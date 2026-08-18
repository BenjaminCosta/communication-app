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
  enabledSecretaryModules,
  type SecretaryToolContext,
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
import { createReportWriteTools } from "@/lib/whatsapp-secretary/tools/report-writes"
import { createClockingTools } from "@/lib/whatsapp-secretary/tools/clocking"
import { createOutlooksTools } from "@/lib/whatsapp-secretary/tools/outlooks"
import { createKnowledgeTools } from "@/lib/whatsapp-secretary/tools/knowledge"
import { createMessagesTools } from "@/lib/whatsapp-secretary/tools/messages"
import { createMeTools } from "@/lib/whatsapp-secretary/tools/me"
import { createSvcTools } from "@/lib/whatsapp-secretary/tools/svc"
import { createEntityResolver, type EntityResolver, type ResolvedEntity } from "@/lib/whatsapp-secretary/entity-resolver"
import { formatPendingWriteReply, type PendingWriteEnvelope } from "@/lib/whatsapp-secretary/pending-writes"
import { createServerEntityLookups } from "@/lib/whatsapp-secretary/tools/entity-lookups"
import { selfContextActorFromIdentity } from "@/lib/whatsapp-secretary/self-context"
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

/**
 * A raw `.slice(0, MAX_REPLY_CHARACTERS)` can cut a word in half mid-sentence
 * (found live-testing a reasoning-effort change: a real answer ended
 * "...still marked work-in-progress/product directio"). Trims back to the
 * last whitespace within the limit instead, so a truncated reply always ends
 * on a real word boundary, with an ellipsis to signal it was cut.
 */
function truncateReply(value: string, max: number): string {
  if (value.length <= max) return value
  const cut = value.slice(0, max)
  const lastSpace = cut.lastIndexOf(" ")
  const boundary = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut
  return `${boundary.trimEnd()}…`
}

/**
 * Every module receives the same per-request {@link SecretaryToolContext}.
 *
 * The two modules that need to know *who is asking* (`messages`, `me`) used to
 * be special-cased with bespoke overrides built inline below; the shared
 * context removes that asymmetry, and `resolver` is what lets every module
 * stop resolving entity names on its own.
 */
export const DEFAULT_TOOL_FACTORIES: Record<SecretaryModule, SecretaryToolFactory> = {
  directory: (context) => createDirectoryTools({ resolver: context.resolver }),
  questCoral: (context) => createQuestCoralTools({ resolver: context.resolver }),
  applications: (context) => createApplicationsTools({ resolver: context.resolver }),
  reports: (context) => [
    ...createReportsTools({ resolver: context.resolver }),
    // The one write capability, registered alongside its module's reads so the
    // model can compose them. Yields nothing without a linked account.
    ...(context.canWrite
      ? createReportWriteTools({
          resolver: context.resolver,
          actorUserId: context.actorUserId,
          actorPersonId: context.identity?.personId,
          senderPhoneNumber: context.senderPhoneNumber,
          requestMessageId: context.requestMessageId,
        })
      : []),
  ],
  clocking: (context) => createClockingTools({ resolver: context.resolver }),
  outlooks: (context) => createOutlooksTools({ resolver: context.resolver }),
  knowledge: () => createKnowledgeTools(),
  messages: (context) => createMessagesTools({ resolver: context.resolver, actorUserId: context.actorUserId }),
  me: (context) =>
    context.identity
      ? createMeTools({ actor: selfContextActorFromIdentity(context.identity), enabledModules: context.enabledModules })
      : [],
  svc: (context) => createSvcTools({ resolver: context.resolver, enabledModules: context.enabledModules }),
}

export interface WhatsAppSecretaryAnswerInput {
  /** Full bounded history including the current question as the last, `role: "user"` message. */
  recentMessages: WhatsAppSecretaryConversationMessage[]
  senderIdentity: WhatsAppSenderIdentity | null
  accessPolicy: WhatsAppAccessPolicy
  companyKnowledge: CompanyKnowledgeContext[]
  /** Required for the write framework's deterministic, idempotent record ids. */
  senderPhoneNumber?: string
  requestMessageId?: string
  /** Entities resolved on previous turns — re-seeded so a ref stays valid across the conversation. */
  priorEntities?: ResolvedEntity[]
  /** What previous turns retrieved, so a follow-up can page instead of restarting. */
  priorRetrievals?: Array<{ toolName: string; summary: string; nextCursor?: string }>
}

export interface WhatsAppSecretaryDeps {
  /** Override for tests — defaults to the real per-module tool factories. */
  toolFactories?: Partial<Record<SecretaryModule, SecretaryToolFactory>>
  /** Override for tests — defaults to the real Firestore-backed entity resolver. */
  resolver?: EntityResolver
  /** Override for tests — defaults to the real OpenAI tool-calling loop. */
  runConversation?: typeof runToolConversation
  /** Override for tests — defaults to the real Firestore-backed usage guard. */
  usageGuard?: {
    acquire: typeof acquireWhatsAppSecretaryAiRequest
    complete: typeof completeWhatsAppSecretaryAiRequest
    fail: typeof failWhatsAppSecretaryAiRequest
  }
}

export type WhatsAppSecretaryAnswer = WhatsAppOutgoingReply & {
  /**
   * Server-only, for the webhook to persist. Never sent to WhatsApp: a
   * `pendingWrite` is the confirmation envelope the deterministic layer
   * stores, and `memory` is what makes the next turn's refs and cursors reusable.
   */
  pendingWrite?: PendingWriteEnvelope
  memory?: { resolvedEntities: ResolvedEntity[]; retrievals: Array<{ toolName: string; summary: string; nextCursor?: string }> }
}

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

  const factories: Partial<Record<SecretaryModule, SecretaryToolFactory>> = {
    ...DEFAULT_TOOL_FACTORIES,
    ...deps.toolFactories,
  }
  // One resolver per question, so a name resolved by one tool is the *same*
  // entity for every other tool this turn — and is resolved exactly once.
  const resolver = deps.resolver ?? createEntityResolver(createServerEntityLookups())
  if (input.priorEntities?.length) resolver.hydrate(input.priorEntities)
  const context: SecretaryToolContext = {
    resolver,
    identity: input.senderIdentity,
    ...(input.accessPolicy.actorUserId ? { actorUserId: input.accessPolicy.actorUserId } : {}),
    enabledModules: enabledSecretaryModules(input.accessPolicy),
    canWrite: input.accessPolicy.canCreateDailyReportDraft,
    ...(input.senderPhoneNumber ? { senderPhoneNumber: input.senderPhoneNumber } : {}),
    ...(input.requestMessageId ? { requestMessageId: input.requestMessageId } : {}),
  }
  const tools = buildToolRegistry(input.accessPolicy, factories, context)
  const runConversation = deps.runConversation ?? runToolConversation
  const guard = deps.usageGuard ?? {
    acquire: acquireWhatsAppSecretaryAiRequest,
    complete: completeWhatsAppSecretaryAiRequest,
    fail: failWhatsAppSecretaryAiRequest,
  }

  const config = getWhatsAppSecretaryAiConfig()
  if (!canCallProvider(config)) {
    return { text: "Courtney Roberts is running in a local test mode (no AI provider configured) and can't generate a live answer right now." }
  }

  const system = buildWhatsAppSecretarySystemPrompt({
    senderIdentity: input.senderIdentity,
    companyKnowledge: input.companyKnowledge,
    accessLevel: input.accessPolicy.level,
    ...(input.priorEntities?.length ? { priorEntities: input.priorEntities.map((entity) => ({ ref: entity.ref, kind: entity.kind, name: entity.name })) } : {}),
    ...(input.priorRetrievals?.length ? { priorRetrievals: input.priorRetrievals } : {}),
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
        // "medium" over the old "low" (2026-08-14): only the final, tool-less
        // round ever uses this — every tool-bearing round is forced to "none"
        // regardless (see runToolConversation) — so the latency/cost impact is
        // bounded to one call, not multiplied by maxToolRounds. Verified live
        // against real gpt-5.6-terra across several realistic questions before
        // this change: "medium" and "high" both stayed in the same 1.5-7s
        // range as "low" (no meaningful latency cliff for this model), with
        // "medium" showing modestly more careful synthesis on multi-source
        // questions and no quality regression anywhere. Real token cost here
        // has been low relative to budget, so this trades a small, bounded
        // cost increase for better answers — explicit user call, not a
        // default assumption. Stopped short of "high": the same live test
        // showed no further quality gain over "medium" for this workload, so
        // it would be pure cost with no observed benefit; revisit if a
        // genuinely harder question class shows up.
        reasoningEffort: config.askModel.startsWith("gpt-5") ? "medium" : undefined,
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
    const presented = createWhatsAppSecretaryPresentation({
      answer: truncateReply(parsed.data.answer.trim(), MAX_REPLY_CHARACTERS),
      question: current.content,
      executions: toolExecutions,
    })

    // A write preview's reply text is built deterministically from the
    // envelope, not from the model's prose: the confirmation contract is a
    // safety property, and a paraphrase of "reply CONFIRM DRAFT" is exactly
    // the kind of thing that must not drift.
    const pendingWrite = pendingWriteFromExecutions(toolExecutions)
    const reply: WhatsAppSecretaryAnswer = pendingWrite
      ? { text: formatPendingWriteReply(pendingWrite), pendingWrite }
      : presented

    return {
      ...reply,
      memory: {
        resolvedEntities: resolver.minted(),
        retrievals: toolExecutions
          .filter((execution) => !execution.result.empty)
          .map((execution) => ({
            toolName: execution.name,
            summary: execution.result.summary,
            ...(execution.result.nextCursor ? { nextCursor: execution.result.nextCursor } : {}),
          })),
      },
    }
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

/**
 * Pulls a write preview's envelope off the server-only `presentation` channel.
 * Takes the most recent one: if the model previewed twice in a turn, the last
 * preview is the one the sender was actually shown.
 */
function pendingWriteFromExecutions(executions: WhatsAppSecretaryToolExecution[]): PendingWriteEnvelope | undefined {
  for (const execution of [...executions].reverse()) {
    const presentation = execution.result.presentation as { pendingWrite?: PendingWriteEnvelope } | undefined
    if (presentation?.pendingWrite?.toolName) return presentation.pendingWrite
  }
  return undefined
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
