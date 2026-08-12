import { createHash } from "node:crypto"
import type { Firestore } from "firebase-admin/firestore"
import { structureDailyReportDraft, type StructureDailyReportResponse } from "@/features/bye-bye-dpr/ai/server/daily-report-structuring-service"
import type { DailyReportStructuredData } from "@/lib/bye-bye-dpr-core"
import { getFirebaseAdminApp } from "@/lib/ai/server/firebase-admin"
import type { WhatsAppSecretaryConversationMessage } from "@/lib/whatsapp-secretary/types"
import { resolveWhatsAppAccessPolicy, type WhatsAppAccessPolicy } from "@/lib/whatsapp-access-policy"
import {
  extractWhatsAppReportJobNameCandidates,
  findWhatsAppReportJobsByNameCandidates,
  type WhatsAppReportJob,
  type WhatsAppReportsDataProvider,
} from "@/lib/whatsapp-reports"
import type { WhatsAppSenderIdentity } from "@/lib/whatsapp-svc-identity"

// This is a server-only confirmation record, not a second report format. The
// actual write below always creates the established /reports document shape.
const WHATSAPP_REPORT_DRAFT_ACTIONS_COLLECTION = "whatsappReportDraftActions"
const REPORTS_COLLECTION = "reports"
const MAX_REPORT_SOURCE_CHARACTERS = 4_000

type RecordValue = Record<string, unknown>
type PendingDraftStatus = "previewed" | "created" | "cancelled"

export type WhatsAppDailyReportDraftAccess = WhatsAppAccessPolicy

export type WhatsAppPendingDailyReportDraft = {
  status: PendingDraftStatus
  actionKey: string
  reportId: string
  actorUserId: string
  actorPersonId: string
  job: WhatsAppReportJob
  rawText: string
  structuredData: DailyReportStructuredData
}

export type WhatsAppDailyReportDraftStore = {
  savePreview(input: WhatsAppPendingDailyReportDraft & { senderHash: string }): Promise<WhatsAppPendingDailyReportDraft>
  confirmPending(input: { senderHash: string; confirmationMessageId: string }): Promise<
    | { kind: "created"; draft: WhatsAppPendingDailyReportDraft }
    | { kind: "already-created"; draft: WhatsAppPendingDailyReportDraft }
    | { kind: "no-pending" }
  >
  cancelPending(input: { senderHash: string }): Promise<
    | { kind: "cancelled"; draft: WhatsAppPendingDailyReportDraft }
    | { kind: "already-created"; draft: WhatsAppPendingDailyReportDraft }
    | { kind: "no-pending" }
  >
}

export type WhatsAppDailyReportDraftAction = {
  kind: "preview" | "created" | "already-created" | "cancelled" | "access-denied" | "needs-details" | "not-found" | "ambiguous" | "unavailable"
  reply: string
}

function asRecord(value: unknown): RecordValue | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as RecordValue) : null
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function asNullableString(value: unknown): string | null {
  const result = asString(value)
  return result || null
}

function mapStructuredData(value: unknown): DailyReportStructuredData {
  const record = asRecord(value)
  return {
    workCompleted: asNullableString(record?.workCompleted),
    issuesOrDelays: asNullableString(record?.issuesOrDelays),
    nextSteps: asNullableString(record?.nextSteps),
  }
}

function readPendingDraft(value: unknown): WhatsAppPendingDailyReportDraft | null {
  const record = asRecord(value)
  if (!record) return null
  const status = record.status
  const job = asRecord(record.job)
  const mapped: WhatsAppPendingDailyReportDraft = {
    status: status === "created" || status === "cancelled" ? status : "previewed",
    actionKey: asString(record.actionKey),
    reportId: asString(record.reportId),
    actorUserId: asString(record.actorUserId),
    actorPersonId: asString(record.actorPersonId),
    job: { id: asString(job?.id), name: asString(job?.name) },
    rawText: asString(record.rawText).slice(0, MAX_REPORT_SOURCE_CHARACTERS),
    structuredData: mapStructuredData(record.structuredData),
  }
  return mapped.actionKey && mapped.reportId && mapped.actorUserId && mapped.job.id && mapped.job.name ? mapped : null
}

function senderHash(phoneNumber: string): string {
  return createHash("sha256").update(phoneNumber).digest("hex")
}

function actionKey(phoneNumber: string, messageId: string): string {
  return createHash("sha256").update(`whatsapp-daily-report-draft:${phoneNumber}:${messageId}`).digest("hex")
}

function reportIdForAction(key: string): string {
  return `whatsapp-draft-${key.slice(0, 40)}`
}

function currentUserMessage(messages: WhatsAppSecretaryConversationMessage[]): string {
  return messages.filter((message) => message.role === "user").at(-1)?.content.trim() ?? ""
}

function normalizedCommand(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[.!?,;:]+$/g, "").replace(/\s+/g, " ")
}

/** Deliberately narrow: a generic chat message can never cause a report preview. */
export function isWhatsAppDailyReportDraftRequest(value: string): boolean {
  return /\b(?:create|prepare|start|make|draft)\b[\s\S]{0,80}\b(?:daily\s+report|report\s+draft)\b/i.test(value)
}

/** Confirmation must state the action explicitly; a bare "yes" is insufficient. */
export function isWhatsAppDailyReportDraftConfirmation(value: string): boolean {
  const command = normalizedCommand(value)
  return /^(?:confirm\s+(?:(?:daily\s+)?report(?:\s+draft)?|draft)|create\s+(?:the\s+)?(?:daily\s+)?report\s+draft)$/.test(command)
}

export function isWhatsAppDailyReportDraftCancellation(value: string): boolean {
  const command = normalizedCommand(value)
  return /^(?:cancel\s+(?:(?:daily\s+)?report(?:\s+draft)?|draft))$/.test(command)
}

function extractCurrentReportSource(text: string): string {
  // Prefer an explicit separator after the write request. This keeps the
  // persisted source note free of the command and job-name wording.
  const separator = text.match(/[:;\n]\s*([\s\S]+)$/)
  if (separator?.[1] && isWhatsAppDailyReportDraftRequest(text)) {
    return separator[1].trim().slice(0, MAX_REPORT_SOURCE_CHARACTERS)
  }

  // No separator is still safe when the sender clearly labels report fields.
  const detailStart = text.search(/\b(?:work\s+completed|completed|issues?(?:\s+or\s+delays)?|delays?|next\s+steps?)\b/i)
  return detailStart >= 0 ? text.slice(detailStart).trim().slice(0, MAX_REPORT_SOURCE_CHARACTERS) : ""
}

function extractReportSource(messages: WhatsAppSecretaryConversationMessage[]): string {
  const current = currentUserMessage(messages)
  const direct = extractCurrentReportSource(current)
  if (direct) return direct

  // A recent field update can be used only as a continuation of an explicit
  // current create command. We do not scan old conversation history broadly.
  const previousUpdates = messages
    .filter((message) => message.role === "user")
    .slice(-4, -1)
    .reverse()
  for (const message of previousUpdates) {
    if (isWhatsAppDailyReportDraftRequest(message.content)) continue
    if (/\b(?:work\s+completed|completed|issues?(?:\s+or\s+delays)?|delays?|next\s+steps?)\b/i.test(message.content)) {
      return message.content.trim().slice(0, MAX_REPORT_SOURCE_CHARACTERS)
    }
  }
  return ""
}

function formatPreview(draft: WhatsAppPendingDailyReportDraft): string {
  const fields = draft.structuredData
  return [
    "Daily Report draft preview",
    `Job: ${draft.job.name}`,
    `Work completed: ${fields.workCompleted ?? "Not provided"}`,
    `Issues or delays: ${fields.issuesOrDelays ?? "Not provided"}`,
    `Next steps: ${fields.nextSteps ?? "Not provided"}`,
    "This will create one DRAFT only. It will not submit, finalize, attach files, or post to Messages.",
    "Reply exactly CONFIRM DRAFT to create it, or CANCEL DRAFT to discard this preview.",
  ].join("\n")
}

function sameDailyReportDraft(existing: RecordValue, draft: WhatsAppPendingDailyReportDraft): boolean {
  return (
    existing.authorId === draft.actorUserId &&
    existing.jobId === draft.job.id &&
    existing.status === "draft" &&
    existing.idempotencyKey === draft.actionKey
  )
}

async function getAdminDb(): Promise<Firestore> {
  const { getFirestore } = await import("firebase-admin/firestore")
  return getFirestore(await getFirebaseAdminApp())
}

function createServerDraftStore(): WhatsAppDailyReportDraftStore {
  return {
    async savePreview(input) {
      const db = await getAdminDb()
      const ref = db.collection(WHATSAPP_REPORT_DRAFT_ACTIONS_COLLECTION).doc(input.senderHash)
      return db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref)
        const existing = readPendingDraft(snapshot.data())
        if (existing?.actionKey === input.actionKey) return existing

        transaction.set(ref, {
          status: "previewed",
          actionKey: input.actionKey,
          reportId: input.reportId,
          actorUserId: input.actorUserId,
          actorPersonId: input.actorPersonId,
          job: input.job,
          rawText: input.rawText,
          structuredData: input.structuredData,
          previewedAt: new Date(),
          createdAt: snapshot.exists ? snapshot.data()?.createdAt ?? new Date() : new Date(),
          confirmedAt: null,
          confirmationMessageId: null,
        })
        return { ...input, status: "previewed" as const }
      })
    },
    async confirmPending(input) {
      const db = await getAdminDb()
      const actionRef = db.collection(WHATSAPP_REPORT_DRAFT_ACTIONS_COLLECTION).doc(input.senderHash)
      return db.runTransaction(async (transaction) => {
        const actionSnapshot = await transaction.get(actionRef)
        const draft = readPendingDraft(actionSnapshot.data())
        if (!draft || draft.status === "cancelled") return { kind: "no-pending" as const }
        if (draft.status === "created") return { kind: "already-created" as const, draft }

        const reportRef = db.collection(REPORTS_COLLECTION).doc(draft.reportId)
        const reportSnapshot = await transaction.get(reportRef)
        if (reportSnapshot.exists && !sameDailyReportDraft(reportSnapshot.data() as RecordValue, draft)) {
          throw new Error("WhatsApp Daily Report draft idempotency conflict.")
        }

        const now = new Date()
        if (!reportSnapshot.exists) {
          transaction.set(reportRef, {
            jobId: draft.job.id,
            authorId: draft.actorUserId,
            type: "daily_report",
            status: "draft",
            rawText: draft.rawText,
            transcription: null,
            transcriptionSource: "typed",
            structuredData: draft.structuredData,
            structuredDataSource: "ai",
            audioStoragePath: null,
            pdfStoragePath: null,
            commsMessageId: null,
            idempotencyKey: draft.actionKey,
            createdAt: now,
            updatedAt: now,
            submittedAt: null,
          })
        }
        transaction.update(actionRef, {
          status: "created",
          confirmedAt: now,
          confirmationMessageId: input.confirmationMessageId,
        })
        return { kind: "created" as const, draft: { ...draft, status: "created" as const } }
      })
    },
    async cancelPending(input) {
      const db = await getAdminDb()
      const actionRef = db.collection(WHATSAPP_REPORT_DRAFT_ACTIONS_COLLECTION).doc(input.senderHash)
      return db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(actionRef)
        const draft = readPendingDraft(snapshot.data())
        if (!draft || draft.status === "cancelled") return { kind: "no-pending" as const }
        if (draft.status === "created") return { kind: "already-created" as const, draft }
        transaction.update(actionRef, { status: "cancelled", cancelledAt: new Date() })
        return { kind: "cancelled" as const, draft: { ...draft, status: "cancelled" as const } }
      })
    },
  }
}

function hasReportContent(data: DailyReportStructuredData): boolean {
  return Object.values(data).some((value) => typeof value === "string" && value.trim().length > 0)
}

/** Shared-policy compatibility export for focused tests and future callers. */
export function createWhatsAppDailyReportDraftAccess(identity: WhatsAppSenderIdentity | null): WhatsAppDailyReportDraftAccess {
  return resolveWhatsAppAccessPolicy(identity)
}

/**
 * Handles only the three explicit WhatsApp commands for a Daily Report draft:
 * create preview, CONFIRM DRAFT, and CANCEL DRAFT. It returns null for every
 * other message so the normal Secretary flow remains unchanged.
 */
export async function handleWhatsAppDailyReportDraftAction(
  input: {
    senderPhoneNumber: string
    messageId: string
    recentMessages: WhatsAppSecretaryConversationMessage[]
    identity: WhatsAppSenderIdentity | null
  },
  deps: {
    reportProvider?: WhatsAppReportsDataProvider
    draftStore?: WhatsAppDailyReportDraftStore
    structure?: (text: string) => Promise<StructureDailyReportResponse>
  } = {},
): Promise<WhatsAppDailyReportDraftAction | null> {
  const current = currentUserMessage(input.recentMessages)
  const isCreate = isWhatsAppDailyReportDraftRequest(current)
  const isConfirm = isWhatsAppDailyReportDraftConfirmation(current)
  const isCancel = isWhatsAppDailyReportDraftCancellation(current)
  if (!isCreate && !isConfirm && !isCancel) return null

  const access = createWhatsAppDailyReportDraftAccess(input.identity)
  // Enforce authorization before constructing a job resolver, a Firestore
  // action store, or an AI parser. Public numbers cannot probe jobs or drafts.
  if (!access.canCreateDailyReportDraft || !access.actorUserId || !access.actorPersonId) {
    return {
      kind: "access-denied",
      reply: "Creating a Daily Report draft requires a recognized SVC WhatsApp number linked to an SVC user account.",
    }
  }

  const store = deps.draftStore ?? createServerDraftStore()
  const hashedSender = senderHash(input.senderPhoneNumber)
  if (isConfirm) {
    try {
      const outcome = await store.confirmPending({ senderHash: hashedSender, confirmationMessageId: input.messageId })
      if (outcome.kind === "no-pending") {
        return { kind: "needs-details", reply: "There is no active Daily Report draft preview to confirm. Send the report details first so I can show you a preview." }
      }
      if (outcome.kind === "already-created") {
        return { kind: "already-created", reply: `That Daily Report draft for ${outcome.draft.job.name} was already created. It remains a draft and has not been submitted.` }
      }
      return { kind: "created", reply: `Daily Report draft created for ${outcome.draft.job.name}. It is still a draft only; nothing was submitted or finalized.` }
    } catch {
      console.error("Unable to confirm WhatsApp Daily Report draft.")
      return { kind: "unavailable", reply: "I could not create that Daily Report draft right now. Nothing was submitted. Please try CONFIRM DRAFT again." }
    }
  }

  if (isCancel) {
    try {
      const outcome = await store.cancelPending({ senderHash: hashedSender })
      if (outcome.kind === "no-pending") {
        return { kind: "needs-details", reply: "There is no active Daily Report draft preview to cancel." }
      }
      if (outcome.kind === "already-created") {
        return { kind: "already-created", reply: `That Daily Report draft for ${outcome.draft.job.name} was already created, so the preview can no longer be cancelled. It has not been submitted.` }
      }
      return { kind: "cancelled", reply: "Daily Report draft preview cancelled. No report was created." }
    } catch {
      console.error("Unable to cancel WhatsApp Daily Report draft preview.")
      return { kind: "unavailable", reply: "I could not cancel that Daily Report draft preview right now. No report was submitted." }
    }
  }

  const currentCandidates = extractWhatsAppReportJobNameCandidates([{ role: "user", content: current }])
  const jobCandidates = currentCandidates.length > 0
    ? currentCandidates
    : extractWhatsAppReportJobNameCandidates(input.recentMessages)
  if (jobCandidates.length === 0) {
    return {
      kind: "needs-details",
      reply: "Please include the exact job name and report details. For example: Create a Daily Report draft for North Ridge: Work completed: … Issues or delays: … Next steps: …",
    }
  }

  let jobs: WhatsAppReportJob[]
  try {
    jobs = await findWhatsAppReportJobsByNameCandidates(jobCandidates, { provider: deps.reportProvider })
  } catch {
    console.error("Unable to resolve WhatsApp Daily Report draft job.")
    return { kind: "unavailable", reply: "I could not look up that job right now, so no draft was prepared." }
  }
  if (jobs.length === 0) {
    return { kind: "not-found", reply: "I could not find a matching ByeByeDPR job. Please send the exact job name; no draft was created." }
  }
  if (jobs.length > 1) {
    return {
      kind: "ambiguous",
      reply: `More than one job matches. Please choose one exact job name:\n${jobs.slice(0, 5).map((job) => `- ${job.name}`).join("\n")}`,
    }
  }

  const rawText = extractReportSource(input.recentMessages)
  if (!rawText) {
    return {
      kind: "needs-details",
      reply: "I found the job, but not the Daily Report details. Include work completed, issues or delays, and/or next steps, then I will show a preview before creating anything.",
    }
  }

  let structured: StructureDailyReportResponse
  try {
    structured = await (deps.structure ?? structureDailyReportDraft)(rawText)
  } catch {
    console.error("Unable to structure WhatsApp Daily Report draft preview.")
    return { kind: "unavailable", reply: "I could not prepare the Daily Report preview right now. No draft was created." }
  }
  if (!hasReportContent(structured.structuredData)) {
    return {
      kind: "needs-details",
      reply: "I could not find report content to preview. Include what was completed, any issues or delays, or the next steps; no draft was created.",
    }
  }

  const draft: WhatsAppPendingDailyReportDraft & { senderHash: string } = {
    status: "previewed",
    actionKey: actionKey(input.senderPhoneNumber, input.messageId),
    reportId: reportIdForAction(actionKey(input.senderPhoneNumber, input.messageId)),
    actorUserId: access.actorUserId,
    actorPersonId: access.actorPersonId,
    job: jobs[0],
    rawText,
    structuredData: structured.structuredData,
    senderHash: hashedSender,
  }
  try {
    const saved = await store.savePreview(draft)
    return { kind: "preview", reply: formatPreview(saved) }
  } catch {
    console.error("Unable to save WhatsApp Daily Report draft preview.")
    return { kind: "unavailable", reply: "I could not save that Daily Report preview right now. No draft was created." }
  }
}
