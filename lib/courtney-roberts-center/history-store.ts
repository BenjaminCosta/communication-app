import type { Firestore } from "firebase-admin/firestore"
import { getFirebaseAdminApp } from "@/lib/ai/server/firebase-admin"
import type { WhatsAppSenderIdentity } from "@/lib/whatsapp-svc-identity"
import type { WhatsAppOutgoingReply } from "@/lib/whatsapp-response-ux"
import {
  hashWhatsAppPhoneNumber,
  identitySnapshotFromSenderIdentity,
  identitySnapshotWriteFields,
  reconcileIdentitySnapshot,
} from "./identity"
import type { CourtneyRobertsCenterAttachmentMetadata, CourtneyRobertsCenterMessageRole } from "./types"

export const CRC_CONVERSATIONS_COLLECTION = "courtneyRobertsCenterConversations"
export const CRC_MESSAGES_SUBCOLLECTION = "messages"

const MAX_STORED_TEXT_CHARACTERS = 8_000
const MAX_PREVIEW_CHARACTERS = 160

async function getAdminDb(): Promise<Firestore> {
  const { getFirestore } = await import("firebase-admin/firestore")
  return getFirestore(await getFirebaseAdminApp())
}

function preview(text: string): string {
  const trimmed = text.replace(/\s+/g, " ").trim()
  return trimmed.length <= MAX_PREVIEW_CHARACTERS ? trimmed : `${trimmed.slice(0, MAX_PREVIEW_CHARACTERS - 1)}…`
}

/**
 * Appends one message to the durable transcript and refreshes the
 * conversation summary in the same transaction. The message doc id is
 * deterministic (the WhatsApp message id, or `assistant:{replyToMessageId}`
 * for a reply — same convention `lib/whatsapp-conversation-memory.ts` uses)
 * so a Meta delivery retry re-processing the same inbound message is a safe
 * no-op here, and `messageCount` can never double-count a retried message.
 */
async function appendMessage(input: {
  senderPhoneNumber: string
  messageDocId: string
  role: CourtneyRobertsCenterMessageRole
  text: string
  identity: WhatsAppSenderIdentity | null
  extra?: Record<string, unknown>
  /** Merged into the conversation-level doc write, in the same transaction
   * as the message — e.g. flipping `aiPaused` atomically with the human
   * reply that caused it. */
  conversationExtra?: Record<string, unknown>
}): Promise<void> {
  const db = await getAdminDb()
  const conversationId = hashWhatsAppPhoneNumber(input.senderPhoneNumber)
  const conversationRef = db.collection(CRC_CONVERSATIONS_COLLECTION).doc(conversationId)
  const messageRef = conversationRef.collection(CRC_MESSAGES_SUBCOLLECTION).doc(input.messageDocId)
  const turnSnapshot = identitySnapshotFromSenderIdentity(input.identity)
  const text = input.text.slice(0, MAX_STORED_TEXT_CHARACTERS)
  const now = Date.now()

  await db.runTransaction(async (transaction) => {
    const [conversationSnap, messageSnap] = await Promise.all([transaction.get(conversationRef), transaction.get(messageRef)])
    if (messageSnap.exists) return

    transaction.set(messageRef, {
      role: input.role,
      text,
      createdAtMs: now,
      ...(input.extra ?? {}),
    })

    const existing = conversationSnap.data()
    const messageCount = (typeof existing?.messageCount === "number" ? existing.messageCount : 0) + 1
    // Read inside the transaction, so a concurrent link and an inbound message
    // cannot race into "Unknown sender".
    const snapshot = reconcileIdentitySnapshot(existing as Partial<typeof turnSnapshot> | undefined, turnSnapshot)
    transaction.set(
      conversationRef,
      {
        ...identitySnapshotWriteFields(snapshot),
        phoneHash: conversationId,
        phoneNumber: input.senderPhoneNumber,
        messageCount,
        lastMessageAtMs: now,
        // Tracked separately from `lastMessageAtMs` because it is what opens
        // WhatsApp's 24-hour free-form window — an assistant reply, which is
        // what usually moves `lastMessageAtMs`, does not.
        ...(input.role === "user" ? { lastInboundAtMs: now } : {}),
        lastMessagePreview: preview(text),
        lastMessageRole: input.role,
        updatedAtMs: now,
        ...(conversationSnap.exists ? {} : { createdAtMs: now }),
        ...(input.conversationExtra ?? {}),
      },
      { merge: true },
    )
  })
}

/**
 * Whether a human has taken over this conversation — checked by the webhook
 * before it would otherwise generate and send an automatic AI reply. A
 * missing conversation doc (never recorded, or Firestore hiccup) reads as
 * "not paused", the existing default behavior.
 */
export async function isCourtneyRobertsCenterAiPaused(senderPhoneNumber: string): Promise<boolean> {
  const db = await getAdminDb()
  const conversationId = hashWhatsAppPhoneNumber(senderPhoneNumber)
  const snapshot = await db.collection(CRC_CONVERSATIONS_COLLECTION).doc(conversationId).get()
  return snapshot.data()?.aiPaused === true
}

/**
 * Records one inbound WhatsApp message. Best-effort: a failure here is
 * logged and swallowed rather than thrown, so this audit trail can never
 * break the Secretary's actual reply — matches the existing swallow-and-log
 * convention for non-critical side effects elsewhere in this webhook (e.g.
 * `backfillUserPhoneFromInboundWhatsApp`).
 */
export async function recordCourtneyRobertsCenterInboundMessage(input: {
  senderPhoneNumber: string
  messageId: string
  text: string
  identity: WhatsAppSenderIdentity | null
}): Promise<void> {
  try {
    await appendMessage({
      senderPhoneNumber: input.senderPhoneNumber,
      messageDocId: input.messageId,
      role: "user",
      text: input.text,
      identity: input.identity,
    })
  } catch {
    console.error("Unable to record durable Courtney Roberts Center history for an inbound WhatsApp message.")
  }
}

function attachmentMetadata(
  attachments: WhatsAppOutgoingReply["attachments"],
): CourtneyRobertsCenterAttachmentMetadata[] | undefined {
  if (!attachments || attachments.length === 0) return undefined
  return attachments.map((attachment) => ({
    kind: attachment.kind,
    ...(attachment.filename ? { filename: attachment.filename } : {}),
  }))
}

/** Records one Secretary reply. Best-effort, same reasoning as {@link recordCourtneyRobertsCenterInboundMessage}. */
export async function recordCourtneyRobertsCenterAssistantReply(input: {
  senderPhoneNumber: string
  replyToMessageId: string
  identity: WhatsAppSenderIdentity | null
  reply: WhatsAppOutgoingReply
}): Promise<void> {
  try {
    const attachments = attachmentMetadata(input.reply.attachments)
    await appendMessage({
      senderPhoneNumber: input.senderPhoneNumber,
      messageDocId: `assistant:${input.replyToMessageId}`,
      role: "assistant",
      text: input.reply.text,
      identity: input.identity,
      extra: {
        ...(input.reply.presentation?.kind ? { presentationKind: input.reply.presentation.kind } : {}),
        ...(attachments ? { attachments } : {}),
      },
    })
  } catch {
    console.error("Unable to record durable Courtney Roberts Center history for a Courtney Roberts reply.")
  }
}

/**
 * Records one human admin reply and flips `aiPaused` on in the same
 * transaction — the takeover and the message that caused it land together,
 * so the Center can never show a paused conversation whose most recent
 * message doesn't explain why.
 *
 * Deliberately **not** best-effort like the two recorders above: those guard
 * a webhook whose real job is the auto-reply, where a durable-history
 * failure must never block it. Here the durable record *is* the point — the
 * caller (`lib/courtney-roberts-center/manual-reply.ts`) already sent the
 * WhatsApp message by the time this runs, so a failure here is surfaced to
 * the admin rather than silently dropped.
 */
export async function recordCourtneyRobertsCenterHumanReply(input: {
  senderPhoneNumber: string
  clientMessageId: string
  text: string
  identity: WhatsAppSenderIdentity | null
  sentByName: string
}): Promise<void> {
  await appendMessage({
    senderPhoneNumber: input.senderPhoneNumber,
    messageDocId: `human:${input.clientMessageId}`,
    role: "assistant",
    text: input.text,
    identity: input.identity,
    extra: { sentBy: "human", sentByName: input.sentByName },
    conversationExtra: {
      aiPaused: true,
      aiPausedAtMs: Date.now(),
      aiPausedByName: input.sentByName,
    },
  })
}

/** Clears the human takeover — the webhook resumes generating automatic replies for this conversation. */
export async function resumeCourtneyRobertsCenterAi(senderPhoneNumber: string): Promise<void> {
  const db = await getAdminDb()
  const conversationId = hashWhatsAppPhoneNumber(senderPhoneNumber)
  await db
    .collection(CRC_CONVERSATIONS_COLLECTION)
    .doc(conversationId)
    .set({ aiPaused: false, aiPausedAtMs: null, aiPausedByName: null, updatedAtMs: Date.now() }, { merge: true })
}
