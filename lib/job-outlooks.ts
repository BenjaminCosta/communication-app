import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  type DocumentData,
  type Timestamp,
  type Unsubscribe,
} from "firebase/firestore"
import { db } from "@/lib/firebase"
import {
  OUTLOOK_SCHEMA_VERSION,
  outlookVersionId,
  scheduleOutlookTasks,
  type OutlookIssue,
  type OutlookTask,
  type OutlookWindow,
} from "@/lib/outlook-core"

export interface JobOutlookDraft {
  id: string
  jobId: string
  jobDirectoryId: string
  window: OutlookWindow
  tasks: OutlookTask[]
  revision: number
  nextVersionNumber: number
  latestPublishedVersionId: string | null
  latestPdfUrl: string | null
  createdBy: string
  createdAt: Date | null
  updatedBy: string
  updatedAt: Date | null
}

export interface OutlookPdfArtifact {
  directoryFileId: string
  storagePath: string
  downloadUrl: string
  fileName: string
}

export interface JobOutlookVersion {
  id: string
  versionNumber: number
  kind: "published"
  jobId: string
  jobDirectoryId: string
  window: OutlookWindow
  tasks: OutlookTask[]
  createdBy: string
  createdAt: Date | null
  pdf: OutlookPdfArtifact | null
}

export class OutlookConflictError extends Error {
  constructor() {
    super("This outlook changed on another device. Review the latest version and try again.")
    this.name = "OutlookConflictError"
  }
}

function timestampDate(value: unknown): Date | null {
  return value && typeof value === "object" && "toDate" in value
    ? (value as Timestamp).toDate()
    : null
}

function text(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function number(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function storedTasks(value: unknown): OutlookTask[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is OutlookTask => Boolean(entry && typeof entry === "object"))
}

function draftRef(jobId: string, windowStart: string) {
  return doc(db, "contexts", jobId, "outlooks", windowStart)
}

function versionsRef(jobId: string, windowStart: string) {
  return collection(db, "contexts", jobId, "outlooks", windowStart, "versions")
}

function mapDraft(id: string, data: DocumentData): JobOutlookDraft {
  return {
    id,
    jobId: text(data.jobId),
    jobDirectoryId: text(data.jobDirectoryId),
    window: { start: text(data.windowStart), end: text(data.windowEnd) },
    tasks: storedTasks(data.tasks),
    revision: number(data.revision, 0),
    nextVersionNumber: number(data.nextVersionNumber, 1),
    latestPublishedVersionId: text(data.latestPublishedVersionId) || null,
    latestPdfUrl: text(data.latestPdfUrl) || null,
    createdBy: text(data.createdBy),
    createdAt: timestampDate(data.createdAt),
    updatedBy: text(data.updatedBy),
    updatedAt: timestampDate(data.updatedAt),
  }
}

function mapVersion(id: string, data: DocumentData): JobOutlookVersion {
  const pdf = data.pdf && typeof data.pdf === "object" ? data.pdf as DocumentData : null
  return {
    id,
    versionNumber: number(data.versionNumber, 0),
    kind: "published",
    jobId: text(data.jobId),
    jobDirectoryId: text(data.jobDirectoryId),
    window: { start: text(data.windowStart), end: text(data.windowEnd) },
    tasks: storedTasks(data.tasks),
    createdBy: text(data.createdBy),
    createdAt: timestampDate(data.createdAt),
    pdf: pdf ? {
      directoryFileId: text(pdf.directoryFileId),
      storagePath: text(pdf.storagePath),
      downloadUrl: text(pdf.downloadUrl),
      fileName: text(pdf.fileName),
    } : null,
  }
}

export function subscribeJobOutlook(
  jobId: string,
  windowStart: string,
  onChange: (draft: JobOutlookDraft | null) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    draftRef(jobId, windowStart),
    (snapshot) => onChange(snapshot.exists() ? mapDraft(snapshot.id, snapshot.data()) : null),
    (error) => onError?.(error),
  )
}

export function subscribeJobOutlookVersions(
  jobId: string,
  windowStart: string,
  onChange: (versions: JobOutlookVersion[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    query(versionsRef(jobId, windowStart), orderBy("versionNumber", "desc"), limit(20)),
    (snapshot) => onChange(snapshot.docs.map((entry) => mapVersion(entry.id, entry.data()))),
    (error) => onError?.(error),
  )
}

export interface SaveJobOutlookInput {
  userId: string
  jobId: string
  jobDirectoryId: string
  window: OutlookWindow
  tasks: OutlookTask[]
  expectedRevision?: number | null
}

export async function saveJobOutlookDraft(input: SaveJobOutlookInput): Promise<number> {
  const ref = draftRef(input.jobId, input.window.start)
  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(ref)
    const currentRevision = snapshot.exists() ? number(snapshot.data().revision, 0) : 0
    if (input.expectedRevision != null && snapshot.exists() && currentRevision !== input.expectedRevision) {
      throw new OutlookConflictError()
    }
    const revision = currentRevision + 1
    const scheduled = scheduleOutlookTasks(input.tasks, input.window)
    transaction.set(ref, {
      schemaVersion: OUTLOOK_SCHEMA_VERSION,
      jobId: input.jobId,
      jobDirectoryId: input.jobDirectoryId,
      windowStart: input.window.start,
      windowEnd: input.window.end,
      tasks: scheduled.tasks,
      revision,
      nextVersionNumber: snapshot.exists() ? number(snapshot.data().nextVersionNumber, 1) : 1,
      latestPublishedVersionId: snapshot.exists() ? text(snapshot.data().latestPublishedVersionId) || null : null,
      latestPdfUrl: snapshot.exists() ? text(snapshot.data().latestPdfUrl) || null : null,
      createdBy: snapshot.exists() ? text(snapshot.data().createdBy) : input.userId,
      createdAt: snapshot.exists() ? snapshot.data().createdAt : serverTimestamp(),
      updatedBy: input.userId,
      updatedAt: serverTimestamp(),
    })
    return revision
  })
}

export interface PublishJobOutlookResult {
  version: JobOutlookVersion
  issues: OutlookIssue[]
  revision: number
}

export async function publishJobOutlook(input: SaveJobOutlookInput): Promise<PublishJobOutlookResult> {
  const outlookRef = draftRef(input.jobId, input.window.start)
  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(outlookRef)
    const currentRevision = snapshot.exists() ? number(snapshot.data().revision, 0) : 0
    if (input.expectedRevision != null && snapshot.exists() && currentRevision !== input.expectedRevision) {
      throw new OutlookConflictError()
    }
    const scheduled = scheduleOutlookTasks(input.tasks, input.window)
    if (!scheduled.canPublish) {
      throw Object.assign(new Error("Resolve missing or conflicting task details before generating the PDF."), {
        code: "invalid-outlook",
        issues: scheduled.issues,
      })
    }
    const versionNumber = snapshot.exists() ? number(snapshot.data().nextVersionNumber, 1) : 1
    const id = outlookVersionId(versionNumber)
    const versionRef = doc(versionsRef(input.jobId, input.window.start), id)
    const revision = currentRevision + 1
    const versionData = {
      schemaVersion: OUTLOOK_SCHEMA_VERSION,
      versionNumber,
      kind: "published",
      jobId: input.jobId,
      jobDirectoryId: input.jobDirectoryId,
      windowStart: input.window.start,
      windowEnd: input.window.end,
      tasks: scheduled.tasks,
      createdBy: input.userId,
      createdAt: serverTimestamp(),
      pdf: null,
    }
    transaction.set(versionRef, versionData)
    transaction.set(outlookRef, {
      schemaVersion: OUTLOOK_SCHEMA_VERSION,
      jobId: input.jobId,
      jobDirectoryId: input.jobDirectoryId,
      windowStart: input.window.start,
      windowEnd: input.window.end,
      tasks: scheduled.tasks,
      revision,
      nextVersionNumber: versionNumber + 1,
      latestPublishedVersionId: id,
      latestPdfUrl: snapshot.exists() ? text(snapshot.data().latestPdfUrl) || null : null,
      createdBy: snapshot.exists() ? text(snapshot.data().createdBy) : input.userId,
      createdAt: snapshot.exists() ? snapshot.data().createdAt : serverTimestamp(),
      updatedBy: input.userId,
      updatedAt: serverTimestamp(),
    })
    return {
      revision,
      version: {
        id,
        versionNumber,
        kind: "published",
        jobId: input.jobId,
        jobDirectoryId: input.jobDirectoryId,
        window: input.window,
        tasks: scheduled.tasks,
        createdBy: input.userId,
        createdAt: null,
        pdf: null,
      },
      issues: scheduled.issues,
    }
  })
}

export async function attachPdfToOutlookVersion(
  jobId: string,
  windowStart: string,
  versionId: string,
  artifact: OutlookPdfArtifact,
): Promise<void> {
  const versionRef = doc(versionsRef(jobId, windowStart), versionId)
  await updateDoc(versionRef, { pdf: artifact })
}
