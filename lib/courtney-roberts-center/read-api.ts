import type { Firestore, Query } from "firebase-admin/firestore"
import { getFirebaseAdminApp } from "@/lib/ai/server/firebase-admin"
import { CRC_CONVERSATIONS_COLLECTION, CRC_MESSAGES_SUBCOLLECTION } from "./history-store"
import type { CourtneyRobertsCenterAttachmentMetadata, CourtneyRobertsCenterConversationSummary, CourtneyRobertsCenterMessage } from "./types"

const DEFAULT_CONVERSATIONS_PAGE_SIZE = 50
const MAX_CONVERSATIONS_PAGE_SIZE = 200
const DEFAULT_MESSAGES_PAGE_SIZE = 200
const MAX_MESSAGES_PAGE_SIZE = 500

type RecordValue = Record<string, unknown>

async function getAdminDb(): Promise<Firestore> {
  const { getFirestore } = await import("firebase-admin/firestore")
  return getFirestore(await getFirebaseAdminApp())
}

function asRecord(value: unknown): RecordValue | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as RecordValue) : null
}

function clampLimit(requested: number | undefined, fallback: number, max: number): number {
  if (typeof requested !== "number" || !Number.isFinite(requested) || requested <= 0) return fallback
  return Math.min(Math.floor(requested), max)
}

function toConversationSummary(id: string, data: unknown): CourtneyRobertsCenterConversationSummary | null {
  const record = asRecord(data)
  if (!record) return null

  const lastMessageAtMs = typeof record.lastMessageAtMs === "number" ? record.lastMessageAtMs : 0
  return {
    id,
    displayName: typeof record.displayName === "string" && record.displayName ? record.displayName : "Unknown sender",
    identityStatus: record.identityStatus === "internal" ? "internal" : "public",
    ...(typeof record.resolvedUserId === "string" && record.resolvedUserId ? { resolvedUserId: record.resolvedUserId } : {}),
    ...(typeof record.resolvedPersonId === "string" && record.resolvedPersonId ? { resolvedPersonId: record.resolvedPersonId } : {}),
    ...(record.resolvedVia === "explicit" || record.resolvedVia === "fallback" ? { resolvedVia: record.resolvedVia } : {}),
    phoneHash: typeof record.phoneHash === "string" && record.phoneHash ? record.phoneHash : id,
    ...(typeof record.phoneLast4 === "string" && record.phoneLast4 ? { phoneLast4: record.phoneLast4 } : {}),
    messageCount: typeof record.messageCount === "number" ? record.messageCount : 0,
    lastMessageAtMs,
    lastMessagePreview: typeof record.lastMessagePreview === "string" ? record.lastMessagePreview : "",
    lastMessageRole: record.lastMessageRole === "assistant" ? "assistant" : "user",
    createdAtMs: typeof record.createdAtMs === "number" ? record.createdAtMs : lastMessageAtMs,
    updatedAtMs: typeof record.updatedAtMs === "number" ? record.updatedAtMs : lastMessageAtMs,
  }
}

function toMessage(id: string, data: unknown): CourtneyRobertsCenterMessage | null {
  const record = asRecord(data)
  if (!record) return null

  const role = record.role === "assistant" ? "assistant" : record.role === "user" ? "user" : null
  const text = typeof record.text === "string" ? record.text : null
  const createdAtMs = typeof record.createdAtMs === "number" ? record.createdAtMs : null
  if (!role || text === null || createdAtMs === null) return null

  const attachments: CourtneyRobertsCenterAttachmentMetadata[] = Array.isArray(record.attachments)
    ? record.attachments
        .map(asRecord)
        .filter((entry): entry is RecordValue => entry !== null)
        .map((entry): CourtneyRobertsCenterAttachmentMetadata | null => {
          const kind = entry.kind === "image" ? "image" : entry.kind === "document" ? "document" : null
          if (!kind) return null
          const filename = typeof entry.filename === "string" ? entry.filename : undefined
          return filename ? { kind, filename } : { kind }
        })
        .filter((entry): entry is CourtneyRobertsCenterAttachmentMetadata => entry !== null)
    : []

  return {
    id,
    role,
    text,
    createdAtMs,
    ...(record.presentationKind === "list" || record.presentationKind === "cta_url" ? { presentationKind: record.presentationKind } : {}),
    ...(attachments.length > 0 ? { attachments } : {}),
  }
}

/** Test seam: parsing malformed/legacy Firestore doc shapes is where a schema drift would silently corrupt the admin list — worth unit testing directly. */
export const toConversationSummaryForTests = toConversationSummary
export const toMessageForTests = toMessage

export type ListCourtneyRobertsCenterConversationsResult = {
  conversations: CourtneyRobertsCenterConversationSummary[]
  nextCursor?: string
}

/** Newest-active-first — the ordering a WhatsApp-style conversation list wants. Single-field orderBy, no composite index required. */
export async function listCourtneyRobertsCenterConversations(input?: {
  limit?: number
  /** Opaque cursor from a previous page's `nextCursor`. */
  cursor?: string
}): Promise<ListCourtneyRobertsCenterConversationsResult> {
  const db = await getAdminDb()
  const limit = clampLimit(input?.limit, DEFAULT_CONVERSATIONS_PAGE_SIZE, MAX_CONVERSATIONS_PAGE_SIZE)

  let query: Query = db.collection(CRC_CONVERSATIONS_COLLECTION).orderBy("updatedAtMs", "desc").limit(limit + 1)
  const cursorMs = input?.cursor ? Number(input.cursor) : NaN
  if (Number.isFinite(cursorMs)) query = query.startAfter(cursorMs)

  const snapshot = await query.get()
  const conversations = snapshot.docs
    .slice(0, limit)
    .map((doc) => toConversationSummary(doc.id, doc.data()))
    .filter((entry): entry is CourtneyRobertsCenterConversationSummary => entry !== null)

  const hasMore = snapshot.docs.length > limit
  return {
    conversations,
    ...(hasMore && conversations.length > 0
      ? { nextCursor: String(conversations[conversations.length - 1].updatedAtMs) }
      : {}),
  }
}

export type GetCourtneyRobertsCenterConversationThreadResult = {
  conversation: CourtneyRobertsCenterConversationSummary
  messages: CourtneyRobertsCenterMessage[]
  nextCursor?: string
}

/** Full thread for one conversation, oldest-first — the shape a chat screen renders directly. Returns `null` when the conversation id is unknown. */
export async function getCourtneyRobertsCenterConversationThread(
  conversationId: string,
  input?: { limit?: number; cursor?: string },
): Promise<GetCourtneyRobertsCenterConversationThreadResult | null> {
  const db = await getAdminDb()
  const conversationRef = db.collection(CRC_CONVERSATIONS_COLLECTION).doc(conversationId)
  const conversationSnap = await conversationRef.get()
  const conversation = conversationSnap.exists ? toConversationSummary(conversationSnap.id, conversationSnap.data()) : null
  if (!conversation) return null

  const limit = clampLimit(input?.limit, DEFAULT_MESSAGES_PAGE_SIZE, MAX_MESSAGES_PAGE_SIZE)
  let query: Query = conversationRef.collection(CRC_MESSAGES_SUBCOLLECTION).orderBy("createdAtMs", "asc").limit(limit + 1)
  const cursorMs = input?.cursor ? Number(input.cursor) : NaN
  if (Number.isFinite(cursorMs)) query = query.startAfter(cursorMs)

  const snapshot = await query.get()
  const messages = snapshot.docs
    .slice(0, limit)
    .map((doc) => toMessage(doc.id, doc.data()))
    .filter((entry): entry is CourtneyRobertsCenterMessage => entry !== null)

  const hasMore = snapshot.docs.length > limit
  return {
    conversation,
    messages,
    ...(hasMore && messages.length > 0 ? { nextCursor: String(messages[messages.length - 1].createdAtMs) } : {}),
  }
}
