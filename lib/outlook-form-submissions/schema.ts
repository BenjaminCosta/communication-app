import { z } from "zod"
import { MAX_OUTLOOK_FORM_TASKS } from "./types"

/**
 * Server-side validation for the public submit route — the one endpoint in
 * this whole feature with no auth gate at all, so input validation carries
 * more weight here than elsewhere in the app.
 */

export const outlookFormTaskInputSchema = z.object({
  title: z.string().trim().min(1).max(160),
  trade: z.string().trim().max(80).optional().default(""),
  companyName: z.string().trim().max(160).optional().default(""),
  startDate: z.string().trim().max(20).optional().default(""),
  durationDays: z.number().finite().optional(),
  description: z.string().trim().max(500).optional().default(""),
})

export const outlookFormSubmitSchema = z.object({
  submittedByName: z.string().trim().min(1).max(120),
  submittedByPhone: z.string().trim().max(40).optional().default(""),
  submittedByCompany: z.string().trim().max(160).optional().default(""),
  submittedByRole: z.enum(["site_super", "pm", "other"]).optional().default("site_super"),
  byeByeDprJobId: z.string().trim().max(200).nullable().optional(),
  jobName: z.string().trim().min(1).max(160),
  // Always re-snapped to a Monday server-side (see store.ts) — this is just
  // which week the super picked, never trusted as the exact window boundary.
  windowStart: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  tasks: z.array(outlookFormTaskInputSchema).max(MAX_OUTLOOK_FORM_TASKS).optional().default([]),
  generalNotes: z.string().trim().max(2000).optional().default(""),
  // Honeypot — a real super never fills this in. Checked by the route, not here.
  website: z.string().max(200).optional().default(""),
})

export type OutlookFormTaskInput = z.infer<typeof outlookFormTaskInputSchema>
export type OutlookFormSubmitInput = z.infer<typeof outlookFormSubmitSchema>
