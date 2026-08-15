import type { z } from "zod"
import type { OpenAiToolSpec } from "@/lib/ai/openai/client"
import type { WhatsAppAccessPolicy } from "@/lib/whatsapp-access-policy"
import type { EntityResolver } from "@/lib/whatsapp-secretary/entity-resolver"
import type { WhatsAppSenderIdentity } from "@/lib/whatsapp-svc-identity"

/**
 * Generic, module-agnostic tool contract for the WhatsApp Secretary
 * orchestrator — generalized from Directory's own `DirectoryTool` contract
 * (`features/directory/ai/server/tools/types.ts`) so every module (Directory,
 * Quest Coral, Applications, ByeByeDPR reports/clocking, Outlooks) can plug
 * into the same registry without the orchestrator knowing anything about
 * Firestore, collection names, or module-specific record shapes.
 *
 * Every tool is READ-ONLY, validates its own arguments server-side (model
 * output is never trusted), and returns a compact, bounded result — never raw
 * documents and never a whole collection.
 */

/** The only modules this registry may ever aggregate. `"knowledge"` is the
 * stable Company Knowledge tools (§ below), not a live SVC data source — it
 * is gated by `companyKnowledgeScope`, not one of the per-module `canRead*`
 * flags, since it is not module-specific data. `"messages"` is the
 * Communications read layer (`lib/whatsapp-secretary/tools/messages.ts`) —
 * see {@link ALLOWED_MESSAGES_TOOL_NAMES} for why it's still name-guarded.
 * `"me"` is the sender's own SVC context
 * (`lib/whatsapp-secretary/tools/me.ts`) — personalization over already-
 * permitted reads, never a wider scope. `"svc"` is the cross-module dossier
 * (`lib/whatsapp-secretary/tools/svc.ts`) — likewise a convenience over reads
 * the other modules already permit, with each section gated by its own
 * module's flag before any query runs. */
export type SecretaryModule = "directory" | "questCoral" | "applications" | "reports" | "clocking" | "outlooks" | "knowledge" | "messages" | "me" | "svc"

/**
 * Bounded tool output. `data` is a compact, module-specific JSON shape (e.g. a
 * short array of records); long text must already be truncated before it
 * leaves the server. `empty` is set when the tool genuinely found nothing, so
 * the model can say so instead of guessing.
 */
export interface SecretaryToolResult {
  /** Short natural-language framing of what the tool found. */
  summary: string
  data?: unknown
  /**
   * Server-only response-presentation metadata. It is intentionally omitted
   * from tool JSON sent to OpenAI, so identifiers/URLs needed for a native
   * WhatsApp CTA never become model context.
   */
  presentation?: unknown
  empty?: boolean
  /**
   * True when this result is a clipped view — by the per-tool cap, by the
   * shared record budget, or by the tool's own page size.
   *
   * Without this the system prompt's standing guardrail ("never say something
   * is missing just because it wasn't in a bounded result") was impossible for
   * the model to actually honor: a short list looked identical whether it was
   * the complete answer or the first few rows that happened to fit. Tools must
   * set it whenever they dropped rows they could otherwise have returned.
   */
  truncated?: boolean
  /** How many records genuinely matched, when the tool can know it cheaply. Pairs with {@link truncated}. */
  totalMatched?: number
  /** Opaque cursor for the next page, when the tool supports paging. */
  nextCursor?: string
}

/**
 * Per-request context every tool factory receives.
 *
 * Before this existed, the two modules that needed to know *who is asking*
 * (`messages`, `me`) were special-cased with bespoke per-request factory
 * overrides in the orchestrator. Passing one context object to every factory
 * generalizes that: a future module needing the actor, the resolver, or the
 * enabled-module list is one more field read, not another override.
 */
export interface SecretaryToolContext {
  /** Shared, per-request "name → entity" resolution. See `entity-resolver.ts`. */
  resolver: EntityResolver
  /** Server-resolved sender. Never model input. */
  identity: WhatsAppSenderIdentity | null
  /** The requesting sender's linked Firebase uid, when they have one. */
  actorUserId?: string
  /** What this sender can actually reach — used by the capability guide. */
  enabledModules: SecretaryModule[]
}

/**
 * Per-question budget shared across every tool call in one conversation,
 * across every module. Structurally identical to Directory's own `ToolBudget`
 * so Directory's tools can be run with this object directly, with no adapter.
 */
export interface SecretaryToolBudget {
  maxRecordsPerTool: number
  /** Directory's note sub-budget. Always 0 for WhatsApp — notes stay excluded. */
  maxNotesPerTool: number
  maxNoteChars: number
  /** Total records/items handed to the model across every tool call in this turn. */
  remainingRecords: number
}

export interface SecretaryTool<Args = unknown> {
  name: string
  module: SecretaryModule
  description: string
  /** JSON Schema advertised to OpenAI. */
  parameters: Record<string, unknown>
  /** Server-side validation — the model's arguments are never trusted. */
  schema: z.ZodType<Args>
  run(args: Args, budget: SecretaryToolBudget): Promise<SecretaryToolResult>
}

function emptyResult(summary: string): SecretaryToolResult {
  return { summary, empty: true }
}

/**
 * Messages/Communications access used to be structurally impossible — any
 * tool name matching this pattern was rejected outright. It is now a
 * reviewed, deliberate capability (`lib/whatsapp-secretary/tools/messages.ts`),
 * with its own privacy split baked into the tools themselves: automatic
 * operational messages are open to any internal sender, but human-written
 * messages are only ever read through a query hard-scoped server-side to the
 * requesting sender's own `visibleToUserIds` — see that file for the actual
 * enforcement, which cannot be expressed as a name-pattern check here.
 *
 * This guard keeps the original defense-in-depth intent for everything else:
 * no *other* module may ever introduce a Messages/Communications-shaped tool
 * by accident. Only the two names below are allowed to match the pattern.
 */
const FORBIDDEN_TOOL_NAME_PATTERN = /message|comms?/i

const ALLOWED_MESSAGES_TOOL_NAMES = new Set(["messages_searchOperationalHistory", "messages_searchMyCommunications"])

export function assertOnlyAllowedMessagesTools(tools: SecretaryTool[]): void {
  for (const tool of tools) {
    if (FORBIDDEN_TOOL_NAME_PATTERN.test(tool.name) && !ALLOWED_MESSAGES_TOOL_NAMES.has(tool.name)) {
      throw new Error(
        `WhatsApp Secretary tool registry only allows the reviewed Messages/Communications tools (found "${tool.name}").`,
      )
    }
  }
}

export type SecretaryToolFactory = (context: SecretaryToolContext) => SecretaryTool[]

/**
 * Shared budget arithmetic, so "how many rows may I return, and was I clipped"
 * is answered identically everywhere instead of being re-derived (slightly
 * differently) in each tool. Returns the allowed page size; the caller reports
 * `truncated` by comparing what it actually had against it.
 */
export function allowedPageSize(budget: SecretaryToolBudget, requested: number | undefined, hardCap: number): number {
  return Math.max(0, Math.min(requested ?? hardCap, hardCap, budget.maxRecordsPerTool, budget.remainingRecords))
}

/**
 * Spends budget for `returned` rows and reports whether the result was clipped.
 * `available` is what the tool could have returned had nothing bounded it —
 * pass the pre-slice length, or `undefined` when the source itself was already
 * limited and the true total isn't known cheaply.
 */
export function spendBudget(
  budget: SecretaryToolBudget,
  returned: number,
  available?: number,
): { truncated?: boolean; totalMatched?: number } {
  budget.remainingRecords -= returned
  const truncated = available !== undefined && available > returned
  return {
    ...(truncated ? { truncated: true } : {}),
    ...(available !== undefined ? { totalMatched: available } : {}),
  }
}

/**
 * The modules one access policy actually turns on, in a stable order.
 *
 * Exported because the capability guide (`me_getSecretaryGuide`) must describe
 * the sender's *real* capabilities, not a hand-maintained prose list that can
 * drift from the registry. Both it and {@link buildToolRegistry} derive from
 * this one function, so a new module can never be advertised without being
 * registered, or registered without being advertised.
 */
export function enabledSecretaryModules(accessPolicy: WhatsAppAccessPolicy): SecretaryModule[] {
  return [
    ...(accessPolicy.canReadDirectory ? (["directory"] as const) : []),
    ...(accessPolicy.canReadQuestCoral ? (["questCoral"] as const) : []),
    ...(accessPolicy.canReadApplications ? (["applications"] as const) : []),
    ...(accessPolicy.canReadReports ? (["reports"] as const) : []),
    ...(accessPolicy.canReadClocking ? (["clocking"] as const) : []),
    ...(accessPolicy.canReadOutlooks ? (["outlooks"] as const) : []),
    ...(accessPolicy.canReadMessages ? (["messages"] as const) : []),
    // Public senders already get a small fixed knowledge slice folded
    // directly into the prompt (`lib/company-knowledge.ts`) with no tool
    // loop at all — see `companyKnowledgeScope`'s doc comment. Deeper,
    // searchable knowledge access is an internal-only capability.
    ...(accessPolicy.companyKnowledgeScope === "internal" ? (["knowledge"] as const) : []),
    ...(accessPolicy.canReadOwnContext ? (["me"] as const) : []),
    // The cross-module dossier is enabled alongside `me` because it is the
    // same kind of capability — a bounded convenience over reads the other
    // modules already permit. Its individual sections are still filtered by
    // those modules' own flags inside the tool.
    ...(accessPolicy.canReadOwnContext ? (["svc"] as const) : []),
  ]
}

/**
 * Aggregates every module's tool factory into one registry, filtered by the
 * caller's access policy. Public/unrecognized senders get an empty list. A
 * future module is one new factory added to this array — nothing else about
 * the orchestrator changes.
 */
export function buildToolRegistry(
  accessPolicy: WhatsAppAccessPolicy,
  factories: Partial<Record<SecretaryModule, SecretaryToolFactory>>,
  context: SecretaryToolContext,
): Map<string, SecretaryTool> {
  const enabled = enabledSecretaryModules(accessPolicy)

  const tools: SecretaryTool[] = []
  for (const module of enabled) {
    const factory = factories[module]
    if (factory) tools.push(...factory(context))
  }

  assertOnlyAllowedMessagesTools(tools)
  return new Map(tools.map((tool) => [tool.name, tool]))
}

export function toolSpecs(tools: Map<string, SecretaryTool>): OpenAiToolSpec[] {
  return [...tools.values()].map((tool) => ({
    type: "function" as const,
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  }))
}

/**
 * Validate + execute one tool call. Unknown names and invalid arguments
 * return a structured error the model can recover from, rather than
 * throwing — mirrors `runDirectoryTool`.
 */
export async function runSecretaryTool(
  tools: Map<string, SecretaryTool>,
  name: string,
  rawArgs: unknown,
  budget: SecretaryToolBudget,
): Promise<SecretaryToolResult> {
  const tool = tools.get(name)
  if (!tool) return emptyResult(`Unknown tool "${name}".`)
  const parsed = tool.schema.safeParse(rawArgs)
  if (!parsed.success) {
    return emptyResult(`Invalid arguments for ${name}. Check the required fields and try again.`)
  }
  try {
    return await tool.run(parsed.data as never, budget)
  } catch {
    return emptyResult(`${name} could not complete.`)
  }
}
