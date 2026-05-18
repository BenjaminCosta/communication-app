#!/usr/bin/env node
/**
 * export-prod-to-emulator.mjs
 *
 * Safely copies production Firebase Auth + Firestore data into the local emulator.
 * Production is READ-ONLY — this script never writes to production.
 *
 * Prerequisites:
 *   1. Download service account key from Firebase Console:
 *      Project Settings → Service accounts → Generate new private key
 *      Save as: ./service-account.json  (already gitignored)
 *
 *   2. Install firebase-admin (one time):
 *      pnpm add -D firebase-admin
 *
 *   3. Start emulators first (in a separate terminal):
 *      pnpm emulator:clean
 *
 * Usage:
 *   pnpm emulator:export
 *   (or: GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node scripts/export-prod-to-emulator.mjs)
 *
 * What this does:
 *   - Reads all Auth users from production
 *   - Reads: users, projects, messages collections from production Firestore
 *   - Creates matching Auth users in emulator with password "emulator123"
 *   - Writes all Firestore docs to emulator (overwrites existing emulator data)
 *   - NEVER touches production
 */

import { initializeApp, cert } from "firebase-admin/app"
import { getAuth } from "firebase-admin/auth"
import { getFirestore } from "firebase-admin/firestore"
import { existsSync, readFileSync } from "fs"

const PROJECT_ID = "svc-comms"
const COLLECTIONS = ["users", "projects", "messages"]
const EMULATOR_AUTH_HOST = "localhost:9099"
const EMULATOR_FIRESTORE_HOST = "localhost:8080"
const EMULATOR_PASSWORD = "emulator123"

// ── Validate service account ─────────────────────────────────────────────────

const saPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
if (!saPath || !existsSync(saPath)) {
  console.error("")
  console.error("ERROR: Service account key not found.")
  console.error("  Set GOOGLE_APPLICATION_CREDENTIALS to the path of your service account JSON.")
  console.error("  Example: GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node scripts/export-prod-to-emulator.mjs")
  console.error("")
  console.error("  To get the key: Firebase Console → Project Settings → Service accounts → Generate new private key")
  console.error("")
  process.exit(1)
}

let serviceAccount
try {
  serviceAccount = JSON.parse(readFileSync(saPath, "utf8"))
} catch (err) {
  console.error(`ERROR: Could not parse service account JSON at ${saPath}: ${err.message}`)
  process.exit(1)
}

// ── STEP 1: Initialize production app and read ALL data ──────────────────────
// NO emulator env vars set at this point — all reads go to real Firebase.

const prodApp = initializeApp({ credential: cert(serviceAccount), projectId: PROJECT_ID }, "prod")
const prodAuth = getAuth(prodApp)
const prodDb = getFirestore(prodApp)

console.log("")
console.log("══════════════════════════════════════════════")
console.log("  SVC Comms — Production → Emulator Export")
console.log("══════════════════════════════════════════════")
console.log("  Production: READ-ONLY (no writes to production)")
console.log("")

// Read Auth users
console.log("── Reading production Auth users...")
let allProdUsers = []
let nextPageToken
do {
  const result = await prodAuth.listUsers(1000, nextPageToken)
  allProdUsers = allProdUsers.concat(result.users)
  nextPageToken = result.pageToken
} while (nextPageToken)
console.log(`   Found ${allProdUsers.length} auth users`)

// Read Firestore collections
console.log("── Reading production Firestore...")
const prodData = {}
for (const col of COLLECTIONS) {
  const snap = await prodDb.collection(col).get()
  prodData[col] = snap.docs.map((d) => ({ id: d.id, data: d.data() }))
  console.log(`   ${col}: ${snap.size} docs`)
}

const totalDocs = Object.values(prodData).reduce((s, docs) => s + docs.length, 0)
console.log(`   Total: ${totalDocs} docs`)

// ── STEP 2: Set emulator env vars and connect to emulators ───────────────────
// Prod reads are 100% done before this point, so env vars are safe to set now.

process.env.FIREBASE_AUTH_EMULATOR_HOST = EMULATOR_AUTH_HOST
// Do NOT set FIRESTORE_EMULATOR_HOST — we configure Firestore via settings() below.

const emulatorApp = initializeApp({ projectId: PROJECT_ID }, "emulator")
const emulatorAuth = getAuth(emulatorApp) // reads FIREBASE_AUTH_EMULATOR_HOST → connects to emulator

const emulatorDb = getFirestore(emulatorApp)
emulatorDb.settings({ host: EMULATOR_FIRESTORE_HOST, ssl: false }) // explicit emulator host

console.log("")
console.log("── Writing to emulators...")

// ── STEP 3: Clear + write Auth users to emulator ─────────────────────────────

console.log("")
console.log("── Auth users...")
let authCreated = 0
let authFailed = 0

for (const user of allProdUsers) {
  try {
    // Delete existing user in emulator (clean slate — won't fail if not found)
    try { await emulatorAuth.deleteUser(user.uid) } catch {}

    await emulatorAuth.createUser({
      uid: user.uid,
      email: user.email,
      emailVerified: true,
      displayName: user.displayName ?? undefined,
      disabled: false,
    })
    // Set a known test password so testers can log in
    await emulatorAuth.updateUser(user.uid, { password: EMULATOR_PASSWORD })
    console.log(`   ✓ ${user.email ?? user.uid}`)
    authCreated++
  } catch (err) {
    console.warn(`   ⚠ ${user.uid} (${user.email ?? "no email"}): ${err.message}`)
    authFailed++
  }
}
console.log(`   Created: ${authCreated}, Failed: ${authFailed}`)

// ── STEP 4: Write Firestore collections to emulator ──────────────────────────

for (const col of COLLECTIONS) {
  const docs = prodData[col]
  console.log("")
  console.log(`── Firestore: ${col} (${docs.length} docs)...`)

  if (docs.length === 0) {
    console.log("   (empty, skipping)")
    continue
  }

  // Clear existing emulator data for this collection
  const existingSnap = await emulatorDb.collection(col).get()
  if (!existingSnap.empty) {
    const delBatch = emulatorDb.batch()
    existingSnap.docs.forEach((d) => delBatch.delete(d.ref))
    await delBatch.commit()
    console.log(`   Cleared ${existingSnap.size} existing docs`)
  }

  // Write in chunks of 400 (Firestore batch limit is 500, keep margin)
  let written = 0
  for (let i = 0; i < docs.length; i += 400) {
    const chunk = docs.slice(i, i + 400)
    const batch = emulatorDb.batch()
    chunk.forEach(({ id, data }) => {
      batch.set(emulatorDb.collection(col).doc(id), data)
    })
    await batch.commit()
    written += chunk.length
    if (docs.length > 400) {
      console.log(`   Written ${written} / ${docs.length}`)
    }
  }
  console.log(`   ✓ ${written} docs imported`)
}

// ── Done ─────────────────────────────────────────────────────────────────────

console.log("")
console.log("══════════════════════════════════════════════")
console.log("  Export complete!")
console.log("")
console.log(`  Emulator UI:    http://localhost:4000`)
console.log(`  Login password: "${EMULATOR_PASSWORD}"`)
console.log("")
console.log("  Next steps:")
console.log("    1. pnpm dev:emulator          — start app connected to emulator")
console.log("    2. pnpm emulator:migrate       — compute visibleToUserIds for all messages")
console.log("══════════════════════════════════════════════")
console.log("")
