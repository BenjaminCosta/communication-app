import { normalizePhoneDigits } from "@/lib/phone-normalization"
import type { WhatsAppSenderIdentity } from "@/lib/whatsapp-svc-identity"

/**
 * Recovery path for a GENUINELY ambiguous WhatsApp sender (two or more real
 * SVC identities could own this number — see
 * `classifyWhatsAppIdentityMatches`'s `"ambiguous"` status). Instead of
 * silently falling back to public access, the Secretary asks for the
 * sender's SVC email and, on an exact single match, links the number to that
 * account going forward.
 *
 * ⚠️ This is IDENTITY CLAIMING, not cryptographically verified identity. A
 * bare-text reply matched against `/users.emailNormalized` proves nothing
 * beyond "this person knows that email address" — no OTP, no auth challenge.
 * That is a deliberate, documented tradeoff for this stage of a small
 * internal rollout (explicitly requested 2026-08-16), not an oversight. If
 * WhatsApp numbers are ever exposed to a wider or higher-risk audience, this
 * needs a real verification step (e.g. an OTP sent to the SVC email) before
 * a claim is allowed to grant internal access.
 */

/** Persisted on the conversation doc; one pending claim per sender, same
 * shape/lifetime convention as `PendingWriteEnvelope`. */
export interface PendingIdentityClaim {
  askedAtMs: number
}

/** How long the "what's your email" prompt stays live before it's simply
 * re-asked fresh rather than treating a stale reply as an attempt. */
export const PENDING_IDENTITY_CLAIM_TTL_MS = 24 * 60 * 60 * 1_000

export function isPendingIdentityClaimExpired(claim: PendingIdentityClaim, nowMs: number): boolean {
  return nowMs - claim.askedAtMs >= PENDING_IDENTITY_CLAIM_TTL_MS
}

export const AMBIGUOUS_IDENTITY_PROMPT =
  "I found more than one SVC profile that could match this number, so I want to link it to the right one. What's your SVC email address?"

const CLAIM_NOT_MATCHED_REPLY =
  "I couldn't match that to a single SVC account. Please reply with just your SVC email address, or ask an admin to link this number for you."

const CLAIM_CONFLICT_REPLY =
  "That email matches an SVC account, but this WhatsApp number is already linked to a different one. Please ask an admin to sort this out."

function extractEmailCandidate(text: string): string | null {
  const match = text.match(/[^\s@]+@[^\s@]+\.[^\s@]+/)
  return match ? match[0].trim().toLowerCase() : null
}

export type IdentityClaimedUser = { id: string; name: string; role?: string }

/** Server-side data access the claim flow needs, injectable for tests. */
export interface IdentityClaimLookupProvider {
  /** `null` for no match OR more than one — either way, not safe to claim against. */
  findUserByEmail(emailNormalized: string): Promise<IdentityClaimedUser | null>
  /** Throws {@link IdentityClaimConflictError} if the number is already linked to a DIFFERENT user. */
  linkWhatsAppNumberToUser(userId: string, phoneNormalized: string): Promise<void>
}

export class IdentityClaimConflictError extends Error {}

export type IdentityClaimOutcome =
  | { kind: "asked"; reply: string; pendingClaim: PendingIdentityClaim }
  | { kind: "linked"; identity: WhatsAppSenderIdentity; reply: string }
  | { kind: "not-matched"; reply: string; pendingClaim: PendingIdentityClaim }

/**
 * Resolves one turn of the identity-claim conversation. Call this whenever
 * `resolveWhatsAppSenderIdentityDetailed` returns `{status: "ambiguous"}`.
 *
 * No pending claim yet → asks the question and starts one. A pending claim
 * that's stale, or whose reply doesn't contain an email, or whose email
 * doesn't resolve to exactly one `/users` account → re-prompts (never
 * guesses). An email that resolves to exactly one account → links this
 * WhatsApp number to it (server-side, unconditionally trusted going
 * forward) and returns the freshly explicit-tier identity.
 */
export async function resolveIdentityClaim(input: {
  text: string
  pendingClaim: PendingIdentityClaim | null
  senderPhoneNumber: string
  provider: IdentityClaimLookupProvider
  nowMs?: number
}): Promise<IdentityClaimOutcome> {
  const nowMs = input.nowMs ?? Date.now()

  if (!input.pendingClaim || isPendingIdentityClaimExpired(input.pendingClaim, nowMs)) {
    return { kind: "asked", reply: AMBIGUOUS_IDENTITY_PROMPT, pendingClaim: { askedAtMs: nowMs } }
  }

  const emailCandidate = extractEmailCandidate(input.text)
  if (!emailCandidate) {
    return { kind: "not-matched", reply: CLAIM_NOT_MATCHED_REPLY, pendingClaim: input.pendingClaim }
  }

  const user = await input.provider.findUserByEmail(emailCandidate)
  if (!user) {
    return { kind: "not-matched", reply: CLAIM_NOT_MATCHED_REPLY, pendingClaim: input.pendingClaim }
  }

  const phoneNormalized = normalizePhoneDigits(input.senderPhoneNumber)
  try {
    await input.provider.linkWhatsAppNumberToUser(user.id, phoneNormalized)
  } catch (error) {
    if (error instanceof IdentityClaimConflictError) {
      return { kind: "not-matched", reply: CLAIM_CONFLICT_REPLY, pendingClaim: input.pendingClaim }
    }
    throw error
  }

  return {
    kind: "linked",
    identity: {
      personId: `user:${user.id}`,
      userId: user.id,
      name: user.name,
      ...(user.role ? { role: user.role } : {}),
      resolvedVia: "explicit",
    },
    reply: `Thanks, ${user.name} — I've linked this WhatsApp number to your SVC account. Send your question again and I'll help.`,
  }
}

async function getAdminDb() {
  const { getFirebaseAdminApp } = await import("@/lib/ai/server/firebase-admin")
  const { getFirestore } = await import("firebase-admin/firestore")
  return getFirestore(await getFirebaseAdminApp())
}

/** Real Firestore-backed provider for production use. */
export function createFirestoreIdentityClaimProvider(): IdentityClaimLookupProvider {
  return {
    async findUserByEmail(emailNormalized) {
      const db = await getAdminDb()
      const snapshot = await db.collection("users").where("emailNormalized", "==", emailNormalized).limit(2).get()
      if (snapshot.size !== 1) return null
      const doc = snapshot.docs[0]
      const data = doc.data() as Record<string, unknown>
      const name = typeof data.name === "string" && data.name ? data.name : null
      if (!name) return null
      const role = typeof data.role === "string" && data.role ? data.role : undefined
      return { id: doc.id, name, ...(role ? { role } : {}) }
    },
    async linkWhatsAppNumberToUser(userId, phoneNormalized) {
      const db = await getAdminDb()
      const conflicting = await db.collection("users").where("whatsappPhoneNormalized", "==", phoneNormalized).get()
      if (conflicting.docs.some((doc) => doc.id !== userId)) {
        throw new IdentityClaimConflictError(`WhatsApp number already linked to a different user.`)
      }
      const { FieldValue } = await import("firebase-admin/firestore")
      await db.collection("users").doc(userId).set(
        {
          whatsappPhoneNormalized: phoneNormalized,
          whatsappIdentityLinkedAt: FieldValue.serverTimestamp(),
          whatsappIdentityLinkedVia: "self-claim",
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      )
    },
  }
}
