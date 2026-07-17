import assert from "node:assert/strict"
import test from "node:test"
import {
  addIsoDays,
  mondayForDate,
  outlookWindow,
  scheduleOutlookTasks,
  type OutlookTask,
} from "../lib/outlook-core"
import { generateOutlookPdf } from "../features/outlooks/pdf/generate-outlook-pdf"

function task(partial: Partial<OutlookTask> & Pick<OutlookTask, "id" | "title">): OutlookTask {
  return {
    id: partial.id,
    title: partial.title,
    sortOrder: partial.sortOrder ?? 0,
    description: "",
    trade: "",
    companyName: "",
    companyContextId: null,
    startDate: partial.startDate ?? null,
    durationDays: partial.durationDays ?? 1,
    endDate: null,
    dependencyTaskId: partial.dependencyTaskId ?? null,
    status: "not_started",
    completionPercent: 0,
  }
}

test("builds a deterministic Monday-based three-week window", () => {
  assert.equal(mondayForDate(new Date(2026, 6, 16)), "2026-07-13")
  assert.deepEqual(outlookWindow("2026-07-13"), { start: "2026-07-13", end: "2026-08-02" })
  assert.equal(addIsoDays("2026-07-31", 1), "2026-08-01")
})

test("uses inclusive calendar-day durations", () => {
  const result = scheduleOutlookTasks([
    task({ id: "ada", title: "ADA Ramp", startDate: "2026-07-16", durationDays: 3 }),
  ], outlookWindow("2026-07-13"))
  assert.equal(result.tasks[0].endDate, "2026-07-18")
  assert.equal(result.canPublish, true)
})

test("resolves a dependency-only start to the next calendar day", () => {
  const result = scheduleOutlookTasks([
    task({ id: "ada", title: "ADA Ramp", startDate: "2026-07-16", durationDays: 3 }),
    task({ id: "dock", title: "Dock Levelers", dependencyTaskId: "ada", durationDays: 2 }),
  ], outlookWindow("2026-07-13"))
  assert.equal(result.tasks[1].startDate, "2026-07-19")
  assert.equal(result.tasks[1].endDate, "2026-07-20")
  assert.equal(result.canPublish, true)
})

test("blocks missing dates and dependency cycles but only warns for overflow", () => {
  const missing = scheduleOutlookTasks([
    task({ id: "a", title: "A", dependencyTaskId: "b" }),
    task({ id: "b", title: "B", dependencyTaskId: "a" }),
  ], outlookWindow("2026-07-13"))
  assert.equal(missing.canPublish, false)
  assert.equal(missing.issues.some((entry) => entry.message.includes("cycle")), true)

  const overflow = scheduleOutlookTasks([
    task({ id: "long", title: "Long task", startDate: "2026-08-01", durationDays: 5 }),
  ], outlookWindow("2026-07-13"))
  assert.equal(overflow.canPublish, true)
  assert.equal(overflow.issues[0].kind, "warning")
})

test("generates a readable PDF from the confirmed snapshot", async () => {
  const window = outlookWindow("2026-07-13")
  const scheduled = scheduleOutlookTasks([
    task({ id: "ada", title: "ADA Ramp", startDate: "2026-07-16", durationDays: 3 }),
    task({ id: "dock", title: "Dock Levelers", dependencyTaskId: "ada", durationDays: 2 }),
  ], window)
  const bytes = await generateOutlookPdf({
    jobName: "Annapolosa",
    companyName: "74 Construction",
    location: "Newark, NJ",
    window,
    versionNumber: 2,
    tasks: scheduled.tasks,
  })
  assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), "%PDF-")
  assert.equal(bytes.byteLength > 1500, true)
})
