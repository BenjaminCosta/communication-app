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
   * Coarse trust bucket, kept as a stable two-value contract because it is
   * persisted (Courtney Roberts Center conversation docs) and drives the
   * self-heal branch in the webhook. `"explicit"` covers the two strong tiers
   * (a deliberate WhatsApp link, or the account holder's own registered
   * profile phone); `"fallback"` means it was only found via a Directory
   * contact's general `phoneNormalized`, which can be imported/unverified
   * data and, per person, duplicated across several contact records. Purely
   * informational; never changes what the sender is authorized to do.
   * Optional — absent on identities built by hand (tests, other call sites)
   * rather than by {@link resolveWhatsAppSenderIdentity} itself.
   */
  resolvedVia?: "explicit" | "fallback"
  /**
   * Which of the three tiers actually matched — see
   * {@link classifyWhatsAppIdentityMatches}. Strictly for logging and audit
   * output; {@link resolvedVia} remains the field anything else keys off.
   */
  resolvedTier?: IdentityTier
  /**
   * `/contacts` id found by following this identity's `userId` back through
   * `linkedUserId`, when the tier that matched only produced a `/users` doc.
   * Set by {@link resolveWhatsAppSenderIdentityDetailed}, never by the pure
   * classifier — see {@link mergeLinkedContactIntoIdentity}.
   */
  linkedContactId?: string
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

function contactIdentityFromDocument(id: string, data: unknown): Omit<WhatsAppSenderIdentity, "resolvedVia" | "resolvedTier"> | null {
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

function userIdentityFromDocument(userId: string, data: unknown): Omit<WhatsAppSenderIdentity, "resolvedVia" | "resolvedTier"> | null {
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

/**
 * The three trust tiers, strongest first.
 *
 * `"whatsapp-link"` exists as its own tier — above `"registered-phone"` —
 * specifically so the identity-claim flow (`lib/whatsapp-identity-claim.ts`)
 * can always break a tie. Before this split, a claim wrote
 * `/users.whatsappPhoneNormalized` into the SAME tier as the
 * `/users.phoneNormalized` docs that caused the ambiguity, so linking could
 * not resolve it: the next message re-resolved as ambiguous and the Secretary
 * asked for the email again, forever. A deliberate WhatsApp link is now the
 * single strongest statement about who owns a number, which makes claiming
 * self-terminating by construction.
 */
export type IdentityTier = "whatsapp-link" | "registered-phone" | "directory-phone"

/** Coarse bucket persisted as {@link WhatsAppSenderIdentity.resolvedVia}. */
function trustBucketForTier(tier: IdentityTier): "explicit" | "fallback" {
  return tier === "directory-phone" ? "fallback" : "explicit"
}

/** One matched document, tagged with the trust tier its query implies. */
type IdentityCandidate = {
  tier: IdentityTier
  /** Real-identity grouping key: `user:{uid}` when the match is tied to a
   * registered account (directly, or via a contact's `linkedUserId`),
   * otherwise `person:{contactId}` — an identity Firestore has no way to
   * confirm is a real, singular person. */
  key: string
  identity: Omit<WhatsAppSenderIdentity, "resolvedVia" | "resolvedTier">
}

function candidateFromContactDoc(tier: IdentityTier, doc: WhatsAppIdentityDocument): IdentityCandidate | null {
  const identity = contactIdentityFromDocument(doc.id, doc.data)
  if (!identity) return null
  return { tier, key: identity.userId ? `user:${identity.userId}` : `person:${identity.personId}`, identity }
}

function candidateFromUserDoc(tier: IdentityTier, doc: WhatsAppIdentityDocument): IdentityCandidate | null {
  const identity = userIdentityFromDocument(doc.id, doc.data)
  if (!identity) return null
  return { tier, key: `user:${identity.userId}`, identity }
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
 * Comparison form for deciding whether two unlinked contact records are the
 * same person. Deliberately strict — case, accents, punctuation and spacing
 * only. It must never merge "Charlie Santoro" with "CHARLES SANTORE", or
 * "Greme Cooper" with "graeme cooper": those are a nickname and a typo, and
 * guessing at them is exactly the kind of inference this resolver refuses to
 * make.
 */
function personNameKey(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

/**
 * Collapses unlinked contact records that are plainly the SAME person.
 *
 * A production audit (2026-08-18) found 59 phone numbers the resolver could
 * not settle, and 34 of them were one person duplicated across contact
 * records — the same normalized name on an operational-import doc
 * (`op_person_*`), a master-import doc (`usr_*`) and/or a hand-added one, all
 * with `linkedUserId: null`. Treating those as competing claims meant real
 * employees were told "I found more than one SVC profile" about themselves.
 *
 * Only applied to UNLINKED candidates, and only when EVERY one of them
 * normalizes to the same name. Two different registered accounts sharing a
 * number stay a genuine conflict — merging those would pick an arbitrary uid
 * to act as, which is a much stronger claim than picking which of several
 * copies of one Directory record to anchor to.
 *
 * The survivor is chosen deterministically (a record carrying a role first,
 * then lowest id) so the same number always resolves to the same personId
 * and the Center/self-context stay stable across turns.
 */
function collapseDuplicatePersonRecords(unlinked: IdentityCandidate[]): IdentityCandidate[] {
  if (unlinked.length < 2) return unlinked
  if (new Set(unlinked.map((candidate) => personNameKey(candidate.identity.name))).size !== 1) return unlinked

  const survivor = [...unlinked].sort((a, b) => {
    if (Boolean(a.identity.role) !== Boolean(b.identity.role)) return a.identity.role ? -1 : 1
    return a.identity.personId.localeCompare(b.identity.personId)
  })[0]
  console.info("Collapsed duplicate Directory contact records for one person", { copies: unlinked.length })
  return [survivor]
}

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
 * as does two or more unlinked contacts naming DIFFERENT people with no
 * registered account among them to break the tie. Unlinked duplicates of the
 * SAME person are collapsed first; see
 * {@link collapseDuplicatePersonRecords}.
 */
function resolveTier(matches: IdentityCandidate[]): TierResult {
  if (matches.length === 0) return { status: "empty" }

  const merged = mergeByKey(matches)
  const linked = merged.filter((m) => m.identity.userId)
  if (linked.length === 1) return { status: "resolved", candidate: linked[0] }
  if (linked.length > 1) return { status: "ambiguous", matchCount: linked.length }

  const unlinked = collapseDuplicatePersonRecords(merged.filter((m) => !m.identity.userId))
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
 * document each query matched and applies the unique-real-identity rule of
 * {@link resolveTier} to each {@link IdentityTier} in turn, strongest first:
 *
 * 1. **`whatsapp-link`** — `/users.whatsappPhoneNormalized` or
 *    `/contacts.whatsappPhoneNormalized`. Someone (an admin, or the sender
 *    themselves through the claim flow) deliberately stated that this number
 *    belongs to this person.
 * 2. **`registered-phone`** — `/users.phoneNormalized`, the account holder's
 *    own registered profile phone. Strong, but self-reported at signup and
 *    genuinely duplicable (several employees can register one office number).
 * 3. **`directory-phone`** — `/contacts.phoneNormalized`, general
 *    imported/unverified Directory data.
 *
 * A weaker tier is consulted ONLY when every stronger one found nothing at
 * all — never to break a stronger tier's ambiguity, and never blended with
 * it. A conflict within a tier (two different accounts both claiming the
 * number at the same strength) stays unresolved rather than being quietly
 * overridden by a weaker signal.
 *
 * The tier-1/tier-2 split is what makes {@link resolveIdentityClaim}'s link
 * actually stick: writing `whatsappPhoneNormalized` now lands strictly above
 * whatever caused the ambiguity, so the very next message resolves.
 */
export function classifyWhatsAppIdentityMatches(matches: WhatsAppIdentityMatchSet): WhatsAppIdentityResolution {
  const tiers: Array<{ tier: IdentityTier; candidates: IdentityCandidate[] }> = [
    {
      tier: "whatsapp-link",
      candidates: [
        ...matches.contactsByWhatsApp.map((doc) => candidateFromContactDoc("whatsapp-link", doc)),
        ...matches.usersByWhatsApp.map((doc) => candidateFromUserDoc("whatsapp-link", doc)),
      ].filter((c): c is IdentityCandidate => c !== null),
    },
    {
      tier: "registered-phone",
      candidates: matches.usersByPhone.map((doc) => candidateFromUserDoc("registered-phone", doc)).filter((c): c is IdentityCandidate => c !== null),
    },
    {
      tier: "directory-phone",
      candidates: matches.contactsByPhone.map((doc) => candidateFromContactDoc("directory-phone", doc)).filter((c): c is IdentityCandidate => c !== null),
    },
  ]

  for (const { tier, candidates } of tiers) {
    const result = resolveTier(candidates)
    if (result.status === "resolved") {
      return {
        status: "resolved",
        identity: { ...result.candidate.identity, resolvedVia: trustBucketForTier(tier), resolvedTier: tier },
      }
    }
    if (result.status === "ambiguous") {
      console.warn("WhatsApp sender identity was ambiguous", { tier, matchCount: result.matchCount })
      return { status: "ambiguous" }
    }
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
 * Follows a resolved account back to its Directory record.
 *
 * The phone queries above are one-directional: `/contacts.linkedUserId`
 * points at `/users`, never the reverse. So an identity that matched only a
 * `/users` document carried `personId: "user:<uid>"`, and every Directory-side
 * read keyed off that personId came back empty — `contactIdFromPersonId()` in
 * `lib/whatsapp-secretary/self-context.ts` returns null for it. The result was
 * backwards: the STRONGEST tiers produced the POOREST context ("Directory
 * profile: none linked" for someone with a perfectly good Directory record,
 * simply because their contact's phone was stored differently or not at all).
 *
 * Pure so the "exactly one, and only when we don't already have a contact"
 * rule is unit-testable. Ambiguity is declined, never guessed: two contacts
 * claiming the same `linkedUserId` leave the identity exactly as it was.
 */
export function mergeLinkedContactIntoIdentity(identity: WhatsAppSenderIdentity, contactDocs: WhatsAppIdentityDocument[]): WhatsAppSenderIdentity {
  if (!identity.personId.startsWith("user:")) return identity

  const usable = contactDocs
    .map((doc) => contactIdentityFromDocument(doc.id, doc.data))
    .filter((contact): contact is NonNullable<typeof contact> => contact !== null)
  if (usable.length !== 1) return identity

  const contact = usable[0]
  return {
    ...identity,
    // The Directory record becomes the person identifier, which is what every
    // Directory-side read needs. The registered account's own name stays
    // authoritative — it is what this person typed about themselves — while a
    // role only Directory knows is filled in rather than left blank.
    personId: contact.personId,
    linkedContactId: contact.personId,
    role: identity.role ?? contact.role,
  }
}

/** Reads the `/contacts` docs pointing back at a registered account. Bounded
 * at 2 because anything past "exactly one" is declined anyway. */
async function fetchContactsLinkedToUser(userId: string): Promise<WhatsAppIdentityDocument[]> {
  const db = await getAdminDb()
  const snapshot = await db.collection("contacts").where("linkedUserId", "==", userId).limit(2).get()
  return snapshot.docs.map((document) => ({ id: document.id, data: document.data() }))
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

  let resolution: WhatsAppIdentityResolution
  try {
    resolution = classifyWhatsAppIdentityMatches(await fetchWhatsAppIdentityMatchSet(candidates))
  } catch {
    console.error("Unable to resolve WhatsApp sender identity.")
    return { status: "not_found" }
  }

  return resolution.status === "resolved" ? { status: "resolved", identity: await withLinkedDirectoryContact(resolution.identity) } : resolution
}

/**
 * Best-effort Directory enrichment for an already-resolved identity. A
 * failure degrades to the un-enriched identity — the sender is still
 * recognized, they just keep the thinner `user:<uid>` person id for this turn.
 */
export async function withLinkedDirectoryContact(identity: WhatsAppSenderIdentity): Promise<WhatsAppSenderIdentity> {
  if (!identity.userId || !identity.personId.startsWith("user:")) return identity
  try {
    return mergeLinkedContactIntoIdentity(identity, await fetchContactsLinkedToUser(identity.userId))
  } catch {
    console.warn("Unable to look up the Directory contact linked to a resolved WhatsApp identity.")
    return identity
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
