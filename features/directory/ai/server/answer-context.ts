import type { DirectoryAskContext, DirectoryAskRecord } from "@/features/directory/ai/directory-ask-contract"
import { analyzeForAnswer } from "@/features/directory/ai/answer-brief"
import type { QueryPlan } from "@/features/directory/ai/server/query-planner"
import type { CompactNote, DirectoryToolResult, PathHop } from "@/features/directory/ai/server/tools/types"

/**
 * Grounded reasoning context.
 *
 * Aggregates everything the tools returned into the exact structure the answer
 * model reasons over: confirmed facts, relationships (with the path that proves
 * them), relevant notes, missing information, possible inferences, supporting
 * record ids and the question intent. Nothing else reaches the model.
 */

export interface AggregatedTools {
  records: DirectoryAskRecord[]
  notes: CompactNote[]
  paths: PathHop[][]
  summaries: string[]
  sourcesUsed: string[]
  counts: Record<string, number>
  anyEmpty: boolean
}

/** Merge tool results, de-duplicating records by id and keeping the richest copy. */
export function aggregateToolResults(
  calls: Array<{ name: string; result: DirectoryToolResult }>,
): AggregatedTools {
  const byId = new Map<string, DirectoryAskRecord>()
  const notes = new Map<string, CompactNote>()
  const paths: PathHop[][] = []
  const summaries: string[] = []
  const sourcesUsed: string[] = []
  const counts: Record<string, number> = {}
  let anyEmpty = false

  for (const { name, result } of calls) {
    if (!sourcesUsed.includes(name)) sourcesUsed.push(name)
    if (result.summary) summaries.push(result.summary)
    if (result.empty) anyEmpty = true
    for (const record of result.records ?? []) {
      const existing = byId.get(record.id)
      if (!existing) byId.set(record.id, record)
      else byId.set(record.id, { ...existing, ...stripEmpty(record) })
    }
    for (const note of result.notes ?? []) notes.set(note.id, note)
    for (const path of result.paths ?? []) paths.push(path)
    for (const [key, value] of Object.entries(result.counts ?? {})) {
      counts[key] = Math.max(counts[key] ?? 0, value)
    }
  }

  return {
    records: [...byId.values()],
    notes: [...notes.values()],
    paths,
    summaries,
    sourcesUsed,
    counts,
    anyEmpty,
  }
}

function stripEmpty(record: DirectoryAskRecord): Partial<DirectoryAskRecord> {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined && value !== null && value !== ""),
  ) as Partial<DirectoryAskRecord>
}

export interface AnswerContext {
  questionIntent: string
  confirmedFacts: string[]
  relationships: string[]
  relevantNotes: CompactNote[]
  missingInformation: string[]
  possibleInferences: string[]
  supportingRecordIds: string[]
  records: DirectoryAskRecord[]
  paths: PathHop[][]
  sourcesUsed: string[]
  /** Natural-language framing each tool returned (drives the offline mock). */
  summaries: string[]
  hasData: boolean
}

function describePath(path: PathHop[]): string {
  return path
    .map((hop, index) => (index === 0 ? hop.name : `${hop.role ? `${hop.role} → ` : "→ "}${hop.name}`))
    .join(" ")
}

export function buildAnswerContext(
  question: string,
  plan: QueryPlan,
  aggregated: AggregatedTools,
  context: DirectoryAskContext,
): AnswerContext {
  // Reuse the V1 brief for confirmed/inferred/missing over the merged records.
  const brief = analyzeForAnswer({
    question,
    intent: "general",
    records: aggregated.records,
    context,
  })

  const relationships: string[] = []
  for (const record of aggregated.records) {
    if (record.relation) relationships.push(`${record.name} — ${record.relation}.`)
  }
  for (const path of aggregated.paths.slice(0, 3)) {
    relationships.push(`Path: ${describePath(path)} (${path.length - 1} hop${path.length - 1 === 1 ? "" : "s"}).`)
  }

  const missingInformation = [...brief.missing]
  // The planner knows when a question structurally needs two entities.
  if (plan.needsMultipleEntities && plan.entities.length < 2) {
    missingInformation.push(
      "Only one of the records in this question could be identified in the Directory, so a full comparison isn't possible.",
    )
  }
  // Asked for people/jobs but none came back → say so rather than staying quiet.
  const subject = plan.entities[0]?.item.name
  if (subject) {
    const asksForPeople = /\b(contacts?|people|who|staff|team|employees|supervisors?)\b/i.test(question)
    const asksForJobs = /\b(jobs?|projects?)\b/i.test(question)
    if (asksForPeople && !aggregated.records.some((record) => record.type === "person")) {
      missingInformation.push(`No contacts are linked to ${subject} in the Directory.`)
    }
    if (asksForJobs && plan.intent !== "connecting_jobs" && !aggregated.records.some((record) => record.type === "job")) {
      missingInformation.push(`No jobs are linked to ${subject} in the Directory.`)
    }
  }
  if (aggregated.records.length === 0) {
    missingInformation.push("No Directory records matched this question.")
  }

  return {
    questionIntent: plan.intentLabel,
    confirmedFacts: brief.confirmed,
    relationships: relationships.slice(0, 8),
    relevantNotes: aggregated.notes.slice(0, 5),
    missingInformation: missingInformation.slice(0, 3),
    possibleInferences: brief.inferred,
    supportingRecordIds: aggregated.records.map((record) => record.id),
    records: aggregated.records,
    paths: aggregated.paths,
    sourcesUsed: aggregated.sourcesUsed,
    summaries: aggregated.summaries,
    hasData: aggregated.records.length > 0 || aggregated.notes.length > 0,
  }
}
