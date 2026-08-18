/**
 * Courtney Roberts Center — durable WhatsApp conversation history.
 *
 * Deliberately separate from `lib/whatsapp-conversation-memory.ts`, which
 * exists only to feed the Secretary's own bounded model context (last 12
 * messages, trimmed/rewritten as onboarding and write-preview state change).
 * This module is an append-only record of every inbound message and every
 * Secretary reply, kept independent of that rolling window so a full
 * transcript survives regardless of what the model-facing memory trims. No
 * UI reads this yet — these are the types the future admin screen and its
 * read API are built against.
 */

export type CourtneyRobertsCenterIdentityStatus = "internal" | "public"

export type CourtneyRobertsCenterMessageRole = "user" | "assistant"

/** Metadata only — never a URL. Signed/download links expire, so a durable
 * record stores what was sent, not a link that would go stale. */
export type CourtneyRobertsCenterAttachmentMetadata = {
  kind: "image" | "document"
  filename?: string
}

export type CourtneyRobertsCenterMessage = {
  id: string
  role: CourtneyRobertsCenterMessageRole
  text: string
  createdAtMs: number
  /** Native WhatsApp presentation used for an assistant reply, if any. */
  presentationKind?: "list" | "cta_url"
  attachments?: CourtneyRobertsCenterAttachmentMetadata[]
}

export type CourtneyRobertsCenterConversationSummary = {
  /** sha256(phone) — intentionally the same id `lib/whatsapp-conversation-memory.ts` uses for the same sender, so a durable thread and the Secretary's working-memory doc can be cross-referenced by id. */
  id: string
  displayName: string
  identityStatus: CourtneyRobertsCenterIdentityStatus
  resolvedUserId?: string
  resolvedPersonId?: string
  /** Mirrors `WhatsAppSenderIdentity.resolvedVia` — informational only. */
  resolvedVia?: "explicit" | "fallback"
  phoneHash: string
  /** Last 4 normalized digits — enough for an admin to recognize a thread without storing the full number in the open. */
  phoneLast4?: string
  messageCount: number
  lastMessageAtMs: number
  lastMessagePreview: string
  lastMessageRole: CourtneyRobertsCenterMessageRole
  createdAtMs: number
  updatedAtMs: number
}
