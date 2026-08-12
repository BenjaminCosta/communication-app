import type { Firestore } from "firebase-admin/firestore"
import { createHash } from "node:crypto"
import type { WhatsAppSecretaryConversationMessage } from "@/lib/whatsapp-secretary/types"
import { getFirebaseAdminApp } from "@/lib/ai/server/firebase-admin"
import type { WhatsAppOutgoingReply, WhatsAppReplyPresentation } from "@/lib/whatsapp-response-ux"

const CONVERSATIONS_COLLECTION = "whatsappConversations"
const MAX_RECENT_MESSAGES = 12
const MAX_STORED_MESSAGE_CHARACTERS = 2_000

type ConversationRole = WhatsAppSecretaryConversationMessage["role"]

type StoredConversationMessage = WhatsAppSecretaryConversationMessage & {
  id: string
  createdAtMs: number
  replyToMessageId?: string
  presentation?: WhatsAppReplyPresentation
}

type RecordValue = Record<string, unknown>

export type PreparedWhatsAppConversation = {
  recentMessages: WhatsAppSecretaryConversationMessage[]
  existingReply: WhatsAppOutgoingReply | null
  isFirstInteraction: boolean
}

async function getAdminDb(): Promise<Firestore> {
  const { getFirestore } = await import("firebase-admin/firestore")
  return getFirestore(await getFirebaseAdminApp())
}

function asRecord(value: unknown): RecordValue | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as RecordValue) : null
}

function isConversationRole(value: unknown): value is ConversationRole {
  return value === "user" || value === "assistant"
}

function readPresentation(value: unknown): WhatsAppReplyPresentation | undefined {
  const presentation = asRecord(value)
  if (!presentation) return undefined
  const kind = presentation.kind
  const body = typeof presentation.body === "string" ? presentation.body.slice(0, MAX_STORED_MESSAGE_CHARACTERS) : ""
  const buttonText = typeof presentation.buttonText === "string" ? presentation.buttonText.slice(0, 80) : ""
  if (!body || !buttonText) return undefined

  if (kind === "cta_url" && typeof presentation.url === "string" && /^https:\/\//i.test(presentation.url)) {
    return { kind, body, buttonText, url: presentation.url.slice(0, 2_000) }
  }
  if (kind !== "list" || typeof presentation.sectionTitle !== "string" || !Array.isArray(presentation.rows)) return undefined
  const rows = presentation.rows
    .map(asRecord)
    .filter((row): row is RecordValue => row !== null)
    .map((row) => ({
      id: typeof row.id === "string" ? row.id.slice(0, 200) : "",
      title: typeof row.title === "string" ? row.title.slice(0, 80) : "",
      ...(typeof row.description === "string" && row.description ? { description: row.description.slice(0, 160) } : {}),
    }))
    .filter((row) => row.id && row.title)
    .slice(0, 10)
  return rows.length > 0
    ? { kind: "list", body, buttonText, sectionTitle: presentation.sectionTitle.slice(0, 80), rows }
    : undefined
}

function toOutgoingReply(message: StoredConversationMessage): WhatsAppOutgoingReply {
  return {
    text: message.content,
    ...(message.presentation ? { presentation: message.presentation } : {}),
  }
}

function readRecentMessages(value: unknown): StoredConversationMessage[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map(asRecord)
    .filter((message): message is RecordValue => message !== null)
    .filter(
      (message): message is RecordValue & StoredConversationMessage =>
        typeof message.id === "string" &&
        isConversationRole(message.role) &&
        typeof message.content === "string" &&
        typeof message.createdAtMs === "number",
    )
    .map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content.slice(0, MAX_STORED_MESSAGE_CHARACTERS),
      createdAtMs: message.createdAtMs,
      ...(typeof message.replyToMessageId === "string" ? { replyToMessageId: message.replyToMessageId } : {}),
      ...(readPresentation(message.presentation) ? { presentation: readPresentation(message.presentation) } : {}),
    }))
    .sort((first, second) => first.createdAtMs - second.createdAtMs)
    .slice(-MAX_RECENT_MESSAGES)
}

function limitRecentMessages(messages: StoredConversationMessage[]): StoredConversationMessage[] {
  return messages.slice(-MAX_RECENT_MESSAGES)
}

function conversationDocumentId(senderPhoneNumber: string): string {
  // Keep the phone number out of the Firestore document path while retaining one conversation per sender.
  return createHash("sha256").update(senderPhoneNumber).digest("hex")
}

function toModelMessages(messages: StoredConversationMessage[]): WhatsAppSecretaryConversationMessage[] {
  return messages.map(({ role, content }) => ({ role, content }))
}

/**
 * Persists an inbound WhatsApp message and returns the bounded history that
 * should be supplied to the model. A previously persisted reply makes Meta
 * delivery retries safe across Vercel instances.
 */
export async function prepareWhatsAppConversation(input: {
  senderPhoneNumber: string
  messageId: string
  text: string
}): Promise<PreparedWhatsAppConversation> {
  const db = await getAdminDb()
  const conversationRef = db.collection(CONVERSATIONS_COLLECTION).doc(conversationDocumentId(input.senderPhoneNumber))

  return db.runTransaction<PreparedWhatsAppConversation>(async (transaction) => {
    const snapshot = await transaction.get(conversationRef)
    const recentMessages = readRecentMessages(snapshot.data()?.recentMessages)
    const existingReply = recentMessages.find(
      (message) => message.role === "assistant" && message.replyToMessageId === input.messageId,
    )

    if (existingReply) {
      return {
        recentMessages: toModelMessages(recentMessages),
        existingReply: toOutgoingReply(existingReply),
        isFirstInteraction: recentMessages.every((message) => message.id === input.messageId),
      }
    }

    const alreadyRecorded = recentMessages.some((message) => message.role === "user" && message.id === input.messageId)
    const updatedMessages = alreadyRecorded
      ? recentMessages
      : limitRecentMessages([
          ...recentMessages,
          {
            id: input.messageId,
            role: "user",
            content: input.text.slice(0, MAX_STORED_MESSAGE_CHARACTERS),
            createdAtMs: Date.now(),
          },
        ])

    if (!alreadyRecorded) {
      transaction.set(
        conversationRef,
        {
          recentMessages: updatedMessages,
          updatedAtMs: Date.now(),
        },
        { merge: true },
      )
    }

    return {
      recentMessages: toModelMessages(updatedMessages),
      existingReply: null,
      isFirstInteraction: recentMessages.length === 0 || recentMessages.every((message) => message.id === input.messageId),
    }
  })
}

/** Stores the generated reply, retaining only the latest six exchanges per sender. */
export async function storeWhatsAppAssistantReply(input: {
  senderPhoneNumber: string
  replyToMessageId: string
  reply: WhatsAppOutgoingReply
}): Promise<WhatsAppOutgoingReply> {
  const db = await getAdminDb()
  const conversationRef = db.collection(CONVERSATIONS_COLLECTION).doc(conversationDocumentId(input.senderPhoneNumber))

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(conversationRef)
    const recentMessages = readRecentMessages(snapshot.data()?.recentMessages)
    const existingReply = recentMessages.find(
      (message) => message.role === "assistant" && message.replyToMessageId === input.replyToMessageId,
    )

    if (existingReply) {
      return toOutgoingReply(existingReply)
    }

    const updatedMessages = limitRecentMessages([
      ...recentMessages,
      {
        id: `assistant:${input.replyToMessageId}`,
        role: "assistant",
        content: input.reply.text.slice(0, MAX_STORED_MESSAGE_CHARACTERS),
        createdAtMs: Date.now(),
        replyToMessageId: input.replyToMessageId,
        ...(input.reply.presentation ? { presentation: input.reply.presentation } : {}),
      },
    ])

    transaction.set(
      conversationRef,
      {
        recentMessages: updatedMessages,
        updatedAtMs: Date.now(),
      },
      { merge: true },
    )

    return input.reply
  })
}
