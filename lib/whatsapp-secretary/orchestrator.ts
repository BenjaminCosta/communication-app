import { createHash, randomUUID } from "node:crypto"
import { z } from "zod"
import { canCallProvider, getWhatsAppSecretaryAiConfig, WHATSAPP_SECRETARY_AI_LIMITS } from "@/lib/ai/config"
import { AiError, isAiError } from "@/lib/ai/errors"
import { runToolConversation, type OpenAiToolCall } from "@/lib/ai/openai/client"
import { logWhatsAppSecretaryAi } from "@/lib/ai/server/safe-log"
import type { CompanyKnowledgeContext } from "@/lib/company-knowledge"
import type { WhatsAppAccessPolicy } from "@/lib/whatsapp-access-policy"
import type { WhatsAppSenderIdentity } from "@/lib/whatsapp-svc-identity"
import type { WhatsAppSecretaryConversationMessage } from "@/lib/whatsapp-secretary/types"
import { buildWhatsAppSecretarySystemPrompt, WHATSAPP_SECRETARY_RESULT_SCHEMA } from "@/lib/whatsapp-secretary/prompt"
import {
  buildToolRegistry,
  runSecretaryTool,
  toolSpecs,
  type SecretaryModule,
  type SecretaryTool,
  type SecretaryToolBudget,
  type SecretaryToolFactory,
} from "@/lib/whatsapp-secretary/tool-registry"
import {
  acquireWhatsAppSecretaryAiRequest,
  completeWhatsAppSecretaryAiRequest,
  failWhatsAppSecretaryAiRequest,
} from "@/lib/whatsapp-secretary/usage-guard"
import { createDirectoryTools } from "@/lib/whatsapp-secretary/tools/directory"
import { createQuestCoralTools } from "@/lib/whatsapp-secretary/tools/quest-coral"
import { createApplicationsTools } from "@/lib/whatsapp-secretary/tools/applications"
import { createReportsTools } from "@/lib/whatsapp-secretary/tools/reports"
import { createClockingTools } from "@/lib/whatsapp-secretary/tools/clocking"
import { createOutlooksTools } from "@/lib/whatsapp-secretary/tools/outlooks"
import { createKnowledgeTools } from "@/lib/whatsapp-secretary/tools/knowledge"
import {
  createWhatsAppSecretaryPresentation,
  type WhatsAppOutgoingReply,
  type WhatsAppSecretaryToolExecution,
} from "@/lib/whatsapp-response-ux"

/**
 * WhatsApp Secretary orchestrator — replaces `lib/ai/whatsapp-secretary.ts`'s
 * single-shot `generateWhatsAppSecretaryReply` and `route.ts`'s hardcoded,
 * mutually-exclusive module cascade.
 *
 * The model itself decides which tools to call, across however many modules
 * the question needs, and may call more tools across further rounds
 * (`WHATSAPP_SECRETARY_AI_LIMITS.maxToolRounds`) before it must answer. Every
 * tool is read-only and validated server-side; the orchestrator never talks
 * to Firestore directly.
 */

const MAX_REPLY_CHARACTERS = 700

const DEFAULT_TOOL_FACTORIES: Record<SecretaryModule, SecretaryToolFactory> = {
  directory: createDirectoryTools,
  questCoral: createQuestCoralTools,
  applications: createApplicationsTools,
  reports: createReportsTools,
  clocking: createClockingTools,
  outlooks: createOutlooksTools,
  knowledge: createKnowledgeTools,
}

export interface WhatsAppSecretaryAnswerInput {
  /** Full bounded history including the current question as the last, `role: "user"` message. */
  recentMessages: WhatsAppSecretaryConversationMessage[]
  senderIdentity: WhatsAppSenderIdentity | null
  accessPolicy: WhatsAppAccessPolicy
  companyKnowledge: CompanyKnowledgeContext[]
}

export interface WhatsAppSecretaryDeps {
  /** Override for tests — defaults to the real per-module tool factories. */
  toolFactories?: Partial<Record<SecretaryModule, SecretaryToolFactory>>
  /** Override for tests — defaults to the real OpenAI tool-calling loop. */
  runConversation?: typeof runToolConversation
  /** Override for tests — defaults to the real Firestore-backed usage guard. */
  usageGuard?: {
    acquire: typeof acquireWhatsAppSecretaryAiRequest
    complete: typeof completeWhatsAppSecretaryAiRequest
    fail: typeof failWhatsAppSecretaryAiRequest
  }
}

export type WhatsAppSecretaryAnswer = WhatsAppOutgoingReply

const answerResultSchema = z.object({ answer: z.string() })

function hashRequest(value: string): string {
  return createHash("sha256").update(value).digest("base64url")
}

function createBudget(): SecretaryToolBudget {
  return {
    maxRecordsPerTool: WHATSAPP_SECRETARY_AI_LIMITS.maxRecordsPerTool,
    maxNotesPerTool: WHATSAPP_SECRETARY_AI_LIMITS.maxNotesPerTool,
    maxNoteChars: WHATSAPP_SECRETARY_AI_LIMITS.maxNoteChars,
    remainingRecords: WHATSAPP_SECRETARY_AI_LIMITS.maxTotalRecords,
  }
}

/** Generates a fresh, single-use idempotency key for this call. Message-level
 * retry safety is already guaranteed upstream by `whatsapp-conversation-memory.ts`
 * before the orchestrator is ever invoked a second time for the same message. */
function freshIdempotencyKey(): string {
  return randomUUID().replace(/-/g, "")
}

/**
 * Answers one WhatsApp question. The model may call any tool the sender's
 * access policy exposes, across multiple rounds, before answering. Public/
 * unrecognized senders get an empty tool registry (public knowledge only) and
 * skip the usage guard entirely — they have no server-side identity to key it
 * on, matching how they had no rate limiting under the old single-shot flow.
 */
export async function answerWhatsAppSecretaryQuestion(
  input: WhatsAppSecretaryAnswerInput,
  deps: WhatsAppSecretaryDeps = {},
): Promise<string> {
  return (await answerWhatsAppSecretaryQuestionWithPresentation(input, deps)).text
}

/**
 * Generates the normal grounded answer plus optional native WhatsApp
 * presentation metadata. Tool execution is unchanged: the presentation layer
 * only reuses already-authorized, bounded result objects after the model has
 * finished.
 */
export async function answerWhatsAppSecretaryQuestionWithPresentation(
  input: WhatsAppSecretaryAnswerInput,
  deps: WhatsAppSecretaryDeps = {},
): Promise<WhatsAppSecretaryAnswer> {
  const messages = input.recentMessages.filter((message) => message.content.trim())
  const current = messages.at(-1)
  if (!current || current.role !== "user") {
    throw new Error("A current WhatsApp user message is required.")
  }
  const history = messages.slice(0, -1)

  const factories = { ...DEFAULT_TOOL_FACTORIES, ...deps.toolFactories }
  const tools = buildToolRegistry(input.accessPolicy, factories)
  const runConversation = deps.runConversation ?? runToolConversation
  const guard = deps.usageGuard ?? {
    acquire: acquireWhatsAppSecretaryAiRequest,
    complete: completeWhatsAppSecretaryAiRequest,
    fail: failWhatsAppSecretaryAiRequest,
  }

  const config = getWhatsAppSecretaryAiConfig()
  if (!canCallProvider(config)) {
    return { text: "SVC AI Secretary is running in a local test mode (no AI provider configured) and can't generate a live answer right now." }
  }

  const system = buildWhatsAppSecretarySystemPrompt({
    senderIdentity: input.senderIdentity,
    companyKnowledge: input.companyKnowledge,
    accessLevel: input.accessPolicy.level,
  })

  const uid = input.accessPolicy.actorUserId ?? input.accessPolicy.actorPersonId
  const guarded = input.accessPolicy.level === "internal" && Boolean(uid)
  const requestId = randomUUID()
  let acquired: Awaited<ReturnType<typeof acquireWhatsAppSecretaryAiRequest>> | null = null
  const toolExecutions: WhatsAppSecretaryToolExecution[] = []

  try {
    if (guarded && uid) {
      acquired = await guard.acquire({
        uid,
        requestHash: hashRequest(current.content),
        idempotencyKey: freshIdempotencyKey(),
      })
    }

    const budget = createBudget()
    const { result, toolRounds, toolNames } = await runConversation(
      {
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        timeoutMs: WHATSAPP_SECRETARY_AI_LIMITS.providerTimeoutMs,
        trace: { operation: "ask", requestId },
      },
      {
        model: config.askModel,
        system,
        history: history.map((message) => ({ role: message.role, content: message.content })),
        user: current.content,
        tools: toolSpecs(tools),
        schema: WHATSAPP_SECRETARY_RESULT_SCHEMA,
        maxToolRounds: WHATSAPP_SECRETARY_AI_LIMITS.maxToolRounds,
        maxOutputTokens: WHATSAPP_SECRETARY_AI_LIMITS.maxAnswerTokens,
        // "low" over the old "minimal": one conservative step up in reasoning
        // quality (better intent understanding, tool selection, and relative-date
        // math) while staying well short of "medium"/"high" for Hobby-plan latency.
        reasoningEffort: config.askModel.startsWith("gpt-5") ? "low" : undefined,
        verbosity: config.askModel.startsWith("gpt-5") ? "low" : undefined,
        onToolCalls: (calls) => dispatchToolCalls(tools, calls, budget, toolExecutions),
      },
    )

    const parsed = answerResultSchema.safeParse(result)
    if (!parsed.success) throw new AiError("invalid-output", "The assistant returned data that failed validation.")

    if (acquired && uid) await guard.complete(uid, acquired)
    logWhatsAppSecretaryAi({
      event: "succeeded",
      operation: "ask",
      requestId,
      toolNames,
      emptyToolNames: toolExecutions.filter((execution) => execution.result.empty).map((execution) => execution.name),
      toolRounds,
      recordCount: WHATSAPP_SECRETARY_AI_LIMITS.maxTotalRecords - budget.remainingRecords,
    })
    return createWhatsAppSecretaryPresentation({
      answer: parsed.data.answer.trim().slice(0, MAX_REPLY_CHARACTERS),
      question: current.content,
      executions: toolExecutions,
    })
  } catch (error) {
    if (acquired && uid) await guard.fail(uid, acquired).catch(() => undefined)
    const toolNames = toolExecutions.map((execution) => execution.name)
    const emptyToolNames = toolExecutions.filter((execution) => execution.result.empty).map((execution) => execution.name)
    if (isAiError(error)) {
      logWhatsAppSecretaryAi({ event: "failed", operation: "ask", requestId, errorCode: error.code, toolNames, emptyToolNames })
      // AiError messages are already written to be shown to the user.
      return { text: error.message }
    }
    logWhatsAppSecretaryAi({ event: "failed", operation: "ask", requestId, errorCode: "unknown", toolNames, emptyToolNames })
    throw error
  }
}

/** Every call in a round runs concurrently — independent Firestore reads across
 * modules. The shared budget is still validated/decremented per call; a rare
 * race that lets the shared record cap overshoot slightly is an accepted,
 * low-stakes tradeoff for lower latency (it bounds token cost, not security). */
async function dispatchToolCalls(
  tools: Map<string, SecretaryTool>,
  calls: OpenAiToolCall[],
  budget: SecretaryToolBudget,
  executions: WhatsAppSecretaryToolExecution[],
): Promise<Array<{ id: string; content: string }>> {
  const outputs = await Promise.all(
    calls.map(async (call) => {
      let args: unknown = {}
      try {
        args = call.arguments ? (JSON.parse(call.arguments) as unknown) : {}
      } catch {
        args = {}
      }
      const result = await runSecretaryTool(tools, call.name, args, budget)
      const { presentation: _presentation, ...modelResult } = result
      return { id: call.id, content: JSON.stringify(modelResult), name: call.name, result }
    }),
  )
  executions.push(...outputs.map(({ name, result }) => ({ name, result })))
  return outputs.map(({ id, content }) => ({ id, content }))
}
