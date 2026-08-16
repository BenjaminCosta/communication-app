#!/usr/bin/env tsx
/**
 * Backfills /users.phone + /users.phoneNormalized so a registered account's
 * own phone moves into the "explicit" trust tier
 * (lib/whatsapp-svc-identity.ts) directly, closing the gap the 2026-08-16
 * audit found: real signup never asks for a phone number, so /users has
 * essentially none today.
 *
 * Two phases, tried in order for each /users/{uid} that has no phone yet:
 *
 *   Phase 1 — linked contact. Contacts with linkedUserId === uid and a
 *   phone. If they all agree on one phone, backfill it
 *   (phoneSource: "directory-linked-contact").
 *
 *   Phase 2 — email match (only for users Phase 1 found nothing for, i.e.
 *   they have NO linked contact at all). Matches users.emailNormalized to
 *   contacts.emailNormalized. If exactly one contact matches and it has a
 *   phone, backfill it (phoneSource: "directory-email-match") — and, if that
 *   contact currently has no linkedUserId, also fix the contact's
 *   linkedUserId to close the loop for next time.
 *
 * Either phase SKIPS (never guesses) whenever its own match is not unique:
 * multiple linked contacts disagreeing on phone, multiple contacts sharing
 * an email, or an email match already linked to a DIFFERENT user. Those are
 * reported as conflicts for a human to resolve, never auto-picked.
 *
 * DRY RUN BY DEFAULT — prints what it would write and makes no changes.
 * Set CONFIRM_PHONE_BACKFILL=true to actually write.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json pnpm backfill:user-phone:dry
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json CONFIRM_PHONE_BACKFILL=true pnpm backfill:user-phone
 */
import { FieldValue, getFirestore } from "firebase-admin/firestore"
import { getFirebaseAdminApp } from "@/lib/ai/server/firebase-admin"
import { normalizePhoneDigits } from "@/lib/phone-normalization"

const CONFIRMED = process.env.CONFIRM_PHONE_BACKFILL === "true"

function mask(phone: string): string {
  return phone.length >= 5 ? `${phone.slice(0, 3)}***${phone.slice(-2)}` : "***"
}

type ContactRow = {
  id: string
  linkedUserId: string | null
  emailNormalized: string | null
  rawPhone: string | null
  phoneNormalized: string | null
}

type Plan = {
  userId: string
  phone: string
  phoneNormalized: string
  phoneSource: "directory-linked-contact" | "directory-email-match"
  /** Set only for phase 2, when the matched contact should also be linked back. */
  linkContactId?: string
}

async function main(): Promise<void> {
  const db = getFirestore(await getFirebaseAdminApp())
  const [contactsSnapshot, usersSnapshot] = await Promise.all([db.collection("contacts").get(), db.collection("users").get()])

  const contacts: ContactRow[] = contactsSnapshot.docs.map((doc) => {
    const data = doc.data() as Record<string, unknown>
    const rawPhone = typeof data.phone === "string" && data.phone ? data.phone : null
    return {
      id: doc.id,
      linkedUserId: typeof data.linkedUserId === "string" && data.linkedUserId ? data.linkedUserId : null,
      emailNormalized: typeof data.emailNormalized === "string" && data.emailNormalized ? data.emailNormalized : null,
      rawPhone,
      phoneNormalized: typeof data.phoneNormalized === "string" && data.phoneNormalized ? data.phoneNormalized : (rawPhone ? normalizePhoneDigits(rawPhone) : null),
    }
  })
  const contactsByLinkedUserId = new Map<string, ContactRow[]>()
  const contactsByEmail = new Map<string, ContactRow[]>()
  for (const contact of contacts) {
    if (contact.linkedUserId) {
      contactsByLinkedUserId.set(contact.linkedUserId, [...(contactsByLinkedUserId.get(contact.linkedUserId) ?? []), contact])
    }
    if (contact.emailNormalized) {
      contactsByEmail.set(contact.emailNormalized, [...(contactsByEmail.get(contact.emailNormalized) ?? []), contact])
    }
  }

  const plans: Plan[] = []
  let alreadyHasPhone = 0
  let phase1Conflicts = 0
  let phase2Conflicts = 0
  let notFound = 0

  for (const userDoc of usersSnapshot.docs) {
    const data = userDoc.data() as Record<string, unknown>
    if (data.phone) {
      alreadyHasPhone++
      continue
    }
    const userId = userDoc.id
    const linkedContacts = (contactsByLinkedUserId.get(userId) ?? []).filter((c) => c.rawPhone)

    if (linkedContacts.length > 0) {
      const distinctNormalized = new Set(linkedContacts.map((c) => c.phoneNormalized))
      if (distinctNormalized.size > 1) {
        phase1Conflicts++
        console.log(`PHASE 1 CONFLICT user ${userId}: linked contacts disagree on phone (${[...distinctNormalized].map((p) => mask(p ?? "")).join(", ")}).`)
        continue
      }
      const chosen = linkedContacts[0]
      plans.push({ userId, phone: chosen.rawPhone!, phoneNormalized: chosen.phoneNormalized!, phoneSource: "directory-linked-contact" })
      continue
    }

    // Phase 2 — only reached when this user has NO linked contact at all.
    const emailNormalized = typeof data.emailNormalized === "string" && data.emailNormalized ? data.emailNormalized : null
    const emailMatches = emailNormalized ? (contactsByEmail.get(emailNormalized) ?? []) : []
    if (emailMatches.length > 1) {
      phase2Conflicts++
      console.log(`PHASE 2 CONFLICT user ${userId}: email ${emailNormalized} matches ${emailMatches.length} contacts — ambiguous.`)
      continue
    }
    const emailMatch = emailMatches[0]
    if (!emailMatch || !emailMatch.rawPhone) {
      notFound++
      continue
    }
    if (emailMatch.linkedUserId && emailMatch.linkedUserId !== userId) {
      phase2Conflicts++
      console.log(`PHASE 2 CONFLICT user ${userId}: matching contact ${emailMatch.id} is already linked to a different user (${emailMatch.linkedUserId}).`)
      continue
    }
    plans.push({
      userId,
      phone: emailMatch.rawPhone,
      phoneNormalized: emailMatch.phoneNormalized!,
      phoneSource: "directory-email-match",
      ...(emailMatch.linkedUserId ? {} : { linkContactId: emailMatch.id }),
    })
  }

  for (const plan of plans) {
    const linkNote = plan.linkContactId ? ` (also linking contact ${plan.linkContactId}.linkedUserId)` : ""
    console.log(`${CONFIRMED ? "WRITE" : "WOULD WRITE"} user ${plan.userId}: phone=${mask(plan.phoneNormalized)} source=${plan.phoneSource}${linkNote}`)
  }

  console.log("")
  console.log(`Users already with a phone (skipped): ${alreadyHasPhone}`)
  console.log(`Phase 1 (linked contact) eligible: ${plans.filter((p) => p.phoneSource === "directory-linked-contact").length}`)
  console.log(`Phase 1 conflicts (multiple disagreeing phones): ${phase1Conflicts}`)
  console.log(`Phase 2 (email match) eligible: ${plans.filter((p) => p.phoneSource === "directory-email-match").length}`)
  console.log(`Phase 2 conflicts (ambiguous or already linked elsewhere): ${phase2Conflicts}`)
  console.log(`Not found (no linked contact, no email match with a phone): ${notFound}`)
  console.log(`TOTAL eligible for backfill with certainty: ${plans.length}`)

  if (!CONFIRMED) {
    console.log("\nDry run only — set CONFIRM_PHONE_BACKFILL=true to write.")
    return
  }

  for (const plan of plans) {
    await db.collection("users").doc(plan.userId).set(
      {
        phone: plan.phone,
        phoneNormalized: plan.phoneNormalized,
        phoneSource: plan.phoneSource,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
    if (plan.linkContactId) {
      await db.collection("contacts").doc(plan.linkContactId).set(
        { linkedUserId: plan.userId, status: "registered", updatedAt: FieldValue.serverTimestamp() },
        { merge: true },
      )
    }
  }
  console.log(`\nWrote phone/phoneNormalized for ${plans.length} user(s), linked ${plans.filter((p) => p.linkContactId).length} contact(s).`)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Backfill failed:", error)
    process.exit(1)
  })
