import { z } from "zod"
import { DIRECTORY_AI_LIMITS } from "@/lib/ai/config-public"

/**
 * Shared contract for the "Ask SVC Directory" assistant.
 *
 * This is the boundary between a free-text / voice question and the read-only
 * Directory data. Retrieval happens on the client (reusing the already-loaded
 * MiniSearch index + /directoryRelations, all of which the user can already
 * read), so the request carries a *small, bounded* set of records the model may
 * ground its answer on — never the whole Directory. Both client and server
 * import these zod schemas so the request/response shapes and runtime validation
 * live in exactly one place.
 *
 * The model returns an answer grounded ONLY in the provided records. It never
 * writes, edits, or invents Directory data.
 */

/** Directory entity taxonomy (mirrors DirectoryType in lib/directory-core). */
export const directoryEntityTypeSchema = z.enum(["person", "company", "job", "other"])
export type DirectoryEntityType = z.infer<typeof directoryEntityTypeSchema>

/**
 * A single record projected for the model. Long fields are truncated on the
 * client before sending; the max here is a hard server-side backstop.
 */
export const directoryAskRecordSchema = z.object({
  id: z.string().min(1).max(200),
  type: directoryEntityTypeSchema,
  name: z.string().min(1).max(200),
  companyName: z.string().max(200).nullish(),
  location: z.string().max(200).nullish(),
  role: z.string().max(200).nullish(),
  subtitle: z.string().max(300).nullish(),
  description: z.string().max(DIRECTORY_AI_LIMITS.maxRecordChars).nullish(),
  status: z.string().max(80).nullish(),
  /** How this record relates to the primary entity, e.g. "Works at 74 Construction". */
  relation: z.string().max(160).nullish(),
})

export type DirectoryAskRecord = z.infer<typeof directoryAskRecordSchema>

/**
 * Client-detected intent. A hint only — the model is never forced to obey it and
 * the answer is still grounded solely in the provided records.
 */
export const directoryAskIntentSchema = z.enum([
  "who_works_at",
  "jobs_for",
  "summarize",
  "related_to",
  "lookup",
  "general",
])

export type DirectoryAskIntent = z.infer<typeof directoryAskIntentSchema>

/** Optional context chips (person / company / job / location) + page scope. */
export const directoryAskContextSchema = z.object({
  scope: z.enum(["all", "person", "company", "job"]).default("all"),
  today: z.string().max(10).nullish(),
  location: z.string().max(200).nullish(),
  entityRefs: z
    .array(
      z.object({
        id: z.string().max(200),
        type: directoryEntityTypeSchema,
        name: z.string().max(200),
      }),
    )
    .max(4)
    .default([]),
})

export type DirectoryAskContext = z.infer<typeof directoryAskContextSchema>

/**
 * A single lightweight refinement. Only the previous question, a short answer
 * summary, and the previously used record ids are carried — never a full chat
 * history. The server caps how many refinements it will accept.
 */
export const directoryAskRefinementSchema = z.object({
  previousQuestion: z.string().min(1).max(DIRECTORY_AI_LIMITS.maxQuestionChars),
  previousAnswerSummary: z.string().max(DIRECTORY_AI_LIMITS.maxSummaryChars),
  recordIds: z.array(z.string().max(200)).max(DIRECTORY_AI_LIMITS.maxRecords).default([]),
  /** 1-based index of this refinement (1 or 2). */
  step: z.number().int().min(1).max(DIRECTORY_AI_LIMITS.maxRefinements),
})

export type DirectoryAskRefinement = z.infer<typeof directoryAskRefinementSchema>

/**
 * Request body accepted by `POST /api/directory/ask`.
 *
 * Retrieval happens server-side (V2), so the client sends only the question and
 * its page context — never records. `resolvedEntityIds` carries the user's
 * answers to earlier disambiguation prompts so resolution can continue.
 */
export const directoryAskRequestSchema = z.object({
  question: z.string().min(1).max(DIRECTORY_AI_LIMITS.maxQuestionChars),
  context: directoryAskContextSchema.default({}),
  refinement: directoryAskRefinementSchema.nullish(),
  /** Directory ids the user explicitly picked when a name was ambiguous. */
  resolvedEntityIds: z.array(z.string().max(200)).max(8).default([]),
})

export type DirectoryAskRequest = z.infer<typeof directoryAskRequestSchema>

/** Model-authored answer payload, validated before it ever reaches the client. */
export const directoryAskResultSchema = z.object({
  answer: z.string(),
  /** True when the Directory cannot answer the question — a clear empty state. */
  notFound: z.boolean().default(false),
  /** Facts the answer states as fact; each must trace to a retrieved record. */
  confirmedFacts: z.array(z.string()).default([]),
  /** Reasonable, explicitly-hedged interpretations. */
  inferredInsights: z.array(z.string()).default([]),
  /** What the Directory does not contain, or caveats on the answer. */
  limitations: z.array(z.string()).default([]),
  /** Ids of the records the answer actually relied on (drives cards + chips). */
  usedRecordIds: z.array(z.string()).default([]),
  confidence: z.enum(["high", "medium", "low"]).default("medium"),
})

export type DirectoryAskResult = z.infer<typeof directoryAskResultSchema>

/** A record surfaced under the answer as a tappable card. */
export const directorySupportingRecordSchema = directoryAskRecordSchema.extend({
  /** Short reason this record supports the answer. */
  why: z.string().max(200).nullish(),
})

export type DirectorySupportingRecord = z.infer<typeof directorySupportingRecordSchema>

/** One hop of a relationship path cited by the answer. */
export interface DirectoryPathHop {
  id: string
  name: string
  type: string
  role?: string
}

/** Full response body of the ask route. */
export interface DirectoryAskResponse extends DirectoryAskResult {
  mode: "mock" | "live"
  questionIntent: string
  /** Records backing the answer, for the cards below it. */
  supportingRecords: DirectorySupportingRecord[]
  /** Tools/data sources consulted, for the source chips. */
  sourcesUsed: string[]
  /** Relationship chains used to justify a connection, when any. */
  paths?: DirectoryPathHop[][]
}

/**
 * Returned instead of an answer when a name in the question matches several
 * records. The user picks one, and the id comes back in `resolvedEntityIds`.
 */
export interface DirectoryAskDisambiguation {
  needsDisambiguation: true
  mention: string
  candidates: Array<{ id: string; type: DirectoryEntityType; name: string; subtitle?: string; companyName?: string; location?: string; role?: string }>
}

export function isDisambiguation(
  value: DirectoryAskResponse | DirectoryAskDisambiguation,
): value is DirectoryAskDisambiguation {
  return (value as DirectoryAskDisambiguation).needsDisambiguation === true
}

/** Response body of the directory transcribe route. */
export interface TranscribeDirectoryResponse {
  transcript: string
  mode: "mock" | "live"
}
