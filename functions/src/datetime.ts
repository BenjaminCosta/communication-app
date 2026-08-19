// ⚠️ GENERATED FILE — DO NOT EDIT.
// Source of truth: lib/datetime.ts (repo root).
// Regenerate with: pnpm --prefix functions build  (or node functions/scripts/copy-shared-core.mjs)

/**
 * Single source of truth for "what time/day is it" across the app. Every
 * instant-with-time-of-day display (message times, clock in/out, report
 * dates, PDF dates) and every "today" anchor used for bucketing (day
 * dividers, the WhatsApp Secretary's `today` line, the Outlooks highlight,
 * the calendar-reminder Cloud Function) renders in this one timezone instead
 * of whatever the viewer's device or the server host defaults to.
 *
 * Framework-free (native Date/Intl only) so it can be mirrored verbatim into
 * Cloud Functions by functions/scripts/copy-shared-core.mjs, the same way
 * lib/applications-core.ts and lib/directory-core.ts already are.
 */

export const APP_TIME_ZONE = "America/New_York"

/** "YYYY-MM-DD" for `date` as seen in APP_TIME_ZONE. */
export function todayIsoInAppZone(date: Date = new Date()): string {
  return date.toLocaleDateString("en-CA", { timeZone: APP_TIME_ZONE })
}

export function isSameDayInAppZone(a: Date, b: Date): boolean {
  return todayIsoInAppZone(a) === todayIsoInAppZone(b)
}

/** "Today" / "Yesterday" / weekday / short-date, cutoffs anchored to APP_TIME_ZONE. */
export function getRelativeDayLabel(date: Date, now: Date = new Date()): string {
  const todayIso = todayIsoInAppZone(now)
  const dateIso = todayIsoInAppZone(date)
  if (dateIso === todayIso) return "Today"

  const [ty, tm, td] = todayIso.split("-").map(Number)
  const [dy, dm, dd] = dateIso.split("-").map(Number)
  const diffDays = Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(dy, dm - 1, dd)) / 86_400_000)

  if (diffDays === 1) return "Yesterday"
  if (diffDays > 0 && diffDays < 7) return formatDateInAppZone(date, { weekday: "long" })
  return formatDateInAppZone(date, { month: "short", day: "numeric" })
}

export function formatTimeInAppZone(
  date: Date,
  options: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit", hour12: false },
): string {
  return date.toLocaleTimeString("en-US", {
    ...options,
    timeZone: APP_TIME_ZONE,
  })
}

export function formatDateInAppZone(
  date: Date,
  options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" },
): string {
  return date.toLocaleDateString("en-US", { ...options, timeZone: APP_TIME_ZONE })
}

export function formatDateTimeInAppZone(
  date: Date,
  options: Intl.DateTimeFormatOptions = { dateStyle: "long", timeStyle: "short" },
): string {
  return date.toLocaleString("en-US", { ...options, timeZone: APP_TIME_ZONE })
}

/**
 * Formats a bare "YYYY-MM-DD" calendar-tag date (no time-of-day, e.g. a
 * message's calendar tag). Parses and formats both anchored to UTC — the
 * same safe convention lib/outlook-core.ts's formatOutlookDate already uses
 * — NOT APP_TIME_ZONE, since a date-only value has no instant to convert:
 * running it through a fixed NY offset could shift which day it prints for
 * a viewer/server outside that zone.
 */
export function formatCalendarDateLabel(
  isoDate: string,
  options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" },
): string {
  const [y, m, d] = isoDate.split("-").map(Number)
  const parsed = new Date(Date.UTC(y, m - 1, d))
  return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(parsed)
}

/** Monday of the calendar week containing `date`, in APP_TIME_ZONE. */
export function mondayForDateInAppZone(date: Date): string {
  const iso = todayIsoInAppZone(date)
  const [y, m, d] = iso.split("-").map(Number)
  const utcDate = new Date(Date.UTC(y, m - 1, d))
  const day = utcDate.getUTCDay()
  utcDate.setUTCDate(utcDate.getUTCDate() - (day === 0 ? 6 : day - 1))
  return [
    utcDate.getUTCFullYear(),
    String(utcDate.getUTCMonth() + 1).padStart(2, "0"),
    String(utcDate.getUTCDate()).padStart(2, "0"),
  ].join("-")
}
