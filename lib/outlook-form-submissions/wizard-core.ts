/**
 * Pure step model + helpers for the public 3-Week Outlook wizard — the
 * "Step N of 5" counter, forward/back linear order, per-week task bucketing,
 * and trade→icon matching. Mirrors lib/applications-core.ts's
 * CandidateStepId/CANDIDATE_STEPS pattern. Kept isomorphic and free of React
 * so the navigation/bucketing logic is unit-testable without a browser.
 */

import { addIsoDays } from "@/lib/outlook-core"

export type OutlookFormStepId = "identify" | "job" | "tasks" | "notes" | "review" | "submitted"

export interface OutlookFormStepMeta {
  id: OutlookFormStepId
  /** Position in the "Step N of 5" counter. Only "submitted" sits outside it. */
  index: number | null
}

export const OUTLOOK_FORM_STEP_COUNT = 5

const STEPS: OutlookFormStepMeta[] = [
  { id: "identify", index: 1 },
  { id: "job", index: 2 },
  { id: "tasks", index: 3 },
  { id: "notes", index: 4 },
  { id: "review", index: 5 },
  { id: "submitted", index: null },
]

export function outlookFormStepMeta(id: OutlookFormStepId): OutlookFormStepMeta {
  return STEPS.find((step) => step.id === id) ?? STEPS[0]
}

/** Linear order the super walks through — there is no branch/skip in this flow. */
export const OUTLOOK_FORM_STEP_ORDER: OutlookFormStepId[] = ["identify", "job", "tasks", "notes", "review", "submitted"]

export function nextOutlookFormStep(id: OutlookFormStepId): OutlookFormStepId | null {
  const index = OUTLOOK_FORM_STEP_ORDER.indexOf(id)
  return index >= 0 && index < OUTLOOK_FORM_STEP_ORDER.length - 1 ? OUTLOOK_FORM_STEP_ORDER[index + 1] : null
}

export function previousOutlookFormStep(id: OutlookFormStepId): OutlookFormStepId | null {
  const index = OUTLOOK_FORM_STEP_ORDER.indexOf(id)
  return index > 0 ? OUTLOOK_FORM_STEP_ORDER[index - 1] : null
}

export function canContinueFromIdentify(name: string): boolean {
  return name.trim().length > 0
}

export function canContinueFromJob(jobName: string): boolean {
  return jobName.trim().length > 0
}

/** Local copy of lib/store.ts's deriveInitials() — the public form deliberately never imports lib/store.ts (an authenticated-app module), so this tiny pure helper is duplicated rather than shared. */
export function outlookFormInitials(name: string): string {
  const parts = name.trim().split(" ").filter(Boolean)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  }
  return name.slice(0, 2).toUpperCase()
}

// ── Week bucketing ──────────────────────────────────────────────────────
// The form groups tasks into "Week 1 / Week 2 / Week 3" the same way the
// reference mockup does, purely for display/entry — the stored record has no
// separate week field, only each task's own startDate (real OutlookTask
// shape). A task's week is derived from how far its startDate falls from the
// window's start.

export interface OutlookFormWeekBucket {
  weekIndex: 0 | 1 | 2
  start: string
  end: string
}

function parseIsoUtcMs(date: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) return null
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}

export function outlookFormWeekBuckets(windowStart: string): OutlookFormWeekBucket[] {
  return [0, 1, 2].map((weekIndex) => ({
    weekIndex: weekIndex as 0 | 1 | 2,
    start: addIsoDays(windowStart, weekIndex * 7),
    end: addIsoDays(windowStart, weekIndex * 7 + 6),
  }))
}

/** Which week bucket a task's startDate falls in. No date, or a date outside the 21-day window, defaults to Week 1 rather than being silently dropped. */
export function weekIndexForDate(windowStart: string, date: string | null): 0 | 1 | 2 {
  if (!date) return 0
  const windowMs = parseIsoUtcMs(windowStart)
  const dateMs = parseIsoUtcMs(date)
  if (windowMs === null || dateMs === null) return 0
  const diffDays = Math.round((dateMs - windowMs) / 86_400_000)
  if (diffDays < 7) return 0
  if (diffDays < 14) return 1
  return 2
}

// ── Trade → icon matching ───────────────────────────────────────────────
// Keyword match on the free-text trade field, same spirit as the WhatsApp
// Secretary's own keyword-fallback matchers — a best-effort visual cue, never
// a constraint on what a super can type as their trade.

export type OutlookFormTradeIconKey = "framing" | "electrical" | "drywall" | "painting" | "plumbing" | "concrete" | "hvac" | "roofing" | "general"

const TRADE_KEYWORDS: Array<[OutlookFormTradeIconKey, string[]]> = [
  ["framing", ["frame", "framing", "carpentry", "carpenter"]],
  ["electrical", ["electric"]],
  ["drywall", ["drywall", "sheetrock", "gypsum"]],
  ["painting", ["paint"]],
  ["plumbing", ["plumb"]],
  ["concrete", ["concrete", "masonry", "foundation"]],
  ["hvac", ["hvac", "mechanical"]],
  ["roofing", ["roof"]],
]

export function tradeIconKey(trade: string): OutlookFormTradeIconKey {
  const normalized = trade.trim().toLowerCase()
  if (!normalized) return "general"
  for (const [key, keywords] of TRADE_KEYWORDS) {
    if (keywords.some((keyword) => normalized.includes(keyword))) return key
  }
  return "general"
}

// ── Notes step ───────────────────────────────────────────────────────────
// Quick-select flags are a UI convenience layered on top of the existing
// plain-text `generalNotes` field — no schema/store change needed. Selected
// flags are woven into the one string sent to the API as a short leading
// line, so the backend stays exactly as already built.

export type OutlookFormNoteTagId = "delay" | "delivery" | "inspection" | "manpower" | "weather" | "coordination"

export const OUTLOOK_FORM_NOTE_TAGS: { id: OutlookFormNoteTagId; label: string }[] = [
  { id: "delay", label: "Delay" },
  { id: "delivery", label: "Delivery" },
  { id: "inspection", label: "Inspection" },
  { id: "manpower", label: "Manpower" },
  { id: "weather", label: "Weather" },
  { id: "coordination", label: "Coordination" },
]

export function composeGeneralNotes(tagLabels: string[], notesText: string): string {
  const trimmedNotes = notesText.trim()
  if (tagLabels.length === 0) return trimmedNotes
  const tagLine = `Flags: ${tagLabels.join(", ")}`
  return trimmedNotes ? `${tagLine}\n\n${trimmedNotes}` : tagLine
}
