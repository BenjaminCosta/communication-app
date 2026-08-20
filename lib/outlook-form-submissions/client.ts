"use client"

/**
 * Public, unauthenticated callers for the 3-Week Outlook intake form
 * (app/outlook-form/page.tsx). No Firebase Auth session is ever involved —
 * these hit two plain public JSON routes, nothing more. Kept isolated from
 * lib/courtney-roberts-center/client.ts (which always attaches a Bearer
 * token) so the import boundary itself makes "this page is public" obvious.
 */

export class OutlookFormClientError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = "OutlookFormClientError"
    this.status = status
  }
}

async function readError(response: Response, fallback: string): Promise<never> {
  let message = fallback
  try {
    const body = (await response.json()) as { error?: unknown }
    if (typeof body.error === "string" && body.error) message = body.error
  } catch {
    /* keep fallback */
  }
  throw new OutlookFormClientError(message, response.status)
}

export type OutlookFormJobOption = { id: string; name: string; address: string | null }

export async function fetchOutlookFormJobs(): Promise<OutlookFormJobOption[]> {
  const response = await fetch("/api/outlook-form/jobs")
  if (!response.ok) await readError(response, "Unable to load jobs.")
  const { jobs } = (await response.json()) as { jobs: OutlookFormJobOption[] }
  return jobs
}

export interface OutlookFormTaskDraft {
  title: string
  trade: string
  companyName: string
  startDate: string
  durationDays: number
  description: string
}

export type OutlookFormSubmitterRole = "site_super" | "pm" | "other"

export interface OutlookFormSubmitPayload {
  submittedByName: string
  submittedByPhone: string
  submittedByCompany: string
  submittedByRole: OutlookFormSubmitterRole
  byeByeDprJobId: string | null
  jobName: string
  /** ISO date, the Monday the 3-week window should start. Server re-snaps to a Monday regardless of what's sent. */
  windowStart: string
  tasks: OutlookFormTaskDraft[]
  generalNotes: string
  /** Honeypot — real supers never fill this in. */
  website: string
}

export async function submitOutlookForm(payload: OutlookFormSubmitPayload): Promise<{ submissionId: string }> {
  const response = await fetch("/api/outlook-form/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
  if (!response.ok) await readError(response, "Unable to submit this form.")
  return (await response.json()) as { submissionId: string }
}
