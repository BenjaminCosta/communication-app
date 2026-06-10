#!/usr/bin/env node
/**
 * migrate-prod-visible-to.mjs
 *
 * Computes and writes "visibleToUserIds" for all messages in PRODUCTION Firestore.
 * Requires GOOGLE_APPLICATION_CREDENTIALS pointing to a service account JSON.
 *
 * Rules:
 *   visibleToUserIds = author + direct recipients (recipientIds) only.
 *   Tag/project membership no longer grants visibility (tagVisibilityV1 migration).
 *   If no recipients → visibleToUserIds = [authorId] (private/unassigned)
 *
 * Safety:
 *   - Never removes existing fields (participants, recipientIds, tagIds, etc.)
 *   - Never overwrites authorId/senderId
 *   - Never sets participants = allUids
 *   - Idempotent: skips messages where visibleToUserIds already matches
 *   - Dry-run mode: set DRY_RUN=true to see what would change without writing
 */

import { initializeApp, cert } from "firebase-admin/app"
import { getFirestore } from "firebase-admin/firestore"
import { readFileSync } from "fs"

const SA_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS
if (!SA_PATH) {
  console.error("ERROR: GOOGLE_APPLICATION_CREDENTIALS is not set")
  process.exit(1)
}

const DRY_RUN = process.env.DRY_RUN === "true"

const serviceAccount = JSON.parse(readFileSync(SA_PATH, "utf8"))
initializeApp({ credential: cert(serviceAccount) })
const db = getFirestore()

async function migrate() {
  console.log("")
  console.log("══════════════════════════════════════════════════════")
  console.log("  visibleToUserIds Migration — PRODUCTION")
  console.log("══════════════════════════════════════════════════════")
  console.log(`  Project:  ${serviceAccount.project_id}`)
  console.log(`  Mode:     ${DRY_RUN ? "DRY RUN (no writes)" : "LIVE — will write to Firestore"}`)
  console.log("")

  // Load all messages
  const messagesSnap = await db.collection("messages").get()
  console.log(`  Messages loaded: ${messagesSnap.size}`)
  console.log("")

  const toUpdate = []
  let skipped = 0
  let noAuthor = 0

  for (const doc of messagesSnap.docs) {
    const data = doc.data()

    const authorId = (data.authorId || data.senderId || "").trim()
    if (!authorId) {
      console.warn(`  WARN: ${doc.id} — no authorId/senderId, skipping`)
      noAuthor++
      continue
    }

    const recipientIds = Array.isArray(data.recipientIds) ? data.recipientIds.filter(Boolean) : []

    // Compute visibleToUserIds: author + explicit recipients only.
    // Tag/project membership no longer grants visibility (tagVisibilityV1 migration).
    const visible = new Set([authorId])
    recipientIds.forEach((id) => visible.add(id))

    const visibleToUserIds = [...visible]

    // Idempotency: skip if already correct
    const current = Array.isArray(data.visibleToUserIds) ? data.visibleToUserIds : null
    if (current !== null) {
      const same =
        current.length === visibleToUserIds.length &&
        visibleToUserIds.every((id) => current.includes(id))
      if (same) { skipped++; continue }
    }

    toUpdate.push({ ref: doc.ref, id: doc.id, visibleToUserIds, authorId, current })
  }

  console.log(`  To update:       ${toUpdate.length}`)
  console.log(`  Already correct: ${skipped}`)
  if (noAuthor > 0) console.log(`  No author (skip): ${noAuthor}`)
  console.log("")

  if (toUpdate.length === 0) {
    console.log("  ✓ Nothing to do — all messages already have correct visibleToUserIds.")
    console.log("")
    return
  }

  // Show preview
  const preview = toUpdate.slice(0, 10)
  console.log(`  Preview (first ${preview.length}):`)
  for (const { id, visibleToUserIds, current } of preview) {
    const was = current ? `[${current.join(",")}]` : "(none)"
    console.log(`    ${id}`)
    console.log(`      was:  ${was}`)
    console.log(`      now:  [${visibleToUserIds.join(",")}]`)
  }
  if (toUpdate.length > 10) console.log(`    ... and ${toUpdate.length - 10} more`)
  console.log("")

  if (DRY_RUN) {
    console.log("  DRY RUN — no changes written.")
    console.log("  Re-run without DRY_RUN=true to apply.")
    console.log("")
    return
  }

  // Commit in chunks of 400
  for (let i = 0; i < toUpdate.length; i += 400) {
    const chunk = toUpdate.slice(i, i + 400)
    const batch = db.batch()
    chunk.forEach(({ ref, visibleToUserIds }) => {
      batch.update(ref, { visibleToUserIds })
    })
    await batch.commit()
    const done = Math.min(i + 400, toUpdate.length)
    console.log(`  Updated ${done} / ${toUpdate.length}`)
  }

  console.log("")
  console.log("══════════════════════════════════════════════════════")
  console.log("  Migration complete!")
  console.log(`  Updated:  ${toUpdate.length} messages`)
  console.log(`  Skipped:  ${skipped} (already correct)`)
  console.log("══════════════════════════════════════════════════════")
  console.log("")
}

migrate().catch((err) => {
  console.error("Migration failed:", err.message)
  console.error(err.stack)
  process.exit(1)
})
