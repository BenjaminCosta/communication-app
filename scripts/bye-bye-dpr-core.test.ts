import assert from "node:assert/strict"
import test from "node:test"
import {
  durationMinutes,
  findNearestJob,
  haversineDistanceMeters,
  isDailyReportSubmittable,
  isValidGeoPoint,
  isValidIdempotencyKey,
  validateClockOutCorrection,
  type DailyReportStructuredData,
} from "../lib/bye-bye-dpr-core"

test("haversineDistanceMeters is 0 for the same point and grows with distance", () => {
  const point = { lat: 25.7907, lng: -80.13 } // Miami Beach
  assert.equal(haversineDistanceMeters(point, point), 0)

  // Roughly 1 degree of latitude ~= 111km.
  const oneDegreeNorth = { lat: point.lat + 1, lng: point.lng }
  const distance = haversineDistanceMeters(point, oneDegreeNorth)
  assert.ok(distance > 108_000 && distance < 112_000, `expected ~111km, got ${distance}`)
})

test("findNearestJob picks the closest of several jobs, never via AI", () => {
  const origin = { lat: 25.79, lng: -80.13 }
  const jobs = [
    { id: "far", latitude: 26.5, longitude: -80.13 },
    { id: "near", latitude: 25.8, longitude: -80.13 },
    { id: "middle", latitude: 26.0, longitude: -80.13 },
  ]
  const match = findNearestJob(origin, jobs)
  assert.equal(match?.jobId, "near")
})

test("findNearestJob returns null for an empty job list", () => {
  assert.equal(findNearestJob({ lat: 0, lng: 0 }, []), null)
})

test("isValidGeoPoint rejects out-of-range or malformed coordinates", () => {
  assert.equal(isValidGeoPoint({ lat: 25.79, lng: -80.13 }), true)
  assert.equal(isValidGeoPoint({ lat: 100, lng: 0 }), false)
  assert.equal(isValidGeoPoint({ lat: 0, lng: 200 }), false)
  assert.equal(isValidGeoPoint({ lat: "0", lng: 0 }), false)
  assert.equal(isValidGeoPoint(null), false)
})

test("durationMinutes rounds and never goes negative", () => {
  const clockInAt = new Date("2026-08-06T07:00:00.000Z")
  const clockOutAt = new Date("2026-08-06T15:30:00.000Z")
  assert.equal(durationMinutes(clockInAt, clockOutAt), 510)
  // Clock-out before clock-in (shouldn't happen given validation, but the
  // function itself must not return a negative number).
  assert.equal(durationMinutes(clockOutAt, clockInAt), 0)
})

test("validateClockOutCorrection rejects a corrected time at or before clock-in", () => {
  const clockInAt = new Date("2026-08-06T07:00:00.000Z")
  const now = new Date("2026-08-06T20:00:00.000Z")
  assert.equal(validateClockOutCorrection(clockInAt, clockInAt, now).ok, false)
  assert.equal(validateClockOutCorrection(clockInAt, new Date("2026-08-06T06:00:00.000Z"), now).ok, false)
  assert.equal(validateClockOutCorrection(clockInAt, new Date("2026-08-06T15:00:00.000Z"), now).ok, true)
})

test("validateClockOutCorrection rejects a corrected time in the future", () => {
  const clockInAt = new Date("2026-08-06T07:00:00.000Z")
  const now = new Date("2026-08-06T10:00:00.000Z")
  const result = validateClockOutCorrection(clockInAt, new Date("2026-08-06T23:00:00.000Z"), now)
  assert.equal(result.ok, false)
  assert.match(result.reason ?? "", /future/)
})

test("isValidIdempotencyKey enforces the expected shape", () => {
  assert.equal(isValidIdempotencyKey("abcdefghijkl"), true)
  assert.equal(isValidIdempotencyKey("short"), false)
  assert.equal(isValidIdempotencyKey("has spaces here"), false)
  assert.equal(isValidIdempotencyKey(""), false)
})

test("isDailyReportSubmittable requires at least one populated field", () => {
  const empty: DailyReportStructuredData = {
    workCompleted: null,
    issuesOrDelays: null,
    attendanceNotes: null,
    nextSteps: null,
    additionalNotes: null,
  }
  assert.equal(isDailyReportSubmittable(empty), false)
  assert.equal(isDailyReportSubmittable({ ...empty, workCompleted: "Framing done" }), true)
  assert.equal(isDailyReportSubmittable({ ...empty, workCompleted: "   " }), false)
})

