import {
  createOutlookTask,
  isIsoDate,
  type OutlookTask,
} from "@/lib/outlook-core"
import type { ParsedOutlookTaskSuggestion } from "@/features/outlooks/ai/outlook-parser-contract"

/**
 * Turn validated AI suggestions into real, reviewable `OutlookTask` drafts.
 *
 * This is deliberately pure and deterministic. It never calls the scheduler,
 * never writes Firestore and never trusts a model-provided `endDate`. It only:
 *   - mints stable task ids via `createOutlookTask`;
 *   - resolves `companyName` against the known companies (confirmed match only);
 *   - resolves `dependencyReference` to a real task id (existing task or a
 *     sibling suggestion) — otherwise it is left unresolved for the user;
 *   - carries per-suggestion metadata so the review UI can highlight what is
 *     uncertain and what could not be linked automatically.
 *
 * After the user reviews/edits these drafts, the caller merges them with the
 * current tasks and runs the existing `scheduleOutlookTasks` + `persist` path —
 * the deterministic core stays the sole authority over dates and issues.
 */

export type CompanyMatch = "confirmed" | "ambiguous" | "unmatched" | "none"
export type DependencyMatch = "confirmed" | "unresolved" | "none"

/** Where a resolved field's value came from: the note, the chip context, or
 *  still-empty and needing the reviewer's attention. */
export type FieldSource = "text" | "chip" | "review"

export interface CompanyOption {
  id: string
  name: string
}

/**
 * Optional chip context the user set before generating. Applied ONLY as a
 * fallback for fields the note left empty — anything explicit in the text always
 * wins. Nothing here is ever invented by the AI.
 */
export interface OutlookContextDefaults {
  startDate?: string | null
  durationDays?: number | null
  trade?: string | null
  companyName?: string | null
  companyContextId?: string | null
  dependencyTaskId?: string | null
}

export interface SuggestionFieldSources {
  startDate: FieldSource
  durationDays: FieldSource
  trade: FieldSource
  companyName: FieldSource
  dependency: FieldSource
}

export interface NormalizeSuggestionsContext {
  companies: CompanyOption[]
  existingTasks: Pick<OutlookTask, "id" | "title">[]
}

export interface NormalizedSuggestion {
  /** Draft task ready for review; ids/derived fields assigned deterministically. */
  task: OutlookTask
  /** The raw suggestion, kept so the UI can surface confidence/warnings. */
  suggestion: ParsedOutlookTaskSuggestion
  companyMatch: CompanyMatch
  dependencyMatch: DependencyMatch
  /** Per-field provenance: text (from note) · chip (from context) · review. */
  fieldSources: SuggestionFieldSources
  /** Human-readable notes: model warnings plus resolution outcomes. */
  notes: string[]
}

function normalizeName(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase()
}

function resolveCompany(
  companyName: string | null | undefined,
  companies: CompanyOption[],
): { companyContextId: string | null; match: CompanyMatch } {
  const needle = normalizeName(companyName)
  if (!needle) return { companyContextId: null, match: "none" }
  const matches = companies.filter((company) => normalizeName(company.name) === needle)
  if (matches.length === 1) return { companyContextId: matches[0].id, match: "confirmed" }
  if (matches.length > 1) return { companyContextId: null, match: "ambiguous" }
  return { companyContextId: null, match: "unmatched" }
}

/**
 * Resolve a dependency reference to a concrete task id.
 * Accepts, in priority order: a sibling `clientSuggestionId`, an exact-unique
 * title match against existing tasks, then against sibling suggestions.
 */
function resolveDependency(
  reference: string | null | undefined,
  siblingIdByClientId: Map<string, string>,
  existingTasks: Pick<OutlookTask, "id" | "title">[],
  siblingTitleToId: Map<string, string[]>,
  existingTitleToId: Map<string, string[]>,
): { dependencyTaskId: string | null; match: DependencyMatch } {
  const ref = (reference ?? "").trim()
  if (!ref) return { dependencyTaskId: null, match: "none" }

  const bySiblingId = siblingIdByClientId.get(ref)
  if (bySiblingId) return { dependencyTaskId: bySiblingId, match: "confirmed" }

  const needle = ref.toLowerCase()
  const existingMatches = existingTitleToId.get(needle) ?? []
  if (existingMatches.length === 1) return { dependencyTaskId: existingMatches[0], match: "confirmed" }

  const siblingMatches = siblingTitleToId.get(needle) ?? []
  if (siblingMatches.length === 1) return { dependencyTaskId: siblingMatches[0], match: "confirmed" }

  void existingTasks
  return { dependencyTaskId: null, match: "unresolved" }
}

function collectTitleIndex(entries: Array<{ id: string; title: string }>): Map<string, string[]> {
  const index = new Map<string, string[]>()
  for (const entry of entries) {
    const key = entry.title.trim().toLowerCase()
    if (!key) continue
    const list = index.get(key)
    if (list) list.push(entry.id)
    else index.set(key, [entry.id])
  }
  return index
}

function cleanText(value: string | null | undefined): string {
  return (value ?? "").trim()
}

export function normalizeOutlookSuggestions(
  suggestions: ParsedOutlookTaskSuggestion[],
  context: NormalizeSuggestionsContext,
  startSortOrder = 0,
  defaults: OutlookContextDefaults = {},
): NormalizedSuggestion[] {
  // Chip defaults are only ever a fallback for fields the note left empty.
  const defaultStart = defaults.startDate && isIsoDate(defaults.startDate) ? defaults.startDate : null
  const defaultDuration = typeof defaults.durationDays === "number" && defaults.durationDays > 0 ? defaults.durationDays : null
  const defaultTrade = cleanText(defaults.trade)
  const defaultCompany = cleanText(defaults.companyName)

  // Pass 1: apply defaults where the note is silent (text wins) + mint ids so
  // sibling dependency references can be resolved in pass 2.
  const drafts = suggestions.map((suggestion, index) => {
    const aiStart = suggestion.startDate && isIsoDate(suggestion.startDate) ? suggestion.startDate : null
    const startDate = aiStart ?? defaultStart
    const startDateSource: FieldSource = aiStart ? "text" : startDate ? "chip" : "review"

    const aiDuration = typeof suggestion.durationDays === "number" ? suggestion.durationDays : null
    const durationDays = aiDuration ?? defaultDuration ?? undefined
    const durationSource: FieldSource = aiDuration != null ? "text" : defaultDuration != null ? "chip" : "review"

    const aiTrade = cleanText(suggestion.trade)
    const trade = aiTrade || defaultTrade
    const tradeSource: FieldSource = aiTrade ? "text" : trade ? "chip" : "review"

    const aiCompany = cleanText(suggestion.companyName)
    let companyName = ""
    let companyContextId: string | null = null
    let companyMatch: CompanyMatch = "none"
    let companySource: FieldSource = "review"
    if (aiCompany) {
      companyName = aiCompany
      const resolved = resolveCompany(aiCompany, context.companies)
      companyContextId = resolved.companyContextId
      companyMatch = resolved.match
      companySource = "text"
    } else if (defaultCompany) {
      companyName = defaultCompany
      const resolved = resolveCompany(defaultCompany, context.companies)
      companyContextId = defaults.companyContextId ?? resolved.companyContextId
      companyMatch = companyContextId ? "confirmed" : resolved.match
      companySource = "chip"
    }

    const task = createOutlookTask({
      sortOrder: startSortOrder + index,
      title: suggestion.title,
      description: suggestion.description ?? "",
      trade,
      companyName,
      companyContextId,
      startDate,
      durationDays,
      // endDate is intentionally never taken from the model.
      dependencyTaskId: null,
      status: suggestion.status ?? "not_started",
      completionPercent: suggestion.completionPercent ?? 0,
    })
    return { suggestion, task, companyMatch, startDateSource, durationSource, tradeSource, companySource }
  })

  const siblingIdByClientId = new Map(drafts.map((draft) => [draft.suggestion.clientSuggestionId, draft.task.id]))
  const siblingTitleToId = collectTitleIndex(drafts.map((draft) => ({ id: draft.task.id, title: draft.task.title })))
  const existingTitleToId = collectTitleIndex(
    context.existingTasks.map((task) => ({ id: task.id, title: task.title })),
  )
  const defaultDependencyId = cleanText(defaults.dependencyTaskId) || null

  // Pass 2: resolve dependencies, provenance and review metadata.
  return drafts.map(({ suggestion, task, companyMatch, startDateSource, durationSource, tradeSource, companySource }) => {
    const aiDependency = resolveDependency(
      suggestion.dependencyReference,
      siblingIdByClientId,
      context.existingTasks,
      siblingTitleToId,
      existingTitleToId,
    )
    const hadAiDependencyRef = cleanText(suggestion.dependencyReference).length > 0
    const aiDependencyId = aiDependency.dependencyTaskId === task.id ? null : aiDependency.dependencyTaskId

    let dependencyTaskId: string | null
    let dependencyMatch: DependencyMatch
    let dependencySource: FieldSource
    if (aiDependencyId) {
      dependencyTaskId = aiDependencyId
      dependencyMatch = "confirmed"
      dependencySource = "text"
    } else if (hadAiDependencyRef) {
      // The note named a dependency we couldn't link — leave it for review.
      dependencyTaskId = null
      dependencyMatch = "unresolved"
      dependencySource = "review"
    } else if (defaultDependencyId && defaultDependencyId !== task.id) {
      dependencyTaskId = defaultDependencyId
      dependencyMatch = "confirmed"
      dependencySource = "chip"
    } else {
      dependencyTaskId = null
      dependencyMatch = "none"
      dependencySource = "review"
    }

    const fieldSources: SuggestionFieldSources = {
      startDate: startDateSource,
      durationDays: durationSource,
      trade: tradeSource,
      companyName: companySource,
      dependency: dependencySource,
    }

    // Keep only AI caveats a chip/text value hasn't already resolved.
    const notes = suggestion.warnings.filter((warning) => {
      const lower = warning.toLowerCase()
      if (fieldSources.startDate !== "review" && lower.includes("date")) return false
      if (fieldSources.durationDays !== "review" && lower.includes("duration")) return false
      if (fieldSources.companyName !== "review" && lower.includes("company")) return false
      return true
    })
    if (companyMatch === "ambiguous") notes.push(`"${task.companyName}" matches more than one company — pick one.`)
    if (companyMatch === "unmatched") notes.push(`"${task.companyName}" is not a known company yet.`)
    if (dependencyMatch === "unresolved") {
      notes.push(`Could not link the dependency "${cleanText(suggestion.dependencyReference)}" — set it manually.`)
    }
    if (!task.startDate && !dependencyTaskId) notes.push("No start date or dependency detected — set one before saving.")

    return {
      task: { ...task, dependencyTaskId },
      suggestion,
      companyMatch,
      dependencyMatch,
      fieldSources,
      notes,
    }
  })
}
