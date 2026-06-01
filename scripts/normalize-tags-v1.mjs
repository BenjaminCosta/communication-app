#!/usr/bin/env node
/**
 * normalize-tags-v1.mjs
 *
 * Tag/Category Normalization Migration — TagCategoriesV1
 *
 * ─── MODES ────────────────────────────────────────────────────────────────────
 *   --dry-run     Scan only, no writes. Reports what would change.
 *   --apply       Execute migration (requires CONFIRM_PROD_MIGRATION=true for prod).
 *   --verify      Validate that migration ran correctly.
 *   --rollback    Restore from logical backups (requires CONFIRM_PROD_MIGRATION=true for prod).
 *
 * ─── FLAGS ────────────────────────────────────────────────────────────────────
 *   --force       Re-process docs already marked as migrated.
 *   --batch-size=N  Writes per Firestore batch (default: 100, max: 200).
 *
 * ─── ENV VARS ─────────────────────────────────────────────────────────────────
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080   → runs against emulator
 *   CONFIRM_PROD_MIGRATION=true              → required for --apply / --rollback on prod
 *   GOOGLE_APPLICATION_CREDENTIALS          → path to service account JSON (prod only)
 *
 * ─── COMMANDS ─────────────────────────────────────────────────────────────────
 *   pnpm migrate:tags -- --dry-run
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 pnpm migrate:tags -- --dry-run
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 pnpm migrate:tags -- --apply
 *   CONFIRM_PROD_MIGRATION=true pnpm migrate:tags -- --apply --batch-size=100
 *   pnpm migrate:tags -- --verify
 *   CONFIRM_PROD_MIGRATION=true pnpm migrate:tags -- --rollback
 *
 * ─── WHAT IT DOES ─────────────────────────────────────────────────────────────
 *   1. Seeds /tagCategories with: status, date, task, custom
 *   2. Seeds /tags with system status tags: status:progress, status:decision,
 *      status:feedback, status:problem
 *   3. Migrates /messages: adds status:* tagIds from message.type,
 *      merges projectId/projectIds into tagIds, deduplicates
 *   4. Normalizes /projects: maps legacy tagCategory values to V1 model
 *
 * ─── WHAT IT DOES NOT DO ──────────────────────────────────────────────────────
 *   - Does NOT delete any documents
 *   - Does NOT remove legacy fields (type, projectId, projectIds)
 *   - Does NOT touch visibleToUserIds, peopleIds, recipientIds, calendarDates
 *   - Does NOT create project or report categories
 *   - Does NOT create date tags (Follow Up, Deadline, Scheduled, etc.)
 *   - Does NOT create Unassigned tag
 *   - Does NOT modify Firestore rules
 */

import { initializeApp, cert } from "firebase-admin/app"
import { getFirestore, FieldValue } from "firebase-admin/firestore"
import { readFileSync, existsSync } from "fs"

// ── Parse args ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const MODE = args.includes("--dry-run")  ? "dry-run"
           : args.includes("--apply")    ? "apply"
           : args.includes("--verify")   ? "verify"
           : args.includes("--rollback") ? "rollback"
           : null

const IS_FORCE = args.includes("--force")
const batchSizeArg = args.find(a => a.startsWith("--batch-size"))
const BATCH_SIZE = (() => {
  if (!batchSizeArg) return 100
  const raw = batchSizeArg.includes("=") ? batchSizeArg.split("=")[1] : args[args.indexOf(batchSizeArg) + 1]
  const n = parseInt(raw)
  return isNaN(n) ? 100 : Math.min(Math.max(n, 10), 200)
})()

if (!MODE) {
  console.error("")
  console.error("ERROR: Specify a mode: --dry-run, --apply, --verify, or --rollback")
  console.error("")
  console.error("Usage:")
  console.error("  pnpm migrate:tags -- --dry-run")
  console.error("  FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 pnpm migrate:tags -- --apply")
  console.error("  CONFIRM_PROD_MIGRATION=true pnpm migrate:tags -- --apply --batch-size=100")
  console.error("  pnpm migrate:tags -- --verify")
  console.error("  CONFIRM_PROD_MIGRATION=true pnpm migrate:tags -- --rollback")
  console.error("")
  process.exit(1)
}

// ── Env / safety checks ───────────────────────────────────────────────────────

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST
const isEmulator   = Boolean(emulatorHost)
const confirmProd  = process.env.CONFIRM_PROD_MIGRATION === "true"
const isDestructive = MODE === "apply" || MODE === "rollback"

if (!isEmulator && isDestructive && !confirmProd) {
  console.error("")
  console.error("ERROR: Running --" + MODE + " against PRODUCTION requires:")
  console.error("")
  console.error("  CONFIRM_PROD_MIGRATION=true pnpm migrate:tags -- --" + MODE)
  console.error("")
  console.error("To test safely against the emulator first:")
  console.error("  FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 pnpm migrate:tags -- --" + MODE)
  console.error("")
  process.exit(1)
}

if (isEmulator && !isEmulator) {
  // guard: can never be both
  console.error("ERROR: Conflicting env state.")
  process.exit(1)
}

// ── Firebase init ─────────────────────────────────────────────────────────────

let app
if (isEmulator) {
  app = initializeApp({ projectId: "svc-comms" })
} else {
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS ?? "./service-account.json"
  if (!existsSync(credPath)) {
    console.error(`ERROR: Service account not found at: ${credPath}`)
    console.error("Set GOOGLE_APPLICATION_CREDENTIALS or place service-account.json in project root.")
    process.exit(1)
  }
  const serviceAccount = JSON.parse(readFileSync(credPath, "utf8"))
  app = initializeApp({
    credential: cert(serviceAccount),
    projectId: serviceAccount.project_id,
  })
}

const db = getFirestore(app)

// ── Migration constants ───────────────────────────────────────────────────────

const SCRIPT_VERSION   = "2026-06-01-v1"
const MIGRATION_KEY    = "tagCategoriesV1"
const BACKUP_ROOT      = "_migrationBackups"

// V1 Category seed (status, date, task, custom ONLY — no project, no report)
const TAG_CATEGORIES_SEED = [
  { id: "status", name: "Status", slug: "status", isSystem: true, isLocked: true,  behavior: "none"       },
  { id: "date",   name: "Date",   slug: "date",   isSystem: true, isLocked: true,  behavior: "datePicker" },
  { id: "task",   name: "Task",   slug: "task",   isSystem: true, isLocked: false, behavior: "none"       },
  { id: "custom", name: "Custom", slug: "custom", isSystem: true, isLocked: false, behavior: "none"       },
]

// System status tags — created in /tags, NOT in /projects
// Date tags (Follow Up, Deadline, Scheduled...) are NOT created — date uses calendarDates
const SYSTEM_STATUS_TAGS_SEED = [
  { id: "status:progress", name: "Progress", categoryId: "status", isSystem: true, isLocked: true },
  { id: "status:decision", name: "Decision", categoryId: "status", isSystem: true, isLocked: true },
  { id: "status:feedback", name: "Feedback", categoryId: "status", isSystem: true, isLocked: true },
  { id: "status:problem",  name: "Problem",  categoryId: "status", isSystem: true, isLocked: true },
]

// Legacy message.type → new status:* tag mapping
const TYPE_TO_STATUS_TAG = {
  progress: "status:progress",
  decision: "status:decision",
  feedback: "status:feedback",
  problem:  "status:problem",
}

// ── Normalization helpers ─────────────────────────────────────────────────────

/**
 * Maps any legacy/unknown category ID to a V1 normalized category ID.
 *
 * V1 categories: status | date | task | custom
 *
 * Mapping rules:
 *   "status"                              → "status"
 *   "systemType"                          → "custom" (system type tags don't live in /projects)
 *   "date" | "timedate" | "date-time" |
 *   "timeDate" | "time/date"             → "date"
 *   "task"                               → "task"
 *   "project" | "report" | "priority" |
 *   "department" | "sales" | unknown |
 *   null | undefined                     → "custom"
 */
function normalizeCategoryId(input) {
  if (!input) return "custom"
  const s = String(input).toLowerCase().trim()
  if (s === "status") return "status"
  if (s === "date" || s === "timedate" || s === "date-time" || s === "time/date" || s === "timedate") return "date"
  if (s === "task") return "task"
  // Everything else (project, report, systemType, priority, department, sales, unknown) → custom
  return "custom"
}

/** Maps legacy message.type to the new status:* tag ID. Returns null for "none". */
function mapLegacyTypeToStatusTagId(type) {
  return TYPE_TO_STATUS_TAG[type] ?? null
}

/** Returns deduplicated, truthy tag ID array. */
function uniqueTagIds(ids) {
  return [...new Set((Array.isArray(ids) ? ids : []).filter(id => id && typeof id === "string"))]
}

/**
 * Computes the normalized tagIds for a message:
 * - Keeps all existing tagIds (conservative — never removes)
 * - Adds status:* tag if message.type is progress/decision/feedback/problem
 * - Merges project:* tags from projectId / projectIds
 * - Deduplicates
 *
 * NOTE: type:none is NOT added. Unassigned = absence of tags.
 */
function computeNewTagIds(message) {
  const ids = new Set()

  // 1. Preserve all existing tagIds (including old type:* if present — we don't remove)
  for (const id of uniqueTagIds(message.tagIds)) ids.add(id)

  // 2. Add status:* from message.type (if non-none)
  const statusTagId = mapLegacyTypeToStatusTagId(message.type)
  if (statusTagId) ids.add(statusTagId)

  // 3. Merge projectId as project:* tag
  if (message.projectId && typeof message.projectId === "string") {
    ids.add(`project:${message.projectId}`)
  }

  // 4. Merge all projectIds as project:* tags
  for (const pid of (Array.isArray(message.projectIds) ? message.projectIds : [])) {
    if (pid && typeof pid === "string") ids.add(`project:${pid}`)
  }

  return [...ids]
}

/** Returns true if the new tag IDs set differs from the current stored one. */
function tagIdsChanged(current, next) {
  const a = new Set(uniqueTagIds(current))
  const b = new Set(next)
  if (a.size !== b.size) return true
  for (const id of b) if (!a.has(id)) return true
  return false
}

/** Returns true if a message has no status tags, no project refs, no calendarDates. */
function isUnassigned(message) {
  const hasType       = message.type && message.type !== "none"
  const hasTagIds     = uniqueTagIds(message.tagIds).length > 0
  const hasProjectId  = Boolean(message.projectId)
  const hasProjectIds = Array.isArray(message.projectIds) && message.projectIds.filter(Boolean).length > 0
  const hasDates      = Array.isArray(message.calendarDates) && message.calendarDates.length > 0
  return !hasType && !hasTagIds && !hasProjectId && !hasProjectIds && !hasDates
}

// ── Batch writer ──────────────────────────────────────────────────────────────

class BatchWriter {
  constructor(db, size) {
    this._db    = db
    this._size  = size
    this._batch = db.batch()
    this._count = 0
    this._total = 0
  }
  set(ref, data, opts = {}) {
    opts.merge ? this._batch.set(ref, data, { merge: true }) : this._batch.set(ref, data)
    this._count++
    this._total++
  }
  update(ref, data) {
    this._batch.update(ref, data)
    this._count++
    this._total++
  }
  async flushIfNeeded() {
    if (this._count >= this._size) await this.flush()
  }
  async flush() {
    if (this._count > 0) {
      await this._batch.commit()
      this._batch = this._db.batch()
      this._count = 0
    }
  }
  async close() { await this.flush(); return this._total }
}

// ── Print helpers ─────────────────────────────────────────────────────────────

const LINE = "─".repeat(58)
const banner = (t) => { console.log(`\n${LINE}`); console.log(`  ${t}`); console.log(LINE) }
const row    = (label, value) => console.log(`  ${String(label).padEnd(40)} ${value}`)
const info   = (msg) => console.log(`  ℹ️   ${msg}`)
const warn   = (msg) => console.log(`  ⚠️   ${msg}`)

// ─────────────────────────────────────────────────────────────────────────────
// MODE: dry-run
// ─────────────────────────────────────────────────────────────────────────────

async function runDryRun() {
  banner("DRY RUN — Tag Categories V1 Migration")
  row("Target:", isEmulator ? `Emulator  (${emulatorHost})` : "⚠️  PRODUCTION  (read-only scan)")
  row("Script version:", SCRIPT_VERSION)
  console.log()

  const warnings = []

  // ── Scan /tagCategories ──────────────────────────────────────────────────
  banner("Scan: /tagCategories")
  const tcSnap  = await db.collection("tagCategories").get()
  const existCats = new Set(tcSnap.docs.map(d => d.id))
  const toCreateCats = TAG_CATEGORIES_SEED.filter(c => !existCats.has(c.id))
  row("Existing docs:", existCats.size.toString())
  row("Would create:", toCreateCats.length > 0 ? toCreateCats.map(c => c.id).join(", ") : "(none — all exist)")
  info("NOT creating: project, report")

  // ── Scan /tags ──────────────────────────────────────────────────────────
  banner("Scan: /tags (system status tags)")
  const tagsSnap   = await db.collection("tags").get()
  const existTags  = new Set(tagsSnap.docs.map(d => d.id))
  const toCreateTags = SYSTEM_STATUS_TAGS_SEED.filter(t => !existTags.has(t.id))
  row("Existing tags:", existTags.size.toString())
  row("Would create:", toCreateTags.length > 0 ? toCreateTags.map(t => t.id).join(", ") : "(none — all exist)")
  info("NOT creating date tags (Follow Up, Deadline, Scheduled, etc.)")
  info("NOT creating Unassigned tag")

  // ── Scan /messages ───────────────────────────────────────────────────────
  banner("Scan: /messages")
  const msgSnap = await db.collection("messages").get()
  const stats = {
    total: msgSnap.size,
    alreadyMigrated: 0,
    wouldMigrate: 0,
    noChange: 0,
    typeProgress: 0, typeProblem: 0, typeFeedback: 0, typeDecision: 0, typeNone: 0,
    withProjectId: 0, withProjectIds: 0, withExistingTagIds: 0,
    newTagIdsAdded: 0,
    unassigned: 0,
  }

  for (const doc of msgSnap.docs) {
    const m = doc.data()

    if (m.migration?.[MIGRATION_KEY]?.completed === true) {
      stats.alreadyMigrated++
      if (!IS_FORCE) continue
    }

    // Type breakdown
    if      (m.type === "progress") stats.typeProgress++
    else if (m.type === "problem")  stats.typeProblem++
    else if (m.type === "feedback") stats.typeFeedback++
    else if (m.type === "decision") stats.typeDecision++
    else                             stats.typeNone++

    if (m.projectId) stats.withProjectId++
    if (Array.isArray(m.projectIds) && m.projectIds.length > 0) stats.withProjectIds++
    if (Array.isArray(m.tagIds) && m.tagIds.length > 0) stats.withExistingTagIds++
    if (isUnassigned(m)) stats.unassigned++

    // Warn: type:none in tagIds
    if (Array.isArray(m.tagIds) && m.tagIds.includes("type:none")) {
      warnings.push(`Message ${doc.id}: contains "type:none" in tagIds (will be kept, NOT removed)`)
    }

    const newIds  = computeNewTagIds(m)
    const changed = tagIdsChanged(m.tagIds, newIds)

    if (changed) {
      stats.wouldMigrate++
      const added = newIds.filter(id => !uniqueTagIds(m.tagIds).includes(id))
      stats.newTagIdsAdded += added.length
    } else {
      stats.noChange++
    }
  }

  row("Total messages:", stats.total.toString())
  row("Already migrated:", `${stats.alreadyMigrated}${IS_FORCE ? " (--force: will re-process)" : " (will skip)"}`)
  row("Would migrate (tagIds change):", stats.wouldMigrate.toString())
  row("No change needed:", stats.noChange.toString())
  console.log()
  row("  type=progress:", `${stats.typeProgress}  → would add "status:progress"`)
  row("  type=problem:", `${stats.typeProblem}  → would add "status:problem"`)
  row("  type=feedback:", `${stats.typeFeedback}  → would add "status:feedback"`)
  row("  type=decision:", `${stats.typeDecision}  → would add "status:decision"`)
  row("  type=none/absent:", `${stats.typeNone}  → no tag added (type:none is NOT a tag)`)
  console.log()
  row("  with projectId:", stats.withProjectId.toString())
  row("  with projectIds:", stats.withProjectIds.toString())
  row("  with existing tagIds:", stats.withExistingTagIds.toString())
  row("  unassigned (nothing):", stats.unassigned.toString())
  row("  net new tagIds to add:", stats.newTagIdsAdded.toString())

  // Fields NOT touched
  info("NOT touching: visibleToUserIds, peopleIds, recipientIds, calendarDates, type, projectId, projectIds")

  // ── Scan /projects ───────────────────────────────────────────────────────
  banner("Scan: /projects")
  const projSnap = await db.collection("projects").get()
  const projStats = {
    total: projSnap.size,
    alreadyMigrated: 0,
    wouldMigrate: 0,
    noChange: 0,
    toStatus: 0, toDate: 0, toTask: 0, toCustom: 0,
    categoryBreakdown: {},
  }

  for (const doc of projSnap.docs) {
    const p = doc.data()

    if (p.migration?.[MIGRATION_KEY]?.completed === true) {
      projStats.alreadyMigrated++
      if (!IS_FORCE) continue
    }

    const current    = p.tagCategory ?? "(absent)"
    const normalized = normalizeCategoryId(p.tagCategory)

    // Track breakdown of current categories
    projStats.categoryBreakdown[current] = (projStats.categoryBreakdown[current] ?? 0) + 1

    if (String(p.tagCategory) === normalized) {
      projStats.noChange++
    } else {
      projStats.wouldMigrate++
      if      (normalized === "status") projStats.toStatus++
      else if (normalized === "date")   projStats.toDate++
      else if (normalized === "task")   projStats.toTask++
      else                               projStats.toCustom++
    }
  }

  row("Total projects:", projStats.total.toString())
  row("Already migrated:", projStats.alreadyMigrated.toString())
  row("Would normalize:", projStats.wouldMigrate.toString())
  row("No change needed:", projStats.noChange.toString())
  console.log()

  // Category breakdown
  const breakdown = Object.entries(projStats.categoryBreakdown).sort((a, b) => b[1] - a[1])
  if (breakdown.length > 0) {
    console.log("  Current tagCategory distribution:")
    for (const [cat, count] of breakdown) {
      const normalized = normalizeCategoryId(cat === "(absent)" ? null : cat)
      const arrow = (cat === "(absent)" || String(cat) !== normalized) ? ` → "${normalized}"` : " ✓ (no change)"
      row(`    "${cat}": ${count}`, arrow)
    }
  }

  info(`"project" → "custom"  (Project is no longer a category in V1)`)
  info(`"report"  → "custom"  (Report is no longer a category in V1)`)
  info(`"timedate" → "date"   (renamed in V1)`)

  // ── Warnings ────────────────────────────────────────────────────────────
  if (warnings.length > 0) {
    banner("Warnings")
    warnings.forEach(w => warn(w))
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  banner("Summary — What --apply would do")
  const totalWrites = toCreateCats.length + toCreateTags.length
    + stats.wouldMigrate * 2   // backup + update per message
    + projStats.wouldMigrate * 2  // backup + update per project
  row("Create /tagCategories docs:", toCreateCats.length.toString())
  row("Create /tags (system) docs:", toCreateTags.length.toString())
  row("Create backup docs:", (stats.wouldMigrate + projStats.wouldMigrate).toString())
  row("Update /messages:", stats.wouldMigrate.toString())
  row("Update /projects:", projStats.wouldMigrate.toString())
  row("Estimated total Firestore writes:", totalWrites.toString())
  console.log("\n  No writes performed (dry-run).\n")
}

// ─────────────────────────────────────────────────────────────────────────────
// MODE: apply
// ─────────────────────────────────────────────────────────────────────────────

async function runApply() {
  banner("APPLY — Tag Categories V1 Migration")
  row("Target:", isEmulator ? `Emulator  (${emulatorHost})` : "⚠️  PRODUCTION")
  row("Script version:", SCRIPT_VERSION)
  row("Batch size:", BATCH_SIZE.toString())
  row("Force:", IS_FORCE ? "yes — re-processes already-migrated docs" : "no — skips migrated docs")
  if (!isEmulator) {
    console.log()
    warn("PRODUCTION MODE — CONFIRM_PROD_MIGRATION=true is set. Proceeding.")
  }
  console.log()

  const now = FieldValue.serverTimestamp()

  // ── Step 1: Seed /tagCategories ───────────────────────────────────────────
  banner("Step 1/4 — Seed /tagCategories")
  info("Creating: status, date, task, custom")
  info("NOT creating: project, report")
  const w1 = new BatchWriter(db, BATCH_SIZE)
  let catCreated = 0, catSkipped = 0
  for (const cat of TAG_CATEGORIES_SEED) {
    const ref  = db.collection("tagCategories").doc(cat.id)
    const snap = await ref.get()
    if (snap.exists && !IS_FORCE) {
      catSkipped++
      console.log(`  [skip]  tagCategories/${cat.id}  (exists)`)
      continue
    }
    w1.set(ref, { ...cat, createdAt: now, updatedAt: now }, { merge: true })
    catCreated++
    console.log(`  [seed]  tagCategories/${cat.id}  "${cat.name}"  isLocked=${cat.isLocked}  behavior=${cat.behavior}`)
    await w1.flushIfNeeded()
  }
  await w1.close()
  row("Created:", catCreated.toString())
  row("Skipped:", catSkipped.toString())

  // ── Step 2: Seed /tags (system status tags) ───────────────────────────────
  banner("Step 2/4 — Seed /tags (system status tags)")
  info("Creating: status:progress, status:decision, status:feedback, status:problem")
  info("NOT creating date tags, NOT creating Unassigned")
  const w2 = new BatchWriter(db, BATCH_SIZE)
  let tagCreated = 0, tagSkipped = 0
  for (const tag of SYSTEM_STATUS_TAGS_SEED) {
    const ref  = db.collection("tags").doc(tag.id)
    const snap = await ref.get()
    if (snap.exists && !IS_FORCE) {
      tagSkipped++
      console.log(`  [skip]  tags/${tag.id}  (exists)`)
      continue
    }
    w2.set(ref, { ...tag, createdAt: now, updatedAt: now }, { merge: true })
    tagCreated++
    console.log(`  [seed]  tags/${tag.id}  "${tag.name}"`)
    await w2.flushIfNeeded()
  }
  await w2.close()
  row("Created:", tagCreated.toString())
  row("Skipped:", tagSkipped.toString())

  // ── Step 3: Migrate /messages ─────────────────────────────────────────────
  banner("Step 3/4 — Migrate /messages")
  info("Adding status:* tagIds from message.type")
  info("Merging project:* from projectId / projectIds")
  info("NOT removing any existing tagIds")
  info("NOT touching: type, projectId, projectIds, visibleToUserIds, peopleIds, recipientIds, calendarDates")

  const msgSnap = await db.collection("messages").get()
  const w3 = new BatchWriter(db, BATCH_SIZE)
  let msgMigrated = 0, msgSkipped = 0, msgNoChange = 0
  let progress = 0

  for (const doc of msgSnap.docs) {
    const m = doc.data()
    progress++

    // Idempotency: skip if already migrated (unless --force)
    if (m.migration?.[MIGRATION_KEY]?.completed === true && !IS_FORCE) {
      msgSkipped++
      continue
    }

    const newTagIds = computeNewTagIds(m)
    const changed   = tagIdsChanged(m.tagIds, newTagIds)

    if (!changed && m.migration?.[MIGRATION_KEY]?.completed === true) {
      msgNoChange++
      continue
    }

    // Write logical backup
    const backupRef = db
      .collection(BACKUP_ROOT).doc(MIGRATION_KEY)
      .collection("messages").doc(doc.id)
    w3.set(backupRef, {
      messageId:              doc.id,
      previousTagIds:         m.tagIds          ?? [],
      previousType:           m.type            ?? null,
      previousProjectId:      m.projectId       ?? null,
      previousProjectIds:     m.projectIds      ?? [],
      previousCalendarDates:  m.calendarDates   ?? [],
      previousMigration:      m.migration       ?? null,
      backedUpAt:             now,
      scriptVersion:          SCRIPT_VERSION,
    })
    await w3.flushIfNeeded()

    // Apply migration
    w3.update(doc.ref, {
      tagIds: newTagIds,
      [`migration.${MIGRATION_KEY}.completed`]:     true,
      [`migration.${MIGRATION_KEY}.migratedAt`]:    now,
      [`migration.${MIGRATION_KEY}.scriptVersion`]: SCRIPT_VERSION,
    })
    await w3.flushIfNeeded()
    msgMigrated++

    if (msgMigrated % 100 === 0) {
      console.log(`  ... ${msgMigrated} messages migrated (${progress}/${msgSnap.size} scanned)`)
    }
  }
  await w3.close()
  row("Migrated:", msgMigrated.toString())
  row("Skipped (already done):", msgSkipped.toString())
  row("Skipped (no change needed):", msgNoChange.toString())

  // ── Step 4: Normalize /projects ───────────────────────────────────────────
  banner("Step 4/4 — Normalize /projects tagCategory")
  info("Mapping: project → custom, report → custom, timedate → date, systemType → custom")
  info("Keeping: status, task, custom, date (already valid)")
  info("NOT removing any project documents or fields")

  const projSnap = await db.collection("projects").get()
  const w4 = new BatchWriter(db, BATCH_SIZE)
  let projMigrated = 0, projSkipped = 0, projNoChange = 0

  for (const doc of projSnap.docs) {
    const p = doc.data()

    // Idempotency
    if (p.migration?.[MIGRATION_KEY]?.completed === true && !IS_FORCE) {
      projSkipped++
      continue
    }

    const current    = p.tagCategory
    const normalized = normalizeCategoryId(current)
    const changed    = String(current ?? "") !== normalized

    // Write logical backup
    const backupRef = db
      .collection(BACKUP_ROOT).doc(MIGRATION_KEY)
      .collection("projects").doc(doc.id)
    w4.set(backupRef, {
      projectId:           doc.id,
      previousTagCategory: current ?? null,
      previousName:        p.name  ?? null,
      previousMigration:   p.migration ?? null,
      backedUpAt:          now,
      scriptVersion:       SCRIPT_VERSION,
    })
    await w4.flushIfNeeded()

    // Apply migration
    const update = {
      [`migration.${MIGRATION_KEY}.completed`]:     true,
      [`migration.${MIGRATION_KEY}.migratedAt`]:    now,
      [`migration.${MIGRATION_KEY}.scriptVersion`]: SCRIPT_VERSION,
    }
    if (changed) {
      update.tagCategory = normalized
      console.log(`  [normalize]  ${doc.id}  "${p.name}"  "${current ?? "(absent)"}" → "${normalized}"`)
    }
    w4.update(doc.ref, update)
    await w4.flushIfNeeded()
    changed ? projMigrated++ : projNoChange++
  }
  await w4.close()
  row("Normalized:", projMigrated.toString())
  row("No change needed:", projNoChange.toString())
  row("Skipped (already done):", projSkipped.toString())

  // ── Complete ───────────────────────────────────────────────────────────────
  banner("COMPLETE")
  row("tagCategories seeded:", catCreated.toString())
  row("system tags seeded:", tagCreated.toString())
  row("messages migrated:", msgMigrated.toString())
  row("projects normalized:", projMigrated.toString())
  console.log("\n  Migration complete. Run --verify to validate.\n")
}

// ─────────────────────────────────────────────────────────────────────────────
// MODE: verify
// ─────────────────────────────────────────────────────────────────────────────

async function runVerify() {
  banner("VERIFY — Tag Categories V1 Migration")
  row("Target:", isEmulator ? `Emulator  (${emulatorHost})` : "PRODUCTION")
  console.log()

  let passed = 0, failed = 0
  const failures = []

  function assert(ok, label, detail = "") {
    if (ok) {
      console.log(`  ✅  PASS  ${label}`)
      passed++
    } else {
      console.log(`  ❌  FAIL  ${label}${detail ? `\n            ${detail}` : ""}`)
      failed++
      failures.push(`${label}${detail ? ` (${detail})` : ""}`)
    }
  }

  // ── 1. /tagCategories ─────────────────────────────────────────────────────
  banner("1/5 — /tagCategories")
  const requiredCatIds = ["status", "date", "task", "custom"]
  for (const catId of requiredCatIds) {
    const snap = await db.collection("tagCategories").doc(catId).get()
    assert(snap.exists, `tagCategories/${catId} exists`)
    if (snap.exists) {
      const d = snap.data()
      assert(d.isSystem === true,          `tagCategories/${catId}.isSystem = true`)
      assert(typeof d.behavior === "string", `tagCategories/${catId}.behavior is a string`)
      assert(typeof d.slug === "string",    `tagCategories/${catId}.slug is set`)
      if (catId === "status") assert(d.isLocked === true,  `tagCategories/status.isLocked = true`)
      if (catId === "date")   assert(d.behavior === "datePicker", `tagCategories/date.behavior = "datePicker"`)
    }
  }

  // Guard: project and report must NOT have been created by this script
  for (const catId of ["project", "report"]) {
    const snap = await db.collection("tagCategories").doc(catId).get()
    const createdByThisScript = snap.exists && snap.data()?.migration?.[MIGRATION_KEY]?.scriptVersion === SCRIPT_VERSION
    assert(!createdByThisScript, `tagCategories/${catId} NOT created by this migration`)
  }

  // ── 2. /tags ──────────────────────────────────────────────────────────────
  banner("2/5 — /tags (system status tags)")
  const requiredTagIds = ["status:progress", "status:decision", "status:feedback", "status:problem"]
  for (const tagId of requiredTagIds) {
    const snap = await db.collection("tags").doc(tagId).get()
    assert(snap.exists, `tags/${tagId} exists`)
    if (snap.exists) {
      const d = snap.data()
      assert(d.categoryId === "status", `tags/${tagId}.categoryId = "status"`)
      assert(d.isSystem === true,       `tags/${tagId}.isSystem = true`)
      assert(d.isLocked === true,       `tags/${tagId}.isLocked = true`)
    }
  }

  // Guard: no date tags created
  const dateTagsSnap = await db.collection("tags").where("categoryId", "==", "date").get()
  assert(dateTagsSnap.empty, "No date category tags created (Date uses calendarDates, not tags)")

  // Guard: no Unassigned tag
  const unassignedSnap = await db.collection("tags").doc("type:none").get()
  assert(!unassignedSnap.exists, `tags/type:none NOT created (Unassigned = absence of tags)`)

  // ── 3. /messages ─────────────────────────────────────────────────────────
  banner("3/5 — /messages")
  const msgSnap    = await db.collection("messages").get()
  let msgTotal     = msgSnap.size
  let statusMissing = 0
  let typeNoneAdded = 0
  let hasDuplicates = 0
  let calDatesOK    = true
  let visibilityOK  = true

  for (const doc of msgSnap.docs) {
    const m = doc.data()
    if (!m.migration?.[MIGRATION_KEY]?.completed) continue

    const tagIds = uniqueTagIds(m.tagIds)

    // Check: type:progress/decision/feedback/problem have correct status:* tag
    if (m.type && TYPE_TO_STATUS_TAG[m.type]) {
      const expected = TYPE_TO_STATUS_TAG[m.type]
      if (!tagIds.includes(expected)) {
        statusMissing++
        failures.push(`Message ${doc.id}: type="${m.type}" missing "${expected}" in tagIds`)
      }
    }

    // Check: type:none was NOT added by migration
    // (We can't distinguish pre-existing from migration-added, so just count)
    if (tagIds.includes("type:none")) typeNoneAdded++

    // Check: no duplicate tagIds
    if (new Set(m.tagIds ?? []).size !== (m.tagIds ?? []).length) hasDuplicates++
  }

  assert(statusMissing === 0,
    "All type:progress/decision/feedback/problem messages have their status:* tagId",
    statusMissing > 0 ? `${statusMissing} messages missing expected status tag` : "")
  assert(hasDuplicates === 0,
    "No duplicate tagIds in any migrated message",
    hasDuplicates > 0 ? `${hasDuplicates} messages with duplicate tagIds` : "")
  info(`Messages with type:none in tagIds: ${typeNoneAdded} (may be pre-existing — not added by this migration)`)
  info(`Total messages scanned: ${msgTotal}`)

  // ── 4. /projects ─────────────────────────────────────────────────────────
  banner("4/5 — /projects")
  const projSnap = await db.collection("projects").get()
  const VALID_V1_CATS  = new Set(["status", "date", "task", "custom"])
  let projInvalid = 0, projWithProject = 0, projWithReport = 0

  for (const doc of projSnap.docs) {
    const p = doc.data()
    if (!p.migration?.[MIGRATION_KEY]?.completed) continue

    const cat = p.tagCategory
    if (cat && !VALID_V1_CATS.has(cat)) {
      projInvalid++
      failures.push(`Project ${doc.id}: invalid V1 category "${cat}"`)
    }
    if (cat === "project") projWithProject++
    if (cat === "report")  projWithReport++
  }

  assert(projInvalid === 0,
    "All migrated projects have a valid V1 category (status | date | task | custom)",
    projInvalid > 0 ? `${projInvalid} projects with invalid category` : "")
  assert(projWithProject === 0,
    `No migrated projects have category "project"`,
    projWithProject > 0 ? `${projWithProject} still have "project"` : "")
  assert(projWithReport === 0,
    `No migrated projects have category "report"`,
    projWithReport > 0 ? `${projWithReport} still have "report"` : "")
  info(`Total projects scanned: ${projSnap.size}`)

  // ── 5. Backups ────────────────────────────────────────────────────────────
  banner("5/5 — Backups")
  const msgBackSnap  = await db.collection(BACKUP_ROOT).doc(MIGRATION_KEY).collection("messages").limit(1).get()
  const projBackSnap = await db.collection(BACKUP_ROOT).doc(MIGRATION_KEY).collection("projects").limit(1).get()
  assert(!msgBackSnap.empty  || msgSnap.size === 0,  `Message backups exist at ${BACKUP_ROOT}/${MIGRATION_KEY}/messages/`)
  assert(!projBackSnap.empty || projSnap.size === 0, `Project backups exist at ${BACKUP_ROOT}/${MIGRATION_KEY}/projects/`)

  // ── Results ───────────────────────────────────────────────────────────────
  banner("RESULTS")
  row("Tests passed:", passed.toString())
  row("Tests failed:", failed.toString())

  if (failures.length > 0) {
    console.log("\n  Failures:")
    failures.forEach(f => console.log(`    ❌  ${f}`))
  }
  console.log()
  process.exit(failed > 0 ? 1 : 0)
}

// ─────────────────────────────────────────────────────────────────────────────
// MODE: rollback
// ─────────────────────────────────────────────────────────────────────────────

async function runRollback() {
  banner("ROLLBACK — Tag Categories V1 Migration")
  row("Target:", isEmulator ? `Emulator  (${emulatorHost})` : "⚠️  PRODUCTION")
  row("Script version:", SCRIPT_VERSION)
  row("Force:", IS_FORCE ? "yes — re-rollback already-rolled-back docs" : "no")
  if (!isEmulator) {
    console.log()
    warn("PRODUCTION ROLLBACK — CONFIRM_PROD_MIGRATION=true is set. Proceeding.")
    warn("Restoring data from logical backups in: " + BACKUP_ROOT + "/" + MIGRATION_KEY)
  }
  console.log()

  const now = FieldValue.serverTimestamp()

  // ── Rollback /messages ────────────────────────────────────────────────────
  banner("1/3 — Rollback /messages")
  const msgBackSnap = await db
    .collection(BACKUP_ROOT).doc(MIGRATION_KEY).collection("messages").get()

  if (msgBackSnap.empty) {
    info("No message backups found. Nothing to rollback for messages.")
  }

  const wm = new BatchWriter(db, BATCH_SIZE)
  let msgRolledBack = 0, msgSkipped = 0, msgMissing = 0

  for (const backupDoc of msgBackSnap.docs) {
    const backup = backupDoc.data()
    const msgRef = db.collection("messages").doc(backup.messageId)
    const msgSnap = await msgRef.get()

    if (!msgSnap.exists) {
      msgMissing++
      warn(`Message ${backup.messageId} no longer exists — cannot rollback`)
      continue
    }

    const current = msgSnap.data()

    // Idempotency: skip if already rolled back
    if (current.migration?.[MIGRATION_KEY]?.rolledBack === true && !IS_FORCE) {
      msgSkipped++
      continue
    }

    // Restore previousTagIds; mark as rolled back
    wm.update(msgRef, {
      tagIds: backup.previousTagIds ?? [],
      [`migration.${MIGRATION_KEY}.completed`]:    false,
      [`migration.${MIGRATION_KEY}.rolledBack`]:   true,
      [`migration.${MIGRATION_KEY}.rolledBackAt`]: now,
    })
    await wm.flushIfNeeded()
    msgRolledBack++
  }
  await wm.close()
  row("Messages rolled back:", msgRolledBack.toString())
  row("Skipped (already rolled back):", msgSkipped.toString())
  row("Missing (cannot rollback):", msgMissing.toString())

  // ── Rollback /projects ────────────────────────────────────────────────────
  banner("2/3 — Rollback /projects")
  const projBackSnap = await db
    .collection(BACKUP_ROOT).doc(MIGRATION_KEY).collection("projects").get()

  if (projBackSnap.empty) {
    info("No project backups found. Nothing to rollback for projects.")
  }

  const wp = new BatchWriter(db, BATCH_SIZE)
  let projRolledBack = 0, projSkipped = 0, projMissing = 0

  for (const backupDoc of projBackSnap.docs) {
    const backup  = backupDoc.data()
    const projRef = db.collection("projects").doc(backup.projectId)
    const projSnap = await projRef.get()

    if (!projSnap.exists) {
      projMissing++
      warn(`Project ${backup.projectId} no longer exists — cannot rollback`)
      continue
    }

    const current = projSnap.data()

    if (current.migration?.[MIGRATION_KEY]?.rolledBack === true && !IS_FORCE) {
      projSkipped++
      continue
    }

    const update = {
      [`migration.${MIGRATION_KEY}.completed`]:    false,
      [`migration.${MIGRATION_KEY}.rolledBack`]:   true,
      [`migration.${MIGRATION_KEY}.rolledBackAt`]: now,
    }

    // Restore tagCategory (null means it was absent — use FieldValue.delete())
    if (backup.previousTagCategory !== undefined && backup.previousTagCategory !== null) {
      update.tagCategory = backup.previousTagCategory
    } else {
      update.tagCategory = FieldValue.delete()
    }

    wp.update(projRef, update)
    await wp.flushIfNeeded()
    projRolledBack++
    console.log(`  [rollback]  ${backup.projectId}  "${backup.previousName}"  → "${backup.previousTagCategory ?? "(absent)"}"`)
  }
  await wp.close()
  row("Projects rolled back:", projRolledBack.toString())
  row("Skipped (already rolled back):", projSkipped.toString())
  row("Missing (cannot rollback):", projMissing.toString())

  // ── Mark seed docs as rolled back (NOT deleted) ───────────────────────────
  banner("3/3 — Mark seed docs as rolled back (conservative — no deletes)")
  const ws = new BatchWriter(db, BATCH_SIZE)
  let seedMarked = 0

  for (const cat of TAG_CATEGORIES_SEED) {
    const ref  = db.collection("tagCategories").doc(cat.id)
    const snap = await ref.get()
    if (snap.exists) {
      ws.update(ref, {
        [`migration.${MIGRATION_KEY}.rolledBack`]:   true,
        [`migration.${MIGRATION_KEY}.rolledBackAt`]: now,
      })
      seedMarked++
      console.log(`  [mark-rolledback]  tagCategories/${cat.id}`)
    }
  }
  for (const tag of SYSTEM_STATUS_TAGS_SEED) {
    const ref  = db.collection("tags").doc(tag.id)
    const snap = await ref.get()
    if (snap.exists) {
      ws.update(ref, {
        [`migration.${MIGRATION_KEY}.rolledBack`]:   true,
        [`migration.${MIGRATION_KEY}.rolledBackAt`]: now,
      })
      seedMarked++
      console.log(`  [mark-rolledback]  tags/${tag.id}`)
    }
  }
  await ws.close()
  row("Seed docs marked as rolled back:", seedMarked.toString())
  info("Seed docs are NOT deleted — conservative rollback. Delete manually if needed.")

  banner("ROLLBACK COMPLETE")
  console.log("  Rollback finished. Run --verify to check state.\n")
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const modeLabel = { "dry-run": "DRY RUN", apply: "APPLY", verify: "VERIFY", rollback: "ROLLBACK" }[MODE]
  const targetLabel = isEmulator ? `Emulator (${emulatorHost})` : "PRODUCTION"

  console.log(`\n╔══════════════════════════════════════════════════════════╗`)
  console.log(`║   normalize-tags-v1.mjs  —  TagCategoriesV1              ║`)
  console.log(`║   Mode:    ${(modeLabel + " ".repeat(50)).slice(0, 48)}  ║`)
  console.log(`║   Target:  ${(targetLabel + " ".repeat(50)).slice(0, 48)}  ║`)
  console.log(`╚══════════════════════════════════════════════════════════╝`)

  if      (MODE === "dry-run")  await runDryRun()
  else if (MODE === "apply")    await runApply()
  else if (MODE === "verify")   await runVerify()
  else if (MODE === "rollback") await runRollback()
}

main().catch(err => {
  console.error("\n❌  Fatal error:", err.message)
  console.error(err.stack)
  process.exit(1)
})
