import { CRC_CONVERSATIONS_COLLECTION } from "./history-store"
import { identitySnapshotFromSenderIdentity, identitySnapshotWriteFields, reconcileIdentitySnapshot } from "./identity"
import type { CourtneyRobertsCenterIdentitySnapshot } from "./identity"
import { IdentityClaimConflictError, createFirestoreIdentityClaimProvider } from "@/lib/whatsapp-identity-claim"
import { normalizePhoneDigits } from "@/lib/phone-normalization"
import { resolveWhatsAppSenderIdentityDetailed } from "@/lib/whatsapp-svc-identity"
import { getFirebaseAdminApp } from "@/lib/ai/server/firebase-admin"

/**
 * Admin-side manual identity linking, for the senders self-service claiming
 * cannot reach: someone with no `/users` account to match an email against, a
 * number already linked to the wrong account, or an admin who simply wants to
 * fix a thread they are looking at rather than shell into
 * `scripts/link-whatsapp-sender-identity.ts`.
 *
 * It writes the same `/users.whatsappPhoneNormalized` field the conversational
 * claim writes, so both paths land on the resolver's strongest tier and behave
 * identically from the next message onward — there is no separate "admin
 * link" concept in the identity model.
 *
 * The refreshed identity snapshot is written straight back onto the
 * conversation document so the Center reflects the change immediately, rather
 * than waiting for the sender's next message to re-stamp it.
 */

export type LinkConversationIdentityResult = {
  identityStatus: CourtneyRobertsCenterIdentitySnapshot["identityStatus"]
  displayName: string
  resolvedUserId?: string
  resolvedPersonId?: string
}

export class CourtneyRobertsCenterLinkError extends Error {
  readonly status: 400 | 404 | 409
  constructor(status: 400 | 404 | 409, message: string) {
    super(message)
    this.name = "CourtneyRobertsCenterLinkError"
    this.status = status
  }
}

async function getAdminDb() {
  const { getFirestore } = await import("firebase-admin/firestore")
  return getFirestore(await getFirebaseAdminApp())
}

/** Rejects anything that is not a single, well-formed address. */
export function normalizeLinkEmail(raw: unknown): string {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : ""
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw new CourtneyRobertsCenterLinkError(400, "Enter a single valid SVC email address.")
  }
  return value
}

export async function linkCourtneyRobertsCenterConversationIdentity(input: {
  conversationId: string
  email: string
  /** Recorded for audit; never used for authorization. */
  linkedByEmail: string
}): Promise<LinkConversationIdentityResult> {
  const emailNormalized = normalizeLinkEmail(input.email)
  const db = await getAdminDb()

  const conversationRef = db.collection(CRC_CONVERSATIONS_COLLECTION).doc(input.conversationId)
  const conversationSnap = await conversationRef.get()
  const phoneNumber = conversationSnap.exists ? conversationSnap.data()?.phoneNumber : null
  if (typeof phoneNumber !== "string" || !phoneNumber) {
    throw new CourtneyRobertsCenterLinkError(404, "This conversation has no phone number on record to link.")
  }

  const provider = createFirestoreIdentityClaimProvider()
  const user = await provider.findUserByEmail(emailNormalized)
  if (!user) {
    throw new CourtneyRobertsCenterLinkError(404, "No single SVC account matches that email address.")
  }

  try {
    await provider.linkWhatsAppNumberToUser(user.id, normalizePhoneDigits(phoneNumber))
  } catch (error) {
    if (error instanceof IdentityClaimConflictError) {
      throw new CourtneyRobertsCenterLinkError(409, "This number is already linked to a different SVC account. Unlink it first.")
    }
    throw error
  }

  // Re-resolving (rather than synthesizing a snapshot from `user`) means the
  // Center shows exactly what the Secretary itself will resolve on the next
  // message, Directory contact and all.
  const resolution = await resolveWhatsAppSenderIdentityDetailed(phoneNumber)
  const identity = resolution.status === "resolved" ? resolution.identity : null
  const snapshot = reconcileIdentitySnapshot(
    conversationSnap.data() as Parameters<typeof reconcileIdentitySnapshot>[0],
    identitySnapshotFromSenderIdentity(identity),
  )

  const { FieldValue } = await import("firebase-admin/firestore")
  await conversationRef.set(
    {
      ...identitySnapshotWriteFields(snapshot),
      identityLinkedByEmail: input.linkedByEmail,
      identityLinkedAt: FieldValue.serverTimestamp(),
      updatedAtMs: Date.now(),
    },
    { merge: true },
  )

  console.info("Courtney Roberts Center admin linked a WhatsApp conversation to an SVC account", {
    userId: user.id,
    identityStatus: snapshot.identityStatus,
  })

  return {
    identityStatus: snapshot.identityStatus,
    displayName: snapshot.displayName,
    ...(snapshot.resolvedUserId ? { resolvedUserId: snapshot.resolvedUserId } : {}),
    ...(snapshot.resolvedPersonId ? { resolvedPersonId: snapshot.resolvedPersonId } : {}),
  }
}
