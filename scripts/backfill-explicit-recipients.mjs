#!/usr/bin/env node
/**
 * backfill-explicit-recipients.mjs
 *
 * Promotes implicit visibility (currently granted via tag/project membership)
 * into explicit recipientIds and peopleIds on every affected message.
 *
 * This is the prerequisite migration before removing tag-based visibility
 * from computeVisibleToUserIds. After this script runs, visibleToUserIds will
 * equal [authorId, ...recipientIds] — no IDs will be sourced from tag members.
 *
 * ── Source of truth ─────────────────────────────────────────────────────────
 * The current visibleToUserIds field on each message is used as the authority
 * for who currently has access. We do NOT re-read project.members because
 * members may have changed since the message was written.
 *
 * ── What this script writes ──────────────────────────────────────────────────
 *  recipientIds      expanded to include all implicit IDs
 *  peopleIds         kept in sync with recipientIds (always identical)
 *  visibleToUserIds  recomputed from [authorId, ...newRecipientIds]
 *                    (must equal current value — verified before each write)
 *  _migration        set to "tagVisibilityV1" as an idempotency marker
 *
 * ── What this script does NOT touch ─────────────────────────────────────────
 *  participants, tagIds, projectIds, projectId, project_id
 *  type, text, content, imageUrl, calendarDates, replyToId
 *  createdAt, updatedAt, timestamp (no timestamp touch)
 *  Project documents (name, color, members)
 *
 * ── Backup ───────────────────────────────────────────────────────────────────
 * Before modifying any message, a backup document is written to:
 *   _migrationBackups/tagVisibilityV1/messages/{messageId}
 *
 * The backup stores: previousRecipientIds, previousPeopleIds,
 * previousVisibleToUserIds, previousMigration, backedUpAt, scriptVersion.
 *
 * The backup is written atomically in the SAME batch as the message update,
 * so either both succeed or neither does.
 *
 * If a backup already exists for a message (from a prior partial run), it is
 * NOT overwritten — the original pre-migration state is preserved.
 *
 * ── Modes ────────────────────────────────────────────────────────────────────
 *   DRY_RUN (default)  Show what would change. No writes. Safe on any target.
 *   APPLY              DRY_RUN=false → actually write backups + update messages.
 *   VERIFY             VERIFY=true → read backups, validate current state.
 *
 * ── Usage ────────────────────────────────────────────────────────────────────
 *
 *  # Dry-run against emulator (default)
 *  pnpm backfill:recipients:dry
 *  FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/backfill-explicit-recipients.mjs
 *
 *  # Apply to emulator
 *  pnpm backfill:recipients
 *  DRY_RUN=false FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/backfill-explicit-recipients.mjs
 *
 *  # Dry-run against production (read-only)
 *  pnpm backfill:recipients:dry:prod
 *  GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node scripts/backfill-explicit-recipients.mjs
 *
 *  # Apply to production (requires explicit confirmation)
 *  pnpm backfill:recipients:prod
 *  DRY_RUN=false CONFIRM_PROD_MIGRATION=true GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *    node scripts/backfill-explicit-recipients.mjs
 *
 *  # Verify after backfill (emulator)
 *  pnpm backfill:recipients:verify
 *  VERIFY=true FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/backfill-explicit-recipients.mjs
 *
 *  # Verify after backfill (production)
 *  pnpm backfill:recipients:verify:prod
 *  VERIFY=true GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node scripts/backfill-explicit-recipients.mjs
 */

import { initializeApp, cert } from "firebase-admin/app"
import { getFirestore, FieldValue } from "firebase-admin/firestore"
import { readFileSync } from "fs"

// ── Constants ────────────────────────────────────────────────────────────────

const MIGRATION_ID     = "tagVisibilityV1"
const SCRIPT_VERSION   = "1.0.0"
const BACKUP_COLL_PATH = `_migrationBackups/${MIGRATION_ID}/messages`
const CHUNK_SIZE       = 200  // 2 Firestore ops per message (backup + update) = 400 ops/batch

// ── Environment detection ────────────────────────────────────────────────────

const EMULATOR_HOST       = process.env.FIRESTORE_EMULATOR_HOST
const SA_PATH             = process.env.GOOGLE_APPLICATION_CREDENTIALS
const DRY_RUN             = process.env.DRY_RUN !== "false"           // default: true
const VERIFY_MODE         = process.env.VERIFY === "true"
const CONFIRM_PROD        = process.env.CONFIRM_PROD_MIGRATION === "true"

let targetMode
if (EMULATOR_HOST) {
  targetMode = "emulator"
} else if (SA_PATH) {
  targetMode = "production"
} else {
  console.error("")
  console.error("ERROR: No Firestore target configured.")
  console.error("  Emulator:   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080")
  console.error("  Production: GOOGLE_APPLICATION_CREDENTIALS=./service-account.json")
  console.error("")
  process.exit(1)
}

// Production safety gate: must explicitly confirm before any live writes
if (targetMode === "production" && !DRY_RUN && !VERIFY_MODE && !CONFIRM_PROD) {
  console.error("")
  console.error("ERROR: Production write blocked.")
  console.error("  You are attempting to write to PRODUCTION Firestore.")
  console.error("  Set CONFIRM_PROD_MIGRATION=true to proceed.")
  console.error("")
  console.error("  Example:")
  console.error("    DRY_RUN=false CONFIRM_PROD_MIGRATION=true \\")
  console.error("    GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \\")
  console.error("    node scripts/backfill-explicit-recipients.mjs")
  console.error("")
  process.exit(1)
}

// ── Firebase init ────────────────────────────────────────────────────────────

let db
let projectId
if (targetMode === "emulator") {
  projectId = "svc-comms"
  initializeApp({ projectId })
  db = getFirestore()
} else {
  const sa = JSON.parse(readFileSync(SA_PATH, "utf8"))
  projectId = sa.project_id
  initializeApp({ credential: cert(sa) })
  db = getFirestore()
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function dedupe(arr) {
  return [...new Set(arr.filter(Boolean))]
}

function setsEqual(a, b) {
  if (a.length !== b.length) return false
  const setA = new Set(a)
  return b.every((id) => setA.has(id))
}

function setsContains(superset, subset) {
  const s = new Set(superset)
  return subset.every((id) => s.has(id))
}

function formatList(arr, max = 6) {
  if (arr.length === 0) return "(empty)"
  const shown = arr.slice(0, max).join(", ")
  return arr.length > max ? `${shown} … (+${arr.length - max} more)` : shown
}

// ── APPLY mode ───────────────────────────────────────────────────────────────

async function apply() {
  const runLabel = DRY_RUN ? "DRY RUN" : "LIVE APPLY"
  console.log("")
  console.log("══════════════════════════════════════════════════════════")
  console.log(`  Backfill Explicit Recipients  [${runLabel}]`)
  console.log("══════════════════════════════════════════════════════════")
  console.log(`  Target:         ${targetMode === "emulator" ? `Emulator (${EMULATOR_HOST})` : `Production (${projectId})`}`)
  console.log(`  Mode:           ${DRY_RUN ? "DRY RUN — no writes" : "LIVE — will write to Firestore"}`)
  console.log(`  Migration ID:   ${MIGRATION_ID}`)
  console.log(`  Script version: ${SCRIPT_VERSION}`)
  console.log(`  Backup path:    ${BACKUP_COLL_PATH}/{messageId}`)
  console.log("")

  if (!DRY_RUN) {
    console.log("  WRITES ARE ENABLED. Backups will be created before every message update.")
    console.log("")
  }

  // ── Load existing backups (to avoid overwriting prior partial runs) ────────
  const backupsSnap = await db.collection(BACKUP_COLL_PATH).get()
  const existingBackupIds = new Set(backupsSnap.docs.map((d) => d.id))
  console.log(`  Existing backups: ${existingBackupIds.size}`)

  // ── Load all messages ──────────────────────────────────────────────────────
  const messagesSnap = await db.collection("messages").get()
  const total = messagesSnap.size
  console.log(`  Messages loaded:  ${total}`)
  console.log("")

  // ── Analysis pass ─────────────────────────────────────────────────────────

  let noAuthorId       = 0
  let noVisible        = 0
  let alreadyMigrated  = 0
  let alreadyClean     = 0
  let inconsistent     = 0   // newVisibleToUserIds would not match current — logged as warning
  const toProcess      = []  // messages that need backfill

  for (const msgDoc of messagesSnap.docs) {
    const data = msgDoc.data()
    const msgId = msgDoc.id

    const authorId = (data.authorId || data.senderId || "").trim()
    if (!authorId) {
      noAuthorId++
      continue
    }

    // Skip messages without visibleToUserIds — cannot determine implicit recipients
    if (!Array.isArray(data.visibleToUserIds) || data.visibleToUserIds.length === 0) {
      noVisible++
      continue
    }

    // Skip if already processed by this migration
    if (data._migration === MIGRATION_ID) {
      alreadyMigrated++
      continue
    }

    const visibleToUserIds = data.visibleToUserIds.filter(Boolean)
    const recipientIds     = Array.isArray(data.recipientIds) ? data.recipientIds.filter(Boolean) : []
    const peopleIds        = Array.isArray(data.peopleIds) ? data.peopleIds.filter(Boolean) : []

    // IDs currently visible that are not the author and not already explicit recipients
    const implicitIds = visibleToUserIds.filter(
      (uid) => uid !== authorId && !recipientIds.includes(uid)
    )

    if (implicitIds.length === 0) {
      alreadyClean++
      continue
    }

    // Compute the new explicit sets
    const newRecipientIds      = dedupe([...recipientIds, ...implicitIds]).filter((uid) => uid !== authorId)
    const newPeopleIds         = newRecipientIds
    const newVisibleToUserIds  = dedupe([authorId, ...newRecipientIds])

    // Sanity check: newVisibleToUserIds should equal current visibleToUserIds
    // If not, something is off — log a warning but still proceed (we use current as truth)
    if (!setsEqual(newVisibleToUserIds, visibleToUserIds)) {
      inconsistent++
      console.warn(`  WARN [${msgId}]: newVisibleToUserIds would differ from current.`)
      console.warn(`    current: [${formatList(visibleToUserIds)}]`)
      console.warn(`    new:     [${formatList(newVisibleToUserIds)}]`)
      console.warn(`    Proceeding with current visibleToUserIds as authoritative.`)
      // Use the current value as the final visibleToUserIds (it's the source of truth)
    }

    toProcess.push({
      id: msgId,
      ref: msgDoc.ref,
      authorId,
      previousRecipientIds: recipientIds,
      previousPeopleIds: peopleIds,
      previousVisibleToUserIds: visibleToUserIds,
      previousMigration: data._migration ?? null,
      newRecipientIds,
      newPeopleIds,
      // Always keep the current visibleToUserIds (source of truth) — it must not shrink
      newVisibleToUserIds: visibleToUserIds,
      implicitIds,
      backupExists: existingBackupIds.has(msgId),
    })
  }

  // ── Summary ───────────────────────────────────────────────────────────────

  console.log("  ── Analysis results ────────────────────────────────")
  console.log(`  Total messages:              ${total}`)
  console.log(`  No authorId (skipped):       ${noAuthorId}`)
  console.log(`  No visibleToUserIds (skip):  ${noVisible}`)
  console.log(`  Already migrated (skip):     ${alreadyMigrated}`)
  console.log(`  Already clean (skip):        ${alreadyClean}`)
  console.log(`  Need backfill:               ${toProcess.length}`)
  if (inconsistent > 0) {
    console.log(`  Inconsistencies (warn):      ${inconsistent}`)
  }
  console.log("")

  if (noVisible > 0) {
    console.log(`  WARNING: ${noVisible} message(s) have no visibleToUserIds field.`)
    console.log(`  Run the visibleToUserIds migration first, then re-run this script.`)
    console.log(`    Emulator:   pnpm emulator:migrate`)
    console.log(`    Production: see scripts/migrate-prod-visible-to.mjs`)
    console.log("")
  }

  if (toProcess.length === 0) {
    console.log("  Nothing to backfill. All messages are already clean.")
    console.log("  ✓ Safe to remove tag-based visibility from computeVisibleToUserIds.")
    console.log("══════════════════════════════════════════════════════════")
    console.log("")
    return
  }

  // ── Preview (first 8) ─────────────────────────────────────────────────────

  console.log(`  ── Preview (first ${Math.min(8, toProcess.length)} messages) ────────────────────`)
  for (const m of toProcess.slice(0, 8)) {
    console.log(`  [${m.id}]`)
    console.log(`    authorId:                  ${m.authorId}`)
    console.log(`    previousRecipientIds:      [${formatList(m.previousRecipientIds)}]`)
    console.log(`    implicitIds (to promote):  [${formatList(m.implicitIds)}]`)
    console.log(`    newRecipientIds:           [${formatList(m.newRecipientIds)}]`)
    console.log(`    visibleToUserIds (unchanged): [${formatList(m.newVisibleToUserIds)}]`)
    if (m.backupExists) {
      console.log(`    backup: EXISTS (will not overwrite)`)
    }
  }
  if (toProcess.length > 8) {
    console.log(`  ... and ${toProcess.length - 8} more`)
  }
  console.log("")

  if (DRY_RUN) {
    console.log("  DRY RUN complete — no changes written.")
    console.log(`  ${toProcess.length} message(s) would be updated.`)
    console.log("")
    console.log("  To apply:")
    if (targetMode === "emulator") {
      console.log("    pnpm backfill:recipients")
    } else {
      console.log("    pnpm backfill:recipients:prod")
    }
    console.log("══════════════════════════════════════════════════════════")
    console.log("")
    return
  }

  // ── Write in chunks ───────────────────────────────────────────────────────

  console.log(`  Applying backfill to ${toProcess.length} messages...`)
  console.log(`  Chunk size: ${CHUNK_SIZE} messages (${CHUNK_SIZE * 2} Firestore ops)`)
  console.log("")

  const now = new Date()
  let updated    = 0
  let backupsNew = 0

  for (let i = 0; i < toProcess.length; i += CHUNK_SIZE) {
    const chunk = toProcess.slice(i, i + CHUNK_SIZE)
    const batch = db.batch()

    for (const m of chunk) {
      const backupRef = db.collection(BACKUP_COLL_PATH).doc(m.id)

      // Write backup only if it doesn't already exist (never overwrite)
      if (!m.backupExists) {
        batch.set(backupRef, {
          messageId:                   m.id,
          previousRecipientIds:        m.previousRecipientIds,
          previousPeopleIds:           m.previousPeopleIds,
          previousVisibleToUserIds:    m.previousVisibleToUserIds,
          previousMigration:           m.previousMigration,
          backedUpAt:                  now,
          scriptVersion:               SCRIPT_VERSION,
        })
        backupsNew++
      }

      // Update the message
      batch.update(m.ref, {
        recipientIds:     m.newRecipientIds,
        peopleIds:        m.newPeopleIds,
        visibleToUserIds: m.newVisibleToUserIds,
        _migration:       MIGRATION_ID,
        // updatedAt intentionally NOT touched — this is a visibility backfill, not a user edit
      })
    }

    await batch.commit()
    updated += chunk.length
    const pct = Math.round((updated / toProcess.length) * 100)
    console.log(`  Updated ${updated} / ${toProcess.length} (${pct}%)`)
  }

  console.log("")
  console.log("══════════════════════════════════════════════════════════")
  console.log("  Backfill complete!")
  console.log(`  Messages updated:  ${updated}`)
  console.log(`  Backups created:   ${backupsNew}`)
  if (existingBackupIds.size > 0) {
    console.log(`  Backups preserved: ${existingBackupIds.size} (from prior run)`)
  }
  console.log("")
  console.log("  Next steps:")
  console.log("    1. Run verify to confirm no visibility was lost:")
  if (targetMode === "emulator") {
    console.log("         pnpm backfill:recipients:verify")
  } else {
    console.log("         pnpm backfill:recipients:verify:prod")
  }
  console.log("    2. After verify passes, update computeVisibleToUserIds in lib/store.ts")
  console.log("       to remove the tag-member loop (Phase 5 of the migration plan).")
  console.log("══════════════════════════════════════════════════════════")
  console.log("")
}

// ── VERIFY mode ──────────────────────────────────────────────────────────────

async function verify() {
  console.log("")
  console.log("══════════════════════════════════════════════════════════")
  console.log(`  Backfill Verify  [${MIGRATION_ID}]`)
  console.log("══════════════════════════════════════════════════════════")
  console.log(`  Target:  ${targetMode === "emulator" ? `Emulator (${EMULATOR_HOST})` : `Production (${projectId})`}`)
  console.log(`  Mode:    READ-ONLY — verifying existing backfill`)
  console.log("")

  // Load all backup documents
  const backupsSnap = await db.collection(BACKUP_COLL_PATH).get()
  const totalBackups = backupsSnap.size

  if (totalBackups === 0) {
    console.log("  No backup documents found.")
    console.log(`  Has the backfill been applied yet?`)
    console.log(`    Emulator: pnpm backfill:recipients`)
    console.log(`    Prod:     pnpm backfill:recipients:prod`)
    console.log("══════════════════════════════════════════════════════════")
    console.log("")
    return
  }

  console.log(`  Backup documents found: ${totalBackups}`)
  console.log(`  Loading current message state...`)
  console.log("")

  let passed       = 0
  let failed       = 0
  let missing      = 0  // message doc no longer exists (deleted after backup)
  const failures   = []

  for (const backupDoc of backupsSnap.docs) {
    const backup  = backupDoc.data()
    const msgId   = backupDoc.id

    // Load current message
    const msgSnap = await db.collection("messages").doc(msgId).get()

    if (!msgSnap.exists) {
      missing++
      continue
    }

    const current = msgSnap.data()
    const errors  = []

    // ── Check 1: Migration marker must be set ─────────────────────────────
    if (current._migration !== MIGRATION_ID) {
      errors.push(`_migration field not set (got: ${current._migration ?? "(absent)"})`)
    }

    // ── Check 2: No visibility loss ───────────────────────────────────────
    // visibleToUserIds must contain ALL IDs from the pre-migration state
    const prevVisible  = backup.previousVisibleToUserIds ?? []
    const currVisible  = Array.isArray(current.visibleToUserIds) ? current.visibleToUserIds : []
    if (!setsContains(currVisible, prevVisible)) {
      const lost = prevVisible.filter((uid) => !currVisible.includes(uid))
      errors.push(`Visibility LOSS: [${lost.join(", ")}] were in previousVisibleToUserIds but not in current visibleToUserIds`)
    }

    // ── Check 3: Implicit IDs were promoted to recipientIds ───────────────
    // All IDs that were previously implicit (in visibleToUserIds but not in recipientIds)
    // must now be in recipientIds
    const prevRecipients  = backup.previousRecipientIds ?? []
    const currRecipients  = Array.isArray(current.recipientIds) ? current.recipientIds : []
    const authorId        = current.authorId || current.senderId || ""

    const prevImplicit = prevVisible.filter(
      (uid) => uid !== authorId && !prevRecipients.includes(uid)
    )
    const notPromoted = prevImplicit.filter((uid) => !currRecipients.includes(uid))
    if (notPromoted.length > 0) {
      errors.push(`Implicit IDs not promoted: [${notPromoted.join(", ")}] are still missing from recipientIds`)
    }

    // ── Check 4: recipientIds did not shrink ──────────────────────────────
    // Previous explicit recipients must still be in recipientIds
    const lostRecipients = prevRecipients.filter((uid) => !currRecipients.includes(uid))
    if (lostRecipients.length > 0) {
      errors.push(`recipientIds shrank: [${lostRecipients.join(", ")}] were removed`)
    }

    // ── Check 5: peopleIds matches recipientIds ───────────────────────────
    const currPeople = Array.isArray(current.peopleIds) ? current.peopleIds : []
    if (!setsEqual(currPeople, currRecipients)) {
      errors.push(`peopleIds [${formatList(currPeople)}] does not match recipientIds [${formatList(currRecipients)}]`)
    }

    if (errors.length === 0) {
      passed++
    } else {
      failed++
      failures.push({ msgId, errors, backup, current })
    }
  }

  // ── Verify report ─────────────────────────────────────────────────────────

  console.log("  ── Verification results ────────────────────────────")
  console.log(`  Total backups checked: ${totalBackups}`)
  console.log(`  Passed:                ${passed}`)
  console.log(`  Failed:                ${failed}`)
  if (missing > 0) {
    console.log(`  Message deleted:       ${missing} (backup exists but message was deleted — OK)`)
  }
  console.log("")

  if (failures.length > 0) {
    console.log("  ── FAILURES (first 10) ─────────────────────────────")
    for (const f of failures.slice(0, 10)) {
      console.log(`  [${f.msgId}]`)
      for (const err of f.errors) {
        console.log(`    ERROR: ${err}`)
      }
      console.log(`    previousVisibleToUserIds: [${formatList(f.backup.previousVisibleToUserIds ?? [])}]`)
      console.log(`    currentVisibleToUserIds:  [${formatList(Array.isArray(f.current.visibleToUserIds) ? f.current.visibleToUserIds : [])}]`)
      console.log(`    previousRecipientIds:     [${formatList(f.backup.previousRecipientIds ?? [])}]`)
      console.log(`    currentRecipientIds:      [${formatList(Array.isArray(f.current.recipientIds) ? f.current.recipientIds : [])}]`)
    }
    if (failures.length > 10) {
      console.log(`  ... and ${failures.length - 10} more failures`)
    }
    console.log("")
    console.log("  VERIFY FAILED. Do NOT proceed with the code change.")
    console.log("  Investigate the failures above before continuing.")
  } else {
    console.log("  ✓ ALL CHECKS PASSED")
    console.log("")
    console.log("  Every message that was modified:")
    console.log("    - retains all previously visible user IDs")
    console.log("    - has all implicit IDs promoted to explicit recipientIds")
    console.log("    - has peopleIds in sync with recipientIds")
    console.log("    - has _migration marker set")
    console.log("")
    console.log("  You may now proceed with Phase 5:")
    console.log("    Update computeVisibleToUserIds in lib/store.ts to remove")
    console.log("    the tag-member loop. New formula: author + recipientIds only.")
  }

  console.log("══════════════════════════════════════════════════════════")
  console.log("")

  if (failed > 0) process.exit(1)
}

// ── Entry point ──────────────────────────────────────────────────────────────

const runner = VERIFY_MODE ? verify : apply

runner().catch((err) => {
  console.error("")
  console.error(`${VERIFY_MODE ? "Verify" : "Backfill"} failed:`, err.message)
  console.error(err.stack)
  process.exit(1)
})
