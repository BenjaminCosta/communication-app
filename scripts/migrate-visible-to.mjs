#!/usr/bin/env node
/**
 * migrate-visible-to.mjs
 *
 * Computes and writes "visibleToUserIds" for all messages in the EMULATOR.
 * NEVER runs against production — requires FIRESTORE_EMULATOR_HOST to be set.
 *
 * Logic:
 *   visibleToUserIds = author + direct recipients (recipientIds) only.
 *   Tag/project membership no longer grants visibility (tagVisibilityV1 migration).
 *   If no recipients → visibleToUserIds = [authorId] (private/unassigned)
 *
 * Safety:
 *   - Read-only check against emulator guard variable
 *   - Idempotent: skips messages where visibleToUserIds already matches
 *   - Never removes existing fields (participants, recipientIds, tagIds, etc.)
 *   - Never overwrites author/sender IDs
 *
 * Usage:
 *   pnpm emulator:migrate
 *   (or: FIRESTORE_EMULATOR_HOST=localhost:8080 node scripts/migrate-visible-to.mjs)
 */

import { initializeApp } from "firebase-admin/app"
import { getFirestore } from "firebase-admin/firestore"

// ── Safety: emulator guard ───────────────────────────────────────────────────

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST
if (!emulatorHost) {
  console.error("")
  console.error("ERROR: FIRESTORE_EMULATOR_HOST is not set.")
  console.error("  This script only runs against the emulator — never production.")
  console.error("  Run: FIRESTORE_EMULATOR_HOST=localhost:8080 node scripts/migrate-visible-to.mjs")
  console.error("  Or:  pnpm emulator:migrate")
  console.error("")
  process.exit(1)
}

// ── Connect to emulator ──────────────────────────────────────────────────────

const app = initializeApp({ projectId: "svc-comms" })
// FIRESTORE_EMULATOR_HOST is set in env → getFirestore connects to emulator
const db = getFirestore()

// ── Main migration ───────────────────────────────────────────────────────────

async function migrate() {
  console.log("")
  console.log("══════════════════════════════════════════════")
  console.log("  visibleToUserIds Migration (Emulator Only)")
  console.log("══════════════════════════════════════════════")
  console.log(`  Emulator: ${emulatorHost}`)
  console.log("")

  // Load all messages
  const messagesSnap = await db.collection("messages").get()
  console.log(`Processing ${messagesSnap.size} messages...`)
  console.log("")

  const toUpdate = []
  let skipped = 0
  let noAuthor = 0

  for (const doc of messagesSnap.docs) {
    const data = doc.data()

    const authorId = (data.authorId || data.senderId || "").trim()
    if (!authorId) {
      console.warn(`  WARN: message ${doc.id} has no authorId/senderId — skipping`)
      noAuthor++
      continue
    }

    const recipientIds = Array.isArray(data.recipientIds) ? data.recipientIds.filter(Boolean) : []

    // ── Compute visibleToUserIds: author + explicit recipients only ───────────
    // Tag/project membership no longer grants visibility (tagVisibilityV1 migration).
    const visible = new Set([authorId])
    recipientIds.forEach((id) => visible.add(id))

    const visibleToUserIds = [...visible]

    // ── Idempotency: skip if already correct ─────────────────────────────────
    const current = Array.isArray(data.visibleToUserIds) ? data.visibleToUserIds : null
    if (current !== null) {
      const same =
        current.length === visibleToUserIds.length &&
        visibleToUserIds.every((id) => current.includes(id))
      if (same) {
        skipped++
        continue
      }
    }

    toUpdate.push({ ref: doc.ref, visibleToUserIds, authorId })
  }

  console.log(`  Messages to update:     ${toUpdate.length}`)
  console.log(`  Already up-to-date:     ${skipped}`)
  if (noAuthor > 0) console.log(`  Skipped (no author):    ${noAuthor}`)
  console.log("")

  if (toUpdate.length === 0) {
    console.log("✓ Nothing to do. All messages already have visibleToUserIds.")
    console.log("")
    return
  }

  // ── Commit in chunks of 400 ──────────────────────────────────────────────

  for (let i = 0; i < toUpdate.length; i += 400) {
    const chunk = toUpdate.slice(i, i + 400)
    const batch = db.batch()
    chunk.forEach(({ ref, visibleToUserIds }) => {
      // Only add visibleToUserIds — all other fields remain untouched.
      batch.update(ref, { visibleToUserIds })
    })
    await batch.commit()
    const done = Math.min(i + 400, toUpdate.length)
    console.log(`  Updated ${done} / ${toUpdate.length} messages`)
  }

  console.log("")
  console.log("── Sample results (first 5 updated messages):")
  for (const { ref, visibleToUserIds, authorId } of toUpdate.slice(0, 5)) {
    console.log(`  ${ref.id}: [${visibleToUserIds.join(", ")}]`)
  }

  console.log("")
  console.log("══════════════════════════════════════════════")
  console.log("  Migration complete!")
  console.log("")
  console.log(`  Updated:  ${toUpdate.length} messages`)
  console.log(`  Skipped:  ${skipped} (already correct)`)
  console.log("")
  console.log("  Next steps:")
  console.log("    1. pnpm dev:emulator  — test the app against emulator")
  console.log("    2. Test all cases A–G from the spec")
  console.log("    3. Apply secure rules via emulator UI: http://localhost:4000")
  console.log("══════════════════════════════════════════════")
  console.log("")
}

migrate().catch((err) => {
  console.error("")
  console.error("Migration failed:", err.message)
  console.error(err.stack)
  process.exit(1)
})
