import type { Firestore } from "firebase-admin/firestore"
import { getFirebaseAdminApp } from "@/lib/ai/server/firebase-admin"
import type { WhatsAppSenderIdentity } from "@/lib/whatsapp-svc-identity"
import type { WhatsAppOutgoingReply } from "@/lib/whatsapp-response-ux"
import { hashWhatsAppPhoneNumber, identitySnapshotFromSenderIdentity, phoneReference } from "./identity"
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
}): Promise<void> {
  const db = await getAdminDb()
  const conversationId = hashWhatsAppPhoneNumber(input.senderPhoneNumber)
  const conversationRef = db.collection(CRC_CONVERSATIONS_COLLECTION).doc(conversationId)
  const messageRef = conversationRef.collection(CRC_MESSAGES_SUBCOLLECTION).doc(input.messageDocId)
  const snapshot = identitySnapshotFromSenderIdentity(input.identity)
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
    transaction.set(
      conversationRef,
      {
        ...snapshot,
        phoneHash: conversationId,
        phoneLast4: phoneReference(input.senderPhoneNumber),
        messageCount,
        lastMessageAtMs: now,
        lastMessagePreview: preview(text),
        lastMessageRole: input.role,
        updatedAtMs: now,
        ...(conversationSnap.exists ? {} : { createdAtMs: now }),
      },
      { merge: true },
    )
  })
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
