import assert from "node:assert/strict"
import test from "node:test"
import { outlookFormSubmitSchema } from "../lib/outlook-form-submissions/schema"
import { nextRateLimitState } from "../lib/outlook-form-submissions/rate-limit"
import { computeConvertedPatch, resolveWindowAnchorForTests, toOutlookFormSubmissionForTests } from "../lib/outlook-form-submissions/store"

test("outlookFormSubmitSchema accepts a minimal valid submission and defaults optional fields", () => {
  const parsed = outlookFormSubmitSchema.safeParse({
    submittedByName: "John Smith",
    jobName: "Appaloosa",
    byeByeDprJobId: "job-1",
  })
  assert.ok(parsed.success)
  if (!parsed.success) return
  assert.deepEqual(parsed.data.tasks, [])
  assert.equal(parsed.data.generalNotes, "")
  assert.equal(parsed.data.website, "")
  assert.equal(parsed.data.submittedByPhone, "")
  assert.equal(parsed.data.submittedByRole, "site_super")
})

test("outlookFormSubmitSchema accepts a valid windowStart and rejects a malformed one", () => {
  const valid = outlookFormSubmitSchema.safeParse({ submittedByName: "John", jobName: "Appaloosa", windowStart: "2026-08-24" })
  assert.equal(valid.success, true)
  const invalid = outlookFormSubmitSchema.safeParse({ submittedByName: "John", jobName: "Appaloosa", windowStart: "08/24/2026" })
  assert.equal(invalid.success, false)
})

test("resolveWindowAnchorForTests uses the given windowStart when it's a valid ISO date", () => {
  const anchor = resolveWindowAnchorForTests("2026-08-24", Date.now())
  assert.equal(anchor.getUTCFullYear(), 2026)
  assert.equal(anchor.getUTCMonth(), 7) // 0-indexed: August
  assert.equal(anchor.getUTCDate(), 24)
})

test("resolveWindowAnchorForTests falls back to now when windowStart is missing or malformed", () => {
  const now = Date.now()
  assert.equal(resolveWindowAnchorForTests(undefined, now).getTime(), now)
  assert.equal(resolveWindowAnchorForTests("not-a-date", now).getTime(), now)
})

test("outlookFormSubmitSchema rejects an unrecognized submitter role", () => {
  const parsed = outlookFormSubmitSchema.safeParse({
    submittedByName: "John",
    jobName: "Appaloosa",
    submittedByRole: "foreman",
  })
  assert.equal(parsed.success, false)
})

test("outlookFormSubmitSchema rejects a missing name or job", () => {
  assert.equal(outlookFormSubmitSchema.safeParse({ submittedByName: "", jobName: "Appaloosa" }).success, false)
  assert.equal(outlookFormSubmitSchema.safeParse({ submittedByName: "John", jobName: "" }).success, false)
})

test("outlookFormSubmitSchema caps tasks at MAX_OUTLOOK_FORM_TASKS", () => {
  const tooMany = Array.from({ length: 31 }, (_, i) => ({ title: `Task ${i}` }))
  const parsed = outlookFormSubmitSchema.safeParse({ submittedByName: "John", jobName: "Appaloosa", tasks: tooMany })
  assert.equal(parsed.success, false)
})

test("outlookFormSubmitSchema rejects a task with no title", () => {
  const parsed = outlookFormSubmitSchema.safeParse({
    submittedByName: "John",
    jobName: "Appaloosa",
    tasks: [{ title: "" }],
  })
  assert.equal(parsed.success, false)
})

test("nextRateLimitState: first submission from a fresh key is allowed and seeds the window", () => {
  const { allowed, state } = nextRateLimitState(null, 1000)
  assert.equal(allowed, true)
  assert.deepEqual(state, { count: 1, windowStartMs: 1000 })
})

test("nextRateLimitState: increments within the same window until the threshold", () => {
  let state = { count: 1, windowStartMs: 0 }
  for (let i = 0; i < 18; i += 1) {
    const result = nextRateLimitState(state, 1000)
    assert.equal(result.allowed, true)
    state = result.state
  }
  assert.equal(state.count, 19)
})

test("nextRateLimitState: rejects once the threshold is exceeded within the same window", () => {
  const result = nextRateLimitState({ count: 20, windowStartMs: 0 }, 1000)
  assert.equal(result.allowed, false)
  assert.deepEqual(result.state, { count: 20, windowStartMs: 0 })
})

test("nextRateLimitState: resets once the window has elapsed", () => {
  const oneHourMs = 60 * 60 * 1000
  const result = nextRateLimitState({ count: 20, windowStartMs: 0 }, oneHourMs)
  assert.equal(result.allowed, true)
  assert.deepEqual(result.state, { count: 1, windowStartMs: oneHourMs })
})

test("toOutlookFormSubmissionForTests: defaults a malformed/legacy doc rather than throwing", () => {
  const submission = toOutlookFormSubmissionForTests("sub-1", {})
  assert.ok(submission)
  assert.equal(submission?.status, "new")
  assert.equal(submission?.submittedByName, "Unknown")
  assert.equal(submission?.jobName, "Unspecified job")
  assert.equal(submission?.submittedByPhone, "")
  assert.equal(submission?.submittedByRole, "site_super")
  assert.deepEqual(submission?.tasks, [])
  assert.equal(submission?.reviewedAtMs, null)
  assert.equal(submission?.convertedAtMs, null)
  assert.equal(submission?.convertedByUid, null)
  assert.equal(submission?.convertedJobContextId, null)
  assert.equal(submission?.convertedWindowStart, null)
  assert.equal(submission?.convertedVersionId, null)
})

test("toOutlookFormSubmissionForTests: recognizes a converted status", () => {
  const submission = toOutlookFormSubmissionForTests("sub-1", { status: "converted" })
  assert.equal(submission?.status, "converted")
})

test("toOutlookFormSubmissionForTests: reads a well-formed submission doc, including tasks", () => {
  const submission = toOutlookFormSubmissionForTests("sub-1", {
    schemaVersion: 1,
    status: "reviewed",
    submittedByName: "John Smith",
    submittedByPhone: "(555) 123-4567",
    submittedByRole: "pm",
    jobName: "Appaloosa",
    byeByeDprJobId: "job-1",
    jobContextId: "ctx-1",
    window: { start: "2026-08-03", end: "2026-08-23" },
    tasks: [
      { id: "task-1", sortOrder: 0, title: "Framing", trade: "Carpentry", companyName: "74 Construction", startDate: "2026-08-03", durationDays: 5, status: "in_progress" },
    ],
    generalNotes: "Weather delay expected Thursday.",
    submittedAtMs: 1000,
    reviewedAtMs: 2000,
    reviewedByUid: "uid-1",
    reviewedByName: "Frank",
    convertedAtMs: 3000,
    convertedByUid: "uid-2",
    convertedByName: "Ben",
    convertedJobContextId: "ctx-1",
    convertedWindowStart: "2026-08-03",
    convertedVersionId: "v0001",
  })
  assert.ok(submission)
  assert.equal(submission?.status, "reviewed")
  assert.equal(submission?.submittedByPhone, "(555) 123-4567")
  assert.equal(submission?.submittedByRole, "pm")
  assert.equal(submission?.tasks.length, 1)
  assert.equal(submission?.tasks[0]?.title, "Framing")
  assert.equal(submission?.convertedAtMs, 3000)
  assert.equal(submission?.convertedByName, "Ben")
  assert.equal(submission?.convertedVersionId, "v0001")
  assert.equal(submission?.tasks[0]?.status, "in_progress")
  assert.equal(submission?.reviewedByName, "Frank")
})

test("toOutlookFormSubmissionForTests: drops a task with no title rather than keeping a blank row", () => {
  const submission = toOutlookFormSubmissionForTests("sub-1", {
    tasks: [{ title: "" }, { title: "Real task" }],
  })
  assert.equal(submission?.tasks.length, 1)
  assert.equal(submission?.tasks[0]?.title, "Real task")
})

test("computeConvertedPatch: converting straight from 'new' backfills the reviewer trail with the converter", () => {
  const patch = computeConvertedPatch(
    { reviewedAtMs: null },
    { uid: "uid-frank", name: "Frank" },
    { jobContextId: "ctx-1", windowStart: "2026-08-17", versionId: "v0001" },
    5000,
  )
  assert.equal(patch.status, "converted")
  assert.equal(patch.convertedAtMs, 5000)
  assert.equal(patch.convertedByUid, "uid-frank")
  assert.equal(patch.convertedJobContextId, "ctx-1")
  assert.equal(patch.convertedWindowStart, "2026-08-17")
  assert.equal(patch.convertedVersionId, "v0001")
  assert.equal(patch.reviewedAtMs, 5000)
  assert.equal(patch.reviewedByUid, "uid-frank")
  assert.equal(patch.reviewedByName, "Frank")
})

test("computeConvertedPatch: converting an already-reviewed submission never clobbers the original reviewer", () => {
  const patch = computeConvertedPatch(
    { reviewedAtMs: 1000 },
    { uid: "uid-ben", name: "Ben" },
    { jobContextId: "ctx-1", windowStart: "2026-08-17", versionId: "v0001" },
    5000,
  )
  assert.equal(patch.status, "converted")
  assert.equal(patch.convertedByUid, "uid-ben")
  // No reviewer fields in the patch at all — merge() leaves the existing ones untouched.
  assert.equal("reviewedAtMs" in patch, false)
  assert.equal("reviewedByUid" in patch, false)
  assert.equal("reviewedByName" in patch, false)
})
