import type {
  DirectoryAskContext,
  DirectoryAskIntent,
  DirectoryAskRecord,
  DirectoryAskResult,
} from "@/features/directory/ai/directory-ask-contract"
import { analyzeForAnswer, firstName, type AnswerBrief } from "@/features/directory/ai/answer-brief"
import type { AnswerContext } from "@/features/directory/ai/server/answer-context"

/**
 * Deterministic, dependency-free stand-in for the Ask SVC Directory answerer.
 *
 * It runs in mock mode (no API key) and as a graceful fallback. It consumes the
 * same {@link AnswerBrief} the live model does and writes in the same voice —
 * a teammate answering directly, stating confirmed facts as fact and hedging
 * inferences — so the offline UX mirrors production. It never invents anything.
 */

const NOT_FOUND_ANSWER =
  "I couldn't find anything in the Directory that matches that. Try a different name, or add a bit more detail to your question."

function joinNames(names: string[], max = 3): string {
  const shown = names.filter(Boolean).slice(0, max)
  if (shown.length === 0) return ""
  if (shown.length === 1) return shown[0]
  const head = shown.slice(0, -1).join(", ")
  const tail = shown[shown.length - 1]
  const more = names.length > max ? ` and ${names.length - max} more` : ` and ${tail}`
  return names.length > max ? `${head}, ${tail}${more}` : `${head} and ${tail}`
}

function pluralize(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`
}

/** The confirmed fact line that belongs to the primary record. */
function primaryFact(brief: AnswerBrief): string {
  if (!brief.primary) return brief.confirmed[0] ?? ""
  const index = brief.records.findIndex((record) => record.id === brief.primary?.id)
  return brief.confirmed[index] ?? brief.confirmed[0] ?? ""
}

function summaryConnections(brief: AnswerBrief): string {
  const { primary, people, companies, jobs, activeJobs } = brief
  if (!primary) return ""
  if (primary.type === "person") {
    const bits: string[] = []
    if (primary.companyName) bits.push(primary.companyName)
    if (jobs.length) bits.push(joinNames(jobs.map((job) => job.name)))
    return bits.length ? `${firstName(primary.name)} is connected to ${joinNames(bits, bits.length)} here.` : ""
  }
  const bits: string[] = []
  if (jobs.length) bits.push(pluralize(jobs.length, "linked job") + (activeJobs.length ? ` (${activeJobs.length} active)` : ""))
  if (people.length) bits.push(pluralize(people.length, "contact"))
  if (companies.length > 1) bits.push(pluralize(companies.length, "related company"))
  return bits.length ? `It's linked to ${joinNames(bits, bits.length)} in the Directory.` : ""
}

export function mockAnswerFromBrief(brief: AnswerBrief): DirectoryAskResult {
  if (!brief.hasData) {
    return {
      answer: NOT_FOUND_ANSWER,
      notFound: true,
      confirmedFacts: [],
      inferredInsights: [],
      limitations: brief.missing,
      usedRecordIds: [],
      confidence: "low",
    }
  }

  const { primary, people, companies, jobs, activeJobs, keyContacts } = brief
  const sentences: string[] = []
  let pointed = false

  switch (brief.style) {
    case "lookup": {
      sentences.push(primaryFact(brief))
      if (brief.missing[0]) sentences.push(brief.missing[0])
      break
    }
    case "summary": {
      sentences.push(primaryFact(brief))
      const connections = summaryConnections(brief)
      if (connections) sentences.push(connections)
      if (brief.inferred[0]) sentences.push(brief.inferred[0])
      break
    }
    case "relationships": {
      const name = primary?.name ?? "That record"
      if (brief.intent === "jobs_for") {
        if (jobs.length) {
          const activeBit = activeJobs.length ? `, ${activeJobs.length} of them active` : ""
          sentences.push(`${name} has ${pluralize(jobs.length, "job")} on file${activeBit}: ${joinNames(jobs.map((job) => job.name))}.`)
          pointed = true
        } else sentences.push(brief.missing[0] ?? `No jobs are linked to ${name} in the Directory yet.`)
      } else if (brief.intent === "related_to") {
        const bits: string[] = []
        if (companies.length) bits.push(joinNames(companies.map((company) => company.name)))
        if (jobs.length) bits.push(joinNames(jobs.map((job) => job.name)))
        if (people.length) bits.push(joinNames(people.map((person) => person.name)))
        if (bits.length) {
          sentences.push(`${name} is connected to ${joinNames(bits, bits.length)}.`)
          pointed = true
        } else sentences.push(brief.missing[0] ?? `${name} has no related records on file yet.`)
      } else {
        // who_works_at
        if (people.length) {
          sentences.push(`${name} has ${pluralize(people.length, "contact")} listed: ${joinNames(people.map((person) => person.name))}.`)
          if (keyContacts.length) sentences.push(`${keyContacts[0].name} looks like the main point of contact${keyContacts[0].role ? ` (${keyContacts[0].role})` : ""}.`)
          pointed = true
        } else sentences.push(brief.missing[0] ?? `No contacts are linked to ${name} in the Directory yet.`)
      }
      break
    }
    case "comparison": {
      sentences.push(primaryFact(brief))
      const other = brief.records.find((record) => record.id !== primary?.id)
      if (other) {
        sentences.push(`${other.name} is also in the Directory as a ${other.type}; their shared connections are shown below.`)
        pointed = true
      }
      break
    }
    case "recommendation": {
      if (keyContacts.length) {
        const contact = keyContacts[0]
        const role = contact.role ? ` — listed as ${contact.role}` : ""
        const at = contact.companyName ? ` at ${contact.companyName}` : ""
        sentences.push(`${contact.name} looks like your best contact${role}${at}.`)
      } else if (people.length) {
        sentences.push(`${people[0].name} is the closest contact I can see${people[0].role ? ` (${people[0].role})` : ""}.`)
      } else {
        sentences.push(primaryFact(brief))
      }
      break
    }
    default:
      sentences.push(primaryFact(brief))
  }

  // Point to the supporting cards when there's more to see and we haven't already.
  if (!pointed && brief.records.length > 1) {
    sentences.push("The supporting records are below.")
  }

  return {
    answer: sentences.filter(Boolean).slice(0, 5).join(" ").trim(),
    notFound: false,
    confirmedFacts: brief.confirmed.slice(0, 5),
    inferredInsights: brief.inferred,
    limitations: brief.missing,
    usedRecordIds: brief.relatedIds,
    confidence: brief.missing.length > 0 ? "medium" : "high",
  }
}

/** Convenience wrapper: analyze the records, then render the mock answer. */
export function mockAnswerDirectoryQuestion(input: {
  question: string
  intent: DirectoryAskIntent
  records: DirectoryAskRecord[]
  context: DirectoryAskContext
}): DirectoryAskResult {
  return mockAnswerFromBrief(analyzeForAnswer(input))
}

/**
 * V2 mock: compose the answer from the grounded context the tools produced.
 *
 * The tool summaries are already natural sentences ("3 contacts linked to both
 * A and B."), so the offline answer reads like the live one and stays strictly
 * grounded — it never states anything the tools did not return.
 */
export function mockAnswerFromContext(answerContext: AnswerContext): DirectoryAskResult {
  if (!answerContext.hasData) {
    return {
      answer: NOT_FOUND_ANSWER,
      notFound: true,
      confirmedFacts: [],
      inferredInsights: [],
      limitations: answerContext.missingInformation,
      usedRecordIds: [],
      confidence: "low",
    }
  }

  const sentences: string[] = []
  // Lead with what the tools actually found. Duplicate summaries are common when
  // the entity fallback re-fetches a record, and a bare "Details for X" is a
  // poor opening when a more informative summary exists.
  const seen = new Set<string>()
  const unique = answerContext.summaries.filter((summary) => {
    const key = summary.toLowerCase().trim()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  const informative = unique.filter((summary) => !/^details for /i.test(summary))
  for (const summary of (informative.length > 0 ? informative : unique).slice(0, 2)) sentences.push(summary)
  if (sentences.length === 0 && answerContext.confirmedFacts[0]) sentences.push(answerContext.confirmedFacts[0])

  const path = answerContext.paths[0]
  if (path && path.length > 1) {
    sentences.push(`The connection runs ${path.map((hop) => hop.name).join(" → ")}.`)
  }
  if (answerContext.possibleInferences[0]) sentences.push(answerContext.possibleInferences[0])
  if (answerContext.missingInformation[0]) sentences.push(answerContext.missingInformation[0])
  if (answerContext.records.length > 1) sentences.push("The supporting records are below.")

  const leansOnInference = answerContext.confirmedFacts.length === 0 && answerContext.possibleInferences.length > 0
  return {
    answer: sentences.filter(Boolean).slice(0, 6).join(" ").trim(),
    notFound: false,
    confirmedFacts: answerContext.confirmedFacts.slice(0, 5),
    inferredInsights: answerContext.possibleInferences.slice(0, 3),
    limitations: answerContext.missingInformation.slice(0, 3),
    usedRecordIds: answerContext.supportingRecordIds,
    confidence: leansOnInference || answerContext.missingInformation.length > 0 ? "medium" : "high",
  }
}

/** A realistic spoken question returned by the mock transcriber. */
export const MOCK_DIRECTORY_TRANSCRIPT = "How many active jobs does 74 Construction have?"
