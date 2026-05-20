#!/usr/bin/env node
/**
 * backfill-emails.mjs
 *
 * One-time script: copies Firebase Auth emails → Firestore /users/{uid}.email
 * for all existing users whose Firestore doc is missing the email field.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node scripts/backfill-emails.mjs
 */

import { initializeApp, cert } from "firebase-admin/app"
import { getAuth } from "firebase-admin/auth"
import { getFirestore } from "firebase-admin/firestore"
import { existsSync, readFileSync } from "fs"

const saPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
if (!saPath || !existsSync(saPath)) {
  console.error("ERROR: Set GOOGLE_APPLICATION_CREDENTIALS to your service account JSON path.")
  console.error("  Example: GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node scripts/backfill-emails.mjs")
  process.exit(1)
}

const serviceAccount = JSON.parse(readFileSync(saPath, "utf8"))

initializeApp({ credential: cert(serviceAccount) })

const auth = getAuth()
const db = getFirestore()

let updated = 0
let skipped = 0
let pageToken = undefined

console.log("Starting email backfill…")

do {
  const result = await auth.listUsers(1000, pageToken)

  for (const user of result.users) {
    if (!user.email) { skipped++; continue }

    const ref = db.collection("users").doc(user.uid)
    const snap = await ref.get()

    if (!snap.exists) { skipped++; continue }

    const existing = snap.data()
    if (existing.email === user.email) { skipped++; continue }

    await ref.update({ email: user.email })
    console.log(`  ✓ ${user.email} → uid ${user.uid}`)
    updated++
  }

  pageToken = result.pageToken
} while (pageToken)

console.log(`\nDone. Updated: ${updated}, Skipped: ${skipped}`)
process.exit(0)
