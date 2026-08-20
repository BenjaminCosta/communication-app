import assert from "node:assert/strict"
import test from "node:test"
import {
  canContinueFromIdentify,
  canContinueFromJob,
  composeGeneralNotes,
  nextOutlookFormStep,
  outlookFormInitials,
  outlookFormWeekBuckets,
  previousOutlookFormStep,
  snapToMondayIso,
  tradeIconKey,
  weekIndexForDate,
} from "../lib/outlook-form-submissions/wizard-core"

test("step order: next/previous walk the linear identify→job→tasks→notes→review→submitted order", () => {
  assert.equal(nextOutlookFormStep("identify"), "job")
  assert.equal(nextOutlookFormStep("job"), "tasks")
  assert.equal(nextOutlookFormStep("tasks"), "notes")
  assert.equal(nextOutlookFormStep("notes"), "review")
  assert.equal(nextOutlookFormStep("review"), "submitted")
  assert.equal(nextOutlookFormStep("submitted"), null)

  assert.equal(previousOutlookFormStep("identify"), null)
  assert.equal(previousOutlookFormStep("job"), "identify")
  assert.equal(previousOutlookFormStep("review"), "notes")
})

test("canContinueFromIdentify/Job require non-blank, non-whitespace-only text", () => {
  assert.equal(canContinueFromIdentify(""), false)
  assert.equal(canContinueFromIdentify("   "), false)
  assert.equal(canContinueFromIdentify("John Smith"), true)
  assert.equal(canContinueFromJob(""), false)
  assert.equal(canContinueFromJob("Appaloosa"), true)
})

test("outlookFormWeekBuckets splits the 21-day window into three 7-day weeks", () => {
  const buckets = outlookFormWeekBuckets("2026-08-17")
  assert.deepEqual(buckets, [
    { weekIndex: 0, start: "2026-08-17", end: "2026-08-23" },
    { weekIndex: 1, start: "2026-08-24", end: "2026-08-30" },
    { weekIndex: 2, start: "2026-08-31", end: "2026-09-06" },
  ])
})

test("weekIndexForDate buckets a date into the correct week", () => {
  assert.equal(weekIndexForDate("2026-08-17", "2026-08-17"), 0)
  assert.equal(weekIndexForDate("2026-08-17", "2026-08-23"), 0)
  assert.equal(weekIndexForDate("2026-08-17", "2026-08-24"), 1)
  assert.equal(weekIndexForDate("2026-08-17", "2026-08-30"), 1)
  assert.equal(weekIndexForDate("2026-08-17", "2026-08-31"), 2)
  assert.equal(weekIndexForDate("2026-08-17", "2026-09-06"), 2)
})

test("weekIndexForDate defaults to Week 1 for a missing or malformed date, never throwing", () => {
  assert.equal(weekIndexForDate("2026-08-17", null), 0)
  assert.equal(weekIndexForDate("2026-08-17", "not-a-date"), 0)
})

test("tradeIconKey matches common trade keywords case-insensitively", () => {
  assert.equal(tradeIconKey("Carpentry"), "framing")
  assert.equal(tradeIconKey("electrical rough-in"), "electrical")
  assert.equal(tradeIconKey("Drywall"), "drywall")
  assert.equal(tradeIconKey("PAINT"), "painting")
  assert.equal(tradeIconKey("Plumbing"), "plumbing")
  assert.equal(tradeIconKey(""), "general")
  assert.equal(tradeIconKey("Something unrelated"), "general")
})

test("composeGeneralNotes joins selected flags with free-text notes, or returns either alone", () => {
  assert.equal(composeGeneralNotes([], "Material delivery delayed."), "Material delivery delayed.")
  assert.equal(composeGeneralNotes(["Delivery", "Weather"], ""), "Flags: Delivery, Weather")
  assert.equal(composeGeneralNotes(["Delay"], "Crane access needed."), "Flags: Delay\n\nCrane access needed.")
  assert.equal(composeGeneralNotes([], ""), "")
})

test("snapToMondayIso normalizes any picked date to that week's Monday", () => {
  // 2026-08-17 is itself a Monday — stays put.
  assert.equal(snapToMondayIso("2026-08-17"), "2026-08-17")
  // 2026-08-20 is a Thursday in the same week.
  assert.equal(snapToMondayIso("2026-08-20"), "2026-08-17")
  // 2026-08-23 is a Sunday — belongs to the week that started 2026-08-17.
  assert.equal(snapToMondayIso("2026-08-23"), "2026-08-17")
  // 2026-08-24 is the next Monday.
  assert.equal(snapToMondayIso("2026-08-24"), "2026-08-24")
})

test("snapToMondayIso returns the input unchanged for a malformed date", () => {
  assert.equal(snapToMondayIso("not-a-date"), "not-a-date")
  assert.equal(snapToMondayIso(""), "")
})

test("outlookFormInitials mirrors lib/store.ts's deriveInitials convention", () => {
  assert.equal(outlookFormInitials("John Smith"), "JS")
  assert.equal(outlookFormInitials("North Ridge"), "NR")
  assert.equal(outlookFormInitials("Appaloosa"), "AP")
})
