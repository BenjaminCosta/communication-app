#!/usr/bin/env node
/**
 * inspect-tag-visibility.mjs
 *
 * READ-ONLY analysis of message visibility vs. explicit recipients.
 * Identifies messages where visibleToUserIds contains user IDs that came from
 * tag/project membership — not from explicit recipientIds.
 *
 * These "implicit" recipients must be backfilled into recipientIds BEFORE
 * removing tag-based visibility from computeVisibleToUserIds.
 *
 * Source of truth: current visibleToUserIds field on each message.
 * Does NOT rely on current project.members (members may have changed).
 *
 * Usage:
 *   # Against emulator
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/inspect-tag-visibility.mjs
 *   pnpm inspect:tag-visibility
 *
 *   # Against production (read-only — safe)
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node scripts/inspect-tag-visibility.mjs
 *   pnpm inspect:tag-visibility:prod
 */

import { initializeApp, cert } from "firebase-admin/app"
import { getFirestore } from "firebase-admin/firestore"
import { readFileSync } from "fs"

// ── Environment detection ────────────────────────────────────────────────────

const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST
const SA_PATH       = process.env.GOOGLE_APPLICATION_CREDENTIALS
const MIGRATION_ID  = "tagVisibilityV1"

let mode
if (EMULATOR_HOST) {
  mode = "emulator"
} else if (SA_PATH) {
  mode = "production"
} else {
  console.error("")
  console.error("ERROR: No Firestore target configured.")
  console.error("  Emulator:   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080")
  console.error("  Production: GOOGLE_APPLICATION_CREDENTIALS=./service-account.json")
  console.error("")
  process.exit(1)
}

// ── Firebase init ────────────────────────────────────────────────────────────

let db
if (mode === "emulator") {
  initializeApp({ projectId: "svc-comms" })
  db = getFirestore()
} else {
  const sa = JSON.parse(readFileSync(SA_PATH, "utf8"))
  initializeApp({ credential: cert(sa) })
  db = getFirestore()
}

const PROJECT_TAG_PREFIX = "project:"

function parseProjectTagId(tagId) {
  return tagId.startsWith(PROJECT_TAG_PREFIX) ? tagId.slice(PROJECT_TAG_PREFIX.length) : null
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function inspect() {
  console.log("")
  console.log("══════════════════════════════════════════════════════")
  console.log("  Tag Visibility Inspection")
  console.log("══════════════════════════════════════════════════════")
  console.log(`  Target:  ${mode === "emulator" ? `Emulator (${EMULATOR_HOST})` : `Production (${JSON.parse(readFileSync(SA_PATH, "utf8")).project_id})`}`)
  console.log(`  Mode:    READ-ONLY — no changes will be made`)
  console.log("")

  // Load projects for reference (name lookup only — NOT used for member inference)
  const projectsSnap = await db.collection("projects").get()
  const projectNames = new Map()
  projectsSnap.docs.forEach((d) => {
    projectNames.set(d.id, d.data().name ?? d.id)
  })
  console.log(`  Projects loaded: ${projectsSnap.size}`)

  // Load messages
  const messagesSnap = await db.collection("messages").get()
  const total = messagesSnap.size
  console.log(`  Messages loaded: ${total}`)
  console.log("")

  // ── Counters ──────────────────────────────────────────────────────────────

  let noAuthorId = 0
  let noVisibleToUserIds = 0
  let alreadyMigrated = 0
  let alreadyClean = 0          // visibleToUserIds == author + recipientIds exactly
  let needsBackfill = 0

  // Per-project: how many messages have this project's tag contributing implicit access
  // Key: projectId, Value: { name, messageCount, implicitUserCount (unique UIDs per project) }
  const perProjectStats = new Map()

  // Unique implicit user IDs across all messages
  const globalImplicitUsers = new Set()

  // Sample messages that need backfill (first 10)
  const sampleMessages = []

  for (const msgDoc of messagesSnap.docs) {
    const data = msgDoc.data()
    const msgId = msgDoc.id

    // ── Basic validation ──────────────────────────────────────────────────

    const authorId = (data.authorId || data.senderId || "").trim()
    if (!authorId) {
      noAuthorId++
      continue
    }

    if (!Array.isArray(data.visibleToUserIds) || data.visibleToUserIds.length === 0) {
      noVisibleToUserIds++
      continue
    }

    // ── Already migrated by this script ───────────────────────────────────

    if (data._migration === MIGRATION_ID) {
      alreadyMigrated++
      continue
    }

    // ── Compute implicit IDs ──────────────────────────────────────────────

    const visibleToUserIds = data.visibleToUserIds.filter(Boolean)
    const recipientIds = Array.isArray(data.recipientIds) ? data.recipientIds.filter(Boolean) : []

    // IDs in visibleToUserIds that are NOT the author and NOT in recipientIds
    const implicitIds = visibleToUserIds.filter(
      (uid) => uid !== authorId && !recipientIds.includes(uid)
    )

    if (implicitIds.length === 0) {
      alreadyClean++
      continue
    }

    needsBackfill++
    implicitIds.forEach((uid) => globalImplicitUsers.add(uid))

    // ── Per-project attribution (for reporting only, NOT for migration) ───
    // We report which project tags are present on these messages so the user
    // knows where implicit access is coming from. We do NOT use current
    // project.members — we only read tagIds from the message itself.
    const tagIds = Array.isArray(data.tagIds) ? data.tagIds : []
    for (const tagId of tagIds) {
      const projectId = parseProjectTagId(tagId)
      if (!projectId) continue
      if (!perProjectStats.has(projectId)) {
        perProjectStats.set(projectId, {
          name: projectNames.get(projectId) ?? `(deleted: ${projectId})`,
          messageCount: 0,
          implicitUserIds: new Set(),
        })
      }
      const stat = perProjectStats.get(projectId)
      stat.messageCount++
      implicitIds.forEach((uid) => stat.implicitUserIds.add(uid))
    }

    // ── Sample collection ─────────────────────────────────────────────────

    if (sampleMessages.length < 10) {
      sampleMessages.push({
        id: msgId,
        authorId,
        recipientIds,
        visibleToUserIds,
        implicitIds,
        tagIds: tagIds.filter((t) => t.startsWith(PROJECT_TAG_PREFIX)),
      })
    }
  }

  // ── Report ────────────────────────────────────────────────────────────────

  console.log("  ── Summary ────────────────────────────────────────")
  console.log(`  Total messages:              ${total}`)
  console.log(`  No authorId (skipped):       ${noAuthorId}`)
  console.log(`  No visibleToUserIds (skipped): ${noVisibleToUserIds}`)
  console.log(`  Already migrated (${MIGRATION_ID}):  ${alreadyMigrated}`)
  console.log(`  Already clean (no backfill):  ${alreadyClean}`)
  console.log(`  Need backfill:               ${needsBackfill}`)
  console.log(`  Unique implicit user IDs:    ${globalImplicitUsers.size}`)
  console.log("")

  if (noVisibleToUserIds > 0) {
    console.log(`  WARNING: ${noVisibleToUserIds} message(s) have no visibleToUserIds field.`)
    console.log(`  These are pre-migration messages. Run the following FIRST:`)
    console.log(`    pnpm emulator:migrate     (emulator)`)
    console.log(`    pnpm migrate:visible-to:prod  (production — see migrate-prod-visible-to.mjs)`)
    console.log(`  Then re-run this inspection.`)
    console.log("")
  }

  if (perProjectStats.size > 0) {
    console.log("  ── Per-project implicit access ─────────────────────")
    const sorted = [...perProjectStats.entries()]
      .sort((a, b) => b[1].messageCount - a[1].messageCount)
    for (const [projectId, stat] of sorted) {
      console.log(`  [${projectId}] "${stat.name}"`)
      console.log(`    Messages with implicit access: ${stat.messageCount}`)
      console.log(`    Unique implicit user IDs:      ${stat.implicitUserIds.size}`)
    }
    console.log("")
  }

  if (sampleMessages.length > 0) {
    console.log("  ── Sample messages needing backfill (first 10) ─────")
    for (const m of sampleMessages) {
      console.log(`  [${m.id}]`)
      console.log(`    authorId:         ${m.authorId}`)
      console.log(`    recipientIds:     [${m.recipientIds.join(", ") || "(empty)"}]`)
      console.log(`    visibleToUserIds: [${m.visibleToUserIds.join(", ")}]`)
      console.log(`    implicitIds:      [${m.implicitIds.join(", ")}]  ← to be promoted`)
      console.log(`    projectTags:      [${m.tagIds.join(", ") || "(none)"}]`)
    }
    console.log("")
  }

  console.log("  ── Next steps ──────────────────────────────────────")
  if (needsBackfill === 0) {
    console.log("  All messages are already clean. No backfill needed.")
    console.log("  Safe to remove tag-based visibility from computeVisibleToUserIds.")
  } else {
    console.log(`  ${needsBackfill} message(s) need backfill before removing tag-based visibility.`)
    console.log("")
    console.log("  Emulator (dry-run first, then apply):")
    console.log("    pnpm backfill:recipients:dry")
    console.log("    pnpm backfill:recipients")
    console.log("")
    console.log("  Production (dry-run first, then apply):")
    console.log("    pnpm backfill:recipients:dry:prod")
    console.log("    pnpm backfill:recipients:prod  # requires CONFIRM_PROD_MIGRATION=true")
  }
  console.log("══════════════════════════════════════════════════════")
  console.log("")
}

inspect().catch((err) => {
  console.error("")
  console.error("Inspection failed:", err.message)
  console.error(err.stack)
  process.exit(1)
})
