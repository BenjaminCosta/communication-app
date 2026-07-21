// Force the deterministic offline path even if a key is present in the shell.
process.env.DIRECTORY_AI_MODE = "mock"

import assert from "node:assert/strict"
import test from "node:test"
import { answerDirectoryQuestion } from "../features/directory/ai/server/ask-service"
import { isDisambiguation, type DirectoryAskResponse } from "../features/directory/ai/directory-ask-contract"
import { extractEntities } from "../features/directory/ai/server/entity-extraction"
import { buildQueryPlan, type QuestionIntent } from "../features/directory/ai/server/query-planner"
import { createFixtureDeps, FIXTURE_IDS, FIXTURE_NAMES } from "./directory-fixture"

/**
 * Ask SVC Directory — evaluation suite.
 *
 * Runs realistic questions end to end against the synthetic Directory
 * (extraction → plan → tool prefetch → grounded answer), fully offline. It
 * evaluates the things that actually matter: entity coverage, plan correctness,
 * factual grounding (no unsupported claims), inference hedging, ambiguity
 * handling and honest missing-data behaviour.
 */

const deps = createFixtureDeps()
const CONTEXT = { scope: "all" as const, entityRefs: [] }

async function ask(question: string, resolvedEntityIds: string[] = []) {
  return answerDirectoryQuestion({ question, context: CONTEXT, resolvedEntityIds }, deps)
}

async function askAnswer(question: string, resolvedEntityIds: string[] = []): Promise<DirectoryAskResponse> {
  const result = await ask(question, resolvedEntityIds)
  assert.ok(!isDisambiguation(result), `expected an answer, got a disambiguation prompt for: ${question}`)
  return result
}

const ALLOWED_CAPITALIZED = new Set<string>([
  ...FIXTURE_NAMES,
  ...FIXTURE_NAMES.flatMap((name) => name.split(/\s+/)),
  // Non-entity capitalizations that legitimately appear mid-sentence.
  "Directory", "SVC", "I",
  "Project", "Manager", "Estimator", "Supervisor", "Foreman", "Superintendent",
  "In", "Progress", "Planning", "Cancelled", "Complete", "Job", "Jobs", "Contact", "Contacts",
  "Company", "Companies", "Path", "Details",
  "Short", "Hills", "NJ", "FL", "WI", "Newark", "Piscataway", "Jacksonville", "Delafield",
])

/**
 * Capitalized words in the answer that are not real Directory records =
 * invented entities. Sentence-initial words are skipped, since English
 * capitalizes them regardless of whether they name anything.
 */
function unsupportedNames(text: string): string[] {
  const found = new Set<string>()
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    const firstWordIndex = sentence.search(/\S/)
    for (const match of sentence.matchAll(/\b[A-Z][a-zA-Z']+\b/g)) {
      if (match.index === firstWordIndex) continue // sentence-initial
      if (ALLOWED_CAPITALIZED.has(match[0])) continue
      found.add(match[0])
    }
  }
  return [...found]
}

interface EvalCase {
  name: string
  question: string
  intent?: QuestionIntent
  /** Ids that must be resolved from the question text. */
  expectEntities?: string[]
  /** Ids that must appear among the supporting records. */
  expectRecords?: string[]
  mustMention?: string[]
  expectDisambiguation?: boolean
  expectNotFound?: boolean
  expectLimitation?: boolean
}

const CASES: EvalCase[] = [
  // ── Direct lookups ─────────────────────────────────────────────────────────
  { name: "person lookup", question: "Who is John DeMarco?", intent: "direct_lookup", expectEntities: ["person__jdemarco"], mustMention: ["John DeMarco"] },
  { name: "company lookup", question: "74 Construction", intent: "direct_lookup", expectEntities: ["company__74"], mustMention: ["74 Construction"] },
  { name: "job lookup", question: "Appaloosa", intent: "direct_lookup", expectEntities: ["job__appaloosa"], mustMention: ["Appaloosa"] },

  // ── Relationship / roster ──────────────────────────────────────────────────
  { name: "who works at company", question: "Who works at 74 Construction?", intent: "relationship_analysis", expectEntities: ["company__74"], expectRecords: ["person__jdemarco"] },
  { name: "job team", question: "Who is related to Appaloosa?", intent: "relationship_analysis", expectEntities: ["job__appaloosa"], expectRecords: ["person__jdemarco"] },
  { name: "person relationships", question: "Which jobs is Ricardo Lopez connected to?", intent: "relationship_analysis", expectEntities: ["person__rlopez"] },

  // ── Multi-entity: shared contacts / connecting jobs ────────────────────────
  {
    name: "shared contacts between two companies",
    question: "Which contacts are shared between 74 Construction and 1901 Contracting?",
    intent: "shared_contacts",
    expectEntities: ["company__74", "company__1901"],
    expectRecords: ["person__mwong"],
    mustMention: ["Melissa Wong"],
  },
  {
    name: "connecting jobs between two companies",
    question: "What jobs connect 74 Construction and 1901 Contracting?",
    intent: "connecting_jobs",
    expectEntities: ["company__74", "company__1901"],
    expectRecords: ["job__warehouse"],
    mustMention: ["Warehouse Expansion"],
  },
  {
    name: "comparison of two companies",
    question: "Compare 74 Construction and 1901 Contracting",
    intent: "comparison",
    expectEntities: ["company__74", "company__1901"],
  },
  {
    name: "three entities in one question",
    question: "How are 74 Construction, 1901 Contracting and Warehouse Expansion related?",
    expectEntities: ["company__74", "company__1901", "job__warehouse"],
  },

  // ── Indirect relationships ────────────────────────────────────────────────
  {
    name: "indirect person-to-company connection",
    question: "How is Ricardo Lopez connected to 74 Construction?",
    expectEntities: ["person__rlopez", "company__74"],
  },
  {
    name: "shared contacts with no overlap",
    question: "Which contacts are shared between SFV Services and 1901 Contracting?",
    intent: "shared_contacts",
    expectEntities: ["company__sfv", "company__1901"],
    expectLimitation: true,
  },

  // ── Recommendation ────────────────────────────────────────────────────────
  { name: "best contact recommendation", question: "Who is the best contact for Appaloosa?", intent: "recommendation", expectEntities: ["job__appaloosa"] },
  { name: "recommendation on a company", question: "Who should I talk to at 74 Construction?", intent: "recommendation", expectEntities: ["company__74"] },

  // ── Summary ───────────────────────────────────────────────────────────────
  { name: "summarize a job", question: "Summarize Appaloosa", intent: "summary", expectEntities: ["job__appaloosa"], mustMention: ["Appaloosa"] },
  { name: "summarize a company", question: "Give me an overview of SFV Services", intent: "summary", expectEntities: ["company__sfv"] },

  // ── Ambiguity ─────────────────────────────────────────────────────────────
  { name: "duplicate name asks first", question: "Who is John Smith?", expectDisambiguation: true },
  { name: "duplicate name inside a bigger question", question: "What jobs is John Smith on?", expectDisambiguation: true },

  // ── Missing data ──────────────────────────────────────────────────────────
  { name: "unknown entity", question: "Who works at Nonexistent Industries?", expectNotFound: true },
  { name: "sparse record", question: "Who is Patricia Nolan?", expectEntities: ["person__pnolan"], mustMention: ["Patricia Nolan"] },
  { name: "missing-data check", question: "Do we have any contacts for Voodoo Brewery?", expectEntities: ["job__voodoo"], expectLimitation: true },

  // ── Notes / semantic ──────────────────────────────────────────────────────
  { name: "notes search", question: "What do the notes say about Appaloosa?", intent: "semantic_note_search", expectEntities: ["job__appaloosa"] },
  { name: "experience in notes", question: "Who has electrical experience in the notes?", intent: "semantic_note_search" },

  // ── Conflicting records ───────────────────────────────────────────────────
  { name: "conflicting status", question: "Summarize Riverside Plaza", expectEntities: ["job__riverside"], mustMention: ["Riverside Plaza"] },
]

for (const testCase of CASES) {
  test(`eval: ${testCase.name}`, async () => {
    // Entity coverage is checked directly against the extractor.
    if (testCase.expectEntities) {
      const extraction = await extractEntities(deps.provider, testCase.question)
      const resolvedIds = extraction.entities.map((entity) => entity.item.id)
      const ambiguousMentions = extraction.ambiguous.map((slot) => slot.mention)
      for (const expected of testCase.expectEntities) {
        assert.ok(
          resolvedIds.includes(expected),
          `expected ${expected} to be resolved from "${testCase.question}" (got ${JSON.stringify(resolvedIds)}, ambiguous ${JSON.stringify(ambiguousMentions)})`,
        )
      }
    }

    if (testCase.intent) {
      const extraction = await extractEntities(deps.provider, testCase.question)
      const plan = buildQueryPlan(testCase.question, extraction)
      assert.equal(plan.intent, testCase.intent, `intent for "${testCase.question}"`)
    }

    const result = await ask(testCase.question)

    if (testCase.expectDisambiguation) {
      assert.ok(isDisambiguation(result), `expected disambiguation for "${testCase.question}"`)
      assert.ok(result.candidates.length > 1, "disambiguation needs multiple candidates")
      for (const candidate of result.candidates) {
        assert.ok(FIXTURE_IDS.has(candidate.id), `candidate ${candidate.id} must be a real record`)
      }
      return
    }

    assert.ok(!isDisambiguation(result), `unexpected disambiguation for "${testCase.question}"`)
    assert.ok(result.answer.trim().length > 0, "answer must not be empty")

    // Grounding: every cited id must be a real record.
    for (const id of result.usedRecordIds) {
      assert.ok(FIXTURE_IDS.has(id), `usedRecordId ${id} is not a real Directory record`)
    }
    for (const record of result.supportingRecords) {
      assert.ok(FIXTURE_IDS.has(record.id), `supporting record ${record.id} is not a real Directory record`)
    }
    // No invented entity names in the prose.
    assert.deepEqual(unsupportedNames(result.answer), [], `answer invented names for "${testCase.question}"`)

    if (testCase.expectNotFound) {
      assert.ok(result.notFound || result.limitations.length > 0, "missing data must be stated, not invented")
    }
    if (testCase.expectLimitation) {
      assert.ok(result.limitations.length > 0, `expected a stated limitation for "${testCase.question}"`)
    }
    for (const expected of testCase.expectRecords ?? []) {
      assert.ok(
        result.supportingRecords.some((record) => record.id === expected),
        `expected ${expected} among supporting records for "${testCase.question}"`,
      )
    }
    for (const phrase of testCase.mustMention ?? []) {
      assert.ok(result.answer.includes(phrase), `expected "${phrase}" in the answer to "${testCase.question}"`)
    }
  })
}

// ── Cross-cutting quality checks ────────────────────────────────────────────

test("eval: inferences are hedged, never stated as fact", async () => {
  const result = await askAnswer("Who is the best contact for Appaloosa?")
  for (const insight of result.inferredInsights) {
    assert.match(insight, /appears|looks like|seems|suggests|likely/i, `inference must be hedged: "${insight}"`)
  }
})

test("eval: answers stay concise and cite supporting records", async () => {
  const result = await askAnswer("Who works at 74 Construction?")
  const sentences = result.answer.split(/(?<=[.!?])\s+/).filter(Boolean)
  assert.ok(sentences.length <= 6, `answer should stay concise, got ${sentences.length} sentences`)
  assert.ok(result.supportingRecords.length > 0, "an answerable question must cite records")
  assert.ok(result.sourcesUsed.length > 0, "sourcesUsed drives the source chips")
})

test("eval: resolving an ambiguous name continues to a grounded answer", async () => {
  const first = await ask("Who is John Smith?")
  assert.ok(isDisambiguation(first))
  const picked = first.candidates[0].id
  const second = await askAnswer("Who is John Smith?", [picked])
  assert.ok(second.supportingRecords.some((record) => record.id === picked), "the picked record must ground the answer")
})

test("eval: conflicting records do not become a confident claim", async () => {
  const result = await askAnswer("Summarize Riverside Plaza")
  assert.notEqual(result.confidence, "high")
})

test("eval: every question reports the intent it was answered as", async () => {
  const result = await askAnswer("What jobs connect 74 Construction and 1901 Contracting?")
  assert.ok(result.questionIntent.length > 0)
  assert.equal(result.mode, "mock")
})
