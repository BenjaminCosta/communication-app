"use client"

/**
 * SVC Applications — reads and writes (client side).
 *
 * ARCHITECTURE RULES
 *  - Reviewer actions never touch `agreement.status`. Unlocking, signing and
 *    expiring the agreement are server-side concerns, because that state is
 *    what gates payroll.
 *  - Every reviewer action appends an activity event with `actorUid`. There
 *    are no roles in this module, so the activity log IS the audit trail.
 *  - `progressPercent` / `missingCount` are derived by a Cloud Function; this
 *    module never writes them.
 */

import {
  addDoc,
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Unsubscribe,
} from "firebase/firestore"
import { auth, candidateDb, db } from "@/lib/firebase"
import { subscribeWithServerReconcile } from "@/lib/firestore-reconcile"
import { APPLICATIONS_BACKEND_ENABLED } from "@/lib/applications-flags"
import {
  APPLICATIONS_COLLECTION,
  APPLICATION_ACTIVITY_SUBCOLLECTION,
  APPLICATION_LINKS_COLLECTION,
  applicationToFirestore,
  linkToFirestore,
  mapActivityDoc,
  mapApplicationDoc,
  mapLinkDoc,
  toTimestamp,
} from "@/lib/applications-store"
import type {
  ActivityEvent,
  ActivityKind,
  ApplicationLink,
  ApplicationSectionId,
  CandidateApplication,
  GeneralApplication,
  IntroVideo,
  InviteDetails,
  RequiredDocument,
} from "@/lib/applications-core"

export class ApplicationWriteError extends Error {}

const APPLICATIONS_PAGE_SIZE = 200
const ACTIVITY_PAGE_SIZE = 50

export interface ReviewerIdentity {
  uid: string
  name: string
}

/**
 * Application links are bearer credentials. The client only ever sends the
 * SHA-256 digest as the Firestore document id, so neither the link collection
 * nor the application record keeps a replayable token at rest.
 */
async function applicationLinkHash(token: string): Promise<string> {
  const bytes = new TextEncoder().encode(token)
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("")
}

// ── Reads ───────────────────────────────────────────────────────────────

/**
 * The dashboard list. Ordered by `updatedAt` so anything that just moved is
 * on top regardless of status; the client re-sorts for the other options.
 */
export function subscribeApplications(
  onChange: (applications: CandidateApplication[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  const applicationsQuery = query(
    collection(db, APPLICATIONS_COLLECTION),
    orderBy("updatedAt", "desc"),
    limit(APPLICATIONS_PAGE_SIZE),
  )
  return subscribeWithServerReconcile(
    applicationsQuery,
    (snapshot) => onChange(snapshot.docs.map((entry) => mapApplicationDoc(entry.id, entry.data()))),
    (error) => onError?.(error),
  )
}

/** Activity is a subcollection, so the detail screen subscribes separately. */
export function subscribeApplicationActivity(
  applicationId: string,
  onChange: (events: ActivityEvent[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  const activityQuery = query(
    collection(db, APPLICATIONS_COLLECTION, applicationId, APPLICATION_ACTIVITY_SUBCOLLECTION),
    orderBy("at", "desc"),
    limit(ACTIVITY_PAGE_SIZE),
  )
  return onSnapshot(
    activityQuery,
    (snapshot) => {
      // Stored newest-first for the query; the UI reads oldest-first.
      const events = snapshot.docs.map((entry) => mapActivityDoc(entry.id, entry.data()))
      onChange(events.reverse())
    },
    (error) => onError?.(error),
  )
}

export async function loadApplication(applicationId: string): Promise<CandidateApplication | null> {
  const snapshot = await getDoc(doc(db, APPLICATIONS_COLLECTION, applicationId))
  return snapshot.exists() ? mapApplicationDoc(snapshot.id, snapshot.data()) : null
}

/** One application, live — used by the candidate flow after it signs in. */
export function subscribeApplication(
  applicationId: string,
  onChange: (application: CandidateApplication | null) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    doc(candidateDb, APPLICATIONS_COLLECTION, applicationId),
    (snapshot) => onChange(snapshot.exists() ? mapApplicationDoc(snapshot.id, snapshot.data()) : null),
    (error) => onError?.(error),
  )
}

// ── Candidate writes ────────────────────────────────────────────────────

/**
 * The candidate's autosave. Writes only the fields the rules let a candidate
 * touch; the mappers convert ISO/Date back to Timestamps. Video and document
 * FILE bytes are not uploaded yet (Storage is a later phase) — only the
 * metadata the candidate has entered is persisted.
 *
 * `video.*` is written as individual dot-path fields rather than replacing
 * the whole map: the transcription pipeline (Cloud Function) owns transcript,
 * summary, transcriptionModel/summaryModel, processedAt, processingError and
 * processedStoragePath, and writes them on its own schedule. If this autosave
 * ever replaced the whole `video` object, a debounced save built from a stale
 * local copy could land after the pipeline's write and erase a transcript the
 * candidate never touched. Dot-paths make that impossible — this function
 * simply never mentions those fields.
 */
export async function saveCandidateDraft(
  applicationId: string,
  draft: { general: GeneralApplication; video: IntroVideo; documents: RequiredDocument[] },
): Promise<void> {
  await updateDoc(doc(candidateDb, APPLICATIONS_COLLECTION, applicationId), {
    general: { ...draft.general },
    "video.state": draft.video.state,
    "video.source": draft.video.source,
    "video.fileName": draft.video.fileName,
    "video.durationSeconds": draft.video.durationSeconds,
    "video.capturedAt": toTimestamp(draft.video.capturedAt),
    "video.storagePath": draft.video.storagePath,
    "video.downloadUrl": draft.video.downloadUrl,
    "video.mimeType": draft.video.mimeType,
    "video.sizeBytes": draft.video.sizeBytes,
    documents: draft.documents.map((document) => ({
      ...document,
      uploadedAt: toTimestamp(document.uploadedAt),
    })),
    updatedAt: serverTimestamp(),
  })
}

/**
 * One-shot: tell the transcription pipeline a fresh video is ready. Fired
 * exactly once, right after upload succeeds — never folded into the
 * recurring autosave above, so a later debounced save working off a stale
 * local copy can never accidentally resend "pending" and re-open a job the
 * Cloud Function has already moved past.
 */
export async function requestVideoTranscription(applicationId: string): Promise<void> {
  await updateDoc(doc(candidateDb, APPLICATIONS_COLLECTION, applicationId), {
    "video.transcriptionStatus": "pending",
    updatedAt: serverTimestamp(),
  })
}

export async function submitCandidateApplication(
  applicationId: string,
): Promise<void> {
  const user = auth.currentUser
  if (!user) throw new ApplicationWriteError("Your session ended. Please reopen the application link.")

  let response: Response
  try {
    response = await fetch("/api/applications/submit", {
      method: "POST",
      headers: {
        authorization: `Bearer ${await user.getIdToken()}`,
      },
    })
  } catch {
    throw new ApplicationWriteError("We couldn't submit this application right now.")
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: unknown }
    throw new ApplicationWriteError(
      typeof body.error === "string" ? body.error : "We couldn't submit this application right now.",
    )
  }
}

// ── Activity ────────────────────────────────────────────────────────────

async function appendActivity(
  applicationId: string,
  input: { kind: ActivityKind; actor: string; actorUid: string; message: string },
): Promise<void> {
  await addDoc(collection(db, APPLICATIONS_COLLECTION, applicationId, APPLICATION_ACTIVITY_SUBCOLLECTION), {
    kind: input.kind,
    actor: input.actor,
    actorUid: input.actorUid,
    message: input.message,
    at: serverTimestamp(),
  })
}

/** Record an auditable reviewer interaction without changing application state. */
export async function recordApplicationActivity(
  applicationId: string,
  kind: ActivityKind,
  message: string,
  reviewer: ReviewerIdentity,
): Promise<void> {
  const user = auth.currentUser
  if (!user) throw new ApplicationWriteError("Your session ended. Please sign in again.")

  let response: Response
  try {
    response = await fetch("/api/applications/activity", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${await user.getIdToken()}`,
      },
      body: JSON.stringify({ applicationId, kind, message, reviewerName: reviewer.name }),
    })
  } catch {
    throw new ApplicationWriteError("We couldn't record this activity right now.")
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: unknown }
    throw new ApplicationWriteError(typeof body.error === "string" ? body.error : "We couldn't record this activity right now.")
  }
}

type ReviewerAction = "request_info" | "archive" | "unarchive" | "mark_hired" | "start_review" | "retry_transcription"

async function performReviewerAction(
  applicationId: string,
  action: ReviewerAction,
  reviewer: ReviewerIdentity,
  message?: string,
): Promise<void> {
  const user = auth.currentUser
  if (!user) throw new ApplicationWriteError("Your session ended. Please sign in again.")

  let response: Response
  try {
    response = await fetch("/api/applications/reviewer-action", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${await user.getIdToken()}`,
      },
      body: JSON.stringify({ applicationId, action, message, reviewerName: reviewer.name }),
    })
  } catch {
    throw new ApplicationWriteError("We couldn't update this application right now.")
  }

  const body = (await response.json().catch(() => ({}))) as { error?: unknown }
  if (!response.ok) {
    throw new ApplicationWriteError(typeof body.error === "string" ? body.error : "We couldn't update this application right now.")
  }
}

// ── Reviewer actions ────────────────────────────────────────────────────

/**
 * Ask the candidate for something. Sets the status and the outstanding
 * question in one update so the list and the detail can never disagree.
 */
export async function requestApplicationInfo(
  applicationId: string,
  message: string,
  reviewer: ReviewerIdentity,
): Promise<void> {
  const trimmed = message.trim()
  if (!trimmed) throw new ApplicationWriteError("A request needs a message.")
  await performReviewerAction(applicationId, "request_info", reviewer, trimmed)
}

/**
 * Approving changes `agreement.status`, which Firestore rules deliberately
 * reserve for the server. The signed-in staff token authorizes this request;
 * the server performs the status + agreement transition atomically.
 */
function isApplicationLink(value: unknown): value is ApplicationLink {
  if (!value || typeof value !== "object") return false
  const link = value as Record<string, unknown>
  return (
    typeof link.token === "string" &&
    typeof link.applicationId === "string" &&
    (link.purpose === "application" || link.purpose === "step" || link.purpose === "agreement") &&
    typeof link.createdAt === "string" &&
    typeof link.expiresAt === "string" &&
    (link.step === null || link.step === "general" || link.step === "video" || link.step === "documents") &&
    (link.revokedAt === null || typeof link.revokedAt === "string") &&
    typeof link.usedCount === "number"
  )
}

/**
 * Issue a non-agreement candidate link through the server. The Admin SDK owns
 * bearer credential persistence, so this never depends on a browser Firestore
 * write being accepted by staff-only security rules.
 */
export async function createReviewerApplicationLink(
  input: {
    applicationId: string
    purpose: "application" | "step"
    step?: ApplicationSectionId | null
    invite?: InviteDetails
  },
  reviewer: ReviewerIdentity,
): Promise<ApplicationLink> {
  const user = auth.currentUser
  if (!user) throw new ApplicationWriteError("Your session ended. Please sign in again.")

  let response: Response
  try {
    response = await fetch("/api/applications/link", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${await user.getIdToken()}`,
      },
      body: JSON.stringify({ ...input, reviewerName: reviewer.name }),
    })
  } catch {
    throw new ApplicationWriteError("We couldn't create the secure link right now.")
  }

  const body = (await response.json().catch(() => ({}))) as { error?: unknown; link?: unknown }
  if (!response.ok) {
    throw new ApplicationWriteError(
      typeof body.error === "string" ? body.error : "We couldn't create the secure link right now.",
    )
  }
  if (!isApplicationLink(body.link)) throw new ApplicationWriteError("The secure link response was incomplete.")
  return body.link
}

export async function approveApplication(
  applicationId: string,
  reviewer: ReviewerIdentity,
): Promise<{ approvedAt: string; link: ApplicationLink }> {
  const user = auth.currentUser
  if (!user) throw new ApplicationWriteError("Your session ended. Please sign in again.")

  let response: Response
  try {
    response = await fetch("/api/applications/approve", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${await user.getIdToken()}`,
      },
      body: JSON.stringify({ applicationId, reviewerName: reviewer.name }),
    })
  } catch {
    throw new ApplicationWriteError("We couldn't approve this application right now.")
  }

  const body = (await response.json().catch(() => ({}))) as { error?: unknown; approvedAt?: unknown; link?: unknown }
  if (!response.ok) {
    throw new ApplicationWriteError(typeof body.error === "string" ? body.error : "We couldn't approve this application right now.")
  }
  if (typeof body.approvedAt !== "string" || !isApplicationLink(body.link)) {
    throw new ApplicationWriteError("The approval response was incomplete.")
  }
  return { approvedAt: body.approvedAt, link: body.link }
}

function exportFileName(contentDisposition: string | null, fallback = "candidate-application-profile.pdf"): string {
  const match = contentDisposition?.match(/filename="?([^";]+)"?/i)
  return match?.[1]?.trim() || fallback
}

function localProfileFileName(candidateName: string): string {
  const slug = candidateName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
  return `${slug || "candidate"}-application-profile.pdf`
}

function triggerPdfDownload(blob: Blob, fileName: string): void {
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = objectUrl
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000)
}

/**
 * Preview mode intentionally has no Firestore record to look up. Render the
 * exact local application instead of posting its device-only id to the server.
 * The PDF renderer is loaded only on demand, so normal dashboard startup stays
 * lightweight.
 */
async function downloadLocalApplicationProfilePdf(application: CandidateApplication): Promise<void> {
  const { createApplicationProfilePdf } = await import("@/features/applications/application-profile-pdf")
  const bytes = await createApplicationProfilePdf({
    generatedAtIso: new Date().toISOString(),
    candidate: {
      name: application.candidateName,
      trade: application.trade,
      status: application.status,
      submittedAt: application.submittedAt,
      createdAt: application.createdAt,
    },
    job: {
      name: application.job.name,
      location: application.job.location,
      companyName: application.job.companyName,
    },
    application: {
      fullName: application.general.fullName,
      phone: application.general.phone,
      email: application.general.email,
      cityState: application.general.cityState,
      yearsExperience: application.general.yearsExperience,
      primaryTrade: application.general.primaryTrade,
      resumeFileName: application.general.resumeFileName || null,
      workReference: application.general.workReference || null,
    },
    video: {
      state: application.video.state,
      source: application.video.source,
      fileName: application.video.fileName,
      durationSeconds: application.video.durationSeconds,
      capturedAt: application.video.capturedAt,
      transcript: application.video.transcript ?? null,
      summary: application.video.summary?.summary ?? null,
    },
    documents: application.documents.map((document) => ({
      label: document.label,
      status: document.status,
      required: document.required,
      fileName: document.fileName,
      uploadedAt: document.uploadedAt,
      helper: document.helper,
    })),
    agreement: {
      status: application.agreement.status,
      sentAt: application.agreement.sentAt,
      expiresAt: application.agreement.expiresAt,
      signedAt: application.agreement.signedAt,
      signedName: application.agreement.signedName ?? null,
      signedVersion: application.agreement.signedVersion ?? null,
    },
    activity: application.activity.map((event) => ({ actor: event.actor, message: event.message, at: event.at })),
  })
  triggerPdfDownload(new Blob([bytes as unknown as BlobPart], { type: "application/pdf" }), localProfileFileName(application.candidateName))
}

/**
 * Download a complete application snapshot as a PDF.
 *
 * The real backend produces an auditable staff-only export. The local preview
 * has no shared record by definition, so it produces the same view from the
 * device state rather than failing with "application not found".
 */
export async function downloadApplicationProfilePdf(
  application: CandidateApplication,
  reviewer: ReviewerIdentity,
): Promise<"local" | "server"> {
  if (!APPLICATIONS_BACKEND_ENABLED) {
    await downloadLocalApplicationProfilePdf(application)
    return "local"
  }

  const user = auth.currentUser
  if (!user) throw new ApplicationWriteError("Your session ended. Please sign in again.")

  let response: Response
  try {
    response = await fetch("/api/applications/export", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${await user.getIdToken()}`,
      },
      body: JSON.stringify({ applicationId: application.id, reviewerName: reviewer.name }),
    })
  } catch {
    throw new ApplicationWriteError("We couldn't prepare this application PDF right now.")
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: unknown }
    throw new ApplicationWriteError(
      typeof body.error === "string" ? body.error : "We couldn't prepare this application PDF right now.",
    )
  }

  const blob = await response.blob()
  if (blob.size === 0) throw new ApplicationWriteError("The application PDF was empty. Please try again.")
  triggerPdfDownload(blob, exportFileName(response.headers.get("content-disposition")))
  return "server"
}

/** Refresh the agreement signing window and create its secure server-side link. */
export async function createAgreementSigningLink(
  applicationId: string,
  reviewer: ReviewerIdentity,
): Promise<ApplicationLink> {
  const user = auth.currentUser
  if (!user) throw new ApplicationWriteError("Your session ended. Please sign in again.")

  let response: Response
  try {
    response = await fetch("/api/applications/agreement/link", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${await user.getIdToken()}`,
      },
      body: JSON.stringify({ applicationId, reviewerName: reviewer.name }),
    })
  } catch {
    throw new ApplicationWriteError("We couldn't create the agreement link right now.")
  }

  const body = (await response.json().catch(() => ({}))) as { error?: unknown; link?: unknown }
  if (!response.ok) {
    throw new ApplicationWriteError(
      typeof body.error === "string" ? body.error : "We couldn't create the agreement link right now.",
    )
  }
  if (!isApplicationLink(body.link)) throw new ApplicationWriteError("The agreement link response was incomplete.")
  return body.link
}

export interface SignedAgreementPdf {
  blob: Blob
  fileName: string
  previewPage: number
}

/**
 * Resolve the sealed PDF through the app server. Firebase Storage download
 * URLs are cross-origin, which made an otherwise valid agreement fail in the
 * browser before a preview or download could start.
 */
export async function loadSignedAgreementPdf(
  applicationId: string,
  reviewer: ReviewerIdentity,
): Promise<SignedAgreementPdf> {
  const user = auth.currentUser
  if (!user) throw new ApplicationWriteError("Your session ended. Please sign in again.")

  let response: Response
  try {
    response = await fetch("/api/applications/agreement/file", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${await user.getIdToken()}`,
      },
      body: JSON.stringify({ applicationId, reviewerName: reviewer.name }),
    })
  } catch {
    throw new ApplicationWriteError("We couldn't load the signed agreement right now.")
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: unknown }
    throw new ApplicationWriteError(
      typeof body.error === "string" ? body.error : "We couldn't load the signed agreement right now.",
    )
  }

  const blob = await response.blob()
  if (blob.size === 0) throw new ApplicationWriteError("The signed agreement PDF was empty. Please try again.")
  const previewPage = Number(response.headers.get("x-svc-pdf-preview-page"))
  return {
    blob,
    fileName: exportFileName(response.headers.get("content-disposition"), "signed-operating-agreement.pdf"),
    previewPage: Number.isInteger(previewPage) && previewPage > 0 ? previewPage : 1,
  }
}

export async function downloadSignedAgreementPdf(
  applicationId: string,
  reviewer: ReviewerIdentity,
): Promise<void> {
  const file = await loadSignedAgreementPdf(applicationId, reviewer)
  triggerPdfDownload(file.blob, file.fileName)
}

export async function archiveApplication(applicationId: string, reviewer: ReviewerIdentity): Promise<void> {
  await performReviewerAction(applicationId, "archive", reviewer)
}

/** Puts an archived application back where it was before — see `previousStatus`. */
export async function unarchiveApplication(applicationId: string, reviewer: ReviewerIdentity): Promise<void> {
  await performReviewerAction(applicationId, "unarchive", reviewer)
}

/** Re-queues a failed intro video for transcription — the Cloud Function picks it back up. */
export async function retryVideoTranscription(applicationId: string, reviewer: ReviewerIdentity): Promise<void> {
  await performReviewerAction(applicationId, "retry_transcription", reviewer)
}

/**
 * Permanently delete an application: uploads, agreement PDF, links and the
 * record itself. Irreversible — the caller confirms with the reviewer first.
 */
export async function deleteApplication(applicationId: string, reviewer: ReviewerIdentity): Promise<void> {
  const user = auth.currentUser
  if (!user) throw new ApplicationWriteError("Your session ended. Please sign in again.")

  let response: Response
  try {
    response = await fetch("/api/applications/delete", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${await user.getIdToken()}`,
      },
      body: JSON.stringify({ applicationId, reviewerName: reviewer.name }),
    })
  } catch {
    throw new ApplicationWriteError("We couldn't delete this application right now.")
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: unknown }
    throw new ApplicationWriteError(typeof body.error === "string" ? body.error : "We couldn't delete this application right now.")
  }
}

/** Final internal onboarding step after the candidate has signed the agreement. */
export async function markApplicationHired(applicationId: string, reviewer: ReviewerIdentity): Promise<void> {
  await performReviewerAction(applicationId, "mark_hired", reviewer)
}

export async function startApplicationReview(applicationId: string, reviewer: ReviewerIdentity): Promise<void> {
  await performReviewerAction(applicationId, "start_review", reviewer)
}

// ── Creation ────────────────────────────────────────────────────────────

export async function createApplication(
  application: CandidateApplication,
  reviewer: ReviewerIdentity,
): Promise<void> {
  await setDoc(doc(db, APPLICATIONS_COLLECTION, application.id), {
    ...applicationToFirestore(application),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  await appendActivity(application.id, {
    kind: "created",
    actor: reviewer.name,
    actorUid: reviewer.uid,
    message: "Created the application link",
  })
}

// ── Links ───────────────────────────────────────────────────────────────

/**
 * Links are stored under their token today. The production version hashes it
 * (`/applicationLinks/{tokenHash}`) so a database reader can't replay one —
 * `linkToFirestore` is the only place that changes when we do.
 */
export async function saveApplicationLink(link: ApplicationLink): Promise<void> {
  const tokenHash = await applicationLinkHash(link.token)
  await setDoc(doc(db, APPLICATION_LINKS_COLLECTION, tokenHash), linkToFirestore(link))
}

export async function revokeApplicationLinkDoc(token: string, reviewer: ReviewerIdentity): Promise<void> {
  const user = auth.currentUser
  if (!user) throw new ApplicationWriteError("Your session ended. Please sign in again.")

  let response: Response
  try {
    response = await fetch("/api/applications/link/revoke", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${await user.getIdToken()}`,
      },
      body: JSON.stringify({ token, reviewerName: reviewer.name }),
    })
  } catch {
    throw new ApplicationWriteError("We couldn't revoke the secure link right now.")
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: unknown }
    throw new ApplicationWriteError(typeof body.error === "string" ? body.error : "We couldn't revoke the secure link right now.")
  }
}

export async function loadApplicationLink(token: string): Promise<ApplicationLink | null> {
  const tokenHash = await applicationLinkHash(token)
  const snapshot = await getDoc(doc(db, APPLICATION_LINKS_COLLECTION, tokenHash))
  return snapshot.exists() ? { ...mapLinkDoc(snapshot.id, snapshot.data()), token } : null
}
