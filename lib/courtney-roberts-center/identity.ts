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

/**
 * Reconciles the snapshot this turn produced with what the conversation
 * already recorded, so the Center tracks identity in the direction it
 * actually moves.
 *
 * **Public → internal always applies.** That is the whole point: the moment a
 * number is claimed or admin-linked, the thread stops saying "Unknown sender"
 * and shows the person — including for the message that identified them,
 * since the webhook records inbound messages after enrollment.
 *
 * **Internal → public never applies.** Resolution fails closed (a Firestore
 * hiccup returns `not_found`), and one such blip would otherwise rewrite a
 * known thread back to "Unknown sender" while leaving the previous
 * `resolvedUserId`/`resolvedPersonId` behind as merge leftovers — a visibly
 * wrong, internally inconsistent document. A person who was identified once
 * stays identified; only a stronger signal moves them.
 *
 * Internal → internal always applies, so re-linking a number to a different
 * person is reflected immediately.
 */
export function reconcileIdentitySnapshot(
  existing: Partial<CourtneyRobertsCenterIdentitySnapshot> | null | undefined,
  incoming: CourtneyRobertsCenterIdentitySnapshot,
): CourtneyRobertsCenterIdentitySnapshot {
  if (incoming.identityStatus === "internal") return incoming
  if (existing?.identityStatus !== "internal" || !existing.displayName) return incoming

  return {
    identityStatus: "internal",
    displayName: existing.displayName,
    ...(existing.resolvedUserId ? { resolvedUserId: existing.resolvedUserId } : {}),
    ...(existing.resolvedPersonId ? { resolvedPersonId: existing.resolvedPersonId } : {}),
    ...(existing.resolvedVia ? { resolvedVia: existing.resolvedVia } : {}),
  }
}

/**
 * The identity fields as a conversation document should store them.
 *
 * Every key is always present, explicitly `null` when unset, because the
 * conversation summary is written with `{merge: true}` — omitting a key there
 * preserves whatever was written last time. Re-linking a number from someone
 * with an SVC account to a Directory-only contact would otherwise leave the
 * previous `resolvedUserId` behind next to the new person's name.
 */
export function identitySnapshotWriteFields(snapshot: CourtneyRobertsCenterIdentitySnapshot): Record<string, unknown> {
  return {
    identityStatus: snapshot.identityStatus,
    displayName: snapshot.displayName,
    resolvedUserId: snapshot.resolvedUserId ?? null,
    resolvedPersonId: snapshot.resolvedPersonId ?? null,
    resolvedVia: snapshot.resolvedVia ?? null,
  }
}
