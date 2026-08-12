import type { EntityExtraction, ResolvedEntity } from "@/features/directory/ai/server/entity-extraction"

/**
 * Structured query planning.
 *
 * Before any model call we classify what the question is asking and decide
 * exactly which data is needed. The plan drives a deterministic **prefetch** so
 * the common cases are already answered by the time the model runs — usually
 * one model call instead of a planning round-trip. The model can still request
 * more via tools when the prefetch is not enough.
 */

export type QuestionIntent =
  | "direct_lookup"
  | "comparison"
  | "shared_contacts"
  | "connecting_jobs"
  | "relationship_analysis"
  | "recommendation"
  | "summary"
  | "missing_data_check"
  | "semantic_note_search"

export interface ToolInvocation {
  name: string
  args: Record<string, unknown>
}

export interface QueryPlan {
  intent: QuestionIntent
  /** Human label used in the grounded prompt. */
  intentLabel: string
  entities: ResolvedEntity[]
  locations: string[]
  trades: string[]
  roles: string[]
  statuses: string[]
  /** Tool calls we run deterministically before the model sees anything. */
  prefetch: ToolInvocation[]
  /** True when the question needs at least two entities to be answerable. */
  needsMultipleEntities: boolean
}

const INTENT_LABEL: Record<QuestionIntent, string> = {
  direct_lookup: "direct lookup",
  comparison: "comparison",
  shared_contacts: "shared contacts",
  connecting_jobs: "connecting jobs",
  relationship_analysis: "relationship analysis",
  recommendation: "recommendation",
  summary: "summary",
  missing_data_check: "missing-data check",
  semantic_note_search: "semantic note search",
}

const PATTERNS: Array<{ intent: QuestionIntent; re: RegExp; needsTwo?: boolean }> = [
  { intent: "shared_contacts", re: /\b(shared|common|in common|both)\b.*\b(contacts?|people|person)\b|\b(contacts?|people)\b.*\b(shared|common|in common|both)\b/i, needsTwo: true },
  { intent: "connecting_jobs", re: /\bjobs?\b.*\b(connect|link|between|shared|common)\b|\b(connect|link)\w*\b.*\bjobs?\b/i, needsTwo: true },
  { intent: "comparison", re: /\b(compare|comparison|versus|vs\.?|difference between)\b/i, needsTwo: true },
  { intent: "recommendation", re: /\b(best|should|recommend|right person|who can|who to)\b/i },
  { intent: "semantic_note_search", re: /\b(notes?|mentioned|experience|history|wrote|reported|said)\b/i },
  { intent: "missing_data_check", re: /\b(do we have|is there|are there|any\b.*\bfor\b|missing|do we know)\b/i },
  { intent: "relationship_analysis", re: /\b(related|relationship|connections?|connected|linked|who works|works at|involved)\b/i },
  { intent: "summary", re: /\b(summar(?:y|ize|ise)|overview|tell me about|describe)\b/i },
]

function classify(question: string, entityCount: number): { intent: QuestionIntent; needsTwo: boolean } {
  for (const pattern of PATTERNS) {
    if (!pattern.re.test(question)) continue
    // Two-entity intents degrade gracefully when only one entity was named.
    if (pattern.needsTwo && entityCount < 2) {
      return { intent: "relationship_analysis", needsTwo: true }
    }
    return { intent: pattern.intent, needsTwo: Boolean(pattern.needsTwo) }
  }
  return { intent: entityCount === 1 ? "direct_lookup" : "summary", needsTwo: false }
}

function relationshipToolFor(type: string): string {
  if (type === "company") return "getCompanyRelationships"
  if (type === "job") return "getJobRelationships"
  return "getPersonRelationships"
}

export function buildQueryPlan(question: string, extraction: EntityExtraction): QueryPlan {
  const entities = extraction.entities
  const { intent, needsTwo } = classify(question, entities.length)
  const prefetch: ToolInvocation[] = []
  const [first, second] = entities

  switch (intent) {
    case "shared_contacts":
      if (first && second) {
        prefetch.push({ name: "findSharedContacts", args: { entityIdA: first.item.id, entityIdB: second.item.id } })
      }
      break
    case "connecting_jobs":
      if (first && second) {
        prefetch.push({ name: "findSharedJobs", args: { entityIdA: first.item.id, entityIdB: second.item.id } })
        prefetch.push({ name: "findConnectingPaths", args: { fromId: first.item.id, toId: second.item.id, maxDepth: 3 } })
      }
      break
    case "comparison":
      for (const entity of entities.slice(0, 2)) {
        prefetch.push({ name: relationshipToolFor(entity.item.type), args: { directoryId: entity.item.id } })
      }
      break
    case "recommendation":
      for (const entity of entities.slice(0, 2)) {
        prefetch.push({ name: relationshipToolFor(entity.item.type), args: { directoryId: entity.item.id } })
      }
      break
    case "relationship_analysis":
      for (const entity of entities.slice(0, 2)) {
        prefetch.push({ name: relationshipToolFor(entity.item.type), args: { directoryId: entity.item.id } })
      }
      if (first && second) {
        prefetch.push({ name: "findConnectingPaths", args: { fromId: first.item.id, toId: second.item.id, maxDepth: 3 } })
      }
      break
    case "semantic_note_search":
      prefetch.push({
        name: "searchRelevantNotes",
        args: { query: question, entityIds: entities.slice(0, 5).map((entity) => entity.item.id) },
      })
      for (const entity of entities.slice(0, 1)) {
        prefetch.push({ name: relationshipToolFor(entity.item.type), args: { directoryId: entity.item.id } })
      }
      break
    case "summary":
    case "missing_data_check":
      for (const entity of entities.slice(0, 2)) {
        prefetch.push({ name: "getEntityDetails", args: { directoryId: entity.item.id } })
        prefetch.push({ name: relationshipToolFor(entity.item.type), args: { directoryId: entity.item.id } })
      }
      break
    case "direct_lookup":
    default:
      if (first) prefetch.push({ name: "getEntityDetails", args: { directoryId: first.item.id } })
      break
  }

  // Nothing was named: fall back to a plain search so the model still gets
  // grounded candidates instead of an empty context.
  if (prefetch.length === 0) {
    prefetch.push({ name: "searchPeople", args: { query: question } })
    prefetch.push({ name: "searchCompanies", args: { query: question } })
    prefetch.push({ name: "searchJobs", args: { query: question } })
  }

  return {
    intent,
    intentLabel: INTENT_LABEL[intent],
    entities,
    locations: extraction.locations,
    trades: extraction.trades,
    roles: extraction.roles,
    statuses: extraction.statuses,
    prefetch: prefetch.slice(0, 4),
    needsMultipleEntities: needsTwo,
  }
}
