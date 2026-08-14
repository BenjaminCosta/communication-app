import "server-only"

import type { DocumentData, Firestore } from "firebase-admin/firestore"
import { getFirebaseAdminApp } from "@/lib/ai/server/firebase-admin"
import { projectTagId } from "@/lib/store"

const USERS_COLLECTION = "users"
const CONTEXTS_COLLECTION = "contexts"
const MESSAGES_COLLECTION = "messages"
const PROJECTS_COLLECTION = "projects"
const OUTLOOK_TAG_NAME = "3 Week Outlook"

export class OutlookCommsError extends Error {
  readonly code: string
  readonly httpStatus: number

  constructor(code: string, message: string, httpStatus = 400) {
    super(message)
    this.name = "OutlookCommsError"
    this.code = code
    this.httpStatus = httpStatus
  }
}

export interface PublishOutlookVersionToCommsInput {
  authorUid: string
  jobContextId: string
  windowStart: string
  versionId: string
}

async function adminFirestore(): Promise<Firestore> {
  const { getFirestore } = await import("firebase-admin/firestore")
  return getFirestore(await getFirebaseAdminApp())
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function requiredText(value: unknown, field: string): string {
  const result = text(value)
  if (!result || result.length > 180 || result.includes("/")) {
    throw new OutlookCommsError("invalid-request", `Invalid ${field}.`)
  }
  return result
}

function outlookMessageId(input: Pick<PublishOutlookVersionToCommsInput, "jobContextId" | "windowStart" | "versionId">): string {
  return `outlook-${input.jobContextId}-${input.windowStart}-${input.versionId}`
}

function messageIdFromVersion(value: unknown): string | null {
  const result = text(value)
  return result && result.length <= 180 && !result.includes("/") ? result : null
}

/**
 * Publishes one deterministic Communications card for a generated Outlook
 * version. The version document is the source of truth for the PDF; callers
 * cannot submit a URL or a message body of their own.
 */
export async function publishOutlookVersionToComms(input: PublishOutlookVersionToCommsInput): Promise<{ messageId: string }> {
  const jobContextId = requiredText(input.jobContextId, "job")
  const windowStart = requiredText(input.windowStart, "window")
  const versionId = requiredText(input.versionId, "version")
  const db = await adminFirestore()
  const versionRef = db.collection(CONTEXTS_COLLECTION).doc(jobContextId).collection("outlooks").doc(windowStart).collection("versions").doc(versionId)
  const [versionSnapshot, jobSnapshot, authorSnapshot, membersSnapshot, outlookTagSnapshot] = await Promise.all([
    versionRef.get(),
    db.collection(CONTEXTS_COLLECTION).doc(jobContextId).get(),
    db.collection(USERS_COLLECTION).doc(input.authorUid).get(),
    db.collection(USERS_COLLECTION).get(),
    db.collection(PROJECTS_COLLECTION).where("name", "==", OUTLOOK_TAG_NAME).limit(2).get(),
  ])

  if (!versionSnapshot.exists || !jobSnapshot.exists) {
    throw new OutlookCommsError("not-found", "That Outlook version could not be found.", 404)
  }

  const version = versionSnapshot.data() ?? {}
  if (text(version.jobId) !== jobContextId) {
    throw new OutlookCommsError("invalid-request", "That Outlook does not belong to this job.")
  }
  const pdf = version.pdf && typeof version.pdf === "object" ? version.pdf as DocumentData : null
  const downloadUrl = text(pdf?.downloadUrl)
  const fileName = text(pdf?.fileName)
  const storagePath = text(pdf?.storagePath)
  if (!downloadUrl || !fileName || !storagePath) {
    throw new OutlookCommsError("pdf-not-ready", "The Outlook PDF is not ready yet.", 409)
  }
  if (outlookTagSnapshot.size !== 1) {
    throw new OutlookCommsError("outlook-tag-unavailable", `The required ${OUTLOOK_TAG_NAME} tag is not available.`, 409)
  }

  const job = jobSnapshot.data() ?? {}
  const masterData = job.masterData && typeof job.masterData === "object" ? job.masterData as DocumentData : {}
  const jobName = text(masterData.canonicalName) || text(job.name) || "this job"
  const authorName = text(authorSnapshot.data()?.name) || "Someone"
  const taskCount = Array.isArray(version.tasks) ? version.tasks.length : 0
  const versionNumber = typeof version.versionNumber === "number" ? version.versionNumber : 0
  // Outlooks are a company-wide operational update. Every registered Comms
  // user can see them, while recipients remain everyone other than the author.
  const visibleToUserIds = [...new Set([input.authorUid, ...membersSnapshot.docs.map((member) => member.id)])]
  const recipientIds = visibleToUserIds.filter((id) => id !== input.authorUid)
  const outlookTagId = outlookTagSnapshot.docs[0].id
  const messageId = messageIdFromVersion(version.commsMessageId) ?? outlookMessageId({ jobContextId, windowStart, versionId })
  const messageRef = db.collection(MESSAGES_COLLECTION).doc(messageId)
  const { FieldValue } = await import("firebase-admin/firestore")
  const scheduleLabel = `${windowStart} · Version ${versionNumber || 1}`
  const taskLabel = `${taskCount} scheduled ${taskCount === 1 ? "task" : "tasks"}.`

  const message = {
    authorId: input.authorUid,
    senderId: input.authorUid,
    recipientIds,
    peopleIds: recipientIds,
    participants: [input.authorUid, ...recipientIds],
    visibleToUserIds,
    projectIds: [outlookTagId],
    projectId: outlookTagId,
    tagIds: [projectTagId(outlookTagId)],
    content: `3-Week Outlook · ${jobName}\n${scheduleLabel}\n\n${taskLabel}`,
    text: `3-Week Outlook · ${jobName}\n${scheduleLabel}\n\n${taskLabel}`,
    type: "none" as const,
    contactIds: [] as string[],
    contextIds: [jobContextId],
    fileUrl: downloadUrl,
    fileName,
    fileContentType: "application/pdf",
    filePath: storagePath,
    isFavorited: false,
    sourceModule: "three-week-outlook",
    sourceOutlookVersionId: versionId,
    outlookVersionNumber: versionNumber,
    outlookTaskCount: taskCount,
  }

  if (!((await messageRef.get()).exists)) {
    try {
      await messageRef.create({
        ...message,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        timestamp: FieldValue.serverTimestamp(),
      })
    } catch (error) {
      // A retry can race another tab. The deterministic document is the same
      // Outlook card, so only surface a failure if it still does not exist.
      if (!((await messageRef.get()).exists)) throw error
    }
  }
  await Promise.all([
    messageRef.set({ ...message, updatedAt: FieldValue.serverTimestamp() }, { merge: true }),
    versionRef.update({ commsMessageId: messageId }),
  ])
  return { messageId }
}
