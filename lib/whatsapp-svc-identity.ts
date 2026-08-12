import type { Firestore } from "firebase-admin/firestore"
import { getFirebaseAdminApp } from "@/lib/ai/server/firebase-admin"

type RecordValue = Record<string, unknown>

export type WhatsAppSenderIdentity = {
  personId: string
  userId?: string
  name: string
  role?: string
}

type ContactIdentityMatch = WhatsAppSenderIdentity
type UserIdentityMatch = WhatsAppSenderIdentity

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

/**
 * Produces exact phone values used by SVC contact imports without falling back
 * to suffix matching. The latter could incorrectly join two people.
 */
export function whatsappPhoneLookupCandidates(phoneNumber: string): string[] {
  const digits = phoneNumber.replace(/\D/g, "")
  if (digits.length < 7) return []

  const candidates = new Set([digits])
  // WhatsApp supplies Argentine mobile numbers as 54 + 9 + local number,
  // while imported contacts can store either of the local variants.
  if (digits.startsWith("54")) candidates.add(digits.slice(2))
  if (digits.startsWith("549")) candidates.add(digits.slice(3))
  // Preserve the existing SVC phone-normalization convention for US numbers.
  if (digits.length === 11 && digits.startsWith("1")) candidates.add(digits.slice(1))

  return [...candidates].filter((candidate) => candidate.length >= 7 && candidate.length <= 15)
}

function contactIdentityFromDocument(id: string, data: unknown): ContactIdentityMatch | null {
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

function userIdentityFromDocument(userId: string, data: unknown): UserIdentityMatch | null {
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

function uniqueIdentityMatches(matches: WhatsAppSenderIdentity[]): WhatsAppSenderIdentity[] {
  const byKey = new Map<string, WhatsAppSenderIdentity>()
  for (const match of matches) {
    const key = match.userId ? `user:${match.userId}` : `person:${match.personId}`
    const existing = byKey.get(key)
    byKey.set(key, {
      ...existing,
      ...match,
      // Prefer the contact id as the future person identifier while retaining
      // the user id that allows later authorization-aware work.
      personId: match.personId.startsWith("user:") ? existing?.personId ?? match.personId : match.personId,
      role: match.role ?? existing?.role,
    })
  }
  return [...byKey.values()]
}

/**
 * Resolves only a safe, exact contact identity for an inbound WhatsApp sender.
 * It intentionally never reads messages, Directory projections, or private
 * contact fields, and returns null for missing or ambiguous matches.
 */
export async function resolveWhatsAppSenderIdentity(phoneNumber: string): Promise<WhatsAppSenderIdentity | null> {
  const candidates = whatsappPhoneLookupCandidates(phoneNumber)
  if (candidates.length === 0) return null

  try {
    const db = await getAdminDb()
    const [contactPhoneSnapshot, contactWhatsAppSnapshot, userSnapshot] = await Promise.all([
      db.collection("contacts").where("phoneNormalized", "in", candidates).get(),
      db.collection("contacts").where("whatsappPhoneNormalized", "in", candidates).get(),
      db.collection("users").where("whatsappPhoneNormalized", "in", candidates).get(),
    ])
    const contactMatches = [...contactPhoneSnapshot.docs, ...contactWhatsAppSnapshot.docs]
      .map((document) => contactIdentityFromDocument(document.id, document.data()))
      .filter((match): match is ContactIdentityMatch => match !== null)
    const userMatches = userSnapshot.docs
      .map((document) => userIdentityFromDocument(document.id, document.data()))
      .filter((match): match is UserIdentityMatch => match !== null)
    const matches = uniqueIdentityMatches([...contactMatches, ...userMatches])

    if (matches.length === 0) {
      return null
    }

    if (matches.length > 1) {
      console.warn("WhatsApp sender identity was ambiguous", { matchCount: matches.length })
      return null
    }

    return matches[0]
  } catch {
    console.error("Unable to resolve WhatsApp sender identity.")
    return null
  }
}
