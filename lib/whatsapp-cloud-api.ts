import type { WhatsAppOutgoingReply } from "@/lib/whatsapp-response-ux"

const GRAPH_API_VERSION = "v26.0"

type WhatsAppSendResult = {
  messages?: Array<{ id?: string }>
}

type WhatsAppStatusResult = {
  success?: boolean
}

type WhatsAppErrorResponse = {
  error?: {
    code?: number
    message?: string
    error_data?: {
      details?: string
    }
  }
}

function requireEnvironmentVariable(name: "WHATSAPP_ACCESS_TOKEN" | "WHATSAPP_PHONE_NUMBER_ID"): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`${name} is not configured.`)
  }

  return value
}

function formatWhatsAppRecipient(phoneNumber: string): string {
  return phoneNumber.replace(/\D/g, "")
}

function resolveWhatsAppRecipient(phoneNumber: string): string {
  // Meta's sandbox may require its verified test-recipient representation.
  // Leave this unset when routing to production phone numbers.
  return process.env.WHATSAPP_TEST_RECIPIENT?.trim() || formatWhatsAppRecipient(phoneNumber)
}

async function postWhatsAppMessage(payload: Record<string, unknown>, operation: string): Promise<unknown> {
  const accessToken = requireEnvironmentVariable("WHATSAPP_ACCESS_TOKEN")
  const phoneNumberId = requireEnvironmentVariable("WHATSAPP_PHONE_NUMBER_ID")

  const response = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  })

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as WhatsAppErrorResponse | null
    console.error(`WhatsApp Cloud API ${operation} failed`, {
      status: response.status,
      code: errorBody?.error?.code,
      message: errorBody?.error?.message,
      details: errorBody?.error?.error_data?.details,
    })
    throw new Error(`WhatsApp Cloud API ${operation} failed.`)
  }

  return response.json()
}

/** Sends a text message from the WhatsApp Cloud API phone number configured for this app. */
export async function sendWhatsAppText(to: string, body: string): Promise<WhatsAppSendResult> {
  return (await postWhatsAppMessage({
    messaging_product: "whatsapp",
    to: resolveWhatsAppRecipient(to),
    type: "text",
    text: {
      body,
    },
  }, "send")) as WhatsAppSendResult
}

/** Sends an image message by URL — Meta's servers fetch the link directly, no upload step needed. */
export async function sendWhatsAppImage(to: string, input: { link: string; caption?: string }): Promise<WhatsAppSendResult> {
  return (await postWhatsAppMessage({
    messaging_product: "whatsapp",
    to: resolveWhatsAppRecipient(to),
    type: "image",
    image: { link: input.link, ...(input.caption ? { caption: input.caption } : {}) },
  }, "image send")) as WhatsAppSendResult
}

/** Sends a document message by URL — same fetch-by-link mechanism as {@link sendWhatsAppImage}. */
export async function sendWhatsAppDocument(to: string, input: { link: string; filename: string; caption?: string }): Promise<WhatsAppSendResult> {
  return (await postWhatsAppMessage({
    messaging_product: "whatsapp",
    to: resolveWhatsAppRecipient(to),
    type: "document",
    document: { link: input.link, filename: input.filename, ...(input.caption ? { caption: input.caption } : {}) },
  }, "document send")) as WhatsAppSendResult
}

/** Sends a native WhatsApp list for a bounded, already-authorized choice. */
async function sendWhatsAppList(
  to: string,
  input: Extract<NonNullable<WhatsAppOutgoingReply["presentation"]>, { kind: "list" }>,
): Promise<WhatsAppSendResult> {
  return (await postWhatsAppMessage({
    messaging_product: "whatsapp",
    to: resolveWhatsAppRecipient(to),
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: input.body },
      action: {
        button: input.buttonText,
        sections: [{ title: input.sectionTitle, rows: input.rows }],
      },
    },
  }, "interactive-list send")) as WhatsAppSendResult
}

/** Sends one official WhatsApp CTA URL button to an authenticated SVC route. */
async function sendWhatsAppCtaUrl(
  to: string,
  input: Extract<NonNullable<WhatsAppOutgoingReply["presentation"]>, { kind: "cta_url" }>,
): Promise<WhatsAppSendResult> {
  return (await postWhatsAppMessage({
    messaging_product: "whatsapp",
    to: resolveWhatsAppRecipient(to),
    type: "interactive",
    interactive: {
      type: "cta_url",
      body: { text: input.body },
      action: {
        name: "cta_url",
        parameters: {
          display_text: input.buttonText,
          url: input.url,
        },
      },
    },
  }, "interactive-CTA send")) as WhatsAppSendResult
}

function textFallbackForInteractiveReply(reply: WhatsAppOutgoingReply): string {
  if (reply.presentation?.kind === "list") {
    const choices = reply.presentation.rows.map((row) => `• ${row.title}${row.description ? ` — ${row.description}` : ""}`).join("\n")
    return `${reply.text}\n\n${choices}\n\nReply with the exact name.`
  }
  if (reply.presentation?.kind === "cta_url") {
    return `${reply.text}\n\n${reply.presentation.url}`
  }
  return reply.text
}

/**
 * Best-effort follow-up sends for any attachments (report PDFs, Communications
 * images/files) the deterministic presentation layer resolved. These
 * supplement the primary reply rather than replace it, so each is sent and
 * caught independently — one failed attachment never hides the answer that
 * already went out, and never blocks the others.
 */
async function sendWhatsAppAttachments(to: string, attachments: NonNullable<WhatsAppOutgoingReply["attachments"]>): Promise<void> {
  for (const attachment of attachments) {
    try {
      if (attachment.kind === "image") {
        await sendWhatsAppImage(to, { link: attachment.url, caption: attachment.caption })
      } else {
        await sendWhatsAppDocument(to, { link: attachment.url, filename: attachment.filename ?? "file", caption: attachment.caption })
      }
    } catch {
      console.warn(`Failed to deliver a WhatsApp ${attachment.kind} attachment; the primary reply was still sent.`)
    }
  }
}

/**
 * Delivers a reply in its native presentation when available. A text fallback
 * preserves the answer and destination if an account/client rejects a native
 * interactive type, so a UX enhancement cannot suppress a normal response.
 * Any attachments are sent as follow-up messages after the primary reply.
 */
export async function sendWhatsAppReply(to: string, reply: WhatsAppOutgoingReply): Promise<WhatsAppSendResult> {
  const result = await sendWhatsAppReplyPrimary(to, reply)
  if (reply.attachments?.length) await sendWhatsAppAttachments(to, reply.attachments)
  return result
}

async function sendWhatsAppReplyPrimary(to: string, reply: WhatsAppOutgoingReply): Promise<WhatsAppSendResult> {
  if (reply.presentation?.kind === "list") {
    try {
      return await sendWhatsAppList(to, reply.presentation)
    } catch {
      console.warn("Falling back to a text WhatsApp reply after interactive list delivery failed.")
      return sendWhatsAppText(to, textFallbackForInteractiveReply(reply))
    }
  }
  if (reply.presentation?.kind === "cta_url") {
    try {
      return await sendWhatsAppCtaUrl(to, reply.presentation)
    } catch {
      console.warn("Falling back to a text WhatsApp reply after interactive CTA delivery failed.")
      return sendWhatsAppText(to, textFallbackForInteractiveReply(reply))
    }
  }
  return sendWhatsAppText(to, reply.text)
}

/**
 * Marks an inbound user message as read. Meta also shows its native typing
 * indicator when requested; it disappears when the final text is sent or after
 * Meta's short indicator timeout.
 */
export async function markWhatsAppMessageRead(
  messageId: string,
  options: { showTypingIndicator?: boolean } = {},
): Promise<WhatsAppStatusResult> {
  const trimmedMessageId = messageId.trim()
  if (!trimmedMessageId) {
    throw new Error("A WhatsApp message ID is required to update its status.")
  }

  return (await postWhatsAppMessage({
    messaging_product: "whatsapp",
    status: "read",
    message_id: trimmedMessageId,
    ...(options.showTypingIndicator ? { typing_indicator: { type: "text" } } : {}),
  }, "message-status update")) as WhatsAppStatusResult
}
