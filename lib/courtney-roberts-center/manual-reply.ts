import { sendWhatsAppText } from "@/lib/whatsapp-cloud-api"
import { appendManualAssistantMessage } from "@/lib/whatsapp-conversation-memory"
import { isWithinCustomerServiceWindow } from "@/lib/whatsapp-secretary/recognition-notice"
import { getFirebaseAdminApp } from "@/lib/ai/server/firebase-admin"
import { CRC_CONVERSATIONS_COLLECTION, recordCourtneyRobertsCenterHumanReply, resumeCourtneyRobertsCenterAi } from "./history-store"

/**
 * Human takeover — an authorized admin sending a WhatsApp message from the
 * same Courtney Roberts number, and resuming the AI when they're done.
 *
 * Kept as its own file rather than folded into `history-store.ts` because it
 * orchestrates three different systems (WhatsApp Cloud API send, this
 * module's durable transcript, and the Secretary's own separate rolling
 * memory) where `history-store.ts` only ever touches its own collection.
 * Mirrors `link-identity.ts`'s shape: a narrow admin-triggered write path
 * with its own typed error, reusing the read/access layers rather than
 * duplicating them.
 */

export class CourtneyRobertsCenterManualReplyError extends Error {
  readonly status: 400 | 404 | 409 | 500
  constructor(status: 400 | 404 | 409 | 500, message: string) {
    super(message)
    this.name = "CourtneyRobertsCenterManualReplyError"
    this.status = status
  }
}

const MAX_MANUAL_REPLY_CHARACTERS = 4_000

async function getAdminDb() {
  const { getFirestore } = await import("firebase-admin/firestore")
  return getFirestore(await getFirebaseAdminApp())
}

async function loadConversationForReply(conversationId: string): Promise<{ phoneNumber: string; lastInboundAtMs: number | null }> {
  const db = await getAdminDb()
  const snapshot = await db.collection(CRC_CONVERSATIONS_COLLECTION).doc(conversationId).get()
  const data = snapshot.data()
  const phoneNumber = typeof data?.phoneNumber === "string" ? data.phoneNumber : ""
  if (!snapshot.exists || !phoneNumber) {
    throw new CourtneyRobertsCenterManualReplyError(404, "Conversation not found.")
  }
  const lastInboundAtMs = typeof data?.lastInboundAtMs === "number" ? data.lastInboundAtMs : null
  return { phoneNumber, lastInboundAtMs }
}

export type SendCourtneyRobertsCenterManualReplyResult = {
  id: string
  role: "assistant"
  text: string
  createdAtMs: number
  sentBy: "human"
  sentByName: string
}

/**
 * Sends one manual WhatsApp message as Courtney Roberts and pauses the AI
 * for this conversation. Plain text only, deliberately — an admin
 * intervening in a conversation is a rare, deliberate act; it does not need
 * the model's native list/CTA presentation machinery.
 */
export async function sendCourtneyRobertsCenterManualReply(input: {
  conversationId: string
  text: string
  /** Client-generated, so a duplicate submit (double-tap, retry) is a safe no-op rather than a second WhatsApp message. */
  clientMessageId: string
  sentByName: string
}): Promise<SendCourtneyRobertsCenterManualReplyResult> {
  const text = input.text.trim()
  if (!text) throw new CourtneyRobertsCenterManualReplyError(400, "Enter a message to send.")
  if (text.length > MAX_MANUAL_REPLY_CHARACTERS) {
    throw new CourtneyRobertsCenterManualReplyError(400, `Messages are limited to ${MAX_MANUAL_REPLY_CHARACTERS} characters.`)
  }
  if (!input.clientMessageId.trim()) throw new CourtneyRobertsCenterManualReplyError(400, "Missing message id.")

  const { phoneNumber, lastInboundAtMs } = await loadConversationForReply(input.conversationId)

  if (!isWithinCustomerServiceWindow(lastInboundAtMs, Date.now())) {
    throw new CourtneyRobertsCenterManualReplyError(
      409,
      "WhatsApp's 24-hour reply window has closed for this conversation — they need to message again before you can reply.",
    )
  }

  try {
    await sendWhatsAppText(phoneNumber, text)
  } catch {
    throw new CourtneyRobertsCenterManualReplyError(409, "Unable to send this message on WhatsApp. Please try again.")
  }

  const createdAtMs = Date.now()
  try {
    // Deliberately allowed to throw, unlike the webhook's own recorders: the
    // message already went out, so silently losing the record here would
    // also silently lose the pause — the one guarantee this whole feature
    // exists to make. The route below reports this distinctly from a send
    // failure, since retrying naively would send a second WhatsApp message.
    await recordCourtneyRobertsCenterHumanReply({
      senderPhoneNumber: phoneNumber,
      clientMessageId: input.clientMessageId,
      text,
      // `null` is safe: `reconcileIdentitySnapshot` never downgrades an
      // already-resolved conversation, so this never un-identifies a sender —
      // a human reply just isn't a new identity resolution.
      identity: null,
      sentByName: input.sentByName,
    })
  } catch (error) {
    console.error("A Courtney Roberts Center manual reply sent on WhatsApp but failed to record; the conversation may not be paused.")
    throw new CourtneyRobertsCenterManualReplyError(
      500,
      "Your message was sent on WhatsApp, but couldn't be saved here — the conversation may not have paused. Refresh and check before sending again.",
    )
  }

  // AI-context continuity only — never blocks or fails the reply itself.
  await appendManualAssistantMessage({ senderPhoneNumber: phoneNumber, messageId: `human:${input.clientMessageId}`, text }).catch(() => {
    console.error("Unable to append a manual Courtney Roberts Center reply to the Secretary's own conversation memory.")
  })

  return { id: `human:${input.clientMessageId}`, role: "assistant", text, createdAtMs, sentBy: "human", sentByName: input.sentByName }
}

/** Resumes automatic AI replies for this conversation. */
export async function resumeCourtneyRobertsCenterAiForConversation(conversationId: string): Promise<void> {
  const { phoneNumber } = await loadConversationForReply(conversationId)
  await resumeCourtneyRobertsCenterAi(phoneNumber)
}
