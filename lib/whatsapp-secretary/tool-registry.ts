import type { z } from "zod"
import type { OpenAiToolSpec } from "@/lib/ai/openai/client"
import type { WhatsAppAccessPolicy } from "@/lib/whatsapp-access-policy"

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
 * see {@link ALLOWED_MESSAGES_TOOL_NAMES} for why it's still name-guarded. */
export type SecretaryModule = "directory" | "questCoral" | "applications" | "reports" | "clocking" | "outlooks" | "knowledge" | "messages"

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

export type SecretaryToolFactory = () => SecretaryTool[]

/**
 * Aggregates every module's tool factory into one registry, filtered by the
 * caller's access policy. Public/unrecognized senders get an empty list. A
 * future module is one new factory added to this array — nothing else about
 * the orchestrator changes.
 */
export function buildToolRegistry(
  accessPolicy: WhatsAppAccessPolicy,
  factories: Partial<Record<SecretaryModule, SecretaryToolFactory>>,
): Map<string, SecretaryTool> {
  const enabled: SecretaryModule[] = [
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
  ]

  const tools: SecretaryTool[] = []
  for (const module of enabled) {
    const factory = factories[module]
    if (factory) tools.push(...factory())
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
