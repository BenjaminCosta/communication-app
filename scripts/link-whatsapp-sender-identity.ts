#!/usr/bin/env tsx
import { FieldValue, getFirestore } from "firebase-admin/firestore"
import { getFirebaseAdminApp } from "@/lib/ai/server/firebase-admin"
import { phoneLookupCandidates } from "@/lib/phone-normalization"

const CONFIRMATION = "true"

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required.`)
  return value
}

function normalizedEmail(value: string): string {
  return value.trim().toLocaleLowerCase()
}

function phoneDigits(value: unknown): string {
  return typeof value === "string" ? value.replace(/\D/g, "") : ""
}

function contactContainsPhone(data: Record<string, unknown>, candidates: Set<string>): boolean {
  const phones = Array.isArray(data.phones) ? data.phones : []
  const masterData = typeof data.masterData === "object" && data.masterData !== null ? data.masterData as Record<string, unknown> : {}
  const masterPhones = Array.isArray(masterData.phones) ? masterData.phones : []
  const storedValues = [
    data.phone,
    data.phoneNormalized,
    data.whatsappPhoneNormalized,
    masterData.primaryPhone,
    ...phones.flatMap((point) => {
      const record = typeof point === "object" && point !== null ? point as Record<string, unknown> : {}
      return [record.normalized, record.value]
    }),
    ...masterPhones,
  ]

  return storedValues.map(phoneDigits).some((phone) => candidates.has(phone))
}

async function main(): Promise<void> {
  if (process.env.CONFIRM_WHATSAPP_IDENTITY_LINK !== CONFIRMATION) {
    throw new Error("Set CONFIRM_WHATSAPP_IDENTITY_LINK=true to link an existing SVC user to a WhatsApp number.")
  }

  const email = normalizedEmail(requiredEnvironment("SVC_IDENTITY_USER_EMAIL"))
  const phoneCandidates = phoneLookupCandidates(requiredEnvironment("SVC_WHATSAPP_PHONE"))
  if (phoneCandidates.length === 0) throw new Error("SVC_WHATSAPP_PHONE is not a valid phone number.")

  const db = getFirestore(await getFirebaseAdminApp())
  const userSnapshot = await db.collection("users").where("emailNormalized", "==", email).limit(2).get()
  if (userSnapshot.size !== 1) {
    throw new Error(`Expected exactly one SVC user for the supplied email; found ${userSnapshot.size}.`)
  }

  const userDocument = userSnapshot.docs[0]
  const [userWhatsAppSnapshot, userPhoneSnapshot, contactPhoneSnapshot, contactWhatsAppSnapshot, allContacts] = await Promise.all([
    db.collection("users").where("whatsappPhoneNormalized", "in", phoneCandidates).get(),
    // Also guard against a number already claimed as someone ELSE's own
    // registered profile phone (`/users.phoneNormalized`) — that field is
    // now part of the explicit/trusted resolution tier too, so linking a
    // WhatsApp number that collides with it would create exactly the kind
    // of trusted-tier ambiguity the resolver is designed to refuse.
    db.collection("users").where("phoneNormalized", "in", phoneCandidates).get(),
    db.collection("contacts").where("phoneNormalized", "in", phoneCandidates).get(),
    db.collection("contacts").where("whatsappPhoneNormalized", "in", phoneCandidates).get(),
    db.collection("contacts").select("phone", "phoneNormalized", "whatsappPhoneNormalized", "phones", "masterData.phones", "masterData.primaryPhone").get(),
  ])

  const conflictingUserIds = [...userWhatsAppSnapshot.docs, ...userPhoneSnapshot.docs]
    .map((document) => document.id)
    .filter((id) => id !== userDocument.id)
  const candidateSet = new Set(phoneCandidates)
  const conflictingContactIds = new Set(
    [
      ...contactPhoneSnapshot.docs,
      ...contactWhatsAppSnapshot.docs,
      ...allContacts.docs.filter((document) => contactContainsPhone(document.data(), candidateSet)),
    ].map((document) => document.id),
  )

  if (conflictingUserIds.length > 0 || conflictingContactIds.size > 0) {
    throw new Error("The supplied WhatsApp number is already associated with another SVC record; no changes were made.")
  }

  await userDocument.ref.set(
    {
      whatsappPhoneNormalized: phoneCandidates[0],
      whatsappIdentityLinkedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  )

  console.info("Existing SVC user linked to WhatsApp identity without creating a contact.")
}

main().catch((error) => {
  console.error("WhatsApp identity link failed:", error instanceof Error ? error.message : error)
  process.exitCode = 1
})
