/**
 * Backfill the two existing Applications records into Communications.
 *
 * Safe by default: omit --write to inspect the exact two records only. A
 * deterministic message id means a retry updates the same card instead of
 * duplicating announcements.
 *
 * Production:
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *   CONFIRM_APPLICATION_COMMS_BACKFILL=true pnpm exec tsx \
 *   scripts/backfill-application-completion-comms.ts --write
 */

import { cert, getApps, initializeApp } from "firebase-admin/app"
import { getFirestore, Timestamp } from "firebase-admin/firestore"
import { getStorage } from "firebase-admin/storage"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { createApplicationProfilePdf, type ApplicationProfilePdfInput } from "@/features/applications/application-profile-pdf"

const STORAGE_BUCKET = "svc-comms.firebasestorage.app"
const TAG_NAME = "Applications/Onboarding"
const APPLICATION_IDS = [
  "app_1f14708ddc6686b12f609d324f99d205",
  "app_d2cd850cecafc7b528d55a84e5d2d917",
] as const
const write = process.argv.includes("--write")

type RecordValue = Record<string, unknown>

function record(value: unknown): RecordValue {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {}
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function iso(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function") {
    const date = value.toDate()
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date.toISOString() : null
  }
  if (typeof value === "string") return value || null
  return null
}

function fileName(candidateName: string): string {
  const slug = candidateName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
  return `${slug || "candidate"}-application-profile.pdf`
}

function statusLabel(status: string): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) || "Unknown"
}

function buildProfile(data: RecordValue, activity: RecordValue[]): { candidateName: string; profile: ApplicationProfilePdfInput } {
  const general = record(data.general)
  const video = record(data.video)
  const agreement = record(data.agreement)
  const candidateName = text(general.fullName) || text(data.candidateName) || "Candidate"
  return {
    candidateName,
    profile: {
      generatedAtIso: new Date().toISOString(),
      candidate: {
        name: candidateName,
        trade: text(data.trade),
        status: text(data.status) || "draft",
        submittedAt: iso(data.submittedAt),
        createdAt: iso(data.createdAt),
      },
      job: {
        name: text(data.jobName),
        location: text(data.jobLocation),
        companyName: text(data.companyName),
      },
      application: {
        fullName: text(general.fullName),
        phone: text(general.phone),
        email: text(general.email),
        cityState: text(general.cityState),
        yearsExperience: text(general.yearsExperience),
        primaryTrade: text(general.primaryTrade),
        resumeFileName: text(general.resumeFileName) || null,
        workReference: text(general.workReference) || null,
      },
      video: {
        state: text(video.state) || "not_started",
        source: text(video.source) || null,
        fileName: text(video.fileName) || null,
        durationSeconds: number(video.durationSeconds),
        capturedAt: iso(video.capturedAt),
        transcript: text(video.transcript) || null,
        summary: text(record(video.summary).summary) || null,
      },
      documents: Array.isArray(data.documents)
        ? data.documents.map((entry) => {
            const document = record(entry)
            return {
              label: text(document.label) || "Untitled document",
              status: text(document.status) || "missing",
              required: document.required !== false,
              fileName: text(document.fileName) || null,
              uploadedAt: iso(document.uploadedAt),
              helper: text(document.helper) || null,
            }
          })
        : [],
      agreement: {
        status: text(agreement.status) || "locked",
        sentAt: iso(agreement.sentAt),
        expiresAt: iso(agreement.expiresAt),
        signedAt: iso(agreement.signedAt),
        signedName: text(agreement.signedName) || null,
        signedVersion: text(agreement.signedVersion) || null,
      },
      activity: activity.map((event) => ({
        actor: text(event.actor) || "Someone",
        message: text(event.message),
        at: iso(event.at),
      })),
    },
  }
}

async function main() {
  if (write && process.env.CONFIRM_APPLICATION_COMMS_BACKFILL !== "true") {
    throw new Error("Set CONFIRM_APPLICATION_COMMS_BACKFILL=true before writing to production.")
  }
  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS ?? "./service-account.json"
  const credentials = await import(pathToFileURL(resolve(credentialsPath)).href)
  const serviceAccount = credentials.default ?? credentials
  const app = getApps()[0] ?? initializeApp({ credential: cert(serviceAccount), storageBucket: STORAGE_BUCKET })
  const db = getFirestore(app)
  const bucket = getStorage(app).bucket(STORAGE_BUCKET)

  const [tagSnapshot, membersSnapshot] = await Promise.all([
    db.collection("projects").where("name", "==", TAG_NAME).limit(2).get(),
    db.collection("users").get(),
  ])
  if (tagSnapshot.size !== 1) throw new Error(`Expected exactly one ${TAG_NAME} tag, found ${tagSnapshot.size}.`)
  const tagId = tagSnapshot.docs[0].id

  for (const applicationId of APPLICATION_IDS) {
    const applicationRef = db.collection("applications").doc(applicationId)
    const [applicationSnapshot, activitySnapshot] = await Promise.all([
      applicationRef.get(),
      applicationRef.collection("activity").orderBy("at", "asc").limit(200).get(),
    ])
    if (!applicationSnapshot.exists) throw new Error(`Missing application ${applicationId}.`)
    const data = applicationSnapshot.data() ?? {}
    const activities = activitySnapshot.docs.map((entry) => entry.data())
    const creatorActivity = activities.find((event) => text(event.kind) === "created")
    const authorUid = text(data.inviteCreatedBy) || text(creatorActivity?.actorUid)
    const authorName = text(data.inviteCreatedByName) || text(creatorActivity?.actor) || "SVC team"
    if (!authorUid || authorUid.startsWith("cand_") || authorUid.includes("/")) {
      throw new Error(`No eligible invitation creator for ${applicationId}.`)
    }

    const { candidateName, profile } = buildProfile(data, activities)
    const status = text(data.status) || "draft"
    const jobName = text(data.jobName)
    const messageId = `application-completion-${applicationId}`
    const existingMessage = await db.collection("messages").doc(messageId).get()
    const storagePath = `application-completions/${applicationId}/application-profile.pdf`
    const expectedFileName = fileName(candidateName)
    const summary = `${candidateName} · ${statusLabel(status)}`

    console.log(`${write ? "WRITE" : "DRY RUN"} ${applicationId}: ${summary}; author=${authorName}; message=${messageId}; existing=${existingMessage.exists}`)
    if (!write) continue

    const pdfBytes = await createApplicationProfilePdf(profile)
    const file = bucket.file(storagePath)
    await file.save(Buffer.from(pdfBytes), {
      contentType: "application/pdf",
      metadata: { cacheControl: "private, max-age=0" },
    })
    const [downloadUrl] = await file.getSignedUrl({ action: "read", expires: "01-01-2500" })
    const visibleToUserIds = [...new Set([authorUid, ...membersSnapshot.docs.map((member) => member.id)])]
    const recipientIds = visibleToUserIds.filter((id) => id !== authorUid)
    const content = jobName ? `Application · ${summary}\n${jobName}` : `Application · ${summary}`
    const jobContextId = text(data.jobEntityId)
    const message = {
      authorId: authorUid,
      senderId: authorUid,
      recipientIds,
      peopleIds: recipientIds,
      participants: [authorUid, ...recipientIds],
      visibleToUserIds,
      projectIds: [tagId],
      projectId: tagId,
      tagIds: [`project:${tagId}`],
      content,
      text: content,
      type: "none",
      contactIds: [],
      contextIds: jobContextId ? [jobContextId] : [],
      fileUrl: downloadUrl,
      fileName: expectedFileName,
      fileContentType: "application/pdf",
      filePath: storagePath,
      isFavorited: false,
      sourceModule: "applications",
      sourceApplicationId: applicationId,
      applicationStatus: status,
      createdAt: existingMessage.exists ? existingMessage.data()?.createdAt ?? Timestamp.now() : Timestamp.now(),
      updatedAt: Timestamp.now(),
      timestamp: existingMessage.exists ? existingMessage.data()?.timestamp ?? Timestamp.now() : Timestamp.now(),
    }
    await Promise.all([
      db.collection("messages").doc(messageId).set(message, { merge: true }),
      applicationRef.set(
        {
          inviteCreatedBy: authorUid,
          inviteCreatedByName: authorName,
          completionPdf: { storagePath, downloadUrl, fileName: expectedFileName, generatedAt: Timestamp.now() },
          commsCompletionMessageId: messageId,
          updatedAt: Timestamp.now(),
        },
        { merge: true },
      ),
    ])
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
