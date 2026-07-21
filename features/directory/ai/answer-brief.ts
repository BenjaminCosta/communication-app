import type {
  DirectoryAskContext,
  DirectoryAskIntent,
  DirectoryAskRecord,
} from "@/features/directory/ai/directory-ask-contract"

/**
 * Answer brief — the structured input the answerer reasons over.
 *
 * Rather than dumping raw fields at the model, we pre-digest the retrieved
 * records into the shape a knowledgeable teammate would think in: what's
 * confirmed, what can be reasonably inferred (and must be hedged), what's
 * missing, which records back it up, and how the question should be answered
 * (its intent → writing style). Both the live prompt and the offline mock
 * consume this exact brief, so their answers stay consistent.
 */

export type AnswerStyle = "lookup" | "summary" | "relationships" | "comparison" | "recommendation" | "missing"

export interface AnswerBrief {
  intent: DirectoryAskIntent
  style: AnswerStyle
  /** Human label for the prompt (e.g. "direct lookup"). */
  styleLabel: string
  records: DirectoryAskRecord[]
  primary: DirectoryAskRecord | null
  people: DirectoryAskRecord[]
  companies: DirectoryAskRecord[]
  jobs: DirectoryAskRecord[]
  activeJobs: DirectoryAskRecord[]
  keyContacts: DirectoryAskRecord[]
  /** Facts present in the data — state as fact ("is listed as"). */
  confirmed: string[]
  /** Patterns worth surfacing — hedge as inference ("appears to be"). */
  inferred: string[]
  /** What the question wanted but the Directory does not have. */
  missing: string[]
  relatedIds: string[]
  hasData: boolean
}

const ACTIVE_RE = /progress|active|planning|open|ongoing/i
/** Wording that contradicts an "active" status on the same record. */
const CONFLICTING_RE = /cancell?ed|terminated|closed out|completed|finished/i
const KEY_ROLE_RE = /project\s*manager|(^|\W)pm(\W|$)|\blead\b|supervisor|foreman|superintendent|estimator|owner|principal/i
const COMPARISON_RE = /\b(vs\.?|versus|compare|comparison|difference between|shared between|both|between .+ and )\b/i
const RECOMMENDATION_RE = /\b(should|best|recommend|who can|who to|which .+ should|right person)\b/i

const STYLE_LABEL: Record<AnswerStyle, string> = {
  lookup: "direct lookup",
  summary: "summary",
  relationships: "relationships / roster",
  comparison: "comparison",
  recommendation: "recommendation",
  missing: "missing data",
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name
}

function isActive(record: DirectoryAskRecord): boolean {
  return ACTIVE_RE.test(record.status ?? "")
}

function pluralize(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`
}

function pickPrimary(records: DirectoryAskRecord[], context: DirectoryAskContext): DirectoryAskRecord | null {
  if (records.length === 0) return null
  const pinned = context.entityRefs[0]
    ? records.find((record) => record.id === context.entityRefs[0].id)
    : undefined
  return (
    pinned ??
    records.find((record) => record.type === "company") ??
    records.find((record) => record.type === "job") ??
    records[0]
  )
}

function resolveStyle(intent: DirectoryAskIntent, question: string, hasData: boolean): AnswerStyle {
  if (!hasData) return "missing"
  if (COMPARISON_RE.test(question)) return "comparison"
  if (RECOMMENDATION_RE.test(question)) return "recommendation"
  if (intent === "lookup") return "lookup"
  if (intent === "summarize" || intent === "general") return "summary"
  return "relationships" // who_works_at, jobs_for, related_to
}

/** One confirmed, human-readable fact per record (no ids, no field dumps). */
function confirmedFact(record: DirectoryAskRecord): string {
  if (record.type === "person") {
    const role = record.role ? record.role : "a contact"
    const at = record.companyName ? ` at ${record.companyName}` : ""
    const loc = record.location ? ` and is based in ${record.location}` : ""
    return `${record.name} is listed as ${role}${at}${loc}.`
  }
  if (record.type === "company") {
    const loc = record.location ? ` based in ${record.location}` : ""
    return `${record.name} is listed as a company${loc}.`
  }
  if (record.type === "job") {
    const loc = record.location ? ` in ${record.location}` : ""
    const status = record.status ? `, currently listed as ${record.status}` : ""
    return `${record.name} is a job${loc}${status}.`
  }
  return `${record.name} is recorded in the Directory.`
}

export function analyzeForAnswer(input: {
  question: string
  intent: DirectoryAskIntent
  records: DirectoryAskRecord[]
  context: DirectoryAskContext
}): AnswerBrief {
  const { question, intent, records, context } = input
  const hasData = records.length > 0
  const style = resolveStyle(intent, question, hasData)

  const primary = pickPrimary(records, context)
  // Connection groups describe what the primary is linked TO, so exclude the
  // primary itself — otherwise summarizing a job would count the job as its own
  // "linked job". The full record set still reaches the model via `records`.
  const related = records.filter((record) => record.id !== primary?.id)
  const people = related.filter((record) => record.type === "person")
  const companies = related.filter((record) => record.type === "company")
  const jobs = related.filter((record) => record.type === "job")
  const activeJobs = jobs.filter(isActive)
  const keyContacts = people.filter((person) => KEY_ROLE_RE.test(person.role ?? ""))

  const confirmed = records.slice(0, 6).map(confirmedFact)

  const inferred: string[] = []
  if (primary && (primary.type === "company" || primary.type === "job") && people.length + jobs.length >= 2) {
    inferred.push(`${primary.name} appears to be the main focus here, with ${describeLinks(people.length, jobs.length, companies.length)}.`)
  }
  if (jobs.length >= 2 && activeJobs.length > 0) {
    inferred.push(`${activeJobs.length} of those jobs appear to be active right now.`)
  }
  if (keyContacts.length > 0) {
    const contact = keyContacts[0]
    inferred.push(`${contact.name} looks like a key contact${contact.role ? ` (${contact.role})` : ""}.`)
  }

  const missing: string[] = []
  // Conflicting records: a job listed as active whose own text says otherwise.
  // Surface the inconsistency instead of silently picking one side.
  for (const record of records) {
    if (record.type !== "job") continue
    const looksActive = ACTIVE_RE.test(record.status ?? "")
    const text = `${record.subtitle ?? ""} ${record.description ?? ""}`
    if (looksActive && CONFLICTING_RE.test(text)) {
      missing.push(
        `${record.name} is listed as ${record.status} but its own record mentions it was cancelled or closed — the Directory is inconsistent here.`,
      )
      break
    }
  }
  if (intent === "who_works_at" && people.length === 0 && primary) {
    missing.push(`No individual contacts are linked to ${primary.name} in the Directory yet.`)
  }
  if (intent === "jobs_for" && jobs.length === 0 && primary) {
    missing.push(`No jobs are linked to ${primary.name} in the Directory yet.`)
  }
  if (intent === "related_to" && records.length <= 1 && primary) {
    missing.push(`No related records are on file for ${primary.name} yet.`)
  }
  if (intent === "lookup" && primary?.type === "person" && !primary.companyName) {
    missing.push(`No company is on file for ${primary.name}.`)
  }

  return {
    intent,
    style,
    styleLabel: STYLE_LABEL[style],
    records,
    primary,
    people,
    companies,
    jobs,
    activeJobs,
    keyContacts,
    confirmed,
    inferred: inferred.slice(0, 3),
    missing: missing.slice(0, 2),
    relatedIds: records.map((record) => record.id),
    hasData,
  }
}

function describeLinks(peopleCount: number, jobsCount: number, companiesCount: number): string {
  const bits: string[] = []
  if (jobsCount > 0) bits.push(pluralize(jobsCount, "linked job"))
  if (peopleCount > 0) bits.push(pluralize(peopleCount, "contact"))
  if (companiesCount > 1) bits.push(pluralize(companiesCount, "related company"))
  if (bits.length === 0) return "a few linked records"
  if (bits.length === 1) return bits[0]
  return `${bits.slice(0, -1).join(", ")} and ${bits[bits.length - 1]}`
}

export { firstName, isActive }
