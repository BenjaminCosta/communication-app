/**
 * SVC Applications — Firestore document shapes and mappers.
 *
 * The app works in ISO strings (see `lib/applications-core`) so the domain
 * stays framework-free and testable; Firestore stores Timestamps. This module
 * is the only place that knows about both, which keeps the conversion in one
 * spot instead of scattered across screens.
 *
 * Nothing here writes — see `lib/applications-writes.ts`.
 */

import { Timestamp, type DocumentData } from "firebase/firestore"
import {
  emptyGeneralApplication,
  emptyIntroVideo,
  INTRO_VIDEO_MISSING_FIELDS,
  standardDocuments,
  type ActivityEvent,
  type ApplicationLink,
  type ApplicationSectionId,
  type ApplicationStatus,
  type CandidateApplication,
  type GeneralApplication,
  type IntroVideo,
  type IntroVideoMissingField,
  type LinkedJob,
  type LinkPurpose,
  type OperatingAgreement,
  type RequiredDocument,
  type TranscriptionStatus,
  type VideoSummary,
} from "@/lib/applications-core"

export const APPLICATIONS_COLLECTION = "applications"
export const APPLICATION_ACTIVITY_SUBCOLLECTION = "activity"
export const APPLICATION_LINKS_COLLECTION = "applicationLinks"
export const APPLICATION_AGREEMENTS_COLLECTION = "applicationAgreements"

// ── Timestamp ↔ ISO ─────────────────────────────────────────────────────

export function toIso(value: unknown): string | null {
  if (value instanceof Timestamp) return value.toDate().toISOString()
  // Server routes read documents through firebase-admin, whose Timestamp is a
  // different class from the browser SDK Timestamp above. Both expose toDate;
  // accepting that shape keeps server-issued links from being parsed with an
  // expiry of "now" (which made every freshly generated production link 403).
  if (value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function") {
    const date = value.toDate()
    if (date instanceof Date && !Number.isNaN(date.getTime())) return date.toISOString()
  }
  if (value instanceof Date) return value.toISOString()
  if (typeof value === "string" && value) return value
  return null
}

function isoOrNow(value: unknown): string {
  return toIso(value) ?? new Date().toISOString()
}

export function toTimestamp(iso: string | null): Timestamp | null {
  if (!iso) return null
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : Timestamp.fromDate(date)
}

// ── Readers ─────────────────────────────────────────────────────────────

function mapJob(data: DocumentData): LinkedJob {
  return {
    id: typeof data.jobEntityId === "string" ? data.jobEntityId : "",
    name: typeof data.jobName === "string" ? data.jobName : "",
    location: typeof data.jobLocation === "string" ? data.jobLocation : "",
    companyName: typeof data.companyName === "string" ? data.companyName : "",
  }
}

function mapGeneral(raw: unknown): GeneralApplication {
  const base = emptyGeneralApplication()
  if (!raw || typeof raw !== "object") return base
  const source = raw as Record<string, unknown>
  for (const key of Object.keys(base) as Array<keyof GeneralApplication>) {
    const value = source[key]
    if (typeof value === "string") base[key] = value
  }
  return base
}

function mapMissingFields(raw: unknown): IntroVideoMissingField[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((value): value is IntroVideoMissingField =>
    (INTRO_VIDEO_MISSING_FIELDS as readonly string[]).includes(value),
  )
}

/** The video summary is written wholesale by the transcription pipeline in one shot. */
function mapVideoSummary(raw: unknown): VideoSummary | null {
  if (!raw || typeof raw !== "object") return null
  const source = raw as Record<string, unknown>
  if (typeof source.summary !== "string") return null
  return {
    name: typeof source.name === "string" ? source.name : null,
    town: typeof source.town === "string" ? source.town : null,
    yearsOfExperience: typeof source.yearsOfExperience === "number" ? source.yearsOfExperience : null,
    summary: source.summary,
    missingFields: mapMissingFields(source.missingFields),
    needsReview: source.needsReview === true,
  }
}

const KNOWN_TRANSCRIPTION_STATUSES: TranscriptionStatus[] = ["pending", "processing", "completed", "failed"]

function mapTranscriptionStatus(value: unknown): TranscriptionStatus | null {
  return KNOWN_TRANSCRIPTION_STATUSES.includes(value as TranscriptionStatus) ? (value as TranscriptionStatus) : null
}

function mapVideo(raw: unknown): IntroVideo {
  const base = emptyIntroVideo()
  if (!raw || typeof raw !== "object") return base
  const source = raw as Record<string, unknown>
  return {
    state: source.state === "ready" || source.state === "processing" ? source.state : "not_started",
    source: source.source === "record" || source.source === "upload" ? source.source : null,
    fileName: typeof source.fileName === "string" ? source.fileName : null,
    durationSeconds: typeof source.durationSeconds === "number" ? source.durationSeconds : null,
    capturedAt: toIso(source.capturedAt),
    storagePath: typeof source.storagePath === "string" ? source.storagePath : null,
    downloadUrl: typeof source.downloadUrl === "string" ? source.downloadUrl : null,
    mimeType: typeof source.mimeType === "string" ? source.mimeType : null,
    sizeBytes: typeof source.sizeBytes === "number" ? source.sizeBytes : null,
    transcriptionStatus: mapTranscriptionStatus(source.transcriptionStatus),
    transcript: typeof source.transcript === "string" ? source.transcript : null,
    summary: mapVideoSummary(source.summary),
    transcriptionModel: typeof source.transcriptionModel === "string" ? source.transcriptionModel : null,
    summaryModel: typeof source.summaryModel === "string" ? source.summaryModel : null,
    processedAt: toIso(source.processedAt),
    processingError: typeof source.processingError === "string" ? source.processingError : null,
    processedStoragePath: typeof source.processedStoragePath === "string" ? source.processedStoragePath : null,
  }
}

function mapDocuments(raw: unknown): RequiredDocument[] {
  if (!Array.isArray(raw)) return standardDocuments()
  return raw.map((entry) => {
    const source = (entry ?? {}) as Record<string, unknown>
    return {
      id: typeof source.id === "string" ? source.id : "",
      label: typeof source.label === "string" ? source.label : "",
      helper: typeof source.helper === "string" ? source.helper : "",
      required: source.required !== false,
      status:
        source.status === "verified" || source.status === "uploaded" || source.status === "not_required"
          ? source.status
          : "missing",
      fileName: typeof source.fileName === "string" ? source.fileName : null,
      uploadedAt: toIso(source.uploadedAt),
      storagePath: typeof source.storagePath === "string" ? source.storagePath : null,
      downloadUrl: typeof source.downloadUrl === "string" ? source.downloadUrl : null,
      origin: source.origin === "job" ? "job" : "standard",
    }
  })
}

function mapAgreement(raw: unknown): OperatingAgreement {
  const source = (raw ?? {}) as Record<string, unknown>
  const status = source.status
  const expiresAt = toIso(source.expiresAt)
  const isExpired =
    status === "awaiting_signature" &&
    expiresAt !== null &&
    !Number.isNaN(new Date(expiresAt).getTime()) &&
    new Date(expiresAt).getTime() <= Date.now()
  return {
    status:
      isExpired || status === "expired"
        ? "expired"
        : status === "awaiting_signature" || status === "signed"
          ? status
          : "locked",
    sentAt: toIso(source.sentAt),
    signedAt: toIso(source.signedAt),
    expiresAt,
    signedVersion: typeof source.signedVersion === "string" ? source.signedVersion : null,
    signedName: typeof source.signedName === "string" ? source.signedName : null,
  }
}

const KNOWN_STATUSES: ApplicationStatus[] = [
  "draft",
  "submitted",
  "needs_information",
  "ready_for_review",
  "approved",
  "agreement_pending",
  "payroll_in_progress",
  "hired",
  "archived",
]

function mapStatus(value: unknown): ApplicationStatus {
  return KNOWN_STATUSES.includes(value as ApplicationStatus) ? (value as ApplicationStatus) : "draft"
}

function mapPreviousStatus(value: unknown): ApplicationStatus | null {
  return KNOWN_STATUSES.includes(value as ApplicationStatus) && value !== "archived" ? (value as ApplicationStatus) : null
}

/**
 * Activity lives in a subcollection, so an application read on its own has an
 * empty history until `subscribeApplicationActivity` fills it in.
 */
export function mapApplicationDoc(id: string, data: DocumentData): CandidateApplication {
  return {
    id,
    // Link tokens are bearer credentials, never application data. New records
    // intentionally omit this field; returning an empty value also prevents a
    // legacy token from being rendered or copied by the dashboard.
    linkToken: "",
    candidateName: typeof data.candidateName === "string" ? data.candidateName : "",
    trade: typeof data.trade === "string" ? data.trade : "",
    job: mapJob(data),
    status: mapStatus(data.status),
    general: mapGeneral(data.general),
    video: mapVideo(data.video),
    documents: mapDocuments(data.documents),
    agreement: mapAgreement(data.agreement),
    activity: [],
    createdAt: isoOrNow(data.createdAt),
    updatedAt: isoOrNow(data.updatedAt),
    submittedAt: toIso(data.submittedAt),
    pendingRequest: typeof data.pendingRequest === "string" ? data.pendingRequest : null,
    previousStatus: mapPreviousStatus(data.previousStatus),
    agreementId: typeof data.agreementId === "string" ? data.agreementId : null,
  }
}

export function mapActivityDoc(id: string, data: DocumentData): ActivityEvent {
  const kind = data.kind
  return {
    id,
    kind:
      kind === "created" ||
      kind === "submitted" ||
      kind === "info_requested" ||
      kind === "info_received" ||
      kind === "approved" ||
      kind === "archived" ||
      kind === "link_generated" ||
      kind === "link_opened" ||
      kind === "message_copied" ||
      kind === "message_shared" ||
      kind === "agreement_signed" ||
      kind === "hired"
        ? kind
        : "note",
    actor: typeof data.actor === "string" ? data.actor : "Someone",
    message: typeof data.message === "string" ? data.message : "",
    at: isoOrNow(data.at),
  }
}

export function mapLinkDoc(id: string, data: DocumentData): ApplicationLink {
  const purpose = data.purpose
  return {
    // Link documents are addressed by SHA-256(token) and never retain the raw
    // bearer token. Callers that already possess one pass it separately.
    token: "",
    applicationId: typeof data.applicationId === "string" ? data.applicationId : "",
    purpose: purpose === "step" || purpose === "agreement" ? (purpose as LinkPurpose) : "application",
    step: (["general", "video", "documents"] as ApplicationSectionId[]).includes(data.step)
      ? (data.step as ApplicationSectionId)
      : null,
    createdAt: isoOrNow(data.createdAt),
    expiresAt: isoOrNow(data.expiresAt),
    revokedAt: toIso(data.revokedAt),
    usedCount: typeof data.usedCount === "number" ? data.usedCount : 0,
  }
}

// ── Writers ─────────────────────────────────────────────────────────────

/**
 * The document written on create. Derived fields (`progressPercent`,
 * `missingCount`) are deliberately absent: a Cloud Function owns them, so the
 * client never has a stale copy to fight over.
 */
export function applicationToFirestore(application: CandidateApplication): DocumentData {
  return {
    candidateName: application.candidateName,
    trade: application.trade,
    jobEntityId: application.job.id,
    jobName: application.job.name,
    jobLocation: application.job.location,
    companyName: application.job.companyName,
    // Composite ids, same convention as /directoryNotes and /directoryFiles.
    entityIds: [application.job.id].filter(Boolean),
    status: application.status,
    general: { ...application.general },
    video: {
      ...application.video,
      capturedAt: toTimestamp(application.video.capturedAt),
      processedAt: toTimestamp(application.video.processedAt),
    },
    documents: application.documents.map((document) => ({
      ...document,
      uploadedAt: toTimestamp(document.uploadedAt),
    })),
    agreement: {
      status: application.agreement.status,
      sentAt: toTimestamp(application.agreement.sentAt),
      signedAt: toTimestamp(application.agreement.signedAt),
      expiresAt: toTimestamp(application.agreement.expiresAt),
      signedVersion: application.agreement.signedVersion ?? null,
      signedName: application.agreement.signedName ?? null,
    },
    createdAt: toTimestamp(application.createdAt),
    updatedAt: toTimestamp(application.updatedAt),
    submittedAt: toTimestamp(application.submittedAt),
    pendingRequest: application.pendingRequest,
    previousStatus: application.previousStatus,
    agreementId: application.agreementId,
  }
}

export function linkToFirestore(link: ApplicationLink): DocumentData {
  return {
    applicationId: link.applicationId,
    purpose: link.purpose,
    step: link.step,
    createdAt: toTimestamp(link.createdAt),
    expiresAt: toTimestamp(link.expiresAt),
    revokedAt: toTimestamp(link.revokedAt),
    usedCount: link.usedCount,
  }
}
