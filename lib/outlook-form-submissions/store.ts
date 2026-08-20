import type { Firestore, Query } from "firebase-admin/firestore"
import { getFirebaseAdminApp } from "@/lib/ai/server/firebase-admin"
import { createOutlookTask, isIsoDate, mondayForDate, outlookWindow, type OutlookTask } from "@/lib/outlook-core"
import type { OutlookFormSubmitInput, OutlookFormTaskInput } from "./schema"
import {
  MAX_OUTLOOK_FORM_TASKS,
  OUTLOOK_FORM_SUBMISSION_SCHEMA_VERSION,
  type OutlookFormSubmission,
  type OutlookFormSubmissionStatus,
  type OutlookFormSubmitterRole,
} from "./types"

/**
 * Admin-SDK CRUD for outlookFormSubmissions. Shared by the public submit
 * route, the Courtney Roberts Center review routes, and the WhatsApp
 * Secretary's outlook-form tools — one read/write surface, no duplicated
 * Firestore access. No firestore.rules entry exists for this collection at
 * all (default-deny), matching courtneyRobertsCenterConversations' posture —
 * the public form never touches a client Firestore SDK, so no rule is needed.
 */

export const OUTLOOK_FORM_SUBMISSIONS_COLLECTION = "outlookFormSubmissions"

const DEFAULT_PAGE_SIZE = 50
const MAX_PAGE_SIZE = 200

type RecordValue = Record<string, unknown>

async function getAdminDb(): Promise<Firestore> {
  const { getFirestore } = await import("firebase-admin/firestore")
  return getFirestore(await getFirebaseAdminApp())
}

function asRecord(value: unknown): RecordValue | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as RecordValue) : null
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function asSubmitterRole(value: unknown): OutlookFormSubmitterRole {
  return value === "pm" || value === "other" ? value : "site_super"
}

/** Which Monday to anchor the window on — the client's pick if it's a real ISO date, else "this week." Always re-snapped to a Monday here regardless of what the client sent, never trusted as the exact boundary. */
function resolveWindowAnchor(windowStart: string | undefined, now: number): Date {
  if (windowStart && isIsoDate(windowStart)) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(windowStart)
    if (match) return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12))
  }
  return new Date(now)
}

export const resolveWindowAnchorForTests = resolveWindowAnchor

function buildTask(input: OutlookFormTaskInput, sortOrder: number): OutlookTask {
  return createOutlookTask({
    sortOrder,
    title: input.title,
    trade: input.trade,
    companyName: input.companyName,
    startDate: input.startDate || null,
    durationDays: input.durationDays,
    description: input.description,
  })
}

/** Defensive parsing — a malformed/legacy doc degrades to a safe default rather than throwing, same discipline as lib/courtney-roberts-center/read-api.ts. */
function toTask(value: unknown): OutlookTask | null {
  const record = asRecord(value)
  if (!record) return null
  const title = asString(record.title).trim()
  if (!title) return null
  return createOutlookTask({
    id: asString(record.id) || undefined,
    sortOrder: typeof record.sortOrder === "number" ? record.sortOrder : 0,
    title,
    description: asString(record.description),
    trade: asString(record.trade),
    companyName: asString(record.companyName),
    companyContextId: asString(record.companyContextId) || null,
    startDate: asString(record.startDate) || null,
    durationDays: typeof record.durationDays === "number" ? record.durationDays : 1,
    endDate: asString(record.endDate) || null,
    dependencyTaskId: asString(record.dependencyTaskId) || null,
    status:
      record.status === "in_progress" || record.status === "blocked" || record.status === "complete"
        ? record.status
        : "not_started",
    completionPercent: typeof record.completionPercent === "number" ? record.completionPercent : 0,
  })
}

function toSubmission(id: string, data: unknown): OutlookFormSubmission | null {
  const record = asRecord(data)
  if (!record) return null
  const windowRecord = asRecord(record.window)
  const tasks = Array.isArray(record.tasks)
    ? record.tasks.map(toTask).filter((task): task is OutlookTask => task !== null)
    : []
  return {
    id,
    schemaVersion: typeof record.schemaVersion === "number" ? record.schemaVersion : OUTLOOK_FORM_SUBMISSION_SCHEMA_VERSION,
    status: record.status === "reviewed" ? "reviewed" : "new",
    submittedByName: asString(record.submittedByName) || "Unknown",
    submittedByPhone: asString(record.submittedByPhone),
    submittedByCompany: asString(record.submittedByCompany),
    submittedByRole: asSubmitterRole(record.submittedByRole),
    jobName: asString(record.jobName) || "Unspecified job",
    byeByeDprJobId: asString(record.byeByeDprJobId) || null,
    jobContextId: asString(record.jobContextId) || null,
    window: { start: asString(windowRecord?.start), end: asString(windowRecord?.end) },
    tasks,
    generalNotes: asString(record.generalNotes),
    submittedAtMs: typeof record.submittedAtMs === "number" ? record.submittedAtMs : 0,
    reviewedAtMs: typeof record.reviewedAtMs === "number" ? record.reviewedAtMs : null,
    reviewedByUid: asString(record.reviewedByUid) || null,
    reviewedByName: asString(record.reviewedByName) || null,
  }
}

/** Test seam: parsing malformed/legacy Firestore doc shapes is where schema drift would silently corrupt the admin list — worth unit testing directly. */
export const toOutlookFormSubmissionForTests = toSubmission

/** Resolves a picked ByeByeDPR job to its linked Directory context id — never trusts a client-sent contextId. */
async function resolveJobContextId(db: Firestore, byeByeDprJobId: string | null): Promise<string | null> {
  if (!byeByeDprJobId) return null
  const snapshot = await db.collection("jobs").doc(byeByeDprJobId).get()
  return asString(snapshot.data()?.directoryContextId) || null
}

export async function createOutlookFormSubmission(input: OutlookFormSubmitInput): Promise<{ id: string }> {
  const db = await getAdminDb()
  const byeByeDprJobId = input.byeByeDprJobId?.trim() || null
  const jobContextId = await resolveJobContextId(db, byeByeDprJobId)
  const tasks = input.tasks.slice(0, MAX_OUTLOOK_FORM_TASKS).map((task, index) => buildTask(task, index))
  const now = Date.now()

  const ref = await db.collection(OUTLOOK_FORM_SUBMISSIONS_COLLECTION).add({
    schemaVersion: OUTLOOK_FORM_SUBMISSION_SCHEMA_VERSION,
    status: "new" satisfies OutlookFormSubmissionStatus,
    submittedByName: input.submittedByName,
    submittedByPhone: input.submittedByPhone ?? "",
    submittedByCompany: input.submittedByCompany ?? "",
    submittedByRole: input.submittedByRole ?? "site_super",
    jobName: input.jobName,
    byeByeDprJobId,
    jobContextId,
    window: outlookWindow(mondayForDate(resolveWindowAnchor(input.windowStart, now))),
    tasks,
    generalNotes: input.generalNotes ?? "",
    submittedAtMs: now,
    reviewedAtMs: null,
    reviewedByUid: null,
    reviewedByName: null,
  })
  return { id: ref.id }
}

export type ListOutlookFormSubmissionsResult = { submissions: OutlookFormSubmission[]; nextCursor?: string }

/**
 * Newest-first, single-field orderBy (no composite index needed) — same
 * constraint lib/courtney-roberts-center/read-api.ts's own list function
 * accepts. A `jobName`/`status` filter over-fetches a bounded page and
 * filters in memory rather than adding a where() clause, matching the small,
 * admin-scale-collection assumption CRC's own list screen already makes.
 */
export async function listOutlookFormSubmissions(input?: {
  limit?: number
  cursor?: string
  jobName?: string
  status?: OutlookFormSubmissionStatus
}): Promise<ListOutlookFormSubmissionsResult> {
  const db = await getAdminDb()
  const limit = Math.min(Math.max(input?.limit ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE)
  const hasFilter = Boolean(input?.jobName || input?.status)
  const fetchLimit = hasFilter ? MAX_PAGE_SIZE : limit + 1

  let query: Query = db.collection(OUTLOOK_FORM_SUBMISSIONS_COLLECTION).orderBy("submittedAtMs", "desc").limit(fetchLimit)
  const cursorMs = input?.cursor ? Number(input.cursor) : NaN
  if (Number.isFinite(cursorMs)) query = query.startAfter(cursorMs)

  const snapshot = await query.get()
  let submissions = snapshot.docs
    .map((doc) => toSubmission(doc.id, doc.data()))
    .filter((entry): entry is OutlookFormSubmission => entry !== null)

  if (input?.status) submissions = submissions.filter((entry) => entry.status === input.status)
  if (input?.jobName) {
    const needle = input.jobName.trim().toLowerCase()
    submissions = submissions.filter((entry) => entry.jobName.toLowerCase().includes(needle))
  }

  const hasMore = !hasFilter && snapshot.docs.length > limit
  const page = submissions.slice(0, limit)
  return {
    submissions: page,
    ...(hasMore && page.length > 0 ? { nextCursor: String(page[page.length - 1].submittedAtMs) } : {}),
  }
}

export async function getOutlookFormSubmission(id: string): Promise<OutlookFormSubmission | null> {
  const db = await getAdminDb()
  const snapshot = await db.collection(OUTLOOK_FORM_SUBMISSIONS_COLLECTION).doc(id).get()
  if (!snapshot.exists) return null
  return toSubmission(snapshot.id, snapshot.data())
}

export async function markOutlookFormSubmissionReviewed(
  id: string,
  reviewer: { uid: string; name: string },
): Promise<OutlookFormSubmission | null> {
  const db = await getAdminDb()
  const ref = db.collection(OUTLOOK_FORM_SUBMISSIONS_COLLECTION).doc(id)
  const snapshot = await ref.get()
  if (!snapshot.exists) return null

  const now = Date.now()
  const patch = { status: "reviewed" as const, reviewedAtMs: now, reviewedByUid: reviewer.uid, reviewedByName: reviewer.name }
  await ref.set(patch, { merge: true })
  return toSubmission(id, { ...snapshot.data(), ...patch })
}
