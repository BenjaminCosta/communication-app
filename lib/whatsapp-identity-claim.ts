import { normalizePhoneDigits } from "@/lib/phone-normalization"
import type { WhatsAppSenderIdentity } from "@/lib/whatsapp-svc-identity"

/**
 * Self-service enrollment for a WhatsApp sender the identity resolver could
 * not pin to exactly one SVC person. Two situations reach this module, and
 * they want visibly different handling — see {@link IdentityClaimMode}:
 *
 * - **`"ambiguous"`** — two or more real SVC identities could own this number
 *   (`classifyWhatsAppIdentityMatches`'s `"ambiguous"` status). Blocking: the
 *   Secretary cannot act as anyone until it knows which one, so it asks and
 *   waits.
 * - **`"unrecognized"`** — no SVC record matches this number at all
 *   (`"not_found"`). Non-blocking: the sender may simply be an outsider with
 *   a general question, so the normal public answer still goes out and the
 *   enrollment offer rides along beside it.
 *
 * In BOTH modes an email address appearing in the message is treated as
 * unambiguous intent and acted on immediately, whether or not a prompt is
 * currently pending. Requiring the prompt first cost a whole round-trip for
 * anyone who volunteered their email up front.
 *
 * ⚠️ This is IDENTITY CLAIMING, not cryptographically verified identity. A
 * bare-text reply matched against `/users.emailNormalized` proves nothing
 * beyond "this person knows that email address" — no OTP, no auth challenge.
 * That was already a deliberate, documented tradeoff when only ambiguous
 * senders (already provably matching 2+ SVC records) could claim.
 *
 * ⚠️⚠️ Extending it to `"unrecognized"` senders on 2026-08-18 widened it
 * materially and knowingly, on an explicit call to prioritize a working
 * onboarding over the security posture at this stage: ANY number that
 * messages the SVC WhatsApp line and supplies a valid SVC email address now
 * obtains the full internal read scope — Directory phones and emails,
 * Applications candidate PII, daily reports, clocking. There is also no
 * attempt cap and no domain restriction, so email addresses can be tried
 * indefinitely. Before this is exposed beyond the current small internal
 * rollout, `"unrecognized"` claims need a real verification step (a one-time
 * code mailed to the SVC address) and a per-sender attempt limit. Tracked in
 * `docs/svc-whatsapp-ai-secretary-handoff.md`.
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

/** Which situation sent the sender here — see the module doc. */
export type IdentityClaimMode = "ambiguous" | "unrecognized"

export const AMBIGUOUS_IDENTITY_PROMPT =
  "I found more than one SVC profile that could match this number, so I want to link it to the right one. What's your SVC email address?"

/**
 * Appended to an unrecognized sender's normal public answer, so the reply
 * stays useful on its own and the way in is visible instead of being a dead
 * end ("ask your SVC admin", which the sender has no way to action from
 * WhatsApp). The webhook rate-limits it — see
 * {@link shouldOfferIdentityEnrollment}.
 */
export const UNRECOGNIZED_IDENTITY_OFFER =
  "By the way — I don't recognize this number as an SVC account yet. If you work at SVC, reply with your SVC email address and I'll link it, and then I can look up jobs, Daily Reports, Directory records, Outlooks and more for you."

const CLAIM_NOT_MATCHED_REPLY =
  "I couldn't match that to a single SVC account. Please reply with just your SVC email address, or ask an admin to link this number for you."

const CLAIM_CONFLICT_REPLY =
  "That email matches an SVC account, but this WhatsApp number is already linked to a different one. Please ask an admin to sort this out."

function extractEmailCandidate(text: string): string | null {
  const match = text.match(/[^\s@]+@[^\s@]+\.[^\s@]+/)
  return match ? match[0].trim().toLowerCase() : null
}

/** Words people wrap an email in when they are only answering the prompt. */
const IDENTITY_EMAIL_FILLER =
  /^(?:hi|hello|hey|hola|its|it|is|im|i|am|my|me|the|this|thats|that|sure|yes|yeah|ok|okay|thanks|thank|you|please|email|address|mail|svc|account|here|sorry)$/i

/**
 * True when the message carries an email address and essentially nothing else
 * — "j@svc.com", "sure, it's j@svc.com", "my email is j@svc.com".
 *
 * A linked number now continues the same turn instead of asking the sender to
 * repeat themselves, which is right when they linked while asking something
 * ("what's the Wonder job status? j@svc.com"). But when the email IS the whole
 * message there is no question to carry forward, and feeding it to the model
 * would have it answer an email address. The caller uses this to send a
 * deterministic "you're all set" instead.
 */
export function isIdentityEmailOnlyMessage(text: string): boolean {
  const email = extractEmailCandidate(text)
  if (!email) return false

  const remainder = text.toLowerCase().replace(email, " ")
  return remainder
    .split(/[^a-z0-9']+/i)
    .filter(Boolean)
    .every((word) => IDENTITY_EMAIL_FILLER.test(word.replace(/'/g, "")))
}

/**
 * Sent right after a link when the sender's message was only their email, so
 * the confirmation lands on something actionable rather than on silence. Kept
 * deterministic (never model-generated) for the same reason the guided tour
 * is: the capabilities it names must be ones that really exist.
 */
export const IDENTITY_LINKED_READY_REPLY =
  'You\'re all set. Ask me about a job, a Daily Report, someone in the Directory or a 3-Week Outlook — or say "show me around" for a quick tour.'

/**
 * Whether an unrecognized sender should be offered enrollment on this turn.
 *
 * Reuses the same `pendingIdentityClaim` record the blocking flow writes, so
 * one offer stands for the whole TTL: an outsider asking several public
 * questions in a row is invited once, not nagged on every reply, and a quiet
 * number becomes eligible again a day later.
 */
export function shouldOfferIdentityEnrollment(pendingClaim: PendingIdentityClaim | null, nowMs: number): boolean {
  return !pendingClaim || isPendingIdentityClaimExpired(pendingClaim, nowMs)
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
  /** Blocking question issued; nothing else happens this turn. */
  | { kind: "asked"; reply: string; pendingClaim: PendingIdentityClaim }
  /** Number is now linked. `reply` is a CONFIRMATION LINE, not a whole answer —
   * the webhook prefixes it onto the real answer it goes on to produce for the
   * sender's original message. */
  | { kind: "linked"; identity: WhatsAppSenderIdentity; reply: string }
  /** An attempt was made and failed. */
  | { kind: "not-matched"; reply: string; pendingClaim: PendingIdentityClaim }
  /** Nothing to attempt and nothing to block on — the caller proceeds with its
   * normal (public) flow. Only reachable in `"unrecognized"` mode. */
  | { kind: "skipped" }

/**
 * Resolves one turn of the identity-claim conversation. Call this whenever
 * `resolveWhatsAppSenderIdentityDetailed` returns `"ambiguous"` (mode
 * `"ambiguous"`, the default) or `"not_found"` (mode `"unrecognized"`).
 *
 * An email anywhere in the message is acted on immediately in either mode,
 * pending prompt or not: supplying one is unambiguous intent, and making
 * someone wait for the question before their answer counts was a wasted
 * round-trip. Exactly one matching `/users` account links the number;
 * anything else re-prompts and never guesses.
 *
 * With no email in the message the modes diverge: `"ambiguous"` asks (or
 * re-asks once the previous prompt went stale), while `"unrecognized"`
 * returns `"skipped"` so the public answer is never replaced by an
 * interrogation.
 */
export async function resolveIdentityClaim(input: {
  text: string
  pendingClaim: PendingIdentityClaim | null
  senderPhoneNumber: string
  provider: IdentityClaimLookupProvider
  mode?: IdentityClaimMode
  nowMs?: number
}): Promise<IdentityClaimOutcome> {
  const nowMs = input.nowMs ?? Date.now()
  const mode = input.mode ?? "ambiguous"
  const emailCandidate = extractEmailCandidate(input.text)

  if (emailCandidate) {
    // Keeping the original timestamp when one is already live preserves the
    // TTL the sender is actually inside; a first-time attempt starts one.
    const pendingClaim = input.pendingClaim ?? { askedAtMs: nowMs }
    const user = await input.provider.findUserByEmail(emailCandidate)
    if (!user) {
      return { kind: "not-matched", reply: CLAIM_NOT_MATCHED_REPLY, pendingClaim }
    }

    const phoneNormalized = normalizePhoneDigits(input.senderPhoneNumber)
    try {
      await input.provider.linkWhatsAppNumberToUser(user.id, phoneNormalized)
    } catch (error) {
      if (error instanceof IdentityClaimConflictError) {
        return { kind: "not-matched", reply: CLAIM_CONFLICT_REPLY, pendingClaim }
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
        resolvedTier: "whatsapp-link",
      },
      reply: `Thanks, ${user.name} — I've linked this WhatsApp number to your SVC account.`,
    }
  }

  // An unrecognized sender without an email may just be an outsider with a
  // general question. Never hijack their turn; the webhook attaches the
  // enrollment offer to the public answer instead.
  if (mode === "unrecognized") return { kind: "skipped" }

  if (!input.pendingClaim || isPendingIdentityClaimExpired(input.pendingClaim, nowMs)) {
    return { kind: "asked", reply: AMBIGUOUS_IDENTITY_PROMPT, pendingClaim: { askedAtMs: nowMs } }
  }
  return { kind: "not-matched", reply: CLAIM_NOT_MATCHED_REPLY, pendingClaim: input.pendingClaim }
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
