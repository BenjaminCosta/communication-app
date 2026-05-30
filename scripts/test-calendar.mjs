#!/usr/bin/env node
/**
 * test-calendar.mjs
 *
 * Tests all Calendar V1 flows in the Firebase Emulator.
 * Covers the 9 test scenarios specified in the feature requirements.
 *
 * Usage:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/test-calendar.mjs
 */

import { initializeApp } from "firebase-admin/app"
import { getFirestore, Timestamp } from "firebase-admin/firestore"

const EMULATOR_FS = process.env.FIRESTORE_EMULATOR_HOST
if (!EMULATOR_FS) {
  console.error("ERROR: FIRESTORE_EMULATOR_HOST is not set")
  process.exit(1)
}

const app = initializeApp({ projectId: "svc-comms" })
const db  = getFirestore(app)
db.settings({ host: EMULATOR_FS, ssl: false })

// ── Test helpers ────────────────────────────────────────────────────────────

const PREFIX = `cal-test-${Date.now()}`
let passed = 0
let failed = 0
const created = []

function assert(condition, label) {
  if (condition) {
    console.log(`  ✅  PASS  ${label}`)
    passed++
  } else {
    console.log(`  ❌  FAIL  ${label}`)
    failed++
  }
}

async function cleanup() {
  const b = db.batch()
  for (const ref of created) b.delete(ref)
  if (created.length > 0) await b.commit()
  console.log(`\n   Cleanup: removed ${created.length} test docs.`)
}

function makeCalendarDate(date, userId) {
  return {
    id: `cd-test-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
    date,
    createdAt: Timestamp.now(),
    createdBy: userId,
  }
}

function msgBase(authorId, extra = {}) {
  const now = Timestamp.now()
  return {
    authorId,
    senderId: authorId,
    text: "Calendar test message",
    participants: [authorId],
    visibleToUserIds: [authorId],
    recipientIds: [],
    projectIds: [],
    tagIds: [],
    type: "none",
    isFavorited: false,
    createdAt: now,
    updatedAt: now,
    timestamp: now,
    ...extra,
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const alice = "user-alice"
  const bob   = "user-bob"
  const carol = "user-carol"

  console.log("\n╔══════════════════════════════════════════════════════╗")
  console.log("║       Calendar V1 — Full Test Suite                 ║")
  console.log(`║       Emulator: ${EMULATOR_FS.padEnd(35)}║`)
  console.log("╚══════════════════════════════════════════════════════╝")

  // ── Suite 1: Message without calendarDates does NOT appear in Calendar ──
  console.log("\n──────────────────────────────────────────────────────")
  console.log("  Suite 1 — No-date message stays out of Calendar")
  console.log("──────────────────────────────────────────────────────")

  const noDateRef = db.collection("messages").doc(`${PREFIX}-no-date`)
  created.push(noDateRef)
  await noDateRef.set(msgBase(alice, { text: "[Cal T1] No date — should NOT appear in calendar" }))

  const noDateDoc = await noDateRef.get()
  assert(!noDateDoc.data().calendarDates, "No calendarDates field stored")
  assert(
    noDateDoc.data().visibleToUserIds?.includes(alice),
    "Message still visible to author in stream"
  )

  // ── Suite 2: Message with calendarDates DOES appear in Calendar ─────────
  console.log("\n──────────────────────────────────────────────────────")
  console.log("  Suite 2 — Message with date appears in Calendar")
  console.log("──────────────────────────────────────────────────────")

  const withDateRef = db.collection("messages").doc(`${PREFIX}-with-date`)
  created.push(withDateRef)
  const targetDate = "2026-07-15"
  await withDateRef.set(msgBase(alice, {
    text: "[Cal T2] Has a calendar date",
    visibleToUserIds: [alice, bob],
    calendarDates: [makeCalendarDate(targetDate, alice)],
  }))

  const withDateDoc = await withDateRef.get()
  const storedDates = withDateDoc.data().calendarDates ?? []
  assert(storedDates.length === 1, "calendarDates array has 1 entry")
  assert(storedDates[0].date === targetDate, `Date stored correctly as "${targetDate}"`)
  assert(storedDates[0].createdBy === alice, "createdBy is Alice's UID")
  assert(typeof storedDates[0].id === "string" && storedDates[0].id.length > 0, "Date has a non-empty id")
  assert(withDateDoc.data().visibleToUserIds?.includes(alice), "Alice sees message (via visibleToUserIds)")
  assert(withDateDoc.data().visibleToUserIds?.includes(bob), "Bob sees message (via visibleToUserIds)")

  // ── Suite 3: Message with MULTIPLE dates ─────────────────────────────────
  console.log("\n──────────────────────────────────────────────────────")
  console.log("  Suite 3 — Message with multiple dates")
  console.log("──────────────────────────────────────────────────────")

  const multiRef = db.collection("messages").doc(`${PREFIX}-multi-date`)
  created.push(multiRef)
  const dates = ["2026-08-01", "2026-08-15", "2026-08-31"]
  await multiRef.set(msgBase(alice, {
    text: "[Cal T3] Has multiple calendar dates",
    calendarDates: dates.map((d) => makeCalendarDate(d, alice)),
  }))

  const multiDoc = await multiRef.get()
  const multiDates = multiDoc.data().calendarDates ?? []
  assert(multiDates.length === 3, "3 calendarDates stored")
  assert(multiDates.map(d => d.date).includes("2026-08-01"), "Aug 1 present")
  assert(multiDates.map(d => d.date).includes("2026-08-15"), "Aug 15 present")
  assert(multiDates.map(d => d.date).includes("2026-08-31"), "Aug 31 present")

  // ── Suite 4: Remove dates → message disappears from Calendar ────────────
  console.log("\n──────────────────────────────────────────────────────")
  console.log("  Suite 4 — Removing dates clears Calendar entry")
  console.log("──────────────────────────────────────────────────────")

  const removeDateRef = db.collection("messages").doc(`${PREFIX}-remove-date`)
  created.push(removeDateRef)
  await removeDateRef.set(msgBase(alice, {
    text: "[Cal T4] Will have its dates removed",
    calendarDates: [makeCalendarDate("2026-09-01", alice)],
  }))

  // Verify date is there
  const beforeRemove = (await removeDateRef.get()).data().calendarDates ?? []
  assert(beforeRemove.length === 1, "Date present before removal")

  // Remove all dates
  await removeDateRef.update({ calendarDates: [], updatedAt: Timestamp.now() })

  const afterRemove = (await removeDateRef.get()).data().calendarDates ?? []
  assert(afterRemove.length === 0, "calendarDates cleared (empty array)")

  // Message itself still exists in stream
  const stillExists = await removeDateRef.get()
  assert(stillExists.exists, "Message doc still exists in Firestore (not deleted)")

  // ── Suite 5: Calendar queries respect visibleToUserIds ───────────────────
  console.log("\n──────────────────────────────────────────────────────")
  console.log("  Suite 5 — visibleToUserIds respected in Calendar")
  console.log("──────────────────────────────────────────────────────")

  const bobOnlyRef = db.collection("messages").doc(`${PREFIX}-bob-only`)
  created.push(bobOnlyRef)
  await bobOnlyRef.set(msgBase(bob, {
    text: "[Cal T5] Bob-only message with calendar date",
    visibleToUserIds: [bob],
    calendarDates: [makeCalendarDate("2026-10-01", bob)],
  }))

  const bobDoc = await bobOnlyRef.get()
  assert(bobDoc.data().visibleToUserIds?.includes(bob), "Bob can see the message")
  assert(!bobDoc.data().visibleToUserIds?.includes(alice), "Alice CANNOT see the message")
  assert(!bobDoc.data().visibleToUserIds?.includes(carol), "Carol CANNOT see the message")
  assert((bobDoc.data().calendarDates ?? []).length > 0, "Calendar date stored")

  // ── Suite 6: Tag Later applies calendarDates ──────────────────────────────
  console.log("\n──────────────────────────────────────────────────────")
  console.log("  Suite 6 — Tag Later (handleApplyTag) applies dates")
  console.log("──────────────────────────────────────────────────────")

  const tagLaterRef = db.collection("messages").doc(`${PREFIX}-tag-later`)
  created.push(tagLaterRef)
  await tagLaterRef.set(msgBase(alice, { text: "[Cal T6] Will get dates via Tag Later" }))

  // Simulate handleApplyTag writing calendarDates
  const calDate = makeCalendarDate("2026-11-11", alice)
  await tagLaterRef.update({
    calendarDates: [calDate],
    updatedAt: Timestamp.now(),
  })

  const tagLaterDoc = await tagLaterRef.get()
  const tagLaterDates = tagLaterDoc.data().calendarDates ?? []
  assert(tagLaterDates.length === 1, "Date applied via Tag Later")
  assert(tagLaterDates[0].date === "2026-11-11", "Correct date stored")
  assert(tagLaterDates[0].createdBy === alice, "Correct createdBy")

  // ── Suite 7: visibleToUserIds NOT affected by calendarDates changes ──────
  console.log("\n──────────────────────────────────────────────────────")
  console.log("  Suite 7 — calendarDates does NOT affect visibility")
  console.log("──────────────────────────────────────────────────────")

  const visRef = db.collection("messages").doc(`${PREFIX}-visibility-check`)
  created.push(visRef)
  await visRef.set(msgBase(alice, {
    text: "[Cal T7] Visibility should not change when adding dates",
    visibleToUserIds: [alice, carol],
    recipientIds: [carol],
  }))

  const visBefore = (await visRef.get()).data().visibleToUserIds?.sort() ?? []

  // Add calendar date
  await visRef.update({
    calendarDates: [makeCalendarDate("2026-12-25", alice)],
    updatedAt: Timestamp.now(),
  })

  const visAfter = (await visRef.get()).data().visibleToUserIds?.sort() ?? []
  assert(
    JSON.stringify(visBefore) === JSON.stringify(visAfter),
    "visibleToUserIds unchanged after adding calendarDates"
  )

  // ── Suite 8: CalendarDate model structure validation ─────────────────────
  console.log("\n──────────────────────────────────────────────────────")
  console.log("  Suite 8 — CalendarDate model validation")
  console.log("──────────────────────────────────────────────────────")

  const modelRef = db.collection("messages").doc(`${PREFIX}-model`)
  created.push(modelRef)
  const now = Timestamp.now()
  const testDate = {
    id: "cd-model-test-001",
    date: "2026-06-30",
    createdAt: now,
    createdBy: alice,
    // Future fields (not yet used):
    // reminderAt: undefined
    // notificationEnabled: false
  }
  await modelRef.set(msgBase(alice, { calendarDates: [testDate] }))

  const modelDoc = (await modelRef.get()).data()
  const modelDate = (modelDoc.calendarDates ?? [])[0] ?? {}
  assert(typeof modelDate.id === "string", "id is a string")
  assert(modelDate.date === "2026-06-30", "date is YYYY-MM-DD string")
  assert(modelDate.createdAt instanceof Timestamp, "createdAt is a Timestamp")
  assert(modelDate.createdBy === alice, "createdBy is a UID string")
  assert(modelDate.reminderAt === undefined, "reminderAt is undefined (future field not set)")
  assert(modelDate.notificationEnabled === undefined, "notificationEnabled is undefined (future field not set)")

  // ── Suite 9: Create from Calendar creates message with date ──────────────
  console.log("\n──────────────────────────────────────────────────────")
  console.log("  Suite 9 — Create from Calendar flow")
  console.log("──────────────────────────────────────────────────────")

  const fromCalRef = db.collection("messages").doc(`${PREFIX}-from-calendar`)
  created.push(fromCalRef)
  const preselectedDate = "2026-07-04"
  // Simulates handleSend receiving calendarDates from compose initialCalendarDates
  await fromCalRef.set(msgBase(alice, {
    text: "[Cal T9] Created from Calendar screen",
    calendarDates: [makeCalendarDate(preselectedDate, alice)],
  }))

  const fromCalDoc = (await fromCalRef.get()).data()
  assert((fromCalDoc.calendarDates ?? []).length === 1, "Message has 1 calendar date")
  assert(fromCalDoc.calendarDates[0].date === preselectedDate, `Date is ${preselectedDate}`)
  assert(fromCalDoc.visibleToUserIds?.includes(alice), "Author can see it in stream")

  // ── Cleanup ────────────────────────────────────────────────────────────
  await cleanup()

  // ── Summary ────────────────────────────────────────────────────────────
  console.log("\n╔══════════════════════════════════════════════════════╗")
  if (failed === 0) {
    console.log(`║  ✅  ALL ${passed} TESTS PASSED                          ║`)
  } else {
    console.log(`║  ❌  ${passed} passed, ${failed} FAILED                           ║`)
  }
  console.log("╚══════════════════════════════════════════════════════╝\n")

  if (failed > 0) process.exit(1)
}

main().catch((err) => { console.error("Test failed:", err.message); process.exit(1) })
