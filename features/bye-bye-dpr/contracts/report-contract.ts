import { z } from "zod"
import { BYE_BYE_DPR_AI_LIMITS } from "@/lib/ai/config-public"
import { isValidIdempotencyKey } from "@/lib/bye-bye-dpr-core"

const idempotencyKeySchema = z.string().refine(isValidIdempotencyKey, "Invalid idempotency key.")

export const createReportDraftRequestSchema = z.object({
  jobId: z.string().min(1).max(200),
})
export type CreateReportDraftRequest = z.infer<typeof createReportDraftRequestSchema>

// ── Daily report structured data ─────────────────────────────────────────

export const dailyReportStructuredDataSchema = z.object({
  workCompleted: z.string().max(4000).nullable(),
  issuesOrDelays: z.string().max(4000).nullable(),
  nextSteps: z.string().max(4000).nullable(),
})
export type DailyReportStructuredDataInput = z.infer<typeof dailyReportStructuredDataSchema>

// ── Draft mutation / submission ──────────────────────────────────────────

export const updateReportDraftRequestSchema = z.object({
  rawText: z.string().max(BYE_BYE_DPR_AI_LIMITS.maxTextChars).nullish(),
  structuredData: dailyReportStructuredDataSchema.nullish(),
  structuredDataSource: z.enum(["manual", "ai"]).nullish(),
})
export type UpdateReportDraftRequest = z.infer<typeof updateReportDraftRequestSchema>

export const submitReportRequestSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
})
export type SubmitReportRequest = z.infer<typeof submitReportRequestSchema>

export const structureReportDraftRequestSchema = z.object({
  text: z.string().min(1).max(BYE_BYE_DPR_AI_LIMITS.maxTextChars),
  source: z.enum(["voice", "typed"]),
})
export type StructureReportDraftRequest = z.infer<typeof structureReportDraftRequestSchema>
