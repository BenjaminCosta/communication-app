import type { Firestore } from "firebase-admin/firestore"
import { getFirebaseAdminApp } from "@/lib/ai/server/firebase-admin"
import { normalizePhoneDigits, phoneLookupCandidates } from "@/lib/phone-normalization"

type RecordValue = Record<string, unknown>

export type WhatsAppSenderIdentity = {
  personId: string
  userId?: string
  name: string
  role?: string
  /**
   * How this identity was resolved. `"explicit"` means a deliberate WhatsApp
   * link (`/users.whatsappPhoneNormalized`, `/contacts.whatsappPhoneNormalized`)
   * or the account holder's own registered profile phone
   * (`/users.phoneNormalized`) — the strongest source of truth. `"fallback"`
   * means it was only found via a Directory contact's general
   * `phoneNormalized`, which can be imported/unverified data and, per person,
   * duplicated across several contact records. Purely informational (used for
   * logging); never changes what the sender is authorized to do. Optional —
   * absent on identities built by hand (tests, other call sites) rather than
   * by {@link resolveWhatsAppSenderIdentity} itself.
   */
  resolvedVia?: "explicit" | "fallback"
}

/** A raw Firestore-shaped document, decoupled from the Admin SDK's own
 * `QueryDocumentSnapshot` so the resolution algorithm below can be unit
 * tested with plain fixtures instead of a real Firestore connection. */
export type WhatsAppIdentityDocument = { id: string; data: unknown }

/** Everything the identity resolver needs, grouped by which field matched.
 * Kept as an object of arrays (not a single flat list) because the query
 * that produced each match is exactly what determines its trust tier below. */
export interface WhatsAppIdentityMatchSet {
  /** `/contacts` matched via the general, imported/unverified `phoneNormalized`. */
  contactsByPhone: WhatsAppIdentityDocument[]
  /** `/contacts` matched via `whatsappPhoneNormalized` — an explicit link. */
  contactsByWhatsApp: WhatsAppIdentityDocument[]
  /** `/users` matched via the account holder's own registered `phoneNormalized`. */
  usersByPhone: WhatsAppIdentityDocument[]
  /** `/users` matched via `whatsappPhoneNormalized` — an explicit link. */
  usersByWhatsApp: WhatsAppIdentityDocument[]
}

async function getAdminDb(): Promise<Firestore> {
  const { getFirestore } = await import("firebase-admin/firestore")
  return getFirestore(await getFirebaseAdminApp())
}

function asRecord(value: unknown): RecordValue | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as RecordValue) : null
}

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null
  const text = value.trim().slice(0, 200)
  return text || null
}

function contactIdentityFromDocument(id: string, data: unknown): Omit<WhatsAppSenderIdentity, "resolvedVia"> | null {
  const contact = asRecord(data)
  if (!contact || contact.visibility === "private") return null

  const masterData = asRecord(contact.masterData)
  const name = cleanText(masterData?.displayName) ?? cleanText(masterData?.canonicalName) ?? cleanText(contact.name)
  if (!name) return null

  const role = cleanText(masterData?.roleName) ?? cleanText(contact.role) ?? undefined
  const userId = cleanText(contact.linkedUserId) ?? undefined

  return {
    personId: id,
    ...(userId ? { userId } : {}),
    name,
    ...(role ? { role } : {}),
  }
}

function userIdentityFromDocument(userId: string, data: unknown): Omit<WhatsAppSenderIdentity, "resolvedVia"> | null {
  const user = asRecord(data)
  const name = cleanText(user?.name)
  if (!name) return null

  const role = cleanText(user?.role) ?? undefined
  return {
    personId: `user:${userId}`,
    userId,
    name,
    ...(role ? { role } : {}),
  }
}

/** One matched document, tagged with the trust tier its query implies. */
type IdentityCandidate = {
  tier: "explicit" | "fallback"
  /** Real-identity grouping key: `user:{uid}` when the match is tied to a
   * registered account (directly, or via a contact's `linkedUserId`),
   * otherwise `person:{contactId}` — an identity Firestore has no way to
   * confirm is a real, singular person. */
  key: string
  identity: Omit<WhatsAppSenderIdentity, "resolvedVia">
}

function candidateFromContactDoc(tier: "explicit" | "fallback", doc: WhatsAppIdentityDocument): IdentityCandidate | null {
  const identity = contactIdentityFromDocument(doc.id, doc.data)
  if (!identity) return null
  return { tier, key: identity.userId ? `user:${identity.userId}` : `person:${identity.personId}`, identity }
}

function candidateFromUserDoc(doc: WhatsAppIdentityDocument): IdentityCandidate | null {
  const identity = userIdentityFromDocument(doc.id, doc.data)
  if (!identity) return null
  return { tier: "explicit", key: `user:${identity.userId}`, identity }
}

/** Merges same-key candidates (e.g. a `/users` doc match and its linked
 * `/contacts` doc match) into one, preferring the contact id as the future
 * person identifier and filling in whichever role is set. Mirrors the merge
 * this file always did, just scoped to one trust tier at a time now. */
function mergeByKey(matches: IdentityCandidate[]): IdentityCandidate[] {
  const byKey = new Map<string, IdentityCandidate>()
  for (const match of matches) {
    const existing = byKey.get(match.key)
    byKey.set(match.key, {
      tier: match.tier,
      key: match.key,
      identity: {
        ...existing?.identity,
        ...match.identity,
        personId: match.identity.personId.startsWith("user:") ? existing?.identity.personId ?? match.identity.personId : match.identity.personId,
        role: match.identity.role ?? existing?.identity.role,
      },
    })
  }
  return [...byKey.values()]
}

type TierResult =
  | { status: "empty" }
  | { status: "resolved"; candidate: IdentityCandidate }
  | { status: "ambiguous"; matchCount: number }

/**
 * Resolves one trust tier to a UNIQUE REAL IDENTITY, not a document count.
 *
 * A registered account (`userId` set, whether from a `/users` doc directly
 * or a `/contacts` doc's `linkedUserId`) always wins over any number of
 * unlinked duplicate contacts that happen to share the same phone number —
 * those duplicates are exactly the kind of stale/imported junk a phone book
 * accumulates (a second vcf import, a mislabeled entry, ...), not competing
 * claims to the identity. Two or more DIFFERENT registered accounts sharing
 * one phone number is a genuine, unresolvable conflict and stays ambiguous —
 * as does two or more unlinked contacts with no registered account among
 * them to break the tie.
 */
function resolveTier(matches: IdentityCandidate[]): TierResult {
  if (matches.length === 0) return { status: "empty" }

  const merged = mergeByKey(matches)
  const linked = merged.filter((m) => m.identity.userId)
  if (linked.length === 1) return { status: "resolved", candidate: linked[0] }
  if (linked.length > 1) return { status: "ambiguous", matchCount: linked.length }

  const unlinked = merged.filter((m) => !m.identity.userId)
  if (unlinked.length === 1) return { status: "resolved", candidate: unlinked[0] }
  return { status: "ambiguous", matchCount: unlinked.length }
}

/**
 * Tri-state resolution outcome. `"ambiguous"` and `"not_found"` both mean "no
 * identity today," but they call for different responses upstream: a genuine
 * ambiguity (data proves 2+ real identities could own this number) is worth
 * asking the sender to disambiguate; a plain miss is not — see
 * `lib/whatsapp-identity-claim.ts`.
 */
export type WhatsAppIdentityResolution =
  | { status: "resolved"; identity: WhatsAppSenderIdentity }
  | { status: "ambiguous" }
  | { status: "not_found" }

/**
 * Pure resolution algorithm — no Firestore, fully unit-testable. Takes every
 * document each query matched and applies the two-tier, unique-real-identity
 * rule described on {@link resolveTier}.
 *
 * `/users`/explicit-WhatsApp-link matches (`explicit` tier) are the strongest
 * source of truth and are tried first. Directory contact `phoneNormalized`
 * matches (`fallback` tier) are consulted ONLY when the explicit tier found
 * nothing at all — never to break an explicit-tier ambiguity, and never
 * blended with explicit-tier data. A conflict at the trusted tier (two
 * different accounts both explicitly claim the number) must stay
 * unresolved rather than be quietly overridden by a weaker signal.
 */
export function classifyWhatsAppIdentityMatches(matches: WhatsAppIdentityMatchSet): WhatsAppIdentityResolution {
  const explicit = [
    ...matches.contactsByWhatsApp.map((doc) => candidateFromContactDoc("explicit", doc)),
    ...matches.usersByPhone.map((doc) => candidateFromUserDoc(doc)),
    ...matches.usersByWhatsApp.map((doc) => candidateFromUserDoc(doc)),
  ].filter((c): c is IdentityCandidate => c !== null)

  const explicitResult = resolveTier(explicit)
  if (explicitResult.status === "resolved") {
    return { status: "resolved", identity: { ...explicitResult.candidate.identity, resolvedVia: "explicit" } }
  }
  if (explicitResult.status === "ambiguous") {
    console.warn("WhatsApp sender identity was ambiguous at the explicit (verified) tier", { matchCount: explicitResult.matchCount })
    return { status: "ambiguous" }
  }

  const fallback = matches.contactsByPhone.map((doc) => candidateFromContactDoc("fallback", doc)).filter((c): c is IdentityCandidate => c !== null)
  const fallbackResult = resolveTier(fallback)
  if (fallbackResult.status === "resolved") {
    return { status: "resolved", identity: { ...fallbackResult.candidate.identity, resolvedVia: "fallback" } }
  }
  if (fallbackResult.status === "ambiguous") {
    console.warn("WhatsApp sender identity was ambiguous at the fallback (Directory) tier", { matchCount: fallbackResult.matchCount })
    return { status: "ambiguous" }
  }
  return { status: "not_found" }
}

/** Convenience wrapper over {@link classifyWhatsAppIdentityMatches} for
 * callers that only care whether an identity was found, not why not. */
export function resolveWhatsAppIdentityFromMatches(matches: WhatsAppIdentityMatchSet): WhatsAppSenderIdentity | null {
  const result = classifyWhatsAppIdentityMatches(matches)
  return result.status === "resolved" ? result.identity : null
}

async function fetchWhatsAppIdentityMatchSet(candidates: string[]): Promise<WhatsAppIdentityMatchSet> {
  const db = await getAdminDb()
  const [contactsByPhoneSnapshot, contactsByWhatsAppSnapshot, usersByPhoneSnapshot, usersByWhatsAppSnapshot] = await Promise.all([
    db.collection("contacts").where("phoneNormalized", "in", candidates).get(),
    db.collection("contacts").where("whatsappPhoneNormalized", "in", candidates).get(),
    db.collection("users").where("phoneNormalized", "in", candidates).get(),
    db.collection("users").where("whatsappPhoneNormalized", "in", candidates).get(),
  ])

  return {
    contactsByPhone: contactsByPhoneSnapshot.docs.map((document) => ({ id: document.id, data: document.data() })),
    contactsByWhatsApp: contactsByWhatsAppSnapshot.docs.map((document) => ({ id: document.id, data: document.data() })),
    usersByPhone: usersByPhoneSnapshot.docs.map((document) => ({ id: document.id, data: document.data() })),
    usersByWhatsApp: usersByWhatsAppSnapshot.docs.map((document) => ({ id: document.id, data: document.data() })),
  }
}

/**
 * Resolves the tri-state outcome for an inbound WhatsApp sender. It
 * intentionally never reads messages, Directory projections, or private
 * contact fields. A query failure fails closed as `"not_found"` — the same
 * conservative behavior {@link resolveWhatsAppSenderIdentity} always had.
 */
export async function resolveWhatsAppSenderIdentityDetailed(phoneNumber: string): Promise<WhatsAppIdentityResolution> {
  const candidates = phoneLookupCandidates(phoneNumber)
  if (candidates.length === 0) return { status: "not_found" }

  try {
    return classifyWhatsAppIdentityMatches(await fetchWhatsAppIdentityMatchSet(candidates))
  } catch {
    console.error("Unable to resolve WhatsApp sender identity.")
    return { status: "not_found" }
  }
}

/**
 * Resolves only a safe SVC identity for an inbound WhatsApp sender, returning
 * `null` for a missing OR genuinely ambiguous match — see
 * {@link resolveWhatsAppSenderIdentityDetailed} for callers that need to tell
 * those two apart (e.g. to ask a genuinely ambiguous sender to disambiguate).
 */
export async function resolveWhatsAppSenderIdentity(phoneNumber: string): Promise<WhatsAppSenderIdentity | null> {
  const result = await resolveWhatsAppSenderIdentityDetailed(phoneNumber)
  return result.status === "resolved" ? result.identity : null
}

/**
 * Best-effort, idempotent self-healing: once a FALLBACK-tier resolution
 * proves a phone number belongs to exactly one registered user, record it
 * directly on `/users` so the next message resolves through the strongest
 * (explicit) tier without depending on Directory contact hygiene at all.
 * Never overwrites an existing `/users.phone`. Failures are swallowed — this
 * is an optimization, never load-bearing for the current turn's identity,
 * which was already fully resolved before this is called.
 */
export async function backfillUserPhoneFromInboundWhatsApp(userId: string, inboundPhoneNumber: string): Promise<void> {
  try {
    const db = await getAdminDb()
    const userRef = db.collection("users").doc(userId)
    const snapshot = await userRef.get()
    const existing = snapshot.data() as RecordValue | undefined
    if (existing?.phone) return

    const { FieldValue } = await import("firebase-admin/firestore")
    await userRef.set(
      {
        phone: inboundPhoneNumber,
        phoneNormalized: normalizePhoneDigits(inboundPhoneNumber),
        phoneSource: "whatsapp-self-heal",
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
  } catch {
    console.error("Unable to self-heal /users.phone from an inbound WhatsApp message.")
  }
}
