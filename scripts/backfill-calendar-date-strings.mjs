#!/usr/bin/env node
/**
 * backfill-calendar-date-strings.mjs
 *
 * Backfills the `calendarDateStrings: string[]` field on all messages that
 * have `calendarDates` but are missing the flat string array needed for the
 * Firestore array-contains query used by onDailyCalendarReminders.
 *
 * Safety rules:
 *   - By default ONLY runs against the emulator (FIRESTORE_EMULATOR_HOST must be set).
 *   - Pass --prod flag explicitly to run against production (requires service-account.json).
 *   - Idempotent: skips messages that already have calendarDateStrings.
 *   - Never touches any other field.
 *   - --dry-run: prints what would change without writing.
 *
 * Usage (prod):
 *   node scripts/backfill-calendar-date-strings.mjs --prod
 *
 * Usage (dry-run against prod):
 *   node scripts/backfill-calendar-date-strings.mjs --prod --dry-run
 */

import { initializeApp, cert } from "firebase-admin/app"
import { getFirestore, FieldValue } from "firebase-admin/firestore"
import { readFileSync, existsSync } from "fs"

const args = process.argv.slice(2)
const isDryRun = args.includes("--dry-run")
const isProd   = args.includes("--prod")

// ── Safety: emulator guard ───────────────────────────────────────────────────
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST

if (!isProd && !emulatorHost) {
  console.error("")
  console.error("ERROR: FIRESTORE_EMULATOR_HOST is not set.")
  console.error("  This script runs against the emulator by default.")
  console.error("  Set FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 or pass --prod for production.")
  console.error("")
  process.exit(1)
}

if (isProd && emulatorHost) {
  console.error("ERROR: Both --prod and FIRESTORE_EMULATOR_HOST are set. Pick one.")
  process.exit(1)
}

if (isProd) {
  console.warn("")
  console.warn("⚠️  --prod flag detected. This will modify PRODUCTION data.")
  console.warn("")
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && !existsSync("./service-account.json")) {
    console.error("ERROR: No service account found. Set GOOGLE_APPLICATION_CREDENTIALS or place service-account.json in root.")
    process.exit(1)
  }
}

// ── Init Firebase Admin ──────────────────────────────────────────────────────
let app
if (isProd) {
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS ?? "./service-account.json"
  const serviceAccount = JSON.parse(readFileSync(credPath, "utf8"))
  app = initializeApp({ credential: cert(serviceAccount), projectId: serviceAccount.project_id })
} else {
  app = initializeApp({ projectId: "svc-comms" })
}

const db = getFirestore(app)

// ── Migration ────────────────────────────────────────────────────────────────
async function migrate() {
  const mode = isProd ? "PRODUCTION" : `EMULATOR (${emulatorHost})`
  console.log(`\n── Backfill calendarDateStrings ───────────────────────`)
  console.log(`   Mode:    ${mode}`)
  console.log(`   Dry run: ${isDryRun}`)
  console.log(`───────────────────────────────────────────────────────\n`)

  const snapshot = await db.collection("messages").get()

  let total    = snapshot.size
  let skipped  = 0
  let updated  = 0
  let empty    = 0   // has calendarDates but it's empty array

  // Firestore batch max = 500 writes
  const BATCH_LIMIT = 500
  let batch = db.batch()
  let batchCount = 0

  const flush = async () => {
    if (batchCount === 0) return
    if (!isDryRun) await batch.commit()
    batch = db.batch()
    batchCount = 0
  }

  for (const docSnap of snapshot.docs) {
    const data = docSnap.data()

    // Skip if no calendarDates at all
    if (!Array.isArray(data.calendarDates) || data.calendarDates.length === 0) {
      empty++
      continue
    }

    // Already backfilled — skip (idempotent)
    if (Array.isArray(data.calendarDateStrings) && data.calendarDateStrings.length > 0) {
      skipped++
      continue
    }

    // Extract the date strings from calendarDates objects
    const dateStrings = data.calendarDates
      .map((d) => (typeof d.date === "string" ? d.date : null))
      .filter(Boolean)

    if (dateStrings.length === 0) {
      skipped++
      continue
    }

    console.log(`  ${isDryRun ? "[DRY]" : "[WRITE]"} ${docSnap.id} → calendarDateStrings: [${dateStrings.join(", ")}]`)

    if (!isDryRun) {
      batch.update(docSnap.ref, { calendarDateStrings: dateStrings })
      batchCount++
      if (batchCount >= BATCH_LIMIT) await flush()
    }

    updated++
  }

  await flush()

  console.log(`\n── Results ─────────────────────────────────────────────`)
  console.log(`   Total messages scanned : ${total}`)
  console.log(`   Without calendarDates  : ${empty}`)
  console.log(`   Already had field      : ${skipped}`)
  console.log(`   ${isDryRun ? "Would update" : "Updated"}            : ${updated}`)
  console.log(`───────────────────────────────────────────────────────\n`)
}

migrate().catch((err) => {
  console.error("Migration failed:", err)
  process.exit(1)
})
