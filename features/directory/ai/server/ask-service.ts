import { canCallProvider, getDirectoryAiConfig, DIRECTORY_AI_LIMITS } from "@/lib/ai/config"
import { AiError } from "@/lib/ai/errors"
import { runToolConversation } from "@/lib/ai/openai/client"
import {
  directoryAskResultSchema,
  type DirectoryAskContext,
  type DirectoryAskDisambiguation,
  type DirectoryAskRefinement,
  type DirectoryAskResponse,
  type DirectorySupportingRecord,
} from "@/features/directory/ai/directory-ask-contract"
import {
  buildAskUserPrompt,
  DIRECTORY_ASK_JSON_SCHEMA,
  DIRECTORY_ASK_SYSTEM_PROMPT,
} from "@/features/directory/ai/server/prompt"
import { mockAnswerFromContext } from "@/features/directory/ai/server/mock-answerer"
import { aggregateToolResults, buildAnswerContext } from "@/features/directory/ai/server/answer-context"
import { extractEntities, indexRecordToListItem } from "@/features/directory/ai/server/entity-extraction"
import { buildQueryPlan } from "@/features/directory/ai/server/query-planner"
import { directoryToolSpecs, runDirectoryTool } from "@/features/directory/ai/server/tools/definitions"
import type {
  DirectoryDataProvider,
  DirectoryToolResult,
  ToolBudget,
} from "@/features/directory/ai/server/tools/types"
import { createServerDirectoryProvider } from "@/features/directory/ai/server/tools/provider"
import type { OutlookAiOperation } from "@/lib/ai/server/safe-log"

/**
 * Ask SVC Directory orchestrator.
 *
 * Pipeline: resolve every named entity → plan the query → deterministically
 * prefetch the data that plan needs → let the model answer (calling more tools
 * only if it must) → return a grounded, structured answer.
 *
 * Because the prefetch usually satisfies the question, the common case costs a
 * single model call. Retrieval is entirely server-side and read-only; the full
 * Directory is never sent to OpenAI.
 */

export interface AskDeps {
  provider: DirectoryDataProvider
}

export function createServerAskDeps(): AskDeps {
  return { provider: createServerDirectoryProvider() }
}

function createBudget(): ToolBudget {
  return {
    maxRecordsPerTool: DIRECTORY_AI_LIMITS.maxRecordsPerTool,
    maxNotesPerTool: DIRECTORY_AI_LIMITS.maxNotesPerTool,
    maxNoteChars: DIRECTORY_AI_LIMITS.maxNoteChars,
    remainingRecords: DIRECTORY_AI_LIMITS.maxTotalRecords,
  }
}

export async function answerDirectoryQuestion(
  input: {
    question: string
    context: DirectoryAskContext
    refinement?: DirectoryAskRefinement | null
    resolvedEntityIds?: string[]
  },
  deps: AskDeps = createServerAskDeps(),
  trace?: { operation: OutlookAiOperation; requestId: string },
): Promise<DirectoryAskResponse | DirectoryAskDisambiguation> {
  const config = getDirectoryAiConfig()

  // Entities the user already pinned or explicitly disambiguated — fetched by
  // id (bounded getAll), never by scanning.
  const pinnedIds = [...new Set([
    ...input.context.entityRefs.map((ref) => ref.id),
    ...(input.resolvedEntityIds ?? []),
  ])].filter(Boolean)
  const pinnedRecords = await Promise.all(pinnedIds.map((id) => deps.provider.getEntity(id)))
  const pinned = pinnedRecords
    .filter((record): record is NonNullable<typeof record> => Boolean(record))
    .map(indexRecordToListItem)

  const extraction = await extractEntities(deps.provider, input.question, pinned)

  // One ambiguous name at a time — never spend a model call on a guess.
  if (extraction.ambiguous.length > 0) {
    const slot = extraction.ambiguous[0]
    return {
      needsDisambiguation: true,
      mention: slot.mention,
      candidates: slot.candidates.map((item) => ({
        id: item.id,
        type: item.type,
        name: item.name,
        subtitle: item.subtitle,
        companyName: item.companyName,
        location: item.location,
        role: item.role,
      })),
    }
  }

  const plan = buildQueryPlan(input.question, extraction)
  const budget = createBudget()
  const calls: Array<{ name: string; result: DirectoryToolResult }> = []

  // Deterministic prefetch — no model call involved.
  for (const invocation of plan.prefetch) {
    const result = await runDirectoryTool(invocation.name, invocation.args, deps.provider, budget)
    calls.push({ name: invocation.name, result })
  }

  // A resolved entity whose relationship tools came back empty must still reach
  // the answer: "X has no contacts linked" is a real answer, whereas an empty
  // record set would wrongly read as "I couldn't find anything".
  const prefetchedRecords = calls.reduce((total, call) => total + (call.result.records?.length ?? 0), 0)
  if (prefetchedRecords === 0 && plan.entities.length > 0) {
    for (const entity of plan.entities.slice(0, 2)) {
      const result = await runDirectoryTool(
        "getEntityDetails",
        { directoryId: entity.item.id },
        deps.provider,
        budget,
      )
      calls.push({ name: "getEntityDetails", result })
    }
  }

  const buildResponse = (
    parsed: ReturnType<typeof directoryAskResultSchema.parse>,
    mode: "mock" | "live",
  ): DirectoryAskResponse => {
    const aggregated = aggregateToolResults(calls)
    const used = new Set(parsed.usedRecordIds)
    // Records the answer cited first, then the rest of what we retrieved.
    const ordered = [
      ...aggregated.records.filter((record) => used.has(record.id)),
      ...aggregated.records.filter((record) => !used.has(record.id)),
    ].slice(0, DIRECTORY_AI_LIMITS.maxTotalRecords)
    const supportingRecords: DirectorySupportingRecord[] = ordered.map((record) => ({
      ...record,
      why: record.relation ?? null,
    }))
    return {
      ...parsed,
      mode,
      questionIntent: plan.intentLabel,
      supportingRecords,
      sourcesUsed: aggregated.sourcesUsed,
      ...(aggregated.paths.length ? { paths: aggregated.paths.slice(0, 3) } : {}),
    }
  }

  if (!canCallProvider(config)) {
    const answerContext = buildAnswerContext(input.question, plan, aggregateToolResults(calls), input.context)
    return buildResponse(directoryAskResultSchema.parse(mockAnswerFromContext(answerContext)), "mock")
  }

  const answerContext = buildAnswerContext(input.question, plan, aggregateToolResults(calls), input.context)
  const { result } = await runToolConversation(
    {
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      timeoutMs: DIRECTORY_AI_LIMITS.providerTimeoutMs,
      trace,
    },
    {
      model: config.askModel,
      system: DIRECTORY_ASK_SYSTEM_PROMPT,
      user: buildAskUserPrompt(input.question, answerContext, input.context, input.refinement, DIRECTORY_AI_LIMITS.maxRecordChars),
      tools: directoryToolSpecs(),
      schema: DIRECTORY_ASK_JSON_SCHEMA,
      maxToolRounds: DIRECTORY_AI_LIMITS.maxToolRounds,
      maxOutputTokens: DIRECTORY_AI_LIMITS.maxAnswerTokens,
      reasoningEffort: config.askModel.startsWith("gpt-5") ? "minimal" : undefined,
      verbosity: config.askModel.startsWith("gpt-5") ? "low" : undefined,
      // Every tool call is validated + budgeted server-side before it runs.
      onToolCalls: async (requested) => {
        const outputs: Array<{ id: string; content: string }> = []
        for (const call of requested) {
          let args: unknown = {}
          try {
            args = call.arguments ? (JSON.parse(call.arguments) as unknown) : {}
          } catch {
            args = {}
          }
          const result = await runDirectoryTool(call.name, args, deps.provider, budget)
          calls.push({ name: call.name, result })
          outputs.push({ id: call.id, content: JSON.stringify(result) })
        }
        return outputs
      },
    },
  )

  const parsed = directoryAskResultSchema.safeParse(result)
  if (!parsed.success) {
    throw new AiError("invalid-output", "The assistant returned data that failed validation.")
  }
  return buildResponse(parsed.data, "live")
}
