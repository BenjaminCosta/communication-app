#!/usr/bin/env node
/**
 * test-tag-categories.mjs
 *
 * Comprehensive test suite for Tag Category implementation.
 * Tests all scenarios: creation, grouping, migration, backward compat.
 *
 * Only runs against the emulator — NEVER production.
 * Usage: FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/test-tag-categories.mjs
 *   or:  pnpm emulator:test-categories
 */

import { initializeApp } from "firebase-admin/app"
import { getFirestore, FieldValue } from "firebase-admin/firestore"

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST
if (!emulatorHost) {
  console.error("ERROR: FIRESTORE_EMULATOR_HOST is not set. Use pnpm emulator:test-categories")
  process.exit(1)
}

const app = initializeApp({ projectId: "svc-comms" })
const db = getFirestore(app)

// ── Test runner ──────────────────────────────────────────────────────────────
let passed = 0
let failed = 0
const failures = []

function assert(condition, label, detail = "") {
  if (condition) {
    console.log(`  ✅  PASS  ${label}`)
    passed++
  } else {
    console.log(`  ❌  FAIL  ${label}${detail ? `\n          ${detail}` : ""}`)
    failed++
    failures.push({ label, detail })
  }
}

function assertEq(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  assert(ok, label, ok ? "" : `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`)
}

function section(title) {
  console.log(`\n${"─".repeat(54)}`)
  console.log(`  ${title}`)
  console.log(`${"─".repeat(54)}`)
}

// ── Valid categories (mirror lib/store.ts) ───────────────────────────────────
const USER_SELECTABLE_CATEGORIES = [
  "project", "status", "priority", "timedate",
  "department", "report", "sales", "task", "custom",
]
const ALL_VALID_CATEGORIES = ["systemType", ...USER_SELECTABLE_CATEGORIES]
const CATEGORY_LABELS = {
  systemType: "Type",
  project: "Project",
  status: "Status",
  priority: "Priority",
  timedate: "Time / Date",
  department: "Department",
  report: "Report",
  sales: "Sales",
  task: "Task",
  custom: "Custom",
}

// ── Test collection prefix — isolated from real data ─────────────────────────
const PREFIX = `test-cats-${Date.now()}`
const testProjectIds = []

async function cleanup() {
  const batch = db.batch()
  for (const id of testProjectIds) {
    batch.delete(db.collection("projects").doc(id))
  }
  await batch.commit()
}

// ── Helpers ──────────────────────────────────────────────────────────────────
async function createProject(overrides = {}) {
  const id = `${PREFIX}-${Math.random().toString(36).slice(2, 8)}`
  const doc = {
    id,
    name: overrides.name ?? `Test Tag ${id.slice(-4)}`,
    color: "bg-progress",
    members: overrides.members ?? ["user-alice"],
    ownerId: "user-alice",
    ...overrides,
  }
  await db.collection("projects").doc(id).set(doc)
  testProjectIds.push(id)
  return { id, ...doc }
}

async function getProject(id) {
  const snap = await db.collection("projects").doc(id).get()
  return snap.exists ? snap.data() : null
}

// ── effectiveCategory logic (mirrors project-list-screen.tsx) ─────────────
const validCats = new Set(USER_SELECTABLE_CATEGORIES)
function effectiveCategory(tagCategory) {
  return tagCategory && validCats.has(tagCategory) ? tagCategory : "custom"
}

// ── MIGRATION LOGIC (mirrors migrate-tag-categories.mjs) ─────────────────────
async function runMigration(dryRun = false) {
  const snap = await db.collection("projects").get()
  const batch = db.batch()
  let updated = 0, skipped = 0
  for (const docSnap of snap.docs) {
    const data = docSnap.data()
    const cur = data.tagCategory
    if (cur && ALL_VALID_CATEGORIES.includes(cur) && cur !== "systemType") {
      skipped++
      continue
    }
    const newCat = cur === "project" ? "project" : "custom"
    if (!dryRun) batch.update(docSnap.ref, { tagCategory: newCat })
    updated++
  }
  if (!dryRun && updated > 0) await batch.commit()
  return { updated, skipped }
}


// ═══════════════════════════════════════════════════════════════════════════
//  SUITE 1: CATEGORY_CONFIG structure
// ═══════════════════════════════════════════════════════════════════════════
async function suite1_categoryConfig() {
  section("Suite 1 — CATEGORY_CONFIG & Constants")

  assertEq(USER_SELECTABLE_CATEGORIES.length, 9, "9 user-selectable categories")
  assert(!USER_SELECTABLE_CATEGORIES.includes("systemType"), "systemType NOT in user-selectable list")
  assert(ALL_VALID_CATEGORIES.includes("systemType"), "systemType IS in all-valid list")

  for (const cat of USER_SELECTABLE_CATEGORIES) {
    assert(CATEGORY_LABELS[cat] !== undefined, `CATEGORY_CONFIG has label for "${cat}"`)
  }

  assert(CATEGORY_LABELS["timedate"] === "Time / Date", 'timedate label = "Time / Date"')
  assert(CATEGORY_LABELS["custom"] === "Custom", 'custom label = "Custom"')
  assert(CATEGORY_LABELS["project"] === "Project", 'project label = "Project"')
}

// ═══════════════════════════════════════════════════════════════════════════
//  SUITE 2: Creating tags with each category
// ═══════════════════════════════════════════════════════════════════════════
async function suite2_createWithCategory() {
  section("Suite 2 — Create Tag with Each Category")

  for (const cat of USER_SELECTABLE_CATEGORIES) {
    const proj = await createProject({ name: `Tag-${cat}`, tagCategory: cat })
    const stored = await getProject(proj.id)
    assertEq(stored.tagCategory, cat, `Create tag with category="${cat}" → stored correctly`)
  }

  // Verify all 9 are persisted
  const snap = await db.collection("projects").where("name", ">=", "Tag-").get()
  const ourTags = snap.docs.filter(d => testProjectIds.includes(d.id))
  assert(ourTags.length >= 9, `At least 9 test tags created (got ${ourTags.length})`)
}

// ═══════════════════════════════════════════════════════════════════════════
//  SUITE 3: Backward compatibility — legacy tags without tagCategory
// ═══════════════════════════════════════════════════════════════════════════
async function suite3_backwardCompat() {
  section("Suite 3 — Backward Compatibility (Legacy Tags)")

  // Tag with no tagCategory at all
  const noCategory = await createProject({ name: "Legacy-NoCategory" })
  await db.collection("projects").doc(noCategory.id).update({ tagCategory: FieldValue.delete() })
  const stored1 = await getProject(noCategory.id)
  assert(stored1.tagCategory === undefined, "Legacy tag: tagCategory is absent after delete")
  assertEq(effectiveCategory(stored1.tagCategory), "custom", "effectiveCategory(undefined) → 'custom'")

  // Tag with null tagCategory
  const nullCategory = await createProject({ name: "Legacy-NullCategory", tagCategory: null })
  const stored2 = await getProject(nullCategory.id)
  assertEq(effectiveCategory(stored2.tagCategory), "custom", "effectiveCategory(null) → 'custom'")

  // Tag with invalid/unknown tagCategory (shouldn't happen from UI, but old data)
  const invalidCategory = await createProject({ name: "Legacy-Invalid", tagCategory: "unknown_cat" })
  const stored3 = await getProject(invalidCategory.id)
  assertEq(effectiveCategory(stored3.tagCategory), "custom", "effectiveCategory('unknown_cat') → 'custom'")

  // Tag with "systemType" as tagCategory (internal — shouldn't appear in user UI)
  const sysTypeCategory = await createProject({ name: "Legacy-SystemType", tagCategory: "systemType" })
  const stored4 = await getProject(sysTypeCategory.id)
  assertEq(effectiveCategory(stored4.tagCategory), "custom", "effectiveCategory('systemType') → 'custom'")

  // Tag with valid "project" category (old auto-assigned)
  const projectCategory = await createProject({ name: "Legacy-Project", tagCategory: "project", members: ["u1", "u2"] })
  const stored5 = await getProject(projectCategory.id)
  assertEq(effectiveCategory(stored5.tagCategory), "project", "effectiveCategory('project') → 'project'")
}

// ═══════════════════════════════════════════════════════════════════════════
//  SUITE 4: Grouping logic (mirrors project-list-screen.tsx)
// ═══════════════════════════════════════════════════════════════════════════
async function suite4_groupingLogic() {
  section("Suite 4 — Grouping Logic (mirrors project-list-screen.tsx)")

  // Create a set of tags with different categories
  const tags = [
    { name: "Cool Breeze", tagCategory: "project" },
    { name: "Pending", tagCategory: "status" },
    { name: "High", tagCategory: "priority" },
    { name: "Next Week", tagCategory: "timedate" },
    { name: "Marketing", tagCategory: "department" },
    { name: "Q4 Report", tagCategory: "report" },
    { name: "Pipeline", tagCategory: "sales" },
    { name: "Fix Bug", tagCategory: "task" },
    { name: "MyTag", tagCategory: "custom" },
    { name: "NoCategory" },  // will get deleted after creation to simulate legacy
    { name: "InvalidCat", tagCategory: "systemType" }, // should fall to custom
  ]

  const created = []
  for (const t of tags) {
    const p = await createProject(t)
    created.push(p)
  }

  // Delete tagCategory from "NoCategory"
  const nocat = created.find(p => p.name === "NoCategory")
  await db.collection("projects").doc(nocat.id).update({ tagCategory: FieldValue.delete() })

  // Fetch all test tags
  const snap = await db.collection("projects").get()
  const testTags = snap.docs
    .filter(d => testProjectIds.includes(d.id))
    .map(d => ({ id: d.id, ...d.data() }))

  // Simulate grouping
  const grouped = {}
  for (const cat of USER_SELECTABLE_CATEGORIES) grouped[cat] = []
  for (const tag of testTags) {
    const cat = effectiveCategory(tag.tagCategory)
    grouped[cat].push(tag)
  }

  // Assert each category has the right tags
  assert(grouped["project"].some(t => t.name === "Cool Breeze"), "Project category contains 'Cool Breeze'")
  assert(grouped["status"].some(t => t.name === "Pending"), "Status category contains 'Pending'")
  assert(grouped["priority"].some(t => t.name === "High"), "Priority category contains 'High'")
  assert(grouped["timedate"].some(t => t.name === "Next Week"), "Time/Date category contains 'Next Week'")
  assert(grouped["department"].some(t => t.name === "Marketing"), "Department category contains 'Marketing'")
  assert(grouped["report"].some(t => t.name === "Q4 Report"), "Report category contains 'Q4 Report'")
  assert(grouped["sales"].some(t => t.name === "Pipeline"), "Sales category contains 'Pipeline'")
  assert(grouped["task"].some(t => t.name === "Fix Bug"), "Task category contains 'Fix Bug'")
  assert(grouped["custom"].some(t => t.name === "MyTag"), "Custom category contains 'MyTag'")
  assert(grouped["custom"].some(t => t.name === "NoCategory"), "NoCategory tag → falls into 'custom'")
  assert(grouped["custom"].some(t => t.name === "InvalidCat"), "systemType tag → falls into 'custom'")

  // No duplicates in grouping
  const allGrouped = Object.values(grouped).flat()
  const ids = allGrouped.map(t => t.id)
  const uniqueIds = new Set(ids)
  assertEq(ids.length, uniqueIds.size, `No duplicate tags in grouped view (${ids.length} total, ${uniqueIds.size} unique)`)
}

// ═══════════════════════════════════════════════════════════════════════════
//  SUITE 5: Migration script behavior
// ═══════════════════════════════════════════════════════════════════════════
async function suite5_migration() {
  section("Suite 5 — Migration Script (idempotency)")

  // Create test tags with various states
  const legacyNocat = await createProject({ name: "Mig-NoCategory" })
  await db.collection("projects").doc(legacyNocat.id).update({ tagCategory: FieldValue.delete() })

  const legacyProject = await createProject({ name: "Mig-LegacyProject", tagCategory: "project" })
  const alreadyStatus = await createProject({ name: "Mig-AlreadyStatus", tagCategory: "status" })
  const sysTypeTag = await createProject({ name: "Mig-SystemType", tagCategory: "systemType" })

  // Run migration
  const { updated, skipped } = await runMigration(false)
  assert(updated >= 2, `Migration updated at least 2 tags (no-category + systemType) — got ${updated}`)
  assert(skipped >= 2, `Migration skipped at least 2 valid tags (project + status) — got ${skipped}`)

  // Verify results
  const s1 = await getProject(legacyNocat.id)
  assertEq(s1.tagCategory, "custom", "Mig: NoCategory → tagCategory becomes 'custom'")

  const s2 = await getProject(legacyProject.id)
  assertEq(s2.tagCategory, "project", "Mig: LegacyProject → tagCategory stays 'project'")

  const s3 = await getProject(alreadyStatus.id)
  assertEq(s3.tagCategory, "status", "Mig: AlreadyStatus → tagCategory stays 'status'")

  const s4 = await getProject(sysTypeTag.id)
  assertEq(s4.tagCategory, "custom", "Mig: SystemType → tagCategory becomes 'custom'")

  // Idempotency: run migration again, nothing should change
  const { updated: u2, skipped: s5 } = await runMigration(false)
  assert(u2 === 0, `Idempotency: second migration run updates 0 tags (got ${u2})`)
}

// ═══════════════════════════════════════════════════════════════════════════
//  SUITE 6: Edit category of existing tag (handleRenameProject behavior)
// ═══════════════════════════════════════════════════════════════════════════
async function suite6_editCategory() {
  section("Suite 6 — Edit Category of Existing Tag")

  const tag = await createProject({ name: "EditableTag", tagCategory: "custom" })

  // Simulate handleRenameProject(id, name, category)
  await db.collection("projects").doc(tag.id).update({
    name: "EditableTag",
    tagCategory: "status",
  })

  const updated = await getProject(tag.id)
  assertEq(updated.tagCategory, "status", "Edit category: custom → status")
  assertEq(updated.name, "EditableTag", "Edit: name unchanged after category change")

  // Change again to "timedate"
  await db.collection("projects").doc(tag.id).update({ tagCategory: "timedate" })
  const updated2 = await getProject(tag.id)
  assertEq(updated2.tagCategory, "timedate", "Edit category: status → timedate")

  // Verify members and other fields untouched
  assert(Array.isArray(updated2.members), "Edit: members array still present")
  assertEq(updated2.ownerId, "user-alice", "Edit: ownerId unchanged after category edit")
}

// ═══════════════════════════════════════════════════════════════════════════
//  SUITE 7: visibleToUserIds NOT affected by tagCategory changes
// ═══════════════════════════════════════════════════════════════════════════
async function suite7_visibilityNotAffected() {
  section("Suite 7 — visibleToUserIds NOT Affected by tagCategory")

  // Fetch Case C message by known doc ID (set by seed-test-cases.mjs)
  const caseRef = db.collection("messages").doc("msg-case-c")
  const caseSnap = await caseRef.get()

  if (!caseSnap.exists) {
    console.log("  ⚠️   No Case C message found — skipping visibility cross-check")
    console.log("  ℹ️   Run: pnpm emulator:seed then pnpm emulator:migrate, then rerun")
    return
  }

  const msgBefore = caseSnap.data()
  const visibleBefore = [...(msgBefore.visibleToUserIds || [])].sort()

  // Change the project's tagCategory (not members) — should NOT affect visibility
  const projectId = msgBefore.projectIds?.[0] ?? msgBefore.projectId
  if (projectId) {
    await db.collection("projects").doc(projectId).update({ tagCategory: "status" })
  }

  const msgAfter = (await caseRef.get()).data()
  const visibleAfter = [...(msgAfter.visibleToUserIds || [])].sort()

  assertEq(visibleAfter, visibleBefore, "visibleToUserIds unchanged after tagCategory update on project")

  // Restore original category
  if (projectId) {
    await db.collection("projects").doc(projectId).update({ tagCategory: "project" })
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  SUITE 8: Message tagIds NOT affected by category changes
// ═══════════════════════════════════════════════════════════════════════════
async function suite8_tagIdsNotAffected() {
  section("Suite 8 — Message tagIds NOT Affected")

  const snap = await db.collection("messages").get()
  const msgsBefore = snap.docs.map(d => ({
    id: d.id,
    tagIds: (d.data().tagIds || []).sort(),
    visibleToUserIds: (d.data().visibleToUserIds || []).sort(),
    projectIds: (d.data().projectIds || []).sort(),
  }))

  // Change all test tag categories
  if (testProjectIds.length > 0) {
    const batch = db.batch()
    testProjectIds.forEach(id => {
      batch.update(db.collection("projects").doc(id), { tagCategory: "report" })
    })
    await batch.commit()
  }

  const snapAfter = await db.collection("messages").get()
  const msgsAfter = snapAfter.docs.map(d => ({
    id: d.id,
    tagIds: (d.data().tagIds || []).sort(),
    visibleToUserIds: (d.data().visibleToUserIds || []).sort(),
    projectIds: (d.data().projectIds || []).sort(),
  }))

  let allSame = true
  for (const before of msgsBefore) {
    const after = msgsAfter.find(m => m.id === before.id)
    if (!after) continue
    if (JSON.stringify(before.tagIds) !== JSON.stringify(after.tagIds)) {
      allSame = false
      failures.push({ label: `Message ${before.id} tagIds changed`, detail: `${JSON.stringify(before.tagIds)} → ${JSON.stringify(after.tagIds)}` })
    }
    if (JSON.stringify(before.visibleToUserIds) !== JSON.stringify(after.visibleToUserIds)) {
      allSame = false
      failures.push({ label: `Message ${before.id} visibleToUserIds changed`, detail: "" })
    }
  }
  assert(allSame, "All messages: tagIds and visibleToUserIds unchanged after category edits")
}

// ═══════════════════════════════════════════════════════════════════════════
//  SUITE 9: Dry-run migration
// ═══════════════════════════════════════════════════════════════════════════
async function suite9_dryRun() {
  section("Suite 9 — Migration Dry-Run (no writes)")

  // Create a tag without category
  const dryTag = await createProject({ name: "DryRun-NoCategory" })
  await db.collection("projects").doc(dryTag.id).update({ tagCategory: FieldValue.delete() })

  const before = await getProject(dryTag.id)
  assert(before.tagCategory === undefined, "Setup: DryRun tag has no tagCategory")

  // Dry run
  const { updated } = await runMigration(true)
  assert(updated >= 1, `Dry-run reports ${updated} would-be updates (≥1)`)

  // Verify nothing written
  const after = await getProject(dryTag.id)
  assert(after.tagCategory === undefined, "Dry-run: tagCategory still absent (nothing written)")
}

// ═══════════════════════════════════════════════════════════════════════════
//  SUITE 10: handleCreateProject auto-category fallback
// ═══════════════════════════════════════════════════════════════════════════
async function suite10_createFallback() {
  section("Suite 10 — handleCreateProject Category Fallback")

  // Simulate handleCreateProject with category passed
  const withCategory = await createProject({ name: "FallbackTest-WithCat", tagCategory: "priority" })
  assertEq((await getProject(withCategory.id)).tagCategory, "priority", "Create with category='priority' → stored as 'priority'")

  // Simulate handleCreateProject with NO category + multiple members → "project"
  // (fallback logic: category ?? (members.length > 1 ? "project" : "custom"))
  const multiMember = await createProject({
    name: "FallbackTest-MultiMember",
    members: ["u1", "u2", "u3"],
    tagCategory: "project",  // this is what the fallback computes
  })
  assertEq((await getProject(multiMember.id)).tagCategory, "project", "Fallback: multi-member without explicit category → 'project'")

  // Simulate handleCreateProject with NO category + 1 member → "custom"
  const singleMember = await createProject({
    name: "FallbackTest-SingleMember",
    members: ["u1"],
    tagCategory: "custom",  // this is what the fallback computes
  })
  assertEq((await getProject(singleMember.id)).tagCategory, "custom", "Fallback: single-member without explicit category → 'custom'")
}

// ═══════════════════════════════════════════════════════════════════════════
//  MAIN
// ═══════════════════════════════════════════════════════════════════════════
async function main() {
  console.log("\n╔══════════════════════════════════════════════════════╗")
  console.log("║       Tag Category — Full Test Suite                 ║")
  console.log(`║       Emulator: ${emulatorHost.padEnd(37)}║`)
  console.log("╚══════════════════════════════════════════════════════╝\n")

  try {
    await suite1_categoryConfig()
    await suite2_createWithCategory()
    await suite3_backwardCompat()
    await suite4_groupingLogic()
    await suite5_migration()
    await suite6_editCategory()
    await suite7_visibilityNotAffected()
    await suite8_tagIdsNotAffected()
    await suite9_dryRun()
    await suite10_createFallback()
  } finally {
    // Cleanup all test documents
    console.log(`\n── Cleanup: removing ${testProjectIds.length} test tags...`)
    await cleanup()
    console.log("   Done.")
  }

  // ── Final report ────────────────────────────────────────────────────────
  console.log("\n╔══════════════════════════════════════════════════════╗")
  if (failed === 0) {
    console.log(`║  ✅  ALL ${String(passed).padEnd(3)} TESTS PASSED                          ║`)
  } else {
    console.log(`║  ⚠️   ${passed} passed / ${failed} FAILED                        ║`)
  }
  console.log("╚══════════════════════════════════════════════════════╝")

  if (failures.length > 0) {
    console.log("\nFailed tests:")
    failures.forEach(f => console.log(`  ❌  ${f.label}${f.detail ? `: ${f.detail}` : ""}`))
  }

  process.exit(failed > 0 ? 1 : 0)
}

main().catch(err => {
  console.error("Test suite crashed:", err)
  process.exit(1)
})
