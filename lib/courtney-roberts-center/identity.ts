import { createHash } from "node:crypto"
import type { WhatsAppSenderIdentity } from "@/lib/whatsapp-svc-identity"
import type { CourtneyRobertsCenterIdentityStatus } from "./types"

/**
 * Same algorithm as the private `conversationDocumentId()` in
 * `lib/whatsapp-conversation-memory.ts` — kept as its own tiny copy here
 * rather than importing from that file, so this module never has a runtime
 * dependency on the Secretary's own memory implementation. The two id spaces
 * are meant to line up (same phone -> same hash), not to share code.
 */
export function hashWhatsAppPhoneNumber(phoneNumber: string): string {
  return createHash("sha256").update(phoneNumber).digest("hex")
}

export type CourtneyRobertsCenterIdentitySnapshot = {
  identityStatus: CourtneyRobertsCenterIdentityStatus
  displayName: string
  resolvedUserId?: string
  resolvedPersonId?: string
  resolvedVia?: "explicit" | "fallback"
}

const UNKNOWN_SENDER_DISPLAY_NAME = "Unknown sender"

/** Mirrors the same "internal" / "public" split `WhatsAppAccessPolicy.level` already uses for this exact identity. */
export function identitySnapshotFromSenderIdentity(identity: WhatsAppSenderIdentity | null): CourtneyRobertsCenterIdentitySnapshot {
  if (!identity) {
    return { identityStatus: "public", displayName: UNKNOWN_SENDER_DISPLAY_NAME }
  }
  return {
    identityStatus: "internal",
    displayName: identity.name,
    ...(identity.userId ? { resolvedUserId: identity.userId } : {}),
    resolvedPersonId: identity.personId,
    ...(identity.resolvedVia ? { resolvedVia: identity.resolvedVia } : {}),
  }
}
