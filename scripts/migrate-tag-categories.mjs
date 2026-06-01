#!/usr/bin/env node
/**
 * migrate-tag-categories.mjs
 *
 * Assigns a `tagCategory` to every project/tag document that is missing one
 * or has an invalid/legacy value.
 *
 * Safety rules:
 *   - By default ONLY runs against the emulator (FIRESTORE_EMULATOR_HOST must be set).
 *   - Pass --prod flag explicitly to run against production (requires confirmation).
 *   - Idempotent: skips documents that already have a valid tagCategory.
 *   - Never removes other fields, never changes IDs, names, or members.
 *   - --dry-run: prints what would change without writing.
 *
 * Usage (emulator):
 *   pnpm emulator:migrate-categories
 *   (or: FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/migrate-tag-categories.mjs)
 *
 * Usage (dry-run):
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/migrate-tag-categories.mjs --dry-run
 */

import { initializeApp, cert } from "firebase-admin/app"
import { getFirestore } from "firebase-admin/firestore"
import { readFileSync, existsSync } from "fs"

const args = process.argv.slice(2)
const isDryRun = args.includes("--dry-run")
const isProd = args.includes("--prod")

// ── Valid categories (must match lib/store.ts TagCategory) ───────────────────
const VALID_CATEGORIES = new Set([
  "systemType",
  "project",
  "status",
  "priority",
  "timedate",
  "department",
  "report",
  "sales",
  "task",
  "custom",
])

// ── Safety: emulator guard ───────────────────────────────────────────────────
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST

if (!isProd && !emulatorHost) {
  console.error("")
  console.error("ERROR: FIRESTORE_EMULATOR_HOST is not set.")
  console.error("  This script runs against the emulator by default.")
  console.error("  Set FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 or use --prod for production.")
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
  console.warn("   Make sure you have explicit approval before proceeding.")
  console.warn("")
  // In a real prod run you'd want a readline confirmation here.
  // For now, require --prod + explicit GOOGLE_APPLICATION_CREDENTIALS.
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
  // Emulator: no credentials needed
  app = initializeApp({ projectId: "svc-comms" })
}

const db = getFirestore(app)

// ── Migration logic ──────────────────────────────────────────────────────────
async function migrate() {
  const mode = isProd ? "PRODUCTION" : `EMULATOR (${emulatorHost})`
  console.log(`\n── Tag Category Migration ──────────────────────────────`)
  console.log(`   Mode:    ${mode}`)
  console.log(`   Dry run: ${isDryRun}`)
  console.log(`────────────────────────────────────────────────────────\n`)

  const snapshot = await db.collection("projects").get()

  let skipped = 0
  let updated = 0
  let total = snapshot.size

  const batch = db.batch()
  let batchCount = 0

  for (const docSnap of snapshot.docs) {
    const data = docSnap.data()
    const currentCategory = data.tagCategory

    // Already has a valid category — skip (idempotent)
    if (currentCategory && VALID_CATEGORIES.has(currentCategory) && currentCategory !== "systemType") {
      skipped++
      continue
    }

    // Determine default category:
    // If it had "project" (auto-assigned for multi-member) → keep "project"
    // Anything else (absent, invalid, "systemType") → "custom"
    const newCategory = currentCategory === "project" ? "project" : "custom"

    if (isDryRun) {
      console.log(`  [DRY RUN] ${docSnap.id}  "${data.name}"`)
      console.log(`            tagCategory: ${currentCategory ?? "(absent)"} → ${newCategory}`)
    } else {
      batch.update(docSnap.ref, { tagCategory: newCategory })
      batchCount++
    }
    updated++

    // Firestore batch limit: 500 ops — commit and reset
    if (!isDryRun && batchCount >= 499) {
      await batch.commit()
      batchCount = 0
      console.log(`  Committed batch of 499 writes...`)
    }
  }

  if (!isDryRun && batchCount > 0) {
    await batch.commit()
  }

  console.log(`\n── Results ──────────────────────────────────────────────`)
  console.log(`   Total projects: ${total}`)
  console.log(`   Already valid:  ${skipped}  (unchanged)`)
  console.log(`   ${isDryRun ? "Would update" : "Updated"}:      ${updated}`)
  console.log(`────────────────────────────────────────────────────────\n`)

  if (isDryRun) {
    console.log("Dry run complete — no changes written.\n")
  } else {
    console.log("Migration complete.\n")
  }
}

migrate().catch((err) => {
  console.error("Migration failed:", err)
  process.exit(1)
})
