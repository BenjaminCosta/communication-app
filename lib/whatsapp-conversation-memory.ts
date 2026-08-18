import type { Firestore } from "firebase-admin/firestore"
import { createHash } from "node:crypto"
import type { WhatsAppSecretaryConversationMessage } from "@/lib/whatsapp-secretary/types"
import { getFirebaseAdminApp } from "@/lib/ai/server/firebase-admin"
import type { WhatsAppOnboardingState } from "@/lib/whatsapp-secretary/onboarding"
import type { PendingWriteEnvelope } from "@/lib/whatsapp-secretary/pending-writes"
import type { PendingIdentityClaim } from "@/lib/whatsapp-identity-claim"
import type { ResolvedEntity } from "@/lib/whatsapp-secretary/entity-resolver"
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
  /**
   * When this sender was last introduced to the Secretary's capabilities, and
   * what those capabilities were at the time. `null` means never — which
   * `decideIntroduction` distinguishes from "returning sender who predates
   * this tracking" using {@link PreparedWhatsAppConversation.isFirstInteraction}.
   * Stored on the same conversation document (not a new collection) because
   * its lifetime, id, and privacy posture are identical to the transcript's.
   */
  onboarding: WhatsAppOnboardingState | null
  /**
   * A preview awaiting the sender's exact confirmation phrase. Kept on the
   * conversation document so the confirmation is matched deterministically,
   * before the model runs, by `lib/whatsapp-secretary/pending-writes.ts`.
   */
  pendingWrite: PendingWriteEnvelope | null
  /**
   * An outstanding "what's your SVC email" prompt for a genuinely ambiguous
   * sender, awaiting a reply to resolve and link their number — see
   * `lib/whatsapp-identity-claim.ts`. Same lifetime/reset convention as
   * `pendingWrite`.
   */
  pendingIdentityClaim: PendingIdentityClaim | null
  /**
   * An admin linked this number to an SVC person while the sender was not in
   * the middle of a conversation, and the 24-hour customer-service window had
   * already closed — so the one-time recognition confirmation could not be
   * pushed and rides on this sender's next reply instead. See
   * `lib/whatsapp-secretary/recognition-notice.ts`.
   */
  pendingRecognitionNotice: PendingRecognitionNotice | null
  /**
   * Entities resolved on previous turns, re-seeded into this turn's resolver.
   *
   * Tool *results* were never persisted — only the final assistant text — so a
   * follow-up could not reuse the prior turn's structured data and had to
   * re-call tools and re-spend budget, with the added risk that re-resolving
   * the same name landed on a different record than the answer being followed
   * up on. Carrying the resolved entities forward makes a ref stable across
   * the whole conversation.
   */
  resolvedEntities: ResolvedEntity[]
  /** Compact record of what the last turn retrieved, so the model can page rather than restart. */
  retrievals: ConversationRetrieval[]
}

/** A recognition confirmation waiting for the sender to write again. */
export type PendingRecognitionNotice = {
  /** When the link that earned the notice happened — kept for audit, never for expiry: a person who was recognized deserves to be told whenever they next appear. */
  sinceMs: number
}

/** One tool call's compact trace, small enough to fold into the next prompt. */
export type ConversationRetrieval = {
  toolName: string
  summary: string
  nextCursor?: string
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

function millis(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined
}

/**
 * Reads the persisted onboarding record.
 *
 * **Every field must be read here.** An earlier version parsed only
 * `lastIntroAtMs`/`capabilitySignature` and silently dropped the rest, which
 * made `lastCapabilityNudgeAtMs` write-only: the progressive-discovery hint
 * stored its timestamp, the next read threw it away, and so the "at most once
 * every few days" rate limit never once applied — the hint appended itself to
 * *every single answer* until it read as boilerplate. A field added to
 * {@link WhatsAppOnboardingState} without a line here is a rate limit that
 * does not exist.
 */
function readOnboardingState(value: unknown): WhatsAppOnboardingState | null {
  const state = asRecord(value)
  if (!state) return null
  const lastIntroAtMs = typeof state.lastIntroAtMs === "number" && Number.isFinite(state.lastIntroAtMs) ? state.lastIntroAtMs : null
  const capabilitySignature = typeof state.capabilitySignature === "string" ? state.capabilitySignature.slice(0, 400) : ""
  if (lastIntroAtMs === null || !capabilitySignature) return null

  const suggested = Array.isArray(state.suggestedCapabilities)
    ? state.suggestedCapabilities.filter((entry): entry is string => typeof entry === "string").slice(0, 12)
    : undefined

  return {
    lastIntroAtMs,
    capabilitySignature,
    ...(millis(state.firstSeenAtMs) ? { firstSeenAtMs: millis(state.firstSeenAtMs) as number } : {}),
    ...(millis(state.guideCompletedAtMs) ? { guideCompletedAtMs: millis(state.guideCompletedAtMs) as number } : {}),
    ...(millis(state.lastCapabilityNudgeAtMs) ? { lastCapabilityNudgeAtMs: millis(state.lastCapabilityNudgeAtMs) as number } : {}),
    ...(millis(state.recognitionNoticeAtMs) ? { recognitionNoticeAtMs: millis(state.recognitionNoticeAtMs) as number } : {}),
    ...(suggested && suggested.length > 0 ? { suggestedCapabilities: suggested as WhatsAppOnboardingState["suggestedCapabilities"] } : {}),
  }
}

const MAX_PERSISTED_ENTITIES = 24
const MAX_PERSISTED_RETRIEVALS = 8

function readPendingWrite(value: unknown): PendingWriteEnvelope | null {
  const envelope = asRecord(value)
  if (!envelope) return null
  const toolName = typeof envelope.toolName === "string" ? envelope.toolName : ""
  const summary = typeof envelope.summary === "string" ? envelope.summary.slice(0, MAX_STORED_MESSAGE_CHARACTERS) : ""
  const confirmPhrase = typeof envelope.confirmPhrase === "string" ? envelope.confirmPhrase.slice(0, 80) : ""
  const cancelPhrase = typeof envelope.cancelPhrase === "string" ? envelope.cancelPhrase.slice(0, 80) : ""
  const requestMessageId = typeof envelope.requestMessageId === "string" ? envelope.requestMessageId : ""
  const createdAtMs = typeof envelope.createdAtMs === "number" && Number.isFinite(envelope.createdAtMs) ? envelope.createdAtMs : 0
  if (!toolName || !summary || !confirmPhrase || !cancelPhrase || !requestMessageId || !createdAtMs) return null
  return { toolName, args: envelope.args ?? {}, summary, confirmPhrase, cancelPhrase, requestMessageId, createdAtMs }
}

function readPendingIdentityClaim(value: unknown): PendingIdentityClaim | null {
  const claim = asRecord(value)
  if (!claim) return null
  const askedAtMs = typeof claim.askedAtMs === "number" && Number.isFinite(claim.askedAtMs) ? claim.askedAtMs : 0
  if (!askedAtMs) return null
  return { askedAtMs }
}

/** Test seam: the write/read round trip is where a dropped field silently disables a rate limit. */
export const readPendingIdentityClaimForTests = readPendingIdentityClaim

function readResolvedEntities(value: unknown): ResolvedEntity[] {
  if (!Array.isArray(value)) return []
  return value
    .map(asRecord)
    .filter((entity): entity is RecordValue => entity !== null)
    .map((entity) => ({
      ref: typeof entity.ref === "string" ? entity.ref : "",
      kind: entity.kind as ResolvedEntity["kind"],
      name: typeof entity.name === "string" ? entity.name : "",
      sourceIds: (asRecord(entity.sourceIds) ?? {}) as ResolvedEntity["sourceIds"],
      meta: (asRecord(entity.meta) ?? {}) as ResolvedEntity["meta"],
    }))
    .filter((entity) => entity.ref && entity.name && entity.kind)
    .slice(-MAX_PERSISTED_ENTITIES)
}

function readRetrievals(value: unknown): ConversationRetrieval[] {
  if (!Array.isArray(value)) return []
  return value
    .map(asRecord)
    .filter((entry): entry is RecordValue => entry !== null)
    .map((entry) => ({
      toolName: typeof entry.toolName === "string" ? entry.toolName : "",
      summary: typeof entry.summary === "string" ? entry.summary.slice(0, 300) : "",
      ...(typeof entry.nextCursor === "string" && entry.nextCursor ? { nextCursor: entry.nextCursor.slice(0, 60) } : {}),
    }))
    .filter((entry) => entry.toolName && entry.summary)
    .slice(-MAX_PERSISTED_RETRIEVALS)
}

function readPendingRecognitionNotice(value: unknown): PendingRecognitionNotice | null {
  const record = asRecord(value)
  const sinceMs = record ? millis(record.sinceMs) : null
  return sinceMs ? { sinceMs } : null
}

/** Test seam: the write/read round trip is where a dropped field silently disables a rate limit. */
export const readOnboardingStateForTests = readOnboardingState

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
    const onboarding = readOnboardingState(snapshot.data()?.onboarding)
    const pendingWrite = readPendingWrite(snapshot.data()?.pendingWrite)
    const pendingIdentityClaim = readPendingIdentityClaim(snapshot.data()?.pendingIdentityClaim)
    const pendingRecognitionNotice = readPendingRecognitionNotice(snapshot.data()?.pendingRecognitionNotice)
    const resolvedEntities = readResolvedEntities(snapshot.data()?.resolvedEntities)
    const retrievals = readRetrievals(snapshot.data()?.retrievals)
    const existingReply = recentMessages.find(
      (message) => message.role === "assistant" && message.replyToMessageId === input.messageId,
    )

    if (existingReply) {
      return {
        recentMessages: toModelMessages(recentMessages),
        existingReply: toOutgoingReply(existingReply),
        isFirstInteraction: recentMessages.every((message) => message.id === input.messageId),
        onboarding,
        pendingWrite,
        pendingIdentityClaim,
        pendingRecognitionNotice,
        resolvedEntities,
        retrievals,
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
      onboarding,
      pendingWrite,
      pendingIdentityClaim,
      pendingRecognitionNotice,
      resolvedEntities,
      retrievals,
    }
  })
}

/**
 * Stores the generated reply, retaining only the latest six exchanges per
 * sender. `onboarding` is written in the same transaction as the reply it was
 * computed for, so a sender can never be marked "already introduced" for a
 * reply that failed to persist — and a Meta retry that finds the reply already
 * stored short-circuits before touching it, so the intro is not re-armed.
 */
export async function storeWhatsAppAssistantReply(input: {
  senderPhoneNumber: string
  replyToMessageId: string
  reply: WhatsAppOutgoingReply
  onboarding?: WhatsAppOnboardingState
  /** `null` explicitly clears a pending preview (confirmed, cancelled or expired). */
  pendingWrite?: PendingWriteEnvelope | null
  /** `null` explicitly clears a pending identity claim (linked, declined, or superseded). */
  pendingIdentityClaim?: PendingIdentityClaim | null
  resolvedEntities?: ResolvedEntity[]
  retrievals?: ConversationRetrieval[]
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
        ...(input.onboarding ? { onboarding: input.onboarding } : {}),
        // Clearing the deferred notice is not a separate decision: the only
        // way `recognitionNoticeAtMs` reaches this write is the reply itself
        // carrying the confirmation, so both land or neither does.
        ...(input.onboarding?.recognitionNoticeAtMs ? { pendingRecognitionNotice: null } : {}),
        ...(input.pendingWrite !== undefined ? { pendingWrite: input.pendingWrite } : {}),
        ...(input.pendingIdentityClaim !== undefined ? { pendingIdentityClaim: input.pendingIdentityClaim } : {}),
        ...(input.resolvedEntities ? { resolvedEntities: input.resolvedEntities.slice(-MAX_PERSISTED_ENTITIES) } : {}),
        ...(input.retrievals ? { retrievals: input.retrievals.slice(-MAX_PERSISTED_RETRIEVALS) } : {}),
      },
      { merge: true },
    )

    return input.reply
  })
}


/**
 * Reads only what the recognition confirmation needs to decide whether it may
 * fire — deliberately not the whole conversation, because the caller (the
 * Courtney Roberts Center link route) is not running a Secretary turn and has
 * no business loading a sender's transcript to send one message.
 */
export async function getRecognitionNoticeStatus(senderPhoneNumber: string): Promise<{
  noticedAtMs: number | null
  pendingSinceMs: number | null
}> {
  const db = await getAdminDb()
  const snapshot = await db.collection(CONVERSATIONS_COLLECTION).doc(conversationDocumentId(senderPhoneNumber)).get()
  const onboarding = readOnboardingState(snapshot.data()?.onboarding)
  const pending = readPendingRecognitionNotice(snapshot.data()?.pendingRecognitionNotice)
  return {
    noticedAtMs: onboarding?.recognitionNoticeAtMs ?? null,
    pendingSinceMs: pending?.sinceMs ?? null,
  }
}

/**
 * Records that the one-time recognition confirmation actually went out.
 *
 * It is written as an *introduction*, not just a flag: the short confirmation
 * is what this person was told, so the ordinary intro machinery must consider
 * them introduced and stay quiet. Without that, someone linked by an admin
 * would get "got you, I recognize you now" and then, on their very next
 * message, the full "Hi X — Courtney Roberts here" refresher.
 *
 * Existing onboarding fields are preserved rather than replaced, so a nudge
 * rate limit or a completed guided tour survives being recognized.
 */
export async function markRecognitionNoticeSent(input: {
  senderPhoneNumber: string
  capabilitySignature: string
  nowMs: number
}): Promise<void> {
  const db = await getAdminDb()
  const conversationRef = db.collection(CONVERSATIONS_COLLECTION).doc(conversationDocumentId(input.senderPhoneNumber))

  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(conversationRef)
    const existing = readOnboardingState(snapshot.data()?.onboarding)
    transaction.set(
      conversationRef,
      {
        onboarding: {
          ...(existing ?? {}),
          lastIntroAtMs: input.nowMs,
          capabilitySignature: input.capabilitySignature,
          recognitionNoticeAtMs: input.nowMs,
        },
        pendingRecognitionNotice: null,
        updatedAtMs: input.nowMs,
      },
      { merge: true },
    )
  })
}

/**
 * Defers the confirmation to the sender's next message — used when the
 * 24-hour window has closed, or when the push itself failed. Never overwrites
 * an earlier pending marker, so the recorded `sinceMs` stays the moment the
 * person actually became recognized.
 */
export async function markRecognitionNoticePending(input: { senderPhoneNumber: string; nowMs: number }): Promise<void> {
  const db = await getAdminDb()
  const conversationRef = db.collection(CONVERSATIONS_COLLECTION).doc(conversationDocumentId(input.senderPhoneNumber))

  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(conversationRef)
    if (readPendingRecognitionNotice(snapshot.data()?.pendingRecognitionNotice)) return
    transaction.set(
      conversationRef,
      { pendingRecognitionNotice: { sinceMs: input.nowMs }, updatedAtMs: input.nowMs },
      { merge: true },
    )
  })
}
