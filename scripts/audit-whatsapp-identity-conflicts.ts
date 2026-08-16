#!/usr/bin/env tsx
/**
 * READ-ONLY. Reports every phone number in /contacts and /users that still
 * cannot be resolved to a unique WhatsApp identity after the 2026-08-16
 * duplicate-contact fix — i.e. two or more DIFFERENT registered accounts
 * sharing a number, or two or more unlinked contacts with no registered
 * account among them to break the tie. Those need human data cleanup; the
 * code fix (lib/whatsapp-svc-identity.ts) already resolves everything else
 * (a single linked contact plus any number of unlinked duplicates).
 *
 * Reuses resolveWhatsAppIdentityFromMatches directly — the exact function
 * production calls — so this audit can never silently drift from what the
 * WhatsApp Secretary actually does.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json pnpm audit:whatsapp-identity
 */
import { getFirestore } from "firebase-admin/firestore"
import { getFirebaseAdminApp } from "@/lib/ai/server/firebase-admin"
import { resolveWhatsAppIdentityFromMatches, type WhatsAppIdentityDocument } from "@/lib/whatsapp-svc-identity"

function mask(phone: string): string {
  return phone.length >= 5 ? `${phone.slice(0, 3)}***${phone.slice(-2)}` : "***"
}

async function main(): Promise<void> {
  const db = getFirestore(await getFirebaseAdminApp())
  const [contactsSnapshot, usersSnapshot] = await Promise.all([db.collection("contacts").get(), db.collection("users").get()])

  const contactsByPhone = new Map<string, WhatsAppIdentityDocument[]>()
  const contactsByWhatsApp = new Map<string, WhatsAppIdentityDocument[]>()
  for (const doc of contactsSnapshot.docs) {
    const data = doc.data() as Record<string, unknown>
    const entry: WhatsAppIdentityDocument = { id: doc.id, data }
    if (typeof data.phoneNormalized === "string" && data.phoneNormalized) {
      contactsByPhone.set(data.phoneNormalized, [...(contactsByPhone.get(data.phoneNormalized) ?? []), entry])
    }
    if (typeof data.whatsappPhoneNormalized === "string" && data.whatsappPhoneNormalized) {
      contactsByWhatsApp.set(data.whatsappPhoneNormalized, [...(contactsByWhatsApp.get(data.whatsappPhoneNormalized) ?? []), entry])
    }
  }

  const usersByPhone = new Map<string, WhatsAppIdentityDocument[]>()
  const usersByWhatsApp = new Map<string, WhatsAppIdentityDocument[]>()
  for (const doc of usersSnapshot.docs) {
    const data = doc.data() as Record<string, unknown>
    const entry: WhatsAppIdentityDocument = { id: doc.id, data }
    if (typeof data.phoneNormalized === "string" && data.phoneNormalized) {
      usersByPhone.set(data.phoneNormalized, [...(usersByPhone.get(data.phoneNormalized) ?? []), entry])
    }
    if (typeof data.whatsappPhoneNormalized === "string" && data.whatsappPhoneNormalized) {
      usersByWhatsApp.set(data.whatsappPhoneNormalized, [...(usersByWhatsApp.get(data.whatsappPhoneNormalized) ?? []), entry])
    }
  }

  const allPhones = new Set([...contactsByPhone.keys(), ...contactsByWhatsApp.keys(), ...usersByPhone.keys(), ...usersByWhatsApp.keys()])

  let resolvable = 0
  let stillAmbiguous = 0
  const silencedWarnings = console.warn
  console.warn = () => {} // resolveWhatsAppIdentityFromMatches logs per-call; this audit prints its own summary instead
  for (const phone of allPhones) {
    const matches = {
      contactsByPhone: contactsByPhone.get(phone) ?? [],
      contactsByWhatsApp: contactsByWhatsApp.get(phone) ?? [],
      usersByPhone: usersByPhone.get(phone) ?? [],
      usersByWhatsApp: usersByWhatsApp.get(phone) ?? [],
    }
    const totalDocs = matches.contactsByPhone.length + matches.contactsByWhatsApp.length + matches.usersByPhone.length + matches.usersByWhatsApp.length
    if (totalDocs < 2) continue // nothing to disambiguate

    const identity = resolveWhatsAppIdentityFromMatches(matches)
    if (identity) {
      resolvable++
      continue
    }
    stillAmbiguous++
    console.log(`AMBIGUOUS ${mask(phone)}:`)
    for (const doc of [...matches.contactsByPhone, ...matches.contactsByWhatsApp]) {
      const data = doc.data as Record<string, unknown>
      console.log(`  contact ${doc.id}: "${data.name}" linkedUserId=${data.linkedUserId ?? "null"}`)
    }
    for (const doc of [...matches.usersByPhone, ...matches.usersByWhatsApp]) {
      const data = doc.data as Record<string, unknown>
      console.log(`  user ${doc.id}: "${data.name}"`)
    }
  }
  console.warn = silencedWarnings

  console.log("")
  console.log(`Phone numbers shared by 2+ docs: ${resolvable + stillAmbiguous}`)
  console.log(`  Resolved to a unique identity (fixed by the code change, no action needed): ${resolvable}`)
  console.log(`  Still genuinely ambiguous (needs manual data cleanup): ${stillAmbiguous}`)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Audit failed:", error)
    process.exit(1)
  })
