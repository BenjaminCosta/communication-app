"use client"

import { auth } from "@/lib/firebase"
import type { ClockSelectionSource, DailyReportStructuredData, GeoPoint, StructuredDataSource } from "@/lib/bye-bye-dpr-core"
import type { ClockRecord, Job, Report, ReportAttachment } from "@/lib/bye-bye-dpr-store"
import type { DirectoryJobSearchResult } from "@/lib/bye-bye-dpr-directory-link"

/**
 * Browser-side callers for the ByeByeDPR API routes.
 *
 * Same shape as features/outlooks/ai/client/outlook-ai-client.ts: every
 * request carries the current Firebase ID token as a bearer credential, and
 * these wrappers own auth + error shaping only — validation of shapes
 * happens on the server via the shared zod schemas in
 * features/bye-bye-dpr/contracts/*.ts. Response types are imported
 * `import type` from the (server-only) lib/bye-bye-dpr-store.ts so the
 * shapes can never drift; type-only imports are erased at compile time and
 * never pull in that file's `server-only` guard at runtime.
 */

export class ByeByeDprClientError extends Error {
  readonly code: string
  readonly httpStatus: number
  constructor(code: string, message: string, httpStatus = 400) {
    super(message)
    this.name = "ByeByeDprClientError"
    this.code = code
    this.httpStatus = httpStatus
  }
}

async function authHeader(): Promise<string> {
  const user = auth.currentUser
  if (!user) throw new ByeByeDprClientError("unauthenticated", "Please sign in again.", 401)
  const token = await user.getIdToken()
  return `Bearer ${token}`
}

export function createByeByeDprIdempotencyKey(): string {
  const browserCrypto = globalThis.crypto
  if (typeof browserCrypto.randomUUID === "function") {
    return browserCrypto.randomUUID().replaceAll("-", "").slice(0, 20)
  }
  const bytes = new Uint8Array(12)
  browserCrypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
}

async function readError(response: Response, fallback: string): Promise<never> {
  let message = fallback
  let code = "request-failed"
  try {
    const body = (await response.json()) as { error?: unknown; code?: unknown }
    if (typeof body.error === "string" && body.error) message = body.error
    if (typeof body.code === "string" && body.code) code = body.code
  } catch {
    /* keep fallback */
  }
  throw new ByeByeDprClientError(code, message, response.status)
}

async function getJson<T>(path: string, fallback: string): Promise<T> {
  const response = await fetch(path, { headers: { Authorization: await authHeader() } })
  if (!response.ok) await readError(response, fallback)
  return (await response.json()) as T
}

async function postJson<T>(path: string, body: unknown, fallback: string): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { Authorization: await authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!response.ok) await readError(response, fallback)
  return (await response.json()) as T
}

async function patchJson<T>(path: string, body: unknown, fallback: string): Promise<T> {
  const response = await fetch(path, {
    method: "PATCH",
    headers: { Authorization: await authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!response.ok) await readError(response, fallback)
  return (await response.json()) as T
}

async function postForm<T>(path: string, form: FormData, fallback: string, extraHeaders?: Record<string, string>): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { Authorization: await authHeader(), ...extraHeaders },
    body: form,
  })
  if (!response.ok) await readError(response, fallback)
  return (await response.json()) as T
}

// ── Jobs ────────────────────────────────────────────────────────────────
// Flat, single-org model — every signed-in user sees every job.

export function fetchJobs(activeOnly = true): Promise<{ jobs: Job[] }> {
  return getJson(`/api/bye-bye-dpr/jobs?activeOnly=${activeOnly}`, "Could not load job sites.")
}

export function fetchRecentJobs(): Promise<{ jobs: Job[] }> {
  return getJson("/api/bye-bye-dpr/jobs/recent", "Could not load recent job sites.")
}

export function fetchNearestJob(location: GeoPoint): Promise<{ match: { job: Job; distanceMeters: number } | null }> {
  return postJson("/api/bye-bye-dpr/jobs/nearest", { location }, "Could not find the nearest job site.")
}

export interface CreateJobInput {
  name: string
  address?: string | null
  latitude?: number | null
  longitude?: number | null
  directoryContextId?: string | null
}

export function createJob(input: CreateJobInput): Promise<{ job: Job }> {
  return postJson("/api/bye-bye-dpr/jobs", input, "Could not add the job site.")
}

/** Bounded name search over existing SVC Directory job contexts — links a new ByeByeDPR job to a real one instead of a disconnected duplicate. */
export function searchDirectoryJobs(query: string): Promise<{ results: DirectoryJobSearchResult[] }> {
  return getJson(`/api/bye-bye-dpr/directory-jobs?q=${encodeURIComponent(query)}`, "Could not search Directory jobs.")
}

// ── Clock ───────────────────────────────────────────────────────────────

export function fetchActiveClock(): Promise<{ clockRecord: ClockRecord | null }> {
  return getJson("/api/bye-bye-dpr/clock/active", "Could not load your clock status.")
}

export function clockIn(input: {
  jobId: string
  selectionSource: ClockSelectionSource
  location?: GeoPoint | null
}): Promise<{ clockRecord: ClockRecord }> {
  return postJson(
    "/api/bye-bye-dpr/clock/in",
    { ...input, idempotencyKey: createByeByeDprIdempotencyKey() },
    "Could not clock in. Try again.",
  )
}

export function clockOut(input: { clockRecordId: string; location?: GeoPoint | null }): Promise<{ clockRecord: ClockRecord }> {
  return postJson(
    "/api/bye-bye-dpr/clock/out",
    { ...input, idempotencyKey: createByeByeDprIdempotencyKey() },
    "Could not clock out. Try again.",
  )
}

export function correctClockOut(input: { clockRecordId: string; correctedClockOutAt: Date }): Promise<{ clockRecord: ClockRecord }> {
  return postJson(
    "/api/bye-bye-dpr/clock/correct",
    { clockRecordId: input.clockRecordId, correctedClockOutAt: input.correctedClockOutAt.toISOString() },
    "Could not update your clock-out time.",
  )
}

// ── Reports ─────────────────────────────────────────────────────────────

export function createReportDraft(jobId: string): Promise<{ report: Report }> {
  return postJson("/api/bye-bye-dpr/reports", { jobId }, "Could not start a new report.")
}

export function fetchReport(reportId: string): Promise<{ report: Report }> {
  return getJson(`/api/bye-bye-dpr/reports/${reportId}`, "Could not load the report.")
}

export function updateReportDraft(
  reportId: string,
  input: { rawText?: string | null; structuredData?: DailyReportStructuredData | null; structuredDataSource?: StructuredDataSource | null },
): Promise<{ report: Report }> {
  return patchJson(`/api/bye-bye-dpr/reports/${reportId}`, input, "Could not save your changes.")
}

export function uploadReportAudio(reportId: string, audio: Blob, fileName: string): Promise<{ audioStoragePath: string }> {
  const form = new FormData()
  form.append("audio", audio, fileName)
  return postForm(`/api/bye-bye-dpr/reports/${reportId}/audio`, form, "Could not save the recording.")
}

export function uploadReportAttachment(reportId: string, file: File): Promise<{ attachment: ReportAttachment }> {
  const form = new FormData()
  form.append("file", file, file.name)
  return postForm(`/api/bye-bye-dpr/reports/${reportId}/attachments`, form, "Could not upload the photo.")
}

export function transcribeReportAudio(
  reportId: string,
  audio: Blob,
  fileName: string,
): Promise<{ transcript: string; mode: "mock" | "live" }> {
  const form = new FormData()
  form.append("audio", audio, fileName)
  return postForm(`/api/bye-bye-dpr/reports/${reportId}/transcribe`, form, "Transcription failed. You can type your update instead.", {
    "X-Idempotency-Key": createByeByeDprIdempotencyKey(),
  })
}

export function structureReportDraft(
  reportId: string,
  input: { text: string; source: "voice" | "typed" },
): Promise<{ structuredData: DailyReportStructuredData; mode: "mock" | "live" }> {
  return postJson(`/api/bye-bye-dpr/reports/${reportId}/structure`, input, "Could not structure your update. You can edit it manually.")
}

export function submitReport(reportId: string): Promise<{ report: Report }> {
  return postJson(`/api/bye-bye-dpr/reports/${reportId}/submit`, { idempotencyKey: createByeByeDprIdempotencyKey() }, "Could not submit the report. Try again.")
}
