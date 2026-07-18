import { addIsoDays, isIsoDate } from "@/lib/outlook-core"
import type {
  ParseOutlookContext,
  ParseOutlookResult,
  ParsedOutlookTaskSuggestion,
} from "@/features/outlooks/ai/outlook-parser-contract"

/**
 * Deterministic, dependency-free stand-in for the `gpt-5-mini` parser.
 *
 * It runs whenever the app is in mock mode (no API key) so the entire capture →
 * review UX is exercisable offline, and it doubles as a graceful fallback. It is
 * intentionally simple: it splits notes into activities and pulls out durations,
 * dates and known company names with plain heuristics. It never fabricates a
 * value it cannot find — missing fields become null with a low confidence and a
 * warning, exactly like the real parser is instructed to behave.
 */

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]

function isoWeekday(iso: string): number {
  const [year, month, day] = iso.split("-").map(Number)
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

/** Resolve a relative/explicit date phrase against the client-local `today`. */
function resolveDate(segment: string, today: string): string | null {
  const explicit = segment.match(/\d{4}-\d{2}-\d{2}/)
  if (explicit && isIsoDate(explicit[0])) return explicit[0]

  const lower = segment.toLowerCase()
  if (!isIsoDate(today)) return null
  if (/\btoday\b/.test(lower)) return today
  if (/\btomorrow\b/.test(lower)) return addIsoDays(today, 1)

  const weekdayMatch = lower.match(/\b(next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/)
  if (weekdayMatch) {
    const target = WEEKDAYS.indexOf(weekdayMatch[2])
    const current = isoWeekday(today)
    let delta = (target - current + 7) % 7
    if (delta === 0) delta = 7 // "monday" spoken today means the next one
    return addIsoDays(today, delta)
  }
  return null
}

/** Pull a calendar-day duration out of "3 days" / "2 weeks" / "a week". */
function resolveDuration(segment: string): number | null {
  const lower = segment.toLowerCase()
  const num = lower.match(/(\d+)\s*(day|days|week|weeks)\b/)
  if (num) {
    const value = Number(num[1])
    return num[2].startsWith("week") ? value * 7 : value
  }
  if (/\ba week\b/.test(lower)) return 7
  return null
}

function resolveCompany(segment: string, companies: ParseOutlookContext["companies"]): string | null {
  const lower = segment.toLowerCase()
  const hit = companies.find((company) => company.name && lower.includes(company.name.toLowerCase()))
  return hit ? hit.name : null
}

const LEADING_CONNECTOR = /^(?:and\s+)?(?:then|after\s+that|afterwards?|followed\s+by|next|once)\b/i
const INTERNAL_CONNECTOR = /,?\s+(?:and\s+)?(?:then|after\s+that|afterwards?|followed\s+by|next|once)\s+/i

/**
 * Split a note into activity segments, remembering which segments follow a
 * "then/after that" connector so dependencies survive the split (the connector
 * word itself is removed from the segment text).
 */
function splitSegments(text: string): Array<{ text: string; dependsOnPrevious: boolean }> {
  const sentences = text
    .split(/\n|(?:\.\s+)|;/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 1)

  const segments: Array<{ text: string; dependsOnPrevious: boolean }> = []
  for (const sentence of sentences) {
    let base = sentence
    let sentenceDepends = false
    const lead = base.match(LEADING_CONNECTOR)
    if (lead) {
      sentenceDepends = true
      base = base.slice(lead[0].length).trim()
    }
    const clauses = base
      .split(INTERNAL_CONNECTOR)
      .map((clause) => clause.trim())
      .filter((clause) => clause.length > 1)
    clauses.forEach((clause, index) => {
      segments.push({ text: clause, dependsOnPrevious: index === 0 ? sentenceDepends : true })
    })
  }
  return segments
}

/** Strip date/duration noise so the leftover reads like a task title. */
function deriveTitle(segment: string): string {
  return segment
    .replace(/\d{4}-\d{2}-\d{2}/g, " ")
    .replace(/\b(next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/gi, " ")
    .replace(/\b(today|tomorrow)\b/gi, " ")
    .replace(/\b(for\s+)?(\d+\s*(day|days|week|weeks)|a week)\b/gi, " ")
    .replace(/\bwith\b.*$/i, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s.,-]+|[\s.,-]+$/g, "")
    .slice(0, 80)
    .trim()
}

export function mockParseOutlookText(text: string, context: ParseOutlookContext): ParseOutlookResult {
  const segments = splitSegments(text).slice(0, 20)
  const suggestions: ParsedOutlookTaskSuggestion[] = []
  let previousTitle: string | null = null

  segments.forEach((segment, index) => {
    const title = deriveTitle(segment.text) || `Task ${index + 1}`
    const startDate = resolveDate(segment.text, context.today)
    const durationDays = resolveDuration(segment.text)
    const companyName = resolveCompany(segment.text, context.companies)
    const dependsOnPrevious = segment.dependsOnPrevious && !startDate && previousTitle !== null
    const warnings: string[] = []
    if (!startDate && !dependsOnPrevious) warnings.push("No start date detected — set one in review.")
    if (durationDays === null) warnings.push("No duration detected — defaults to 1 day.")

    suggestions.push({
      clientSuggestionId: `mock-${index + 1}`,
      title,
      description: null,
      trade: null,
      companyName,
      startDate,
      durationDays,
      dependencyReference: dependsOnPrevious ? previousTitle : null,
      status: "not_started",
      completionPercent: 0,
      confidence: {
        title: 0.6,
        startDate: startDate ? 0.7 : 0.2,
        durationDays: durationDays !== null ? 0.7 : 0.2,
        trade: 0.2,
        companyName: companyName ? 0.8 : 0.2,
        dependencyReference: dependsOnPrevious ? 0.5 : 0.2,
      },
      warnings,
    })
    previousTitle = title
  })

  return {
    suggestions,
    warnings: suggestions.length
      ? ["Generated by the offline mock parser. Review every field before saving."]
      : ["No activities were detected in the note."],
  }
}

/** A realistic multi-activity transcript returned by the mock transcriber. */
export const MOCK_OUTLOOK_TRANSCRIPT =
  "Pour the foundation on Monday for three days. Then framing for five days with the framing crew. After that electrical rough-in for two days."
