import { z } from "zod"
import type { OutlookTaskStatus } from "@/lib/outlook-core"
import { OUTLOOK_AI_LIMITS } from "@/lib/ai/config-public"

/**
 * Shared contract for the Outlook AI capture flow.
 *
 * This is the boundary between free text / voice transcript and the
 * deterministic domain (`lib/outlook-core.ts`). The model is asked for
 * *suggestions only* — never Firestore documents and never derived fields such
 * as `endDate`, which the scheduler always recomputes. Both the client and the
 * server import these types + zod schemas so the request/response shapes and the
 * runtime validation stay in exactly one place.
 *
 * Reused, not re-declared: the task status enum comes from `outlook-core`, so a
 * suggested status can only ever be a real `OutlookTaskStatus`.
 */

export const OUTLOOK_TASK_STATUSES = [
  "not_started",
  "in_progress",
  "blocked",
  "complete",
] as const satisfies readonly OutlookTaskStatus[]

export const outlookTaskStatusSchema = z.enum(OUTLOOK_TASK_STATUSES)

/**
 * Optional per-field confidence retained for provider compatibility. The live
 * parser does not request it because review provenance is derived
 * deterministically from present/missing values and chip fallbacks.
 */
export const suggestionConfidenceSchema = z
  .object({
    title: z.number().min(0).max(1),
    startDate: z.number().min(0).max(1),
    durationDays: z.number().min(0).max(1),
    trade: z.number().min(0).max(1),
    companyName: z.number().min(0).max(1),
    dependencyReference: z.number().min(0).max(1),
  })
  // Tolerate partial/absent confidence from a provider: default everything to a
  // neutral 0.5 so the review UI still renders instead of rejecting the parse.
  .partial()
  .transform((value) => ({
    title: value.title ?? 0.5,
    startDate: value.startDate ?? 0.5,
    durationDays: value.durationDays ?? 0.5,
    trade: value.trade ?? 0.5,
    companyName: value.companyName ?? 0.5,
    dependencyReference: value.dependencyReference ?? 0.5,
  }))

export type SuggestionConfidence = z.infer<typeof suggestionConfidenceSchema>

/**
 * A single parsed task suggestion. No `id`, no `endDate`, no `companyContextId`:
 * those are all assigned deterministically after user review by
 * `normalize-outlook-suggestions.ts`.
 */
export const parsedOutlookTaskSuggestionSchema = z.object({
  /** Stable id the model assigns so dependency references can point at siblings. */
  clientSuggestionId: z.string().min(1),
  title: z.string(),
  description: z.string().nullish(),
  trade: z.string().nullish(),
  companyName: z.string().nullish(),
  /** ISO date the model *thinks* it heard; never trusted blindly. */
  startDate: z.string().nullish(),
  durationDays: z.number().nullish(),
  /** Free text or a sibling `clientSuggestionId` describing a dependency. */
  dependencyReference: z.string().nullish(),
  status: outlookTaskStatusSchema.nullish(),
  completionPercent: z.number().nullish(),
  confidence: suggestionConfidenceSchema.default({}),
  warnings: z.array(z.string()).default([]),
})

export type ParsedOutlookTaskSuggestion = z.infer<typeof parsedOutlookTaskSuggestionSchema>

/** Context the client sends so the model can disambiguate without guessing. */
export const parseOutlookContextSchema = z.object({
  windowStart: z.string().max(10),
  windowEnd: z.string().max(10),
  /** Client-local "today" as ISO, so relative dates resolve in the user's tz. */
  today: z.string().max(10),
  jobName: z.string().max(200).nullish(),
  location: z.string().max(300).nullish(),
  /** Bounded list of selectable companies (name + id) for confirmed matching. */
  companies: z
    .array(z.object({ id: z.string().max(200), name: z.string().max(200) }))
    .max(200)
    .default([]),
  /** Existing tasks (id/title/dates) so dependencies can point at real tasks. */
  existingTasks: z
    .array(
      z.object({
        id: z.string().max(200),
        title: z.string().max(300),
        startDate: z.string().max(10).nullish(),
        endDate: z.string().max(10).nullish(),
      }),
    )
    .max(120)
    .default([]),
})

export type ParseOutlookContext = z.infer<typeof parseOutlookContextSchema>

/** Request body accepted by `POST /api/outlooks/parse`. */
export const parseOutlookRequestSchema = z.object({
  text: z.string().min(1).max(OUTLOOK_AI_LIMITS.maxTextChars),
  context: parseOutlookContextSchema,
})

export type ParseOutlookRequest = z.infer<typeof parseOutlookRequestSchema>

/** Validated shape returned by the parser (mock or live). */
export const parseOutlookResultSchema = z.object({
  suggestions: z.array(parsedOutlookTaskSuggestionSchema),
  warnings: z.array(z.string()).default([]),
})

export type ParseOutlookResult = z.infer<typeof parseOutlookResultSchema>

/** Full response body of the parse route (adds provider mode for the UI). */
export interface ParseOutlookResponse extends ParseOutlookResult {
  mode: "mock" | "live"
}

/** Response body of the transcribe route. */
export interface TranscribeOutlookResponse {
  transcript: string
  mode: "mock" | "live"
}
