import "server-only"

/**
 * ByeByeDPR — jobs, clock in/out, reports, Comms integration, PDF (Admin SDK).
 *
 * Flat, single-org model (2026-08-10) — every signed-in user sees every job
 * and can add one; there is no company/role scoping (the multi-tenant
 * scaffolding from the first pass was removed — see
 * docs/svc-bye-bye-dpr-module.md). This matches how the rest of the portal
 * already works (Directory contexts, contacts, etc. are all global to any
 * signed-in user) — ByeByeDPR briefly diverged from that, then rejoined it.
 *
 * Reuses the same lazily-initialized Admin app as the AI routes and
 * Applications (`lib/ai/server/firebase-admin.ts`).
 *
 * `createAutomaticCommsPost()` is the first server-side (Admin SDK) write
 * into the shared `messages` collection in this codebase — see the plan for
 * why: Communications message creation is 100% client-side today
 * (`app/page.tsx`'s `handleSend`), with no shared `createMessage()` helper
 * to call, so this hand-constructs the identical field set, authored as the
 * real acting user.
 */

import { randomUUID } from "node:crypto"
import type { DocumentData, DocumentReference, Firestore } from "firebase-admin/firestore"
import { getFirebaseAdminApp } from "@/lib/ai/server/firebase-admin"
import type { OutlookAiOperation } from "@/lib/ai/server/safe-log"
import {
  durationMinutes,
  emptyDailyReportStructuredData,
  findNearestJob,
  isDailyReportSubmittable,
  isValidGeoPoint,
  validateClockOutCorrection,
  type ClockSelectionSource,
  type ContentSource,
  type DailyReportStructuredData,
  type GeoPoint,
  type StructuredDataSource,
} from "@/lib/bye-bye-dpr-core"
import {
  CLOCK_RECORDS_COLLECTION,
  JOBS_COLLECTION,
  REPORTS_COLLECTION,
  REPORT_ATTACHMENTS_SUBCOLLECTION,
  mapAttachmentDoc,
  mapClockRecordDoc,
  mapJobDoc,
  mapReportDoc,
  mapReportStructuredData,
  type ClockRecord,
  type Job,
  type Report,
  type ReportAttachment,
} from "@/lib/bye-bye-dpr-store"
import { byeByeDprMessageTagIds, type ByeByeDprEventTag } from "@/lib/bye-bye-dpr-tags"
import {
  createDirectoryJobContext,
  geocodeByDirectoryContextId,
  getLiveDirectoryJobNames,
  listGeocodedDirectoryJobs,
  resolveDirectoryJob,
} from "@/lib/bye-bye-dpr-directory-link"
import { computeVisibleToUserIds } from "@/lib/store"
import { structureDailyReportDraft } from "@/features/bye-bye-dpr/ai/server/daily-report-structuring-service"
import { transcribeReportAudio as transcribeReportAudioAi } from "@/features/bye-bye-dpr/ai/server/transcription-service"
import { generateDailyReportPdf } from "@/features/bye-bye-dpr/pdf/generate-daily-report-pdf"

const STORAGE_BUCKET = "svc-comms.firebasestorage.app"
const USERS_COLLECTION = "users"
const RECENT_JOBS_SUBCOLLECTION = "recentJobs"
const MAX_RECENT_JOBS = 5
/** No company model — the PDF header just names the org, same as the UI ("SVC ByeByeDPR"). */
const ORG_NAME = "SVC"

export class ByeByeDprError extends Error {
  readonly code: string
  readonly httpStatus: number
  constructor(code: string, message: string, httpStatus = 400) {
    super(message)
    this.name = "ByeByeDprError"
    this.code = code
    this.httpStatus = httpStatus
  }
}

export interface ByeByeDprPrincipal {
  uid: string
}

async function adminFirestore(): Promise<Firestore> {
  const { getFirestore } = await import("firebase-admin/firestore")
  return getFirestore(await getFirebaseAdminApp())
}

/**
 * Verify the caller's Firebase ID token. Fails closed — no dev/mock
 * fallback, matching `verifyStaffRequest()` in lib/applications-server.ts,
 * since clock/report data deserves the stricter posture.
 */
export async function verifyByeByeDprUserRequest(request: Request): Promise<ByeByeDprPrincipal> {
  const header = request.headers.get("authorization") ?? request.headers.get("Authorization") ?? ""
  const match = header.match(/^Bearer\s+(.+)$/i)
  if (!match) throw new ByeByeDprError("unauthenticated", "Please sign in again.", 401)

  const { getAuth } = await import("firebase-admin/auth")
  const auth = getAuth(await getFirebaseAdminApp())
  try {
    const decoded = await auth.verifyIdToken(match[1].trim())
    return { uid: decoded.uid }
  } catch {
    throw new ByeByeDprError("unauthenticated", "Please sign in again.", 401)
  }
}

function sanitizeStorageName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/_{2,}/g, "_").slice(0, 120) || "file"
}

async function resolveDisplayName(db: Firestore, uid: string): Promise<string> {
  const snap = await db.collection(USERS_COLLECTION).doc(uid).get()
  const name = snap.data()?.name
  return typeof name === "string" && name.trim() ? name.trim() : "Someone"
}

function toDateOrNow(value: unknown): Date {
  if (value instanceof Date) return value
  if (value && typeof value === "object" && "toDate" in value && typeof (value as { toDate: unknown }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate()
  }
  return new Date()
}

// ── Jobs ────────────────────────────────────────────────────────────────

/**
 * Refresh job names against SVC Directory before returning them, so a name
 * edited in Directory after a ByeByeDPR job was linked doesn't go stale.
 * One bounded batch read (`getEntitiesByIds`); never blocks listing on a
 * Directory read failure.
 */
async function overlayLiveDirectoryNames(jobs: Job[]): Promise<Job[]> {
  const linkedIds = jobs.map((job) => job.directoryContextId).filter((id): id is string => Boolean(id))
  if (linkedIds.length === 0) return jobs
  try {
    const liveNames = await getLiveDirectoryJobNames(linkedIds)
    return jobs.map((job) => {
      const liveName = job.directoryContextId ? liveNames.get(job.directoryContextId) : undefined
      return liveName && liveName !== job.name ? { ...job, name: liveName } : job
    })
  } catch {
    return jobs
  }
}

/** Every job, visible to any signed-in user — see the module docstring. */
export async function listJobs(options: { activeOnly?: boolean } = {}): Promise<Job[]> {
  const db = await adminFirestore()
  const snap = await db.collection(JOBS_COLLECTION).get()
  const jobs = snap.docs.map((doc) => mapJobDoc(doc.id, doc.data()))
  const filtered = options.activeOnly ? jobs.filter((job) => job.isActive) : jobs
  const withLiveNames = await overlayLiveDirectoryNames(filtered)
  return withLiveNames.sort((a, b) => a.name.localeCompare(b.name))
}

export interface CreateJobInput {
  name: string
  address?: string | null
  latitude?: number | null
  longitude?: number | null
  directoryContextId?: string | null
  notifyUserIds?: string[] | null
}

/**
 * Not explicitly named in the module spec's service list, but required
 * infrastructure: something has to populate the `jobs` collection ByeByeDPR
 * reads from. Every job here is backed by a real SVC Directory job context
 * (2026-08-10) — either one the worker picked from Directory search
 * (`input.directoryContextId` set) or a brand-new context created alongside
 * it — so the two modules never drift into disconnected, duplicate job
 * lists. See lib/bye-bye-dpr-directory-link.ts. Any signed-in user can add
 * one — no roles in the flat model.
 */
export async function createJob(principal: ByeByeDprPrincipal, input: CreateJobInput): Promise<Job> {
  const requestedName = input.name.trim()
  if (!requestedName) throw new ByeByeDprError("invalid-request", "Job name is required.", 400)
  if ((input.latitude == null) !== (input.longitude == null)) {
    throw new ByeByeDprError("invalid-request", "Provide both latitude and longitude, or neither.", 400)
  }

  let directoryContextId = input.directoryContextId ?? null
  let name = requestedName
  let address = input.address?.trim() || null

  if (directoryContextId) {
    const resolved = await resolveDirectoryJob(directoryContextId)
    if (!resolved) throw new ByeByeDprError("invalid-request", "That Directory job could not be found.", 400)
    name = resolved.name
    address = resolved.address ?? address
  } else {
    directoryContextId = await createDirectoryJobContext(requestedName, principal.uid)
  }

  const db = await adminFirestore()
  const ref = db.collection(JOBS_COLLECTION).doc()
  const now = new Date()
  const data = {
    name,
    address,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    directoryContextId,
    isActive: true,
    notifyUserIds: input.notifyUserIds ?? null,
    createdBy: principal.uid,
    createdAt: now,
    updatedAt: now,
  }
  await ref.set(data)
  return mapJobDoc(ref.id, data)
}

async function getJob(jobId: string): Promise<Job> {
  const db = await adminFirestore()
  const snap = await db.collection(JOBS_COLLECTION).doc(jobId).get()
  if (!snap.exists) throw new ByeByeDprError("not-found", "Job not found.", 404)
  return mapJobDoc(snap.id, snap.data() ?? {})
}

export async function getRecentJobs(principal: ByeByeDprPrincipal): Promise<Job[]> {
  const db = await adminFirestore()
  const recentSnap = await db
    .collection(USERS_COLLECTION)
    .doc(principal.uid)
    .collection(RECENT_JOBS_SUBCOLLECTION)
    .orderBy("viewedAt", "desc")
    .limit(MAX_RECENT_JOBS)
    .get()
  const jobIds = recentSnap.docs.map((doc) => doc.id)
  if (jobIds.length === 0) return []
  const jobs = await Promise.all(jobIds.map((id) => getJob(id).catch(() => null)))
  return jobs.filter((job): job is Job => job !== null)
}

async function recordRecentJob(uid: string, jobId: string): Promise<void> {
  try {
    const db = await adminFirestore()
    await db.collection(USERS_COLLECTION).doc(uid).collection(RECENT_JOBS_SUBCOLLECTION).doc(jobId).set({
      jobId,
      viewedAt: new Date(),
    })
  } catch {
    // Best-effort — never blocks a successful clock-in.
  }
}

export interface NearestJobResult {
  job: Job
  distanceMeters: number
}

/**
 * Fills in coordinates for ByeByeDPR jobs that have a street address but no
 * lat/lng yet (geocoded, cache-first — see lib/bye-bye-dpr-directory-link.ts)
 * and persists the result on the job doc itself, best-effort, so this only
 * ever geocodes a given job once. A job with no address stays uncoordinated
 * — never given a guessed location.
 */
async function withGeocodedCoordinates(jobs: Job[]): Promise<Job[]> {
  const db = await adminFirestore()
  return Promise.all(jobs.map(async (job) => {
    if (job.latitude != null && job.longitude != null) return job
    if (!job.address || !job.directoryContextId) return job
    const point = await geocodeByDirectoryContextId(job.directoryContextId, job.address)
    if (!point) return job
    db.collection(JOBS_COLLECTION).doc(job.id).update({ latitude: point.lat, longitude: point.lng, updatedAt: new Date() }).catch(() => {
      // Best-effort persistence — the result is still used for this request either way.
    })
    return { ...job, latitude: point.lat, longitude: point.lng }
  }))
}

/**
 * Deterministic distance math only — never AI, per the module's own rules.
 * Considers two pools: ByeByeDPR's own jobs (geocoding their stored address
 * on demand if they don't have coordinates yet) and, since 2026-08-11,
 * SVC Directory's broader job catalog (bounded, geocoded, cached — see
 * lib/bye-bye-dpr-directory-link.ts) so nearest-job isn't limited to jobs
 * someone already picked in ByeByeDPR before. If the winner is a Directory
 * job not yet linked locally, it's linked now (same as picking it from
 * search would do) so the response is always a normal, usable `Job`.
 */
export async function suggestNearestJob(principal: ByeByeDprPrincipal, location: GeoPoint): Promise<NearestJobResult | null> {
  if (!isValidGeoPoint(location)) throw new ByeByeDprError("invalid-request", "A valid location is required.", 400)

  const jobs = await listJobs({ activeOnly: true })
  const geocodedJobs = await withGeocodedCoordinates(jobs)
  const withCoordinates = geocodedJobs.filter((job) => job.latitude != null && job.longitude != null)

  const linkedContextIds = new Set(jobs.map((job) => job.directoryContextId).filter((id): id is string => Boolean(id)))
  const directoryCandidates = await listGeocodedDirectoryJobs(linkedContextIds)

  const candidates = [
    ...withCoordinates.map((job) => ({ id: `job:${job.id}`, latitude: job.latitude as number, longitude: job.longitude as number })),
    ...directoryCandidates.map((candidate) => ({ id: `dir:${candidate.directoryContextId}`, latitude: candidate.point.lat, longitude: candidate.point.lng })),
  ]
  const match = findNearestJob(location, candidates)
  if (!match) return null

  if (match.jobId.startsWith("job:")) {
    const job = withCoordinates.find((candidate) => candidate.id === match.jobId.slice(4))
    return job ? { job, distanceMeters: match.distanceMeters } : null
  }

  const directoryContextId = match.jobId.slice(4)
  const candidate = directoryCandidates.find((entry) => entry.directoryContextId === directoryContextId)
  if (!candidate) return null
  const job = await createJob(principal, {
    name: candidate.name,
    directoryContextId,
    latitude: candidate.point.lat,
    longitude: candidate.point.lng,
  })
  return { job, distanceMeters: match.distanceMeters }
}

// ── Communications integration ─────────────────────────────────────────

export interface CreateAutomaticCommsPostInput {
  authorUid: string
  job: Job
  text: string
  event: ByeByeDprEventTag
  /** Optional pre-generated file, rendered by Communications as a clickable attachment card. */
  attachment?: {
    url: string
    name: string
    contentType: string
    size?: number
    path?: string
  }
  /** Used only for report submissions so a retry cannot create a second post. */
  messageId?: string
}

/**
 * Hand-constructs the exact `messages` field set `handleSend` builds
 * client-side in app/page.tsx (authorId/senderId/recipientIds/peopleIds/
 * participants/visibleToUserIds/tagIds/contextIds/...), since no shared
 * createMessage() helper exists to call. Authored as the real acting user —
 * nothing in the schema/rules/UI supports a synthetic system sender.
 * Recipients default to every registered user (this app is single-org —
 * see the module docstring) unless the job overrides with `notifyUserIds`.
 */
export async function createAutomaticCommsPost(input: CreateAutomaticCommsPostInput): Promise<string> {
  const db = await adminFirestore()
  const { FieldValue } = await import("firebase-admin/firestore")

  let recipientIds: string[]
  if (input.job.notifyUserIds && input.job.notifyUserIds.length > 0) {
    recipientIds = input.job.notifyUserIds.filter((id) => id !== input.authorUid)
  } else {
    const membersSnap = await db.collection(USERS_COLLECTION).get()
    recipientIds = membersSnap.docs.map((doc) => doc.id).filter((id) => id !== input.authorUid)
  }

  const visibleToUserIds = computeVisibleToUserIds(input.authorUid, recipientIds)
  const tagIds = byeByeDprMessageTagIds(input.event)
  const contextIds = input.job.directoryContextId ? [input.job.directoryContextId] : []

  const msgData = {
    authorId: input.authorUid,
    senderId: input.authorUid,
    recipientIds,
    peopleIds: recipientIds,
    participants: [input.authorUid, ...recipientIds],
    visibleToUserIds,
    projectIds: [] as string[],
    projectId: null,
    tagIds,
    content: input.text,
    text: input.text,
    type: "none" as const,
    contactIds: [] as string[],
    contextIds,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    timestamp: FieldValue.serverTimestamp(),
    isFavorited: false,
    ...(input.attachment
      ? {
          fileUrl: input.attachment.url,
          fileName: input.attachment.name,
          fileContentType: input.attachment.contentType,
          ...(typeof input.attachment.size === "number" ? { fileSize: input.attachment.size } : {}),
          ...(input.attachment.path ? { filePath: input.attachment.path } : {}),
        }
      : {}),
  }

  if (input.messageId) {
    const ref = db.collection("messages").doc(input.messageId)
    if (!((await ref.get()).exists)) {
      try {
        await ref.create(msgData)
      } catch (error) {
        // A concurrent retry can create the deterministic document between the
        // read and create. It is the same report post, so re-use it.
        if (!((await ref.get()).exists)) throw error
      }
    }
    return ref.id
  }

  const ref = await db.collection("messages").add(msgData)
  return ref.id
}

function clockEventText(userName: string, jobName: string, when: Date, kind: "in" | "out"): string {
  const time = when.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
  return kind === "in" ? `${userName} clocked in at ${jobName} at ${time}.` : `${userName} clocked out from ${jobName} at ${time}.`
}

// ── Clock in/out ────────────────────────────────────────────────────────

export async function getActiveClock(principal: ByeByeDprPrincipal): Promise<ClockRecord | null> {
  const db = await adminFirestore()
  const snap = await db
    .collection(CLOCK_RECORDS_COLLECTION)
    .where("userId", "==", principal.uid)
    .where("status", "==", "active")
    .limit(1)
    .get()
  return snap.empty ? null : mapClockRecordDoc(snap.docs[0].id, snap.docs[0].data())
}

async function ensureClockInCommsPost(db: Firestore, recordId: string, data: DocumentData, job: Job, uid: string): Promise<ClockRecord> {
  if (data.commsClockInMessageId) return mapClockRecordDoc(recordId, data)
  try {
    const userName = await resolveDisplayName(db, uid)
    const text = clockEventText(userName, job.name, toDateOrNow(data.clockInAt), "in")
    const messageId = await createAutomaticCommsPost({ authorUid: uid, job, text, event: "clock-in" })
    await db.collection(CLOCK_RECORDS_COLLECTION).doc(recordId).update({ commsClockInMessageId: messageId, updatedAt: new Date() })
    return mapClockRecordDoc(recordId, { ...data, commsClockInMessageId: messageId })
  } catch {
    // The clock-in itself already succeeded; a later retry will try the post again.
    return mapClockRecordDoc(recordId, data)
  }
}

async function ensureClockOutCommsPost(db: Firestore, recordId: string, data: DocumentData, job: Job, uid: string): Promise<ClockRecord> {
  if (data.commsClockOutMessageId) return mapClockRecordDoc(recordId, data)
  try {
    const userName = await resolveDisplayName(db, uid)
    const text = clockEventText(userName, job.name, toDateOrNow(data.clockOutAt), "out")
    const messageId = await createAutomaticCommsPost({ authorUid: uid, job, text, event: "clock-out" })
    await db.collection(CLOCK_RECORDS_COLLECTION).doc(recordId).update({ commsClockOutMessageId: messageId, updatedAt: new Date() })
    return mapClockRecordDoc(recordId, { ...data, commsClockOutMessageId: messageId })
  } catch {
    return mapClockRecordDoc(recordId, data)
  }
}

export interface ClockInInput {
  jobId: string
  selectionSource: ClockSelectionSource
  location?: GeoPoint | null
  idempotencyKey: string
}

export async function clockIn(principal: ByeByeDprPrincipal, input: ClockInInput): Promise<ClockRecord> {
  if (input.location != null && !isValidGeoPoint(input.location)) {
    throw new ByeByeDprError("invalid-request", "Invalid location.", 400)
  }
  const job = await getJob(input.jobId)
  if (!job.isActive) throw new ByeByeDprError("invalid-request", "This job is no longer active.", 400)

  const db = await adminFirestore()

  // Idempotent retry: the same key returns the existing record (and, if the
  // Comms post didn't make it the first time, attempts it again) instead of
  // erroring or creating a duplicate.
  const existingByKey = await db
    .collection(CLOCK_RECORDS_COLLECTION)
    .where("userId", "==", principal.uid)
    .where("idempotencyKey", "==", input.idempotencyKey)
    .limit(1)
    .get()
  if (!existingByKey.empty) {
    const existingDoc = existingByKey.docs[0]
    return ensureClockInCommsPost(db, existingDoc.id, existingDoc.data(), job, principal.uid)
  }

  const ref = db.collection(CLOCK_RECORDS_COLLECTION).doc()
  const now = new Date()

  await db.runTransaction(async (tx) => {
    const activeQuery = db
      .collection(CLOCK_RECORDS_COLLECTION)
      .where("userId", "==", principal.uid)
      .where("status", "==", "active")
    const activeSnap = await tx.get(activeQuery)
    if (!activeSnap.empty) {
      throw new ByeByeDprError("already-clocked-in", "You're already clocked in. Clock out first.", 409)
    }
    tx.set(ref, {
      userId: principal.uid,
      jobId: job.id,
      status: "active",
      clockInAt: now,
      clockOutAt: null,
      durationMinutes: null,
      clockInLocation: input.location ?? null,
      clockOutLocation: null,
      selectionSource: input.selectionSource,
      manuallyCorrected: false,
      correctionMetadata: null,
      idempotencyKey: input.idempotencyKey,
      commsClockInMessageId: null,
      commsClockOutMessageId: null,
      createdAt: now,
      updatedAt: now,
    })
  })

  recordRecentJob(principal.uid, job.id)

  const snap = await ref.get()
  return ensureClockInCommsPost(db, ref.id, snap.data() ?? {}, job, principal.uid)
}

export interface ClockOutInput {
  clockRecordId: string
  location?: GeoPoint | null
  idempotencyKey: string
}

export async function clockOut(principal: ByeByeDprPrincipal, input: ClockOutInput): Promise<ClockRecord> {
  if (input.location != null && !isValidGeoPoint(input.location)) {
    throw new ByeByeDprError("invalid-request", "Invalid location.", 400)
  }
  const db = await adminFirestore()
  const ref = db.collection(CLOCK_RECORDS_COLLECTION).doc(input.clockRecordId)
  const snap = await ref.get()
  if (!snap.exists) throw new ByeByeDprError("not-found", "Clock record not found.", 404)
  const data = snap.data() ?? {}
  if (data.userId !== principal.uid) throw new ByeByeDprError("forbidden", "You can only clock yourself out.", 403)

  const job = await getJob(data.jobId)

  if (data.status === "closed") {
    // Already closed — any retry is by definition the same logical action.
    return ensureClockOutCommsPost(db, ref.id, data, job, principal.uid)
  }

  const clockInAt = toDateOrNow(data.clockInAt)
  const now = new Date()
  const minutes = durationMinutes(clockInAt, now)

  await ref.update({
    status: "closed",
    clockOutAt: now,
    durationMinutes: minutes,
    clockOutLocation: input.location ?? null,
    idempotencyKey: input.idempotencyKey,
    updatedAt: now,
  })

  const updatedSnap = await ref.get()
  return ensureClockOutCommsPost(db, ref.id, updatedSnap.data() ?? {}, job, principal.uid)
}

export interface CorrectClockOutInput {
  clockRecordId: string
  correctedClockOutAt: Date
}

/**
 * Forgot to clock out: lets the user fix their own clock-out time with no
 * supervisor approval, per the module's rules — but always stamps audit
 * metadata (previous value, who/when corrected).
 */
export async function correctClockOut(principal: ByeByeDprPrincipal, input: CorrectClockOutInput): Promise<ClockRecord> {
  const db = await adminFirestore()
  const ref = db.collection(CLOCK_RECORDS_COLLECTION).doc(input.clockRecordId)
  const snap = await ref.get()
  if (!snap.exists) throw new ByeByeDprError("not-found", "Clock record not found.", 404)
  const data = snap.data() ?? {}
  if (data.userId !== principal.uid) throw new ByeByeDprError("forbidden", "You can only correct your own clock record.", 403)

  const clockInAt = toDateOrNow(data.clockInAt)
  const now = new Date()
  const check = validateClockOutCorrection(clockInAt, input.correctedClockOutAt, now)
  if (!check.ok) throw new ByeByeDprError("invalid-request", check.reason ?? "Invalid corrected time.", 400)

  const previousClockOutAt = data.clockOutAt ?? null
  const minutes = durationMinutes(clockInAt, input.correctedClockOutAt)
  const wasAlreadyClosed = data.status === "closed"

  await ref.update({
    status: "closed",
    clockOutAt: input.correctedClockOutAt,
    durationMinutes: minutes,
    manuallyCorrected: true,
    correctionMetadata: {
      previousClockOutAt,
      correctedTimestamp: input.correctedClockOutAt,
      correctionCreatedAt: now,
      correctedBy: principal.uid,
    },
    updatedAt: now,
  })

  const updatedSnap = await ref.get()
  const updatedData = updatedSnap.data() ?? {}

  // Only post a Comms message the first time this record becomes closed — a
  // later correction to an already-posted clock-out doesn't spam a second
  // activity message; the audit trail lives in correctionMetadata instead.
  if (wasAlreadyClosed) return mapClockRecordDoc(ref.id, updatedData)
  const job = await getJob(data.jobId)
  return ensureClockOutCommsPost(db, ref.id, updatedData, job, principal.uid)
}

// ── Reports ─────────────────────────────────────────────────────────────

interface OwnedReportRef {
  ref: FirebaseFirestore.DocumentReference
  data: DocumentData
}

async function requireOwnedReport(principal: ByeByeDprPrincipal, reportId: string): Promise<OwnedReportRef> {
  const db = await adminFirestore()
  const ref = db.collection(REPORTS_COLLECTION).doc(reportId)
  const snap = await ref.get()
  if (!snap.exists) throw new ByeByeDprError("not-found", "Report not found.", 404)
  const data = snap.data() ?? {}
  if (data.authorId !== principal.uid) throw new ByeByeDprError("forbidden", "You can only edit your own report.", 403)
  return { ref, data }
}

async function requireOwnedDraftReport(principal: ByeByeDprPrincipal, reportId: string): Promise<OwnedReportRef> {
  const owned = await requireOwnedReport(principal, reportId)
  if (owned.data.status !== "draft") {
    throw new ByeByeDprError("invalid-request", "This report has already been submitted.", 409)
  }
  return owned
}

export async function getReport(principal: ByeByeDprPrincipal, reportId: string): Promise<Report> {
  const { ref, data } = await requireOwnedReport(principal, reportId)
  return mapReportDoc(ref.id, data)
}

export interface CreateReportDraftInput {
  jobId: string
}

export async function createReportDraft(principal: ByeByeDprPrincipal, input: CreateReportDraftInput): Promise<Report> {
  const job = await getJob(input.jobId)
  const db = await adminFirestore()
  const ref = db.collection(REPORTS_COLLECTION).doc()
  const now = new Date()
  const data = {
    jobId: job.id,
    authorId: principal.uid,
    type: "daily_report" as const,
    status: "draft" as const,
    rawText: null,
    transcription: null,
    transcriptionSource: null,
    structuredData: emptyDailyReportStructuredData(),
    structuredDataSource: null,
    audioStoragePath: null,
    pdfStoragePath: null,
    commsMessageId: null,
    idempotencyKey: null,
    createdAt: now,
    updatedAt: now,
    submittedAt: null,
  }
  await ref.set(data)
  return mapReportDoc(ref.id, data)
}

export interface UploadBytesInput {
  bytes: Uint8Array
  contentType: string
  fileName: string
}

export async function uploadReportAudio(
  principal: ByeByeDprPrincipal,
  reportId: string,
  input: UploadBytesInput,
): Promise<{ audioStoragePath: string }> {
  const { ref } = await requireOwnedDraftReport(principal, reportId)
  const { getStorage } = await import("firebase-admin/storage")
  const bucket = getStorage(await getFirebaseAdminApp()).bucket(STORAGE_BUCKET)
  const safeName = sanitizeStorageName(input.fileName)
  const audioStoragePath = `byebye-dpr/reports/${reportId}/audio/${Date.now()}-${safeName}`
  await bucket.file(audioStoragePath).save(Buffer.from(input.bytes), {
    contentType: input.contentType,
    metadata: { cacheControl: "private, max-age=0" },
  })
  await ref.update({ audioStoragePath, updatedAt: new Date() })
  return { audioStoragePath }
}

export async function uploadReportAttachment(
  principal: ByeByeDprPrincipal,
  reportId: string,
  input: UploadBytesInput,
): Promise<ReportAttachment> {
  await requireOwnedDraftReport(principal, reportId)
  const db = await adminFirestore()
  const { getStorage } = await import("firebase-admin/storage")
  const bucket = getStorage(await getFirebaseAdminApp()).bucket(STORAGE_BUCKET)
  const safeName = sanitizeStorageName(input.fileName)
  const storagePath = `byebye-dpr/reports/${reportId}/attachments/${Date.now()}-${safeName}`
  await bucket.file(storagePath).save(Buffer.from(input.bytes), {
    contentType: input.contentType,
    metadata: { cacheControl: "private, max-age=0" },
  })
  const attachmentRef = db.collection(REPORTS_COLLECTION).doc(reportId).collection(REPORT_ATTACHMENTS_SUBCOLLECTION).doc()
  const now = new Date()
  const attachmentData = {
    storagePath,
    fileName: input.fileName,
    mimeType: input.contentType,
    size: input.bytes.byteLength,
    uploadedBy: principal.uid,
    createdAt: now,
  }
  await attachmentRef.set(attachmentData)
  return mapAttachmentDoc(attachmentRef.id, attachmentData)
}

export async function transcribeReportAudio(
  principal: ByeByeDprPrincipal,
  reportId: string,
  input: { bytes: Uint8Array; contentType: string; fileName: string; language?: string },
): Promise<{ transcript: string; mode: "mock" | "live" }> {
  const { ref } = await requireOwnedDraftReport(principal, reportId)
  const trace = { operation: "transcription" as OutlookAiOperation, requestId: randomUUID() }
  const blob = new Blob([input.bytes], { type: input.contentType })
  const result = await transcribeReportAudioAi({ file: blob, fileName: input.fileName, language: input.language }, trace)
  await ref.update({
    transcription: result.transcript,
    rawText: result.transcript,
    transcriptionSource: "voice" satisfies ContentSource,
    updatedAt: new Date(),
  })
  return result
}

export interface StructureReportDraftResult {
  structuredData: DailyReportStructuredData
  mode: "mock" | "live"
}

export async function structureReportDraft(
  principal: ByeByeDprPrincipal,
  reportId: string,
  input: { text: string; source: ContentSource },
): Promise<StructureReportDraftResult> {
  const { ref } = await requireOwnedDraftReport(principal, reportId)
  const trace = { operation: "generation" as OutlookAiOperation, requestId: randomUUID() }

  const result = await structureDailyReportDraft(input.text, trace)
  await ref.update({
    rawText: input.text,
    transcriptionSource: input.source,
    structuredData: result.structuredData,
    structuredDataSource: "ai" satisfies StructuredDataSource,
    updatedAt: new Date(),
  })
  return { structuredData: result.structuredData, mode: result.mode }
}

export interface UpdateReportDraftInput {
  rawText?: string | null
  structuredData?: unknown
  structuredDataSource?: StructuredDataSource | null
}

export async function updateReportDraft(
  principal: ByeByeDprPrincipal,
  reportId: string,
  input: UpdateReportDraftInput,
): Promise<Report> {
  const { ref } = await requireOwnedDraftReport(principal, reportId)
  const patch: Record<string, unknown> = { updatedAt: new Date() }

  if (input.rawText !== undefined) patch.rawText = input.rawText

  if (input.structuredData !== undefined) {
    const value = input.structuredData
    const shapeOk = typeof value === "object" && value !== null && "workCompleted" in value
    if (!shapeOk) throw new ByeByeDprError("invalid-request", "Structured data does not match the daily report shape.", 400)
    patch.structuredData = value
  }

  if (input.structuredDataSource !== undefined) patch.structuredDataSource = input.structuredDataSource

  await ref.update(patch)
  const updated = await ref.get()
  return mapReportDoc(ref.id, updated.data() ?? {})
}

/** Idempotent: returns the existing path without regenerating if a PDF was already produced. */
export async function generateReportPdf(principal: ByeByeDprPrincipal, reportId: string): Promise<{ pdfStoragePath: string; sizeBytes: number }> {
  const { ref, data } = await requireOwnedReport(principal, reportId)
  if (typeof data.pdfStoragePath === "string" && data.pdfStoragePath) {
    const sizeBytes = typeof data.pdfSizeBytes === "number" ? data.pdfSizeBytes : 0
    return { pdfStoragePath: data.pdfStoragePath, sizeBytes }
  }

  const db = await adminFirestore()
  const [jobSnap, authorName] = await Promise.all([
    db.collection(JOBS_COLLECTION).doc(data.jobId).get(),
    resolveDisplayName(db, data.authorId),
  ])
  const jobName = typeof jobSnap.data()?.name === "string" ? (jobSnap.data()!.name as string) : "Job"
  const report = mapReportDoc(ref.id, data)

  const pdfBytes = await generateDailyReportPdf({
    companyName: ORG_NAME,
    jobName,
    authorName,
    createdAtIso: report.createdAt ?? new Date().toISOString(),
    submittedAtIso: report.submittedAt,
    structuredData: report.structuredData as DailyReportStructuredData,
    rawText: report.rawText,
  })

  const { getStorage } = await import("firebase-admin/storage")
  const bucket = getStorage(await getFirebaseAdminApp()).bucket(STORAGE_BUCKET)
  const pdfPath = `byebye-dpr/reports/${reportId}/pdf/${Date.now()}-report.pdf`
  await bucket.file(pdfPath).save(Buffer.from(pdfBytes), { contentType: "application/pdf", metadata: { cacheControl: "private, max-age=0" } })
  await ref.update({ pdfStoragePath: pdfPath, pdfSizeBytes: pdfBytes.length, updatedAt: new Date() })
  return { pdfStoragePath: pdfPath, sizeBytes: pdfBytes.length }
}

export interface DailyReportPdfAttachment {
  url: string
  path: string
  name: string
  contentType: "application/pdf"
  size: number
}

/**
 * Creates the same attachment shape Communications already uses for a
 * Three-Week Outlook. The URL is a read-only signed Storage URL so a message
 * recipient can open the generated report directly from the feed.
 */
export async function createDailyReportPdfAttachment(input: {
  pdfStoragePath: string
  pdfSizeBytes: number
  jobName: string
  submittedAt: string | null
}): Promise<DailyReportPdfAttachment> {
  const { getStorage } = await import("firebase-admin/storage")
  const bucket = getStorage(await getFirebaseAdminApp()).bucket(STORAGE_BUCKET)
  const [url] = await bucket.file(input.pdfStoragePath).getSignedUrl({ action: "read", expires: "01-01-2500" })
  const submittedDate = new Date(input.submittedAt ?? Date.now())
  const dateLabel = Number.isNaN(submittedDate.getTime()) ? "report" : submittedDate.toISOString().slice(0, 10)
  return {
    url,
    path: input.pdfStoragePath,
    name: `Daily Report - ${input.jobName} - ${dateLabel}.pdf`,
    contentType: "application/pdf",
    size: input.pdfSizeBytes,
  }
}

function dailyReportCommsMessageId(reportId: string): string {
  return `byebye-dpr-report-${reportId}`
}

/**
 * Makes a Daily Report post self-healing: an older text-only message receives
 * its PDF card, and a retry after an interrupted publish reuses one stable
 * message document instead of creating another post.
 */
async function ensureDailyReportCommsPdfAttachment(input: {
  db: Firestore
  reportRef: DocumentReference
  reportId: string
  reportData: DocumentData
  job: Job
  authorUid: string
  attachment: DailyReportPdfAttachment
}): Promise<void> {
  const existingMessageId = typeof input.reportData.commsMessageId === "string" ? input.reportData.commsMessageId : null
  if (existingMessageId) {
    const messageRef = input.db.collection("messages").doc(existingMessageId)
    const messageSnap = await messageRef.get()
    if (messageSnap.exists) {
      if (typeof messageSnap.data()?.fileUrl !== "string" || !messageSnap.data()?.fileUrl) {
        await messageRef.update({
          fileUrl: input.attachment.url,
          fileName: input.attachment.name,
          fileContentType: input.attachment.contentType,
          fileSize: input.attachment.size,
          filePath: input.attachment.path,
          updatedAt: new Date(),
        })
      }
      return
    }
  }

  const authorName = await resolveDisplayName(input.db, input.authorUid)
  const messageId = await createAutomaticCommsPost({
    authorUid: input.authorUid,
    job: input.job,
    text: `${authorName} submitted a Daily Report for ${input.job.name}.`,
    event: "daily-report",
    attachment: input.attachment,
    messageId: existingMessageId ?? dailyReportCommsMessageId(input.reportId),
  })
  if (messageId !== existingMessageId) {
    await input.reportRef.update({ commsMessageId: messageId, updatedAt: new Date() })
  }
}

/** Turns the reviewed report into a Directory note — never invents content. */
function summarizeDailyReportForNote(structuredData: DailyReportStructuredData, rawText: string | null): string {
  const parts: string[] = []
  if (structuredData.workCompleted) parts.push(`Work completed: ${structuredData.workCompleted}`)
  if (structuredData.issuesOrDelays) parts.push(`Issues or delays: ${structuredData.issuesOrDelays}`)
  if (structuredData.nextSteps) parts.push(`Next steps: ${structuredData.nextSteps}`)
  return parts.join("\n\n") || rawText?.trim() || "Daily report submitted."
}

/**
 * Files a submitted report into SVC Directory, so it shows up on the job's
 * own profile — not just buried in ByeByeDPR's own `reports` collection.
 * Two writes, matching the two purposes Directory already has dedicated,
 * previously-unused types for: a `directoryFiles` doc (category "report")
 * for the actual PDF, and a `directoryNotes` doc (noteType "daily_report")
 * with a readable summary, so it surfaces in the job's activity feed too.
 * Best-effort — a submitted report is already a success without this.
 */
async function fileReportIntoDirectory(
  db: Firestore,
  job: Job,
  report: Report,
  pdfAttachment: DailyReportPdfAttachment,
  authorUid: string,
): Promise<void> {
  if (!job.directoryContextId) return
  try {
    const now = new Date()
    const submittedOn = new Date(report.submittedAt ?? now.toISOString()).toLocaleDateString()

    await db.collection("directoryFiles").add({
      entityIds: [job.directoryContextId],
      storagePath: pdfAttachment.path,
      downloadUrl: pdfAttachment.url,
      fileName: `Daily Report - ${job.name} - ${submittedOn}.pdf`,
      mimeType: pdfAttachment.contentType,
      size: pdfAttachment.size,
      category: "report",
      caption: `Daily Report for ${job.name}`,
      uploadedBy: authorUid,
      createdAt: now,
    })

    await db.collection("directoryNotes").add({
      entityIds: [job.directoryContextId],
      text: summarizeDailyReportForNote(report.structuredData as DailyReportStructuredData, report.rawText),
      noteType: "daily_report",
      attachments: [pdfAttachment.url],
      createdBy: authorUid,
      createdAt: now,
      updatedAt: now,
    })
  } catch {
    // Filing into Directory is on top of an already-successful submit — never blocks it.
  }
}

export interface SubmitReportInput {
  idempotencyKey: string
}

/**
 * Idempotent: a repeated submit reuses the report PDF and deterministic
 * Communications post. It also repairs an interrupted/text-only report post
 * by attaching the existing PDF without changing the submitted report.
 */
export async function submitReport(principal: ByeByeDprPrincipal, reportId: string, input: SubmitReportInput): Promise<Report> {
  const { ref, data } = await requireOwnedReport(principal, reportId)
  const alreadySubmitted = data.status === "submitted"

  if (!alreadySubmitted) {
    const structuredData = mapReportStructuredData(data.structuredData)
    if (!isDailyReportSubmittable(structuredData, typeof data.rawText === "string" ? data.rawText : data.transcription)) {
      throw new ByeByeDprError("invalid-request", "Add some content before submitting.", 400)
    }

    const now = new Date()
    await ref.update({ status: "submitted", submittedAt: now, idempotencyKey: input.idempotencyKey, updatedAt: now })
  }

  const { pdfStoragePath, sizeBytes } = await generateReportPdf(principal, reportId)

  const afterPdfSnap = await ref.get()
  const afterPdfData = afterPdfSnap.data() ?? {}
  const job = await getJob(data.jobId)
  const db = await adminFirestore()
  let pdfAttachment: DailyReportPdfAttachment | null = null
  try {
    pdfAttachment = await createDailyReportPdfAttachment({
      pdfStoragePath,
      pdfSizeBytes: sizeBytes,
      jobName: job.name,
      submittedAt: mapReportDoc(ref.id, afterPdfData).submittedAt,
    })
    await ensureDailyReportCommsPdfAttachment({
      db,
      reportRef: ref,
      reportId,
      reportData: afterPdfData,
      job,
      authorUid: principal.uid,
      attachment: pdfAttachment,
    })
  } catch {
    // The report is submitted even if a transient Storage/Comms failure
    // prevents its attachment card. A repeated submit repairs it.
  }

  if (pdfAttachment && !alreadySubmitted) {
    await fileReportIntoDirectory(db, job, mapReportDoc(ref.id, afterPdfData), pdfAttachment, principal.uid)
  }

  const finalSnap = await ref.get()
  return mapReportDoc(ref.id, finalSnap.data() ?? {})
}
