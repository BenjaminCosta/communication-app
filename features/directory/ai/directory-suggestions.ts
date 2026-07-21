import type { DirectorySearchDoc } from "@/lib/directory"
import type { DirectoryListItem, DirectoryScope } from "@/lib/directory-config"
import type { DirectoryAskIntent } from "@/features/directory/ai/directory-ask-contract"
import { type AskSuggestion, normalizeAskText } from "@/features/directory/ai/directory-retrieval-core"

/**
 * Local, context-aware suggestion engine for Ask SVC Directory.
 *
 * It reads ONLY recent Directory activity (recently opened records + the current
 * page context) plus the fields each record actually carries, and emits question
 * templates that the current data can actually answer. It never calls OpenAI.
 *
 * Design goals: small + declarative so more templates are cheap to add, and each
 * template gates on the fields/records it needs — no `{location}` question when
 * there is no location, no company↔job cross-question unless both exist. Results
 * are ranked (recency · relevance · completeness), deduped, diversified across
 * entities, and rotated by a seed so the same four don't always appear.
 */

export interface SuggestionRecord {
  item: DirectoryListItem
  /** Full index doc when available — unlocks status/tags/keywords/completeness. */
  doc?: DirectorySearchDoc | null
  /** 0 = most recent. Lower ranks higher. */
  recencyIndex: number
}

export interface SuggestionInput {
  /** Recently opened records, most-recent-first. */
  recents: SuggestionRecord[]
  /** Current page scope (all/person/company/job). */
  scope: DirectoryScope
  /** Pinned/current-page entity, treated as the strongest recency signal. */
  contextEntity?: DirectoryListItem | null
  contextDoc?: DirectorySearchDoc | null
  /** Representative entities for the no-context fallback (e.g. first company/job). */
  fallbackEntities?: DirectoryListItem[]
  /** Rotation seed — change it to rotate which comparable suggestions surface. */
  seed?: number
  max?: number
}

// ── Scoring weights ──────────────────────────────────────────────────────────

const RECENTS_CONSIDERED = 4
const RECENCY_MULT = 6
const COMPLETENESS_MULT = 0.6
const SCOPE_MATCH_BONUS = 6
const JITTER_RANGE = 3
const MAX_PER_ENTITY = 2

interface Candidate {
  suggestion: AskSuggestion
  base: number
  recencyIndex: number
  completeness: number
  /** Primary entity id for the per-entity diversity cap (null = general query). */
  entityId: string | null
  /** Collapse near-duplicate questions (same intent group + entity). */
  family: string
}

// ── Field helpers ────────────────────────────────────────────────────────────

interface RecordView {
  id: string
  type: DirectoryListItem["type"]
  name: string
  companyName: string
  location: string
  role: string
  tags: string[]
  keywords: string
  completeness: number
  recencyIndex: number
  item: DirectoryListItem
}

function viewOf(record: SuggestionRecord): RecordView {
  const { item, doc } = record
  return {
    id: item.id,
    type: item.type,
    name: item.name,
    companyName: doc?.companyName || item.companyName || "",
    location: doc?.location || item.location || "",
    role: doc?.role || item.role || "",
    tags: doc?.tags ?? [],
    keywords: doc?.keywords ?? "",
    completeness: doc?.fieldCount ?? countPresent(item),
    recencyIndex: record.recencyIndex,
    item,
  }
}

function countPresent(item: DirectoryListItem): number {
  return [item.name, item.companyName, item.location, item.role, item.description].filter(
    (value) => typeof value === "string" && value.trim().length > 0,
  ).length
}

/** Keep only locations clean enough to read in a question (city / "City, ST"). */
export function cleanLocation(location: string | undefined | null): string | null {
  const loc = (location ?? "").trim()
  if (!loc || loc.length > 30) return null
  if (/\d/.test(loc)) return null // street numbers / zips
  if (/\b(suite|ste|floor|fl|pkwy|st|ave|blvd|road|rd|dr|drive|lane|ln|hwy|unit)\b/i.test(loc)) return null
  if (/^[A-Za-zÀ-ÿ .'\-]+(,\s*[A-Za-zÀ-ÿ .'\-]{2,})?$/.test(loc)) return loc
  return null
}

const TRADES: Array<{ display: string; re: RegExp }> = [
  { display: "electrical", re: /\belectric(al|ian)?\b/i },
  { display: "plumbing", re: /\bplumb(ing|er)?\b/i },
  { display: "framing", re: /\bfram(ing|er)\b/i },
  { display: "concrete", re: /\bconcrete\b/i },
  { display: "masonry", re: /\bmason(ry)?\b/i },
  { display: "HVAC", re: /\bhvac|mechanical\b/i },
  { display: "drywall", re: /\bdrywall\b/i },
  { display: "roofing", re: /\broof(ing|er)?\b/i },
  { display: "painting", re: /\bpaint(ing|er)?\b/i },
  { display: "carpentry", re: /\bcarpent(ry|er)\b/i },
  { display: "welding", re: /\bweld(ing|er)?\b/i },
  { display: "excavation", re: /\bexcavat(ion|ing|or)\b/i },
  { display: "landscaping", re: /\blandscap(ing|e|er)\b/i },
  { display: "flooring", re: /\bfloor(ing)?\b/i },
]

/** Derive a trade from a record's role/keywords/tags/name (no dedicated field). */
export function detectTrade(view: Pick<RecordView, "role" | "keywords" | "tags" | "name">): string | null {
  const haystack = `${view.role} ${view.keywords} ${view.tags.join(" ")} ${view.name}`
  for (const trade of TRADES) {
    if (trade.re.test(haystack)) return trade.display
  }
  return null
}

// ── Candidate generation ─────────────────────────────────────────────────────

function familyOf(intent: DirectoryAskIntent, entityId: string): string {
  const group =
    intent === "who_works_at"
      ? "people"
      : intent === "jobs_for"
        ? "jobs"
        : intent === "related_to"
          ? "related"
          : intent === "summarize"
            ? "summary"
            : "lookup"
  return `${group}:${entityId}`
}

function singleRecordCandidates(view: RecordView): Candidate[] {
  const out: Candidate[] = []
  const { item, id, name, recencyIndex, completeness } = view
  const add = (base: number, text: string, intent: DirectoryAskIntent, opts: { family?: string; entity?: DirectoryListItem | null } = {}) => {
    out.push({
      suggestion: { id: `${intent}-${id}-${normalizeAskText(text).slice(0, 24)}`, text, intent, entity: opts.entity === null ? undefined : opts.entity ?? item },
      base,
      recencyIndex,
      completeness,
      entityId: opts.entity === null ? null : (opts.entity?.id ?? id),
      family: opts.family ?? familyOf(intent, id),
    })
  }
  const loc = cleanLocation(view.location)

  if (view.type === "company") {
    add(13, `Who works at ${name}?`, "who_works_at")
    if (loc) add(20, `What active jobs does ${name} have in ${loc}?`, "jobs_for")
    else add(13, `Show active jobs for ${name}`, "jobs_for")
    add(12, `Which companies are related to ${name}?`, "related_to")
  } else if (view.type === "job") {
    add(16, `Who is most closely related to ${name}?`, "related_to")
    add(15, `Who are the key contacts on ${name}?`, "who_works_at")
    add(9, `Summarize ${name}`, "summarize")
    if (loc) add(17, `What other jobs are active in ${loc}?`, "jobs_for", { family: `loc-jobs:${normalizeAskText(loc)}`, entity: null })
  } else {
    // person
    if (view.companyName) add(14, `How is ${name} connected to ${view.companyName}?`, "related_to", { family: `person-company:${id}` })
    add(13, `Which jobs is ${name} connected to?`, "jobs_for")
    add(12, `Who is related to ${name}?`, "related_to")
    add(8, `Summarize ${name}`, "summarize")
  }

  // Trade-aware (role/keywords/tags), independent of type.
  const trade = detectTrade(view)
  if (trade) {
    const tradeKey = normalizeAskText(trade)
    out.push({
      suggestion: { id: `trade-sup-${tradeKey}`, text: `Which supervisors are connected to ${trade} work?`, intent: "related_to" },
      base: 18,
      recencyIndex,
      completeness,
      entityId: null,
      family: `trade-sup:${tradeKey}`,
    })
    out.push({
      suggestion: { id: `trade-people-${tradeKey}`, text: `Show ${trade} contacts`, intent: "who_works_at" },
      base: 13,
      recencyIndex,
      completeness,
      entityId: null,
      family: `trade-people:${tradeKey}`,
    })
  }

  // Location-aware "who works in" (general), when the location is clean.
  if (loc) {
    const locKey = normalizeAskText(loc)
    out.push({
      suggestion: { id: `loc-people-${locKey}`, text: `Who works in ${loc}?`, intent: "who_works_at" },
      base: 12,
      recencyIndex,
      completeness,
      entityId: null,
      family: `loc-people:${locKey}`,
    })
  }

  return out
}

/** Combine two recent records into a cross-entity question when it makes sense. */
function crossCandidate(a: RecordView, b: RecordView): Candidate | null {
  const recencyIndex = Math.min(a.recencyIndex, b.recencyIndex)
  const completeness = Math.max(a.completeness, b.completeness)
  const ids = [a.id, b.id].sort().join("|")
  const make = (base: number, text: string, entity?: DirectoryListItem): Candidate => ({
    suggestion: { id: `cross-${ids}`, text, intent: "related_to", entity },
    base,
    recencyIndex,
    completeness,
    entityId: entity?.id ?? null,
    family: `cross:${ids}`,
  })
  const types = [a.type, b.type].sort().join("+")

  if (types === "company+job") {
    const company = a.type === "company" ? a : b
    const job = a.type === "job" ? a : b
    return make(22, `Which contacts are shared between ${company.name} and ${job.name}?`, company.item)
  }
  if (types === "company+company") return make(20, `How are ${a.name} and ${b.name} connected?`)
  if (types === "company+person") {
    const person = a.type === "person" ? a : b
    const company = a.type === "company" ? a : b
    return make(20, `How is ${person.name} connected to ${company.name}?`, person.item)
  }
  if (types === "job+person") {
    const person = a.type === "person" ? a : b
    const job = a.type === "job" ? a : b
    return make(19, `Is ${person.name} involved in ${job.name}?`, person.item)
  }
  if (types === "job+job") return make(19, `How are ${a.name} and ${b.name} related?`)
  return null
}

function fallbackCandidates(entities: DirectoryListItem[]): Candidate[] {
  return entities.flatMap((item) => {
    const view: RecordView = {
      id: item.id,
      type: item.type,
      name: item.name,
      companyName: item.companyName ?? "",
      location: item.location ?? "",
      role: item.role ?? "",
      tags: [],
      keywords: "",
      completeness: countPresent(item),
      recencyIndex: RECENTS_CONSIDERED, // lowest recency
      item,
    }
    // Only the safest one-per-entity template, with a low base weight.
    return singleRecordCandidates(view)
      .slice(0, 1)
      .map((candidate) => ({ ...candidate, base: 2 }))
  })
}

// ── Scoring + selection ──────────────────────────────────────────────────────

function jitter(key: string, seed: number): number {
  let hash = (2166136261 ^ seed) >>> 0
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return ((hash >>> 0) % 1000) / 1000 * JITTER_RANGE
}

function score(candidate: Candidate, scope: DirectoryScope, seed: number): number {
  const recencyBoost = Math.max(0, RECENTS_CONSIDERED - candidate.recencyIndex) * RECENCY_MULT
  const completeness = Math.min(candidate.completeness, 10) * COMPLETENESS_MULT
  const scopeBonus = scope !== "all" && candidate.suggestion.entity?.type === scope ? SCOPE_MATCH_BONUS : 0
  return candidate.base + recencyBoost + completeness + scopeBonus + jitter(candidate.family, seed)
}

export function buildDirectorySuggestions(input: SuggestionInput): AskSuggestion[] {
  const max = input.max ?? 4
  const seed = input.seed ?? 0
  const scope = input.scope ?? "all"

  // The current-page entity is the strongest recency signal (index -1).
  const records: SuggestionRecord[] = []
  const seenRecordIds = new Set<string>()
  if (input.contextEntity) {
    records.push({ item: input.contextEntity, doc: input.contextDoc ?? null, recencyIndex: -1 })
    seenRecordIds.add(input.contextEntity.id)
  }
  for (const record of input.recents) {
    if (seenRecordIds.has(record.item.id)) continue
    seenRecordIds.add(record.item.id)
    records.push(record)
  }

  const views = records.map(viewOf)
  const candidates: Candidate[] = views.flatMap(singleRecordCandidates)

  // Cross-record combinations across the most-recent handful.
  const pairPool = views.slice(0, 3)
  for (let i = 0; i < pairPool.length; i += 1) {
    for (let j = i + 1; j < pairPool.length; j += 1) {
      const cross = crossCandidate(pairPool[i], pairPool[j])
      if (cross) candidates.push(cross)
    }
  }

  // Safe fallback only when real context is thin.
  if (candidates.length < max) {
    candidates.push(...fallbackCandidates(input.fallbackEntities ?? []))
  }

  return selectTop(candidates, scope, seed, max)
}

function selectTop(candidates: Candidate[], scope: DirectoryScope, seed: number, max: number): AskSuggestion[] {
  // Collapse near-duplicates: highest-scoring per family, then per exact text.
  const scored = candidates.map((candidate) => ({ candidate, value: score(candidate, scope, seed) }))
  const bestByFamily = new Map<string, { candidate: Candidate; value: number }>()
  for (const entry of scored) {
    const current = bestByFamily.get(entry.candidate.family)
    if (!current || entry.value > current.value) bestByFamily.set(entry.candidate.family, entry)
  }

  const ranked = [...bestByFamily.values()].sort((a, b) => b.value - a.value)
  const out: AskSuggestion[] = []
  const seenText = new Set<string>()
  const perEntity = new Map<string, number>()

  for (const { candidate } of ranked) {
    if (out.length >= max) break
    const textKey = normalizeAskText(candidate.suggestion.text)
    if (seenText.has(textKey)) continue
    if (candidate.entityId) {
      const used = perEntity.get(candidate.entityId) ?? 0
      if (used >= MAX_PER_ENTITY) continue
      perEntity.set(candidate.entityId, used + 1)
    }
    seenText.add(textKey)
    out.push(candidate.suggestion)
  }
  return out
}
