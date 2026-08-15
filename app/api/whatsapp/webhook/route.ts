import { findRelevantCompanyKnowledge } from "@/lib/company-knowledge"
import { prepareWhatsAppConversation, storeWhatsAppAssistantReply } from "@/lib/whatsapp-conversation-memory"
import { resolveWhatsAppAccessPolicy } from "@/lib/whatsapp-access-policy"
import { handleWhatsAppDailyReportDraftAction } from "@/lib/whatsapp-daily-report-drafts"
import { resolveWhatsAppSenderIdentity } from "@/lib/whatsapp-svc-identity"
import { answerWhatsAppSecretaryQuestionWithPresentation } from "@/lib/whatsapp-secretary/orchestrator"
import { markWhatsAppMessageRead, sendWhatsAppReply, sendWhatsAppText } from "@/lib/whatsapp-cloud-api"
import { addSecretaryIntroduction, type WhatsAppOutgoingReply } from "@/lib/whatsapp-response-ux"
import {
  buildCapabilitySignature,
  buildPrefixIntroduction,
  buildStandaloneIntroduction,
  decideIntroduction,
  type WhatsAppOnboardingState,
} from "@/lib/whatsapp-secretary/onboarding"
import { getSelfContextSnapshot, selfContextActorFromIdentity } from "@/lib/whatsapp-secretary/self-context"
import { enabledSecretaryModules } from "@/lib/whatsapp-secretary/tool-registry"
import type { WhatsAppAccessPolicy } from "@/lib/whatsapp-access-policy"
import type { WhatsAppSenderIdentity } from "@/lib/whatsapp-svc-identity"
import { createHmac, timingSafeEqual } from "node:crypto"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
// Cross-module tool-calling can take several sequential model round-trips.
// 60s is a conservative ceiling for a Vercel Hobby-plan function — re-verify
// against the current Vercel dashboard/docs before relying on it in prod.
export const maxDuration = 60

type IncomingWhatsAppMessage = {
  senderPhoneNumber: string
  messageId: string
  text: string
}

type RecordValue = Record<string, unknown>

const REPLY_CACHE_TTL_MS = 15 * 60 * 1_000
const MAX_CACHED_REPLIES = 500
const SLOW_REQUEST_PROGRESS_DELAY_MS = 15_000
const SLOW_REQUEST_PROGRESS_TEXT = "I’m still working on that—one moment."

type CachedReply = {
  reply: WhatsAppOutgoingReply
  expiresAt: number
}

const cachedReplies = new Map<string, CachedReply>()
const pendingReplies = new Map<string, Promise<WhatsAppOutgoingReply>>()

type WhatsAppProcessingFeedback = {
  stop(): Promise<void>
}

function pruneCachedReplies(now: number): void {
  for (const [messageId, cachedReply] of cachedReplies) {
    if (cachedReply.expiresAt <= now) {
      cachedReplies.delete(messageId)
    }
  }

  while (cachedReplies.size >= MAX_CACHED_REPLIES) {
    const oldestMessageId = cachedReplies.keys().next().value
    if (!oldestMessageId) {
      break
    }
    cachedReplies.delete(oldestMessageId)
  }
}

/**
 * Keeps a new request responsive without touching the Secretary's business
 * flow: native read/typing feedback starts immediately, and a text update is
 * sent only when the work is materially slow. The final response always waits
 * for an already-started progress update to preserve message order.
 */
async function startWhatsAppProcessingFeedback(message: IncomingWhatsAppMessage): Promise<WhatsAppProcessingFeedback> {
  try {
    await markWhatsAppMessageRead(message.messageId, { showTypingIndicator: true })
  } catch {
    // Response generation must remain available if the optional UX signal fails.
    console.warn("Unable to update WhatsApp read/typing status.")
  }

  let progressPromise: Promise<void> | null = null
  const progressTimer = setTimeout(() => {
    progressPromise = sendWhatsAppText(message.senderPhoneNumber, SLOW_REQUEST_PROGRESS_TEXT)
      .then(() => undefined)
      .catch(() => {
        // The final response still has the existing send/retry behavior.
        console.warn("Unable to send delayed WhatsApp progress update.")
      })
  }, SLOW_REQUEST_PROGRESS_DELAY_MS)

  return {
    async stop() {
      clearTimeout(progressTimer)
      await progressPromise
    },
  }
}

type ResolvedIntroduction = {
  /** Composes the personalized introduction onto an already-generated reply. */
  apply(reply: WhatsAppOutgoingReply): WhatsAppOutgoingReply
  /** Present only when an introduction was actually shown, so it is recorded exactly once. */
  onboarding?: WhatsAppOnboardingState
}

const NO_INTRODUCTION: ResolvedIntroduction = { apply: (reply) => reply }

/**
 * Decides whether this turn should introduce the Secretary, and builds the
 * personalized copy if so.
 *
 * Runs outside the model entirely: the introduction is deterministic text
 * assembled from the live self-context snapshot, so it can never invent a
 * role, job, or project — and a snapshot failure degrades to no introduction
 * rather than to a wrong one. Only recognized senders are ever introduced;
 * public/unrecognized numbers keep the existing public-knowledge behavior
 * untouched.
 */
async function resolveSecretaryIntroduction(input: {
  identity: WhatsAppSenderIdentity | null
  accessPolicy: WhatsAppAccessPolicy
  onboarding: WhatsAppOnboardingState | null
  isFirstInteraction: boolean
  message: string
}): Promise<ResolvedIntroduction> {
  if (!input.identity) return NO_INTRODUCTION

  const signature = buildCapabilitySignature({
    level: input.accessPolicy.level,
    modules: enabledSecretaryModules(input.accessPolicy),
    role: input.identity.role ?? null,
    hasLinkedAccount: Boolean(input.identity.userId),
  })
  const decision = decideIntroduction({
    state: input.onboarding,
    signature,
    nowMs: Date.now(),
    hasConversationHistory: !input.isFirstInteraction,
  })
  if (!decision.show) return NO_INTRODUCTION

  try {
    const snapshot = await getSelfContextSnapshot(selfContextActorFromIdentity(input.identity))
    const standalone = buildStandaloneIntroduction(snapshot, decision)
    const prefix = buildPrefixIntroduction(snapshot, decision)
    console.info("Introducing the SVC AI Secretary", { reason: decision.reason, newModuleCount: decision.newModules.length })
    return {
      apply: (reply) => addSecretaryIntroduction(reply, { standalone, prefix, message: input.message }),
      onboarding: { lastIntroAtMs: Date.now(), capabilitySignature: signature },
    }
  } catch {
    // A personalized introduction that can't be grounded is simply skipped —
    // the normal answer still goes out, and the next turn tries again.
    console.warn("Unable to build the personalized SVC AI Secretary introduction.")
    return NO_INTRODUCTION
  }
}

/** Avoids repeated model calls when Meta retries delivery of the same inbound message. */
async function getReplyForIncomingMessage(message: IncomingWhatsAppMessage): Promise<WhatsAppOutgoingReply> {
  const now = Date.now()
  const cachedReply = cachedReplies.get(message.messageId)
  if (cachedReply && cachedReply.expiresAt > now) {
    return cachedReply.reply
  }

  const pendingReply = pendingReplies.get(message.messageId)
  if (pendingReply) {
    return pendingReply
  }

  pruneCachedReplies(now)
  const replyPromise = prepareWhatsAppConversation(message).then(async (conversation) => {
    let reply: WhatsAppOutgoingReply
    if (conversation.existingReply !== null) {
      reply = conversation.existingReply
    } else {
      const feedback = await startWhatsAppProcessingFeedback(message)
      try {
        const senderIdentity = await resolveWhatsAppSenderIdentity(message.senderPhoneNumber)
        console.info("Resolved WhatsApp sender identity", {
          identified: senderIdentity !== null,
          hasRole: Boolean(senderIdentity?.role),
          linkedToUser: Boolean(senderIdentity?.userId),
        })
        const accessPolicy = resolveWhatsAppAccessPolicy(senderIdentity)
        // Resolved once per turn, before either branch, so the Daily Report
        // draft flow and the AI answer introduce identically.
        const introduction = await resolveSecretaryIntroduction({
          identity: senderIdentity,
          accessPolicy,
          onboarding: conversation.onboarding,
          isFirstInteraction: conversation.isFirstInteraction,
          message: message.text,
        })
        const dailyReportDraftAction = await handleWhatsAppDailyReportDraftAction({
          senderPhoneNumber: message.senderPhoneNumber,
          messageId: message.messageId,
          recentMessages: conversation.recentMessages,
          identity: senderIdentity,
        })
        if (dailyReportDraftAction) {
          console.info("Handled WhatsApp Daily Report draft action", {
            kind: dailyReportDraftAction.kind,
            actorIdentified: senderIdentity !== null,
          })
          const draftReply: WhatsAppOutgoingReply = { text: dailyReportDraftAction.reply }
          reply = await storeWhatsAppAssistantReply({
            senderPhoneNumber: message.senderPhoneNumber,
            replyToMessageId: message.messageId,
            reply: introduction.apply(draftReply),
            ...(introduction.onboarding ? { onboarding: introduction.onboarding } : {}),
          })
        } else {
          const companyKnowledge = await findRelevantCompanyKnowledge(
            conversation.recentMessages,
            accessPolicy.companyKnowledgeScope,
          )
          console.info("Retrieved curated company knowledge for WhatsApp reply", {
            entries: companyKnowledge.length,
            accessLevel: accessPolicy.level,
          })
          const generatedReply = await answerWhatsAppSecretaryQuestionWithPresentation({
            recentMessages: conversation.recentMessages,
            senderIdentity,
            accessPolicy,
            companyKnowledge,
          })
          reply = await storeWhatsAppAssistantReply({
            senderPhoneNumber: message.senderPhoneNumber,
            replyToMessageId: message.messageId,
            reply: introduction.apply(generatedReply),
            ...(introduction.onboarding ? { onboarding: introduction.onboarding } : {}),
          })
        }
      } finally {
        await feedback.stop()
      }
    }

    cachedReplies.set(message.messageId, { reply, expiresAt: Date.now() + REPLY_CACHE_TTL_MS })
    return reply
  })
    .finally(() => {
      pendingReplies.delete(message.messageId)
    })

  pendingReplies.set(message.messageId, replyPromise)
  return replyPromise
}

function hasValidWhatsAppSignature(rawBody: Buffer, signatureHeader: string | null): boolean {
  const appSecret = process.env.WHATSAPP_APP_SECRET
  if (!appSecret || !signatureHeader?.startsWith("sha256=")) {
    return false
  }

  const receivedSignature = signatureHeader.slice("sha256=".length)
  if (!/^[a-f0-9]{64}$/i.test(receivedSignature)) {
    return false
  }

  const expectedSignature = createHmac("sha256", appSecret).update(rawBody).digest()
  const receivedSignatureBuffer = Buffer.from(receivedSignature, "hex")

  return (
    receivedSignatureBuffer.length === expectedSignature.length &&
    timingSafeEqual(receivedSignatureBuffer, expectedSignature)
  )
}

function asRecord(value: unknown): RecordValue | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as RecordValue) : null
}

function asRecordArray(value: unknown): RecordValue[] {
  return Array.isArray(value)
    ? value.map(asRecord).filter((item): item is RecordValue => item !== null)
    : []
}

function textFromIncomingMessage(message: RecordValue): string | null {
  if (message.type === "text") {
    const text = asRecord(message.text)?.body
    return typeof text === "string" ? text.trim() || null : null
  }

  // Native list and reply-button selections are rendered as ordinary, safe
  // conversation text. We use their visible label/description only, never the
  // opaque row id, so a sender cannot turn a UI response into a privileged id.
  if (message.type === "interactive") {
    const interactive = asRecord(message.interactive)
    const selection = asRecord(interactive?.list_reply) ?? asRecord(interactive?.button_reply)
    const title = typeof selection?.title === "string" ? selection.title.trim() : ""
    if (!title) return null
    const description = typeof selection?.description === "string" ? selection.description.trim() : ""
    return description ? `Selected: ${title} — ${description}` : `Selected: ${title}`
  }

  return null
}

/** Extracts text and native interactive selections for the configured WhatsApp Business Account. */
export function getIncomingWhatsAppMessages(payload: unknown): IncomingWhatsAppMessage[] {
  const webhook = asRecord(payload)
  if (webhook?.object !== "whatsapp_business_account") {
    return []
  }

  const expectedWabaId = process.env.WHATSAPP_WABA_ID?.trim()
  const expectedPhoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim()
  const incomingMessages: IncomingWhatsAppMessage[] = []

  for (const entry of asRecordArray(webhook.entry)) {
    if (expectedWabaId && entry.id !== expectedWabaId) {
      continue
    }

    for (const change of asRecordArray(entry.changes)) {
      if (change.field !== "messages") {
        continue
      }

      const value = asRecord(change.value)
      const metadata = asRecord(value?.metadata)
      if (expectedPhoneNumberId && metadata?.phone_number_id !== expectedPhoneNumberId) {
        continue
      }

      for (const message of asRecordArray(value?.messages)) {
        if (typeof message.from !== "string" || typeof message.id !== "string") {
          continue
        }
        const text = textFromIncomingMessage(message)
        if (!text) {
          continue
        }

        incomingMessages.push({
          senderPhoneNumber: message.from,
          messageId: message.id,
          text,
        })
      }
    }
  }

  return incomingMessages
}

/** Backward-compatible name for test callers; it now includes native selections too. */
export const getIncomingTextMessages = getIncomingWhatsAppMessages

/** Meta calls this endpoint once when a callback URL is saved in the app dashboard. */
export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url)
  const mode = searchParams.get("hub.mode")
  const verifyToken = searchParams.get("hub.verify_token")
  const challenge = searchParams.get("hub.challenge")
  const configuredVerifyToken = process.env.WHATSAPP_VERIFY_TOKEN

  if (!configuredVerifyToken) {
    console.error("WHATSAPP_VERIFY_TOKEN is not configured.")
    return Response.json({ error: "Webhook verification is not configured." }, { status: 500 })
  }

  if (mode === "subscribe" && verifyToken === configuredVerifyToken && challenge !== null) {
    return new Response(challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    })
  }

  console.warn("Rejected WhatsApp webhook verification request.")
  return Response.json({ error: "Webhook verification failed." }, { status: 403 })
}

/** Receives WhatsApp text or native selection events and ignores all other event types. */
export async function POST(request: Request): Promise<Response> {
  if (!process.env.WHATSAPP_APP_SECRET) {
    console.error("WHATSAPP_APP_SECRET is not configured.")
    return Response.json({ error: "Webhook signature validation is not configured." }, { status: 500 })
  }

  const rawBody = Buffer.from(await request.arrayBuffer())
  if (!hasValidWhatsAppSignature(rawBody, request.headers.get("x-hub-signature-256"))) {
    console.warn("Rejected WhatsApp webhook request with an invalid signature.")
    return Response.json({ error: "Invalid webhook signature." }, { status: 401 })
  }

  let payload: unknown
  try {
    payload = JSON.parse(rawBody.toString("utf8"))
  } catch {
    return Response.json({ error: "Invalid JSON payload." }, { status: 400 })
  }

  const incomingMessages = getIncomingWhatsAppMessages(payload)
  if (incomingMessages.length === 0) {
    return Response.json({ received: true, ignored: true })
  }

  try {
    for (const message of incomingMessages) {
      console.info("Received incoming WhatsApp message", {
        textLength: message.text.length,
      })

      const reply = await getReplyForIncomingMessage(message)
      console.info("Generated WhatsApp AI Secretary reply", {
        replyLength: reply.text.length,
        presentation: reply.presentation?.kind ?? "text",
      })
      await sendWhatsAppReply(message.senderPhoneNumber, reply)
    }
  } catch {
    console.error("Failed to process WhatsApp webhook message.")
    return Response.json({ error: "Unable to send the WhatsApp reply." }, { status: 500 })
  }

  return Response.json({ received: true })
}
