/**
 * ByeByeDPR — framework-free core model.
 *
 * Pure domain logic for the clock-in/out + daily report module: distance
 * math, clock duration, correction validation, idempotency-key shape. No
 * Firebase, no React — importable from API routes, scripts and unit tests
 * alike.
 *
 * Kept deliberately free of any AI call: per the module's own rules, job
 * selection, clock math and recipient/tag resolution must never depend on a
 * model response.
 */

export const BYE_BYE_DPR_SCHEMA_VERSION = 1

// ── Idempotency ─────────────────────────────────────────────────────────

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{12,64}$/

export function isValidIdempotencyKey(value: string): boolean {
  return IDEMPOTENCY_KEY_PATTERN.test(value)
}

// ── Geolocation ─────────────────────────────────────────────────────────

export interface GeoPoint {
  lat: number
  lng: number
}

export function isValidGeoPoint(point: unknown): point is GeoPoint {
  if (!point || typeof point !== "object") return false
  const { lat, lng } = point as Record<string, unknown>
  return (
    typeof lat === "number" &&
    Number.isFinite(lat) &&
    lat >= -90 &&
    lat <= 90 &&
    typeof lng === "number" &&
    Number.isFinite(lng) &&
    lng >= -180 &&
    lng <= 180
  )
}

const EARTH_RADIUS_METERS = 6_371_000

/** Great-circle distance between two points, in meters. */
export function haversineDistanceMeters(a: GeoPoint, b: GeoPoint): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const sinDLat = Math.sin(dLat / 2)
  const sinDLng = Math.sin(dLng / 2)
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)))
}

export interface JobWithLocation {
  id: string
  latitude: number
  longitude: number
}

export interface NearestJobMatch {
  jobId: string
  distanceMeters: number
}

/**
 * Nearest job to a point, from a company's jobs that have coordinates.
 * Deterministic distance math only — never AI, per the module's own rules.
 */
export function findNearestJob(point: GeoPoint, jobs: JobWithLocation[]): NearestJobMatch | null {
  let best: NearestJobMatch | null = null
  for (const job of jobs) {
    const distanceMeters = haversineDistanceMeters(point, { lat: job.latitude, lng: job.longitude })
    if (!best || distanceMeters < best.distanceMeters) {
      best = { jobId: job.id, distanceMeters }
    }
  }
  return best
}

// ── Clock records ───────────────────────────────────────────────────────

export type ClockSelectionSource = "manual" | "nearest" | "recent"
export type ClockStatus = "active" | "closed"

export function durationMinutes(clockInAt: Date, clockOutAt: Date): number {
  return Math.max(0, Math.round((clockOutAt.getTime() - clockInAt.getTime()) / 60_000))
}

export interface ClockOutCorrectionCheck {
  ok: boolean
  reason?: string
}

/** The corrected clock-out must land strictly after clock-in and not be in the future. */
export function validateClockOutCorrection(
  clockInAt: Date,
  correctedClockOutAt: Date,
  now: Date = new Date(),
): ClockOutCorrectionCheck {
  if (correctedClockOutAt.getTime() <= clockInAt.getTime()) {
    return { ok: false, reason: "Clock-out time must be after clock-in time." }
  }
  // One minute of slack absorbs clock skew between client and server.
  if (correctedClockOutAt.getTime() > now.getTime() + 60_000) {
    return { ok: false, reason: "Clock-out time cannot be in the future." }
  }
  return { ok: true }
}

// ── Reports ─────────────────────────────────────────────────────────────

export type ReportType = "daily_report"
export type ReportStatus = "draft" | "submitted"
export type ContentSource = "voice" | "typed"
export type StructuredDataSource = "manual" | "ai"

export interface DailyReportStructuredData {
  workCompleted: string | null
  issuesOrDelays: string | null
  nextSteps: string | null
}

export function emptyDailyReportStructuredData(): DailyReportStructuredData {
  return {
    workCompleted: null,
    issuesOrDelays: null,
    nextSteps: null,
  }
}

/** A daily report can be submitted as the reviewed source text, with optional organized fields. */
export function isDailyReportSubmittable(data: DailyReportStructuredData, rawText: string | null = null): boolean {
  return (
    (typeof rawText === "string" && rawText.trim().length > 0) ||
    Object.values(data).some((value) => typeof value === "string" && value.trim().length > 0)
  )
}
