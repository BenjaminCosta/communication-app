import "server-only"

/**
 * ByeByeDPR — Firestore document shapes and mappers (Admin SDK side).
 *
 * Mirrors `lib/applications-store.ts`'s split: domain logic stays in
 * `lib/bye-bye-dpr-core.ts` (framework-free), this module only knows how to
 * turn a raw Firestore doc into a JSON-serializable response shape (Admin
 * SDK `Timestamp` -> ISO string) and back. `lib/bye-bye-dpr-server.ts` is
 * the only place that writes.
 */

import type { DocumentData } from "firebase-admin/firestore"
import {
  emptyDailyReportStructuredData,
  type ClockSelectionSource,
  type ClockStatus,
  type ContentSource,
  type DailyReportStructuredData,
  type ReportStatus,
  type ReportType,
  type StructuredDataSource,
} from "@/lib/bye-bye-dpr-core"

export const JOBS_COLLECTION = "jobs"
export const CLOCK_RECORDS_COLLECTION = "clockRecords"
export const REPORTS_COLLECTION = "reports"
export const REPORT_ATTACHMENTS_SUBCOLLECTION = "attachments"

// ── Timestamp helpers ─────────────────────────────────────────────────────

export function toIso(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (value && typeof value === "object" && "toDate" in value && typeof (value as { toDate: unknown }).toDate === "function") {
    const date = (value as { toDate: () => Date }).toDate()
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
  }
  if (typeof value === "string" && value) return value
  return null
}

// ── Job ─────────────────────────────────────────────────────────────────

export interface Job {
  id: string
  name: string
  address: string | null
  latitude: number | null
  longitude: number | null
  directoryContextId: string | null
  isActive: boolean
  notifyUserIds: string[] | null
  createdBy: string
  createdAt: string | null
  updatedAt: string | null
}

export function mapJobDoc(id: string, data: DocumentData): Job {
  return {
    id,
    name: typeof data.name === "string" ? data.name : "",
    address: typeof data.address === "string" ? data.address : null,
    latitude: typeof data.latitude === "number" ? data.latitude : null,
    longitude: typeof data.longitude === "number" ? data.longitude : null,
    directoryContextId: typeof data.directoryContextId === "string" ? data.directoryContextId : null,
    isActive: data.isActive !== false,
    notifyUserIds: Array.isArray(data.notifyUserIds)
      ? data.notifyUserIds.filter((value: unknown): value is string => typeof value === "string")
      : null,
    createdBy: typeof data.createdBy === "string" ? data.createdBy : "",
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
  }
}

// ── Clock record ────────────────────────────────────────────────────────

export interface GeoPointValue {
  lat: number
  lng: number
}

function mapGeoPoint(value: unknown): GeoPointValue | null {
  if (!value || typeof value !== "object") return null
  const { lat, lng } = value as Record<string, unknown>
  return typeof lat === "number" && typeof lng === "number" ? { lat, lng } : null
}

export interface CorrectionMetadata {
  previousClockOutAt: string | null
  correctedTimestamp: string | null
  correctionCreatedAt: string | null
  correctedBy: string
}

export interface ClockRecord {
  id: string
  userId: string
  jobId: string
  status: ClockStatus
  clockInAt: string | null
  clockOutAt: string | null
  durationMinutes: number | null
  clockInLocation: GeoPointValue | null
  clockOutLocation: GeoPointValue | null
  selectionSource: ClockSelectionSource
  manuallyCorrected: boolean
  correctionMetadata: CorrectionMetadata | null
  idempotencyKey: string | null
  commsClockInMessageId: string | null
  commsClockOutMessageId: string | null
  createdAt: string | null
  updatedAt: string | null
}

const CLOCK_STATUSES: ClockStatus[] = ["active", "closed"]
const SELECTION_SOURCES: ClockSelectionSource[] = ["manual", "nearest", "recent"]

export function mapClockRecordDoc(id: string, data: DocumentData): ClockRecord {
  const correction = data.correctionMetadata
  return {
    id,
    userId: typeof data.userId === "string" ? data.userId : "",
    jobId: typeof data.jobId === "string" ? data.jobId : "",
    status: CLOCK_STATUSES.includes(data.status) ? data.status : "active",
    clockInAt: toIso(data.clockInAt),
    clockOutAt: toIso(data.clockOutAt),
    durationMinutes: typeof data.durationMinutes === "number" ? data.durationMinutes : null,
    clockInLocation: mapGeoPoint(data.clockInLocation),
    clockOutLocation: mapGeoPoint(data.clockOutLocation),
    selectionSource: SELECTION_SOURCES.includes(data.selectionSource) ? data.selectionSource : "manual",
    manuallyCorrected: data.manuallyCorrected === true,
    correctionMetadata:
      correction && typeof correction === "object"
        ? {
            previousClockOutAt: toIso((correction as Record<string, unknown>).previousClockOutAt),
            correctedTimestamp: toIso((correction as Record<string, unknown>).correctedTimestamp),
            correctionCreatedAt: toIso((correction as Record<string, unknown>).correctionCreatedAt),
            correctedBy:
              typeof (correction as Record<string, unknown>).correctedBy === "string"
                ? ((correction as Record<string, unknown>).correctedBy as string)
                : "",
          }
        : null,
    idempotencyKey: typeof data.idempotencyKey === "string" ? data.idempotencyKey : null,
    commsClockInMessageId: typeof data.commsClockInMessageId === "string" ? data.commsClockInMessageId : null,
    commsClockOutMessageId: typeof data.commsClockOutMessageId === "string" ? data.commsClockOutMessageId : null,
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
  }
}

// ── Report ──────────────────────────────────────────────────────────────

function mapDailyReportStructuredData(raw: unknown): DailyReportStructuredData {
  const base = emptyDailyReportStructuredData()
  if (!raw || typeof raw !== "object") return base
  const source = raw as Record<string, unknown>
  for (const key of Object.keys(base) as Array<keyof DailyReportStructuredData>) {
    const value = source[key]
    base[key] = typeof value === "string" ? value : null
  }
  return base
}

export type ReportStructuredData = DailyReportStructuredData

/** Single report type today (`daily_report`) — kept as a named function so
 * call sites don't need to change if a second report type is ever added. */
export function mapReportStructuredData(raw: unknown): ReportStructuredData {
  return mapDailyReportStructuredData(raw)
}

export interface Report {
  id: string
  jobId: string
  authorId: string
  type: ReportType
  status: ReportStatus
  rawText: string | null
  transcription: string | null
  transcriptionSource: ContentSource | null
  structuredData: ReportStructuredData
  structuredDataSource: StructuredDataSource | null
  audioStoragePath: string | null
  pdfStoragePath: string | null
  commsMessageId: string | null
  idempotencyKey: string | null
  createdAt: string | null
  updatedAt: string | null
  submittedAt: string | null
}

const REPORT_STATUSES: ReportStatus[] = ["draft", "submitted"]
const CONTENT_SOURCES: ContentSource[] = ["voice", "typed"]
const STRUCTURED_DATA_SOURCES: StructuredDataSource[] = ["manual", "ai"]

export function mapReportDoc(id: string, data: DocumentData): Report {
  const type: ReportType = "daily_report"
  return {
    id,
    jobId: typeof data.jobId === "string" ? data.jobId : "",
    authorId: typeof data.authorId === "string" ? data.authorId : "",
    type,
    status: REPORT_STATUSES.includes(data.status) ? data.status : "draft",
    rawText: typeof data.rawText === "string" ? data.rawText : null,
    transcription: typeof data.transcription === "string" ? data.transcription : null,
    transcriptionSource: CONTENT_SOURCES.includes(data.transcriptionSource) ? data.transcriptionSource : null,
    structuredData: mapReportStructuredData(data.structuredData),
    structuredDataSource: STRUCTURED_DATA_SOURCES.includes(data.structuredDataSource) ? data.structuredDataSource : null,
    audioStoragePath: typeof data.audioStoragePath === "string" ? data.audioStoragePath : null,
    pdfStoragePath: typeof data.pdfStoragePath === "string" ? data.pdfStoragePath : null,
    commsMessageId: typeof data.commsMessageId === "string" ? data.commsMessageId : null,
    idempotencyKey: typeof data.idempotencyKey === "string" ? data.idempotencyKey : null,
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
    submittedAt: toIso(data.submittedAt),
  }
}

// ── Report attachment ──────────────────────────────────────────────────

export interface ReportAttachment {
  id: string
  storagePath: string
  fileName: string
  mimeType: string
  size: number
  uploadedBy: string
  createdAt: string | null
}

/**
 * No `downloadUrl` field: uploads happen server-side (Admin SDK), and an
 * Admin-generated signed URL bypasses Storage security rules entirely. The
 * frontend should derive a URL from `storagePath` via the client SDK's
 * `getDownloadURL()`, which enforces the rules (any signed-in user) on
 * every request instead of baking in a long-lived bypass.
 */
export function mapAttachmentDoc(id: string, data: DocumentData): ReportAttachment {
  return {
    id,
    storagePath: typeof data.storagePath === "string" ? data.storagePath : "",
    fileName: typeof data.fileName === "string" ? data.fileName : "file",
    mimeType: typeof data.mimeType === "string" ? data.mimeType : "application/octet-stream",
    size: typeof data.size === "number" ? data.size : 0,
    uploadedBy: typeof data.uploadedBy === "string" ? data.uploadedBy : "",
    createdAt: toIso(data.createdAt),
  }
}
