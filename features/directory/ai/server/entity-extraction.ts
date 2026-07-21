import type { DirectoryListItem } from "@/lib/directory-config"
import { normalizeName, stripPunctuation, type DirectoryIndexRecord } from "@/lib/ai/server/directory-data"
import { detectTrade } from "@/features/directory/ai/directory-suggestions"
import type { DirectoryDataProvider } from "@/features/directory/ai/server/tools/types"

/**
 * Deterministic multi-entity extraction over bounded Firestore lookups.
 *
 * Finds EVERY person / company / job named in a question (several of the same
 * type are supported — a question is never collapsed to one entity), plus the
 * structured attributes that shape retrieval: location, trade, role and status.
 *
 * Per the Firestore audit there is no in-memory catalog to match against, so
 * candidate name spans are resolved with bounded `normalizedName` queries and
 * the number of lookups per question is hard-capped. When a name matches
 * several records it becomes an ambiguous slot the user resolves before we
 * spend a model call.
 */

const MAX_SPAN_WORDS = 5
const MAX_LOOKUPS = 10
const MAX_CANDIDATES = 5

/**
 * Words that structure a question rather than name anything. A span containing
 * one of these mid-phrase ("74 Construction **and** 1901") is never an entity,
 * so rejecting it keeps the bounded lookup budget for real candidates.
 */
const INTERIOR_BREAK = new Set([
  "and", "or", "between", "with", "from", "than", "that", "compare", "versus", "vs",
  "connect", "connects", "connecting", "related", "shared", "common", "both",
  "who", "what", "which", "where", "when", "how", "why", "is", "are", "was", "were",
  "does", "do", "did", "has", "have", "had", "the", "for", "to", "in", "on", "at",
])

const STOPWORDS = new Set([
  "who", "what", "which", "where", "when", "how", "why", "is", "are", "was", "were", "the", "a", "an",
  "of", "for", "at", "in", "on", "to", "and", "or", "with", "does", "do", "did", "has", "have", "had",
  "between", "both", "shared", "common", "related", "connected", "connect", "connects", "connecting",
  "show", "list", "find", "give", "me", "tell", "about", "summarize", "summary", "overview",
  "best", "should", "recommend", "most", "closely", "many", "any", "there", "we", "i", "us", "our",
  "active", "current", "currently", "all", "some", "more", "than", "that", "this", "these", "those",
  "jobs", "job", "people", "person", "contacts", "contact", "company", "companies", "work", "works",
  "working", "team", "staff", "employees", "notes", "note", "status", "location", "role", "trade",
])

export interface ResolvedEntity {
  /** The phrase in the question that produced this match. */
  mention: string
  item: DirectoryListItem
}

export interface AmbiguousSlot {
  mention: string
  candidates: DirectoryListItem[]
}

export interface EntityExtraction {
  entities: ResolvedEntity[]
  /** Mentions that matched several records — resolve one at a time. */
  ambiguous: AmbiguousSlot[]
  locations: string[]
  trades: string[]
  roles: string[]
  statuses: string[]
  dates: string[]
}

const ROLE_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: "project manager", re: /\bproject\s*managers?\b|\bpm\b/i },
  { label: "project lead", re: /\bproject\s*leads?\b/i },
  { label: "supervisor", re: /\bsupervisors?\b|\bforeman\b|\bsuperintendents?\b/i },
  { label: "estimator", re: /\bestimators?\b/i },
  { label: "owner", re: /\bowners?\b|\bprincipals?\b/i },
]

const STATUS_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: "in progress", re: /\bin\s*progress\b|\bongoing\b/i },
  { label: "planning", re: /\bplanning\b|\bplanned\b/i },
  { label: "complete", re: /\bcomplete[d]?\b|\bfinished\b/i },
  { label: "cancelled", re: /\bcancell?ed\b/i },
  { label: "on hold", re: /\bon\s*hold\b|\bpaused\b/i },
  { label: "active", re: /\bactive\b|\bopen\b/i },
]

export function indexRecordToListItem(record: DirectoryIndexRecord): DirectoryListItem {
  return {
    id: record.id,
    type: record.type === "other" ? "person" : record.type,
    name: record.name,
    subtitle: record.subtitle,
    companyName: record.companyName,
    location: record.location,
    role: record.role,
    description: record.askContext?.aiText ?? record.description,
  }
}

function tokenize(question: string): string[] {
  return question.replace(/[?!.,;:()"']/g, " ").split(/\s+/).filter(Boolean)
}

interface Span {
  text: string
  start: number
  end: number
}

/** Candidate name phrases: contiguous word spans not bounded by stopwords. */
function candidateSpans(tokens: string[]): Span[] {
  const spans: Span[] = []
  for (let size = Math.min(MAX_SPAN_WORDS, tokens.length); size >= 1; size -= 1) {
    for (let start = 0; start + size <= tokens.length; start += 1) {
      const slice = tokens.slice(start, start + size)
      const first = slice[0].toLowerCase()
      const last = slice[slice.length - 1].toLowerCase()
      if (STOPWORDS.has(first) || STOPWORDS.has(last)) continue
      if (slice.every((token) => STOPWORDS.has(token.toLowerCase()))) continue
      // Reject spans that straddle a question connector — they burn lookups.
      if (slice.some((token) => INTERIOR_BREAK.has(token.toLowerCase()))) continue
      const textValue = slice.join(" ")
      if (textValue.length < 3) continue
      spans.push({ text: textValue, start, end: start + size })
    }
  }
  // Longest spans first, so "74 Construction" is tried before "Construction".
  return spans.sort((a, b) => b.end - b.start - (a.end - a.start))
}

/** Keep only confident matches: exact name, or a substantial prefix. */
function strongMatches(records: DirectoryIndexRecord[], normalizedSpan: string): DirectoryIndexRecord[] {
  // Compare punctuation-insensitively: stored names keep theirs ("story:
  // construction ltd.") but a question never does.
  const target = stripPunctuation(normalizedSpan)
  const plainOf = (record: DirectoryIndexRecord) => stripPunctuation(record.normalizedName)

  const exact = records.filter((record) => plainOf(record) === target)
  if (exact.length > 0) return exact
  return records.filter((record) => {
    const plain = plainOf(record)
    return plain.startsWith(target) && target.length >= Math.min(6, plain.length * 0.6)
  })
}

export async function extractEntities(
  provider: DirectoryDataProvider,
  question: string,
  pinned: DirectoryListItem[] = [],
): Promise<EntityExtraction> {
  const tokens = tokenize(question)
  const spans = candidateSpans(tokens)

  const claimed = new Set<number>()
  const entities: ResolvedEntity[] = []
  const ambiguous: AmbiguousSlot[] = []
  const seenIds = new Set(pinned.map((item) => item.id))
  const foundLocations: string[] = []
  for (const item of pinned) {
    entities.push({ mention: item.name, item })
    if (item.location) foundLocations.push(item.location)
  }

  let lookups = 0
  for (const span of spans) {
    if (lookups >= MAX_LOOKUPS) break
    let overlaps = false
    for (let position = span.start; position < span.end; position += 1) {
      if (claimed.has(position)) { overlaps = true; break }
    }
    if (overlaps) continue

    const normalizedSpan = normalizeName(span.text)
    if (normalizedSpan.length < 3) continue

    lookups += 1
    const records = await provider.findByName(span.text, { limit: 8 })
    if (records.length === 0) continue

    const strong = strongMatches(records, normalizedSpan).filter((record) => !seenIds.has(record.id))
    if (strong.length === 0) continue

    for (let position = span.start; position < span.end; position += 1) claimed.add(position)

    if (strong.length === 1) {
      seenIds.add(strong[0].id)
      entities.push({ mention: span.text, item: indexRecordToListItem(strong[0]) })
      if (strong[0].location) foundLocations.push(strong[0].location)
    } else {
      ambiguous.push({
        mention: span.text,
        candidates: strong.slice(0, MAX_CANDIDATES).map(indexRecordToListItem),
      })
    }
  }

  // Locations come from the resolved records plus an explicit "in <Place>".
  const explicit = [...question.matchAll(/\bin\s+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)*(?:,\s*[A-Z]{2})?)/g)].map((match) => match[1])
  const locations = [...new Set([...foundLocations, ...explicit].filter(Boolean))].slice(0, 3)

  const trade = detectTrade({ role: question, keywords: "", tags: [], name: "" })
  return {
    entities,
    ambiguous,
    locations,
    trades: trade ? [trade] : [],
    roles: ROLE_PATTERNS.filter(({ re }) => re.test(question)).map(({ label }) => label),
    statuses: STATUS_PATTERNS.filter(({ re }) => re.test(question)).map(({ label }) => label),
    dates: [...question.matchAll(/\b\d{4}-\d{2}-\d{2}\b|\b(20\d{2})\b/g)].map((match) => match[0]).slice(0, 3),
  }
}
