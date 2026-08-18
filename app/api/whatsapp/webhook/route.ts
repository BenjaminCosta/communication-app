import { findRelevantCompanyKnowledge } from "@/lib/company-knowledge"
import { prepareWhatsAppConversation, storeWhatsAppAssistantReply, type PreparedWhatsAppConversation } from "@/lib/whatsapp-conversation-memory"
import { resolveWhatsAppAccessPolicy } from "@/lib/whatsapp-access-policy"
import {
  handleWhatsAppDailyReportDraftAction,
  isWhatsAppDailyReportDraftCancellation,
  isWhatsAppDailyReportDraftConfirmation,
} from "@/lib/whatsapp-daily-report-drafts"
import { resolvePendingWrite } from "@/lib/whatsapp-secretary/pending-writes"
import { buildToolRegistry, enabledSecretaryModules, type SecretaryModule, type SecretaryToolContext } from "@/lib/whatsapp-secretary/tool-registry"
import { createEntityResolver } from "@/lib/whatsapp-secretary/entity-resolver"
import { createServerEntityLookups } from "@/lib/whatsapp-secretary/tools/entity-lookups"
import { DEFAULT_TOOL_FACTORIES } from "@/lib/whatsapp-secretary/orchestrator"
import { backfillUserPhoneFromInboundWhatsApp, resolveWhatsAppSenderIdentityDetailed } from "@/lib/whatsapp-svc-identity"
import { createFirestoreIdentityClaimProvider, resolveIdentityClaim } from "@/lib/whatsapp-identity-claim"
import { answerWhatsAppSecretaryQuestionWithPresentation } from "@/lib/whatsapp-secretary/orchestrator"
import { markWhatsAppMessageRead, sendWhatsAppReply, sendWhatsAppText } from "@/lib/whatsapp-cloud-api"
import {
  recordCourtneyRobertsCenterAssistantReply,
  recordCourtneyRobertsCenterInboundMessage,
} from "@/lib/courtney-roberts-center/history-store"
import { addCapabilityHint, addSecretaryIntroduction, type WhatsAppOutgoingReply } from "@/lib/whatsapp-response-ux"
import { buildGuidedTourReply, isShowMeAroundRequest } from "@/lib/whatsapp-secretary/guided-tour"
import { buildCapabilityNudge } from "@/lib/whatsapp-secretary/onboarding"
import {
  buildCapabilitySignature,
  buildPrefixIntroduction,
  buildStandaloneIntroduction,
  decideIntroduction,
  type WhatsAppOnboardingState,
} from "@/lib/whatsapp-secretary/onboarding"
import { getSelfContextSnapshot as loadSelfContext } from "@/lib/whatsapp-secretary/self-context"
import { getSelfContextSnapshot, selfContextActorFromIdentity } from "@/lib/whatsapp-secretary/self-context"
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
    console.info("Introducing Courtney Roberts", { reason: decision.reason, newModuleCount: decision.newModules.length })
    return {
      apply: (reply) => addSecretaryIntroduction(reply, { standalone, prefix, message: input.message }),
      onboarding: { lastIntroAtMs: Date.now(), capabilitySignature: signature },
    }
  } catch {
    // A personalized introduction that can't be grounded is simply skipped —
    // the normal answer still goes out, and the next turn tries again.
    console.warn("Unable to build the personalized Courtney Roberts introduction.")
    return NO_INTRODUCTION
  }
}


/**
 * Matches an inbound message against this sender's stored write preview.
 *
 * Returns null for anything that is not an exact confirmation or cancellation,
 * so an unrelated question simply flows on to the normal Secretary path and
 * the preview stays pending. The tool registry is rebuilt here with the same
 * access policy the orchestrator would use, so a sender whose access changed
 * between preview and confirmation cannot commit something they may no longer
 * do.
 */
async function resolvePendingWriteForSender(input: {
  text: string
  conversation: PreparedWhatsAppConversation
  identity: WhatsAppSenderIdentity | null
  accessPolicy: WhatsAppAccessPolicy
  senderPhoneNumber: string
  confirmationMessageId: string
}): Promise<{ kind: string; reply: string } | null> {
  const envelope = input.conversation.pendingWrite
  if (!envelope || !input.identity || !input.accessPolicy.actorUserId) return null

  const context: SecretaryToolContext = {
    resolver: createEntityResolver(createServerEntityLookups()),
    identity: input.identity,
    actorUserId: input.accessPolicy.actorUserId,
    enabledModules: enabledSecretaryModules(input.accessPolicy),
    canWrite: input.accessPolicy.canCreateDailyReportDraft,
    senderPhoneNumber: input.senderPhoneNumber,
    requestMessageId: envelope.requestMessageId,
  }
  const tools = buildToolRegistry(input.accessPolicy, DEFAULT_TOOL_FACTORIES, context)

  const outcome = await resolvePendingWrite({
    text: input.text,
    envelope,
    tools,
    context: {
      senderPhoneNumber: input.senderPhoneNumber,
      actorUserId: input.accessPolicy.actorUserId,
      actorPersonId: input.identity.personId,
      requestMessageId: envelope.requestMessageId,
      confirmationMessageId: input.confirmationMessageId,
    },
  })

  if (outcome.kind === "none") return null
  if (outcome.kind === "committed") return { kind: outcome.result.kind, reply: outcome.result.reply }
  return { kind: outcome.kind, reply: outcome.reply }
}

/**
 * Safety net for a preview created by the pre-tool regex flow that may still be
 * pending in `/whatsappReportDraftActions` with no envelope on the conversation
 * document. Only ever consulted when there is no envelope, and only for the two
 * exact commands — so it cannot start a new legacy preview, just honor an
 * in-flight one. Delete once no legacy preview can plausibly remain.
 */
async function resolveLegacyDraftCommand(input: {
  text: string
  senderPhoneNumber: string
  messageId: string
  recentMessages: Parameters<typeof handleWhatsAppDailyReportDraftAction>[0]["recentMessages"]
  identity: WhatsAppSenderIdentity | null
}): Promise<{ kind: string; reply: string } | null> {
  if (!isWhatsAppDailyReportDraftConfirmation(input.text) && !isWhatsAppDailyReportDraftCancellation(input.text)) return null
  const action = await handleWhatsAppDailyReportDraftAction({
    senderPhoneNumber: input.senderPhoneNumber,
    messageId: input.messageId,
    recentMessages: input.recentMessages,
    identity: input.identity,
  })
  return action ? { kind: `legacy-${action.kind}`, reply: action.reply } : null
}


/** Maps this turn's tool names back to their modules, for the capability nudge. */
function modulesUsed(retrievals: Array<{ toolName: string }>): SecretaryModule[] {
  const modules = new Set<SecretaryModule>()
  for (const { toolName } of retrievals) {
    const prefix = toolName.split("_", 1)[0]
    if (prefix) modules.add(prefix as SecretaryModule)
  }
  return [...modules]
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
        const identityResult = await resolveWhatsAppSenderIdentityDetailed(message.senderPhoneNumber)
        console.info("Resolved WhatsApp sender identity", {
          status: identityResult.status,
          hasRole: identityResult.status === "resolved" && Boolean(identityResult.identity.role),
          linkedToUser: identityResult.status === "resolved" && Boolean(identityResult.identity.userId),
          resolvedVia: identityResult.status === "resolved" ? identityResult.identity.resolvedVia : undefined,
        })

        // Durable Courtney Roberts Center history — separate from the
        // Secretary's own bounded conversation memory above. Best-effort
        // (errors are logged and swallowed inside the recorder itself), so a
        // failure here can never affect the Secretary's actual reply.
        const durableIdentity = identityResult.status === "resolved" ? identityResult.identity : null
        await recordCourtneyRobertsCenterInboundMessage({
          senderPhoneNumber: message.senderPhoneNumber,
          messageId: message.messageId,
          text: message.text,
          identity: durableIdentity,
        })

        // A GENUINE ambiguity (2+ real SVC identities could own this number)
        // gets a clarifying question instead of silently falling back to
        // public — see lib/whatsapp-identity-claim.ts. A plain "not found"
        // does not: that goes straight to the normal public flow below, same
        // as always.
        if (identityResult.status === "ambiguous") {
          const claimOutcome = await resolveIdentityClaim({
            text: message.text,
            pendingClaim: conversation.pendingIdentityClaim,
            senderPhoneNumber: message.senderPhoneNumber,
            provider: createFirestoreIdentityClaimProvider(),
          })
          if (claimOutcome.kind === "linked") {
            console.info("WhatsApp identity claim linked a number to an SVC account", { userId: claimOutcome.identity.userId })
          }
          reply = await storeWhatsAppAssistantReply({
            senderPhoneNumber: message.senderPhoneNumber,
            replyToMessageId: message.messageId,
            reply: { text: claimOutcome.reply },
            // "linked" clears it (resolved); "asked"/"not-matched" (re)store it.
            pendingIdentityClaim: claimOutcome.kind === "linked" ? null : claimOutcome.pendingClaim,
          })
          await recordCourtneyRobertsCenterAssistantReply({
            senderPhoneNumber: message.senderPhoneNumber,
            replyToMessageId: message.messageId,
            identity: durableIdentity,
            reply,
          })
        } else {
        const senderIdentity = identityResult.status === "resolved" ? identityResult.identity : null
        // Self-healing: a fallback-tier resolution just proved this number
        // belongs to exactly one registered user. Recording it directly on
        // /users moves future messages onto the strongest (explicit) tier
        // without depending on Directory contact hygiene — see
        // backfillUserPhoneFromInboundWhatsApp's own doc comment.
        if (senderIdentity?.resolvedVia === "fallback" && senderIdentity.userId) {
          await backfillUserPhoneFromInboundWhatsApp(senderIdentity.userId, message.senderPhoneNumber)
        }
        // A stale claim prompt (data changed since it was asked, e.g. an
        // admin cleaned up the duplicate contacts) should not linger once
        // resolution stops being ambiguous.
        const clearedPendingIdentityClaim = conversation.pendingIdentityClaim ? { pendingIdentityClaim: null as null } : {}
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
        // "Show me around" is answered deterministically, before the model:
        // the tour's whole value is that its rows are runnable, and a
        // paraphrased list of rows is not.
        if (senderIdentity && isShowMeAroundRequest(message.text)) {
          const snapshot = await loadSelfContext(selfContextActorFromIdentity(senderIdentity))
          const tour = buildGuidedTourReply(snapshot, enabledSecretaryModules(accessPolicy))
          const priorOnboarding = introduction.onboarding ?? conversation.onboarding
          reply = await storeWhatsAppAssistantReply({
            senderPhoneNumber: message.senderPhoneNumber,
            replyToMessageId: message.messageId,
            reply: introduction.apply(tour),
            ...(priorOnboarding ? { onboarding: { ...priorOnboarding, guideCompletedAtMs: Date.now() } } : {}),
            ...clearedPendingIdentityClaim,
          })
          await recordCourtneyRobertsCenterAssistantReply({
            senderPhoneNumber: message.senderPhoneNumber,
            replyToMessageId: message.messageId,
            identity: senderIdentity,
            reply,
          })
        } else {

        // A pending write is resolved BEFORE the model runs and entirely
        // outside it: an exact-phrase confirmation must never depend on the
        // model agreeing that the sender meant yes.
        const writeOutcome =
          (await resolvePendingWriteForSender({
            text: message.text,
            conversation,
            identity: senderIdentity,
            accessPolicy,
            senderPhoneNumber: message.senderPhoneNumber,
            confirmationMessageId: message.messageId,
          })) ??
          (conversation.pendingWrite
            ? null
            : await resolveLegacyDraftCommand({
                text: message.text,
                senderPhoneNumber: message.senderPhoneNumber,
                messageId: message.messageId,
                recentMessages: conversation.recentMessages,
                identity: senderIdentity,
              }))
        if (writeOutcome) {
          console.info("Resolved a pending WhatsApp write", { kind: writeOutcome.kind })
          reply = await storeWhatsAppAssistantReply({
            senderPhoneNumber: message.senderPhoneNumber,
            replyToMessageId: message.messageId,
            reply: introduction.apply({ text: writeOutcome.reply }),
            ...(introduction.onboarding ? { onboarding: introduction.onboarding } : {}),
            // Always clears: confirmed, cancelled and expired all end the preview.
            pendingWrite: null,
            ...clearedPendingIdentityClaim,
          })
          await recordCourtneyRobertsCenterAssistantReply({
            senderPhoneNumber: message.senderPhoneNumber,
            replyToMessageId: message.messageId,
            identity: senderIdentity,
            reply,
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
            senderPhoneNumber: message.senderPhoneNumber,
            requestMessageId: message.messageId,
            priorEntities: conversation.resolvedEntities,
            priorRetrievals: conversation.retrievals,
          })
          const { pendingWrite, memory, ...outgoing } = generatedReply
          // Progressive discovery: one adjacent capability, taught only right
          // after a real answer about a specific record, and rate-limited so it
          // stays a hint rather than chrome.
          const nudge = buildCapabilityNudge({
            usedModules: modulesUsed(memory?.retrievals ?? []),
            enabledModules: enabledSecretaryModules(accessPolicy),
            state: conversation.onboarding,
            nowMs: Date.now(),
            answeredAboutEntity: !pendingWrite && (memory?.resolvedEntities.length ?? 0) > 0,
            introducedThisTurn: Boolean(introduction.onboarding),
          })
          // Only ever stamps an onboarding record that really exists.
          // Synthesizing a placeholder here wrote `capabilitySignature: ""`,
          // which the reader correctly rejects — so the stamp was lost and the
          // rate limit could never take hold.
          const baseOnboarding = introduction.onboarding ?? conversation.onboarding
          const nudgedOnboarding = nudge && baseOnboarding
            ? { ...baseOnboarding, lastCapabilityNudgeAtMs: Date.now() }
            : introduction.onboarding

          reply = await storeWhatsAppAssistantReply({
            senderPhoneNumber: message.senderPhoneNumber,
            replyToMessageId: message.messageId,
            reply: nudge ? addCapabilityHint(introduction.apply(outgoing), nudge.line) : introduction.apply(outgoing),
            ...(nudgedOnboarding ? { onboarding: nudgedOnboarding } : {}),
            ...(pendingWrite ? { pendingWrite } : {}),
            ...(memory ? { resolvedEntities: memory.resolvedEntities, retrievals: memory.retrievals } : {}),
            ...clearedPendingIdentityClaim,
          })
          await recordCourtneyRobertsCenterAssistantReply({
            senderPhoneNumber: message.senderPhoneNumber,
            replyToMessageId: message.messageId,
            identity: senderIdentity,
            reply,
          })
        }
        }
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
      console.info("Generated Courtney Roberts reply", {
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
