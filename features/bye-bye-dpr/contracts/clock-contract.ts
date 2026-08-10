import { z } from "zod"
import { isValidIdempotencyKey } from "@/lib/bye-bye-dpr-core"

/**
 * Shared request contracts for the clock in/out endpoints. Mirrors the
 * `*-parser-contract.ts` convention used by Outlook/Directory: one file, zod
 * schemas + `z.infer<>` types, imported by both the route and any future
 * client code so the shape can't drift.
 */

export const idempotencyKeySchema = z.string().refine(isValidIdempotencyKey, "Invalid idempotency key.")

export const geoPointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
})

export const clockSelectionSourceSchema = z.enum(["manual", "nearest", "recent"])

export const clockInRequestSchema = z.object({
  jobId: z.string().min(1).max(200),
  selectionSource: clockSelectionSourceSchema,
  location: geoPointSchema.nullish(),
  idempotencyKey: idempotencyKeySchema,
})
export type ClockInRequest = z.infer<typeof clockInRequestSchema>

export const clockOutRequestSchema = z.object({
  clockRecordId: z.string().min(1).max(200),
  location: geoPointSchema.nullish(),
  idempotencyKey: idempotencyKeySchema,
})
export type ClockOutRequest = z.infer<typeof clockOutRequestSchema>

export const correctClockOutRequestSchema = z.object({
  clockRecordId: z.string().min(1).max(200),
  correctedClockOutAt: z.string().datetime({ offset: true }),
})
export type CorrectClockOutRequest = z.infer<typeof correctClockOutRequestSchema>
