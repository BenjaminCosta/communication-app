import assert from "node:assert/strict"
import test from "node:test"
process.env.DIRECTORY_AI_MODE = "mock"

import {
  directoryAskRequestSchema,
  directoryAskRecordSchema,
  directoryAskResultSchema,
  isDisambiguation,
  type DirectoryAskRecord,
} from "../features/directory/ai/directory-ask-contract"
import { aggregateToolResults, buildAnswerContext } from "../features/directory/ai/server/answer-context"
import { buildQueryPlan } from "../features/directory/ai/server/query-planner"
import { runDirectoryTool, DIRECTORY_TOOLS, directoryToolSpecs } from "../features/directory/ai/server/tools/definitions"
import type { ToolBudget } from "../features/directory/ai/server/tools/types"
import { createFixtureDeps } from "./directory-fixture"
import {
  mockAnswerDirectoryQuestion,
  MOCK_DIRECTORY_TRANSCRIPT,
} from "../features/directory/ai/server/mock-answerer"
import { answerDirectoryQuestion } from "../features/directory/ai/server/ask-service"
import { buildAskUserPrompt } from "../features/directory/ai/server/prompt"
import { analyzeForAnswer } from "../features/directory/ai/answer-brief"
import {
  buildAskRecordFromDoc,
  detectAskIntent,
  docToListItem,
  extractJobStatus,
} from "../features/directory/ai/directory-retrieval-core"
import {
  buildDirectorySuggestions,
  cleanLocation,
  detectTrade,
  type SuggestionRecord,
} from "../features/directory/ai/directory-suggestions"
import {
  acquireOutlookAiGuardState,
  completeOutlookAiGuardState,
  emptyOutlookAiGuardState,
  type AiGuardLimits,
} from "../lib/ai/server/request-guard-core"
import { AiError } from "../lib/ai/errors"
import { DIRECTORY_AI_LIMITS } from "../lib/ai/config-public"
import type { DirectorySearchDoc } from "../lib/directory"
import type { DirectoryListItem } from "../lib/directory-config"

// ── Fixtures ─────────────────────────────────────────────────────────────────

function doc(overrides: Partial<DirectorySearchDoc> = {}): DirectorySearchDoc {
  return {
    id: "company__74",
    type: "company",
    sourceCollection: "contexts",
    sourceId: "74",
    ownerUserId: "",
    name: "74 Construction",
    aliases: "",
    email: "",
    phone: "",
    phoneDisplay: "",
    keywords: "",
    companyName: "",
    location: "Short Hills, NJ",
    role: "",
    searchText: "",
    subtitle: "",
    linkedUserId: "",
    status: "",
    tags: [],
    description: "",
    fieldCount: 0,
    ...overrides,
  }
}

function record(overrides: Partial<DirectoryAskRecord> = {}): DirectoryAskRecord {
  return { id: "company__74", type: "company", name: "74 Construction", ...overrides }
}

function item(overrides: Partial<DirectoryListItem> = {}): DirectoryListItem {
  return {
    id: "company__74",
    type: "company",
    name: "74 Construction",
    subtitle: "",
    companyName: "",
    location: "",
    role: "",
    ...overrides,
  }
}

// ── Contract ─────────────────────────────────────────────────────────────────

test("request schema applies defaults for a minimal question", () => {
  const parsed = directoryAskRequestSchema.parse({ question: "Who works at 74 Construction?" })
  assert.equal(parsed.context.scope, "all")
  assert.deepEqual(parsed.context.entityRefs, [])
  assert.deepEqual(parsed.resolvedEntityIds, [])
})

test("request schema rejects an over-long question", () => {
  const question = "a".repeat(DIRECTORY_AI_LIMITS.maxQuestionChars + 1)
  assert.equal(directoryAskRequestSchema.safeParse({ question }).success, false)
})

test("request schema caps disambiguation picks", () => {
  const resolvedEntityIds = Array.from({ length: 9 }, (_, index) => `person__${index}`)
  assert.equal(directoryAskRequestSchema.safeParse({ question: "who", resolvedEntityIds }).success, false)
})

test("request no longer accepts client-supplied records (retrieval is server-side)", () => {
  const parsed = directoryAskRequestSchema.parse({
    question: "who",
    records: [record({ id: "person__x", type: "person", name: "Injected" })],
  })
  assert.equal("records" in parsed, false)
})

test("record schema rejects a description beyond the char budget", () => {
  const description = "x".repeat(DIRECTORY_AI_LIMITS.maxRecordChars + 1)
  assert.equal(directoryAskRecordSchema.safeParse(record({ description })).success, false)
})

// ── Mock answerer ────────────────────────────────────────────────────────────

test("mock answerer returns a clear not-found state with no records", () => {
  const result = mockAnswerDirectoryQuestion({ question: "Who works at Nowhere?", intent: "who_works_at", records: [], context: { scope: "all", entityRefs: [] } })
  assert.equal(result.notFound, true)
  assert.deepEqual(result.usedRecordIds, [])
  assert.match(result.answer, /not find|Directory/i)
})

test("mock answerer is deterministic and grounded in the records", () => {
  const records = [
    record({ id: "company__74", type: "company", name: "74 Construction" }),
    record({ id: "person__jd", type: "person", name: "John DeMarco", role: "Project Manager" }),
    record({ id: "job__app", type: "job", name: "Appaloosa", status: "In Progress" }),
  ]
  const input = { question: "Who works at 74 Construction?", intent: "who_works_at" as const, records, context: { scope: "all" as const, entityRefs: [] } }
  const first = mockAnswerDirectoryQuestion(input)
  const second = mockAnswerDirectoryQuestion(input)
  assert.equal(first.answer, second.answer)
  assert.equal(first.notFound, false)
  assert.match(first.answer, /74 Construction/)
  assert.match(first.answer, /John DeMarco/)
  assert.deepEqual(first.usedRecordIds, ["company__74", "person__jd", "job__app"])
})

test("mock answers sound human: direct, confirmed language, no robotic phrasing", () => {
  const answer = mockAnswerDirectoryQuestion({
    question: "Who is John DeMarco?",
    intent: "lookup",
    records: [
      record({ id: "person__jd", type: "person", name: "John DeMarco", role: "Project Manager", companyName: "74 Construction", location: "Short Hills, NJ" }),
    ],
    context: { scope: "all", entityRefs: [] },
  }).answer
  assert.match(answer, /John DeMarco is listed as Project Manager at 74 Construction/i)
  assert.ok(!/there are \d|the system|records:|records found/i.test(answer))
})

test("mock explains missing data instead of inventing contacts", () => {
  const result = mockAnswerDirectoryQuestion({
    question: "Who works at 74 Construction?",
    intent: "who_works_at",
    records: [record({ id: "company__74", type: "company", name: "74 Construction" })],
    context: { scope: "all", entityRefs: [] },
  })
  assert.equal(result.notFound, false)
  assert.match(result.answer, /No (individual )?contacts are linked to 74 Construction/i)
})

// ── Ask service (mock mode when no OPENAI_API_KEY) ───────────────────────────

test("ask service answers in mock mode and validates its own output", async () => {
  const response = await answerDirectoryQuestion(
    { question: "Summarize Appaloosa", context: { scope: "all", entityRefs: [] } },
    createFixtureDeps(),
  )
  assert.ok(!isDisambiguation(response))
  assert.equal(response.mode, "mock")
  assert.doesNotThrow(() => directoryAskResultSchema.parse(response))
  assert.match(response.answer, /Appaloosa/)
})

test("ask service returns not-found in mock mode when nothing matches", async () => {
  const response = await answerDirectoryQuestion(
    { question: "Who is Zzz Qqq?", context: { scope: "all", entityRefs: [] } },
    createFixtureDeps(),
  )
  assert.ok(!isDisambiguation(response))
  assert.equal(response.mode, "mock")
  assert.ok(response.notFound || response.limitations.length > 0)
})

// ── Answer brief + prompt building ───────────────────────────────────────────

test("brief separates confirmed facts, inferences, and question style", () => {
  const brief = analyzeForAnswer({
    question: "Who works at 74 Construction?",
    intent: "who_works_at",
    records: [
      record({ id: "company__74", type: "company", name: "74 Construction" }),
      record({ id: "person__jd", type: "person", name: "John DeMarco", role: "Project Manager", companyName: "74 Construction" }),
      record({ id: "job__app", type: "job", name: "Appaloosa", status: "In Progress" }),
    ],
    context: { scope: "all", entityRefs: [] },
  })
  assert.equal(brief.style, "relationships")
  assert.ok(brief.confirmed.some((line) => /is listed as/i.test(line)))
  assert.ok(brief.keyContacts.some((person) => person.id === "person__jd"))
  assert.ok(brief.inferred.some((line) => /appears to be|looks like/i.test(line)))
  assert.deepEqual(brief.relatedIds, ["company__74", "person__jd", "job__app"])
})

test("brief marks the missing-data state and never self-counts the primary", () => {
  const brief = analyzeForAnswer({
    question: "Summarize Appaloosa",
    intent: "summarize",
    records: [record({ id: "job__app", type: "job", name: "Appaloosa", status: "In Progress", location: "Short Hills, NJ" })],
    context: { scope: "all", entityRefs: [] },
  })
  assert.equal(brief.jobs.length, 0) // the job itself is the primary, not a "linked job"
  assert.equal(brief.style, "summary")
})

test("prompt sends the grounded context (intent, confirmed facts, records, question)", () => {
  const question = "Who works at 74 Construction?"
  const answerContext = buildAnswerContext(
    question,
    buildQueryPlan(question, { entities: [], ambiguous: [], locations: [], trades: [], roles: [], statuses: [], dates: [] }),
    aggregateToolResults([
      {
        name: "getCompanyRelationships",
        result: {
          summary: "Records linked to 74 Construction.",
          records: [record({ id: "person__jd", type: "person", name: "John DeMarco", role: "Project Manager" })],
        },
      },
    ]),
    { scope: "all", entityRefs: [], today: "2026-07-20" },
  )
  const prompt = buildAskUserPrompt(question, answerContext, { scope: "all", entityRefs: [], today: "2026-07-20" }, null)
  assert.match(prompt, /QUESTION INTENT:/)
  assert.match(prompt, /CONFIRMED FACTS/)
  assert.match(prompt, /SUPPORTING RECORDS/)
  assert.match(prompt, /John DeMarco/)
  assert.match(prompt, /Who works at 74 Construction\?/)
})

// ── Intent detection ─────────────────────────────────────────────────────────

test("detects intents and entity hints", () => {
  assert.equal(detectAskIntent("Who works at 74 Construction?").intent, "who_works_at")
  assert.equal(detectAskIntent("Show active jobs for 74 Construction").intent, "jobs_for")
  assert.equal(detectAskIntent("Summarize Appaloosa").intent, "summarize")
  assert.equal(detectAskIntent("Who is related to Appaloosa?").intent, "related_to")

  const lookup = detectAskIntent("74 Construction")
  assert.equal(lookup.intent, "lookup")
  assert.match(lookup.entityHint, /74 Construction/i)

  assert.match(detectAskIntent("Who works at 74 Construction?").entityHint, /74 Construction/i)
  assert.match(detectAskIntent("Summarize Appaloosa").entityHint, /Appaloosa/i)
})

// ── Record projection ────────────────────────────────────────────────────────

test("buildAskRecordFromDoc truncates long text and extracts job status", () => {
  const long = "y".repeat(DIRECTORY_AI_LIMITS.maxRecordChars + 50)
  const projected = buildAskRecordFromDoc(doc({ id: "job__app", type: "job", name: "Appaloosa", subtitle: "Job status: In Progress", description: long }))
  assert.ok((projected.description?.length ?? 0) <= DIRECTORY_AI_LIMITS.maxRecordChars)
  assert.match(projected.status ?? "", /in\s*progress/i)
})

test("extractJobStatus reads status from subtitle/description text", () => {
  assert.match(extractJobStatus({ subtitle: "Job status: Planning", description: "" }) ?? "", /planning/i)
  assert.equal(extractJobStatus({ subtitle: "no status here", description: "" }), undefined)
})

test("docToListItem maps 'other' to a person for display", () => {
  const listItem = docToListItem(doc({ id: "other__x", type: "other", name: "A Note" }))
  assert.equal(listItem.type, "person")
  assert.equal(listItem.name, "A Note")
})

// ── Suggestion engine (context-aware, never calls OpenAI) ────────────────────

function recent(overrides: Partial<DirectorySearchDoc>, recencyIndex = 0): SuggestionRecord {
  const d = doc(overrides)
  return { item: docToListItem(d), doc: d, recencyIndex }
}

test("cleanLocation keeps readable places and rejects raw addresses", () => {
  assert.equal(cleanLocation("Short Hills, NJ"), "Short Hills, NJ")
  assert.equal(cleanLocation("Newark"), "Newark")
  assert.equal(cleanLocation("6440 Southpoint Pkwy, Suite 300 Jacksonville, Florida 32216"), null)
  assert.equal(cleanLocation(""), null)
})

test("detectTrade derives a trade from role/keywords, else null", () => {
  assert.equal(detectTrade({ role: "Electrician", keywords: "", tags: [], name: "John" }), "electrical")
  assert.equal(detectTrade({ role: "", keywords: "framing crew", tags: [], name: "Crew" }), "framing")
  assert.equal(detectTrade({ role: "Project Manager", keywords: "", tags: [], name: "Jane" }), null)
})

test("suggestions gate on fields: location template only when location is clean", () => {
  const withLoc = buildDirectorySuggestions({
    recents: [recent({ id: "company__74", type: "company", name: "74 Construction", location: "Short Hills, NJ" })],
    scope: "all",
    seed: 1,
  })
  assert.ok(withLoc.some((s) => /active jobs does 74 Construction have in Short Hills, NJ/i.test(s.text)))

  const noLoc = buildDirectorySuggestions({
    recents: [recent({ id: "company__74", type: "company", name: "74 Construction", location: "" })],
    scope: "all",
    seed: 1,
  })
  assert.ok(noLoc.some((s) => /Show active jobs for 74 Construction/i.test(s.text)))
  assert.ok(!noLoc.some((s) => / in /.test(s.text))) // no location phrasing without a location
})

test("suggestions combine two recent records into a cross-entity question", () => {
  const suggestions = buildDirectorySuggestions({
    recents: [
      recent({ id: "company__74", type: "company", name: "74 Construction" }, 0),
      recent({ id: "job__app", type: "job", name: "Appaloosa" }, 1),
    ],
    scope: "all",
    seed: 3,
  })
  assert.ok(suggestions.some((s) => /shared between 74 Construction and Appaloosa/i.test(s.text)))
})

test("suggestions are capped at max, deduped, and diversified per entity", () => {
  const suggestions = buildDirectorySuggestions({
    recents: [
      recent({ id: "company__74", type: "company", name: "74 Construction", location: "Short Hills, NJ" }, 0),
      recent({ id: "job__app", type: "job", name: "Appaloosa", subtitle: "Job status: In Progress" }, 1),
      recent({ id: "person__jd", type: "person", name: "John DeMarco", role: "Electrician", companyName: "74 Construction" }, 2),
    ],
    scope: "all",
    seed: 5,
  })
  assert.ok(suggestions.length <= 4)
  const texts = suggestions.map((s) => s.text)
  assert.equal(new Set(texts).size, texts.length) // no duplicates
  const perEntity = new Map<string, number>()
  for (const s of suggestions) {
    if (!s.entity) continue
    perEntity.set(s.entity.id, (perEntity.get(s.entity.id) ?? 0) + 1)
  }
  for (const count of perEntity.values()) assert.ok(count <= 2)
})

test("suggestions rotate across seeds when comparable candidates exist", () => {
  const company = recent({ id: "company__74", type: "company", name: "74 Construction" })
  const orderings = new Set<string>()
  for (let seed = 0; seed < 16; seed += 1) {
    const texts = buildDirectorySuggestions({ recents: [company], scope: "all", seed }).map((s) => s.text).join("|")
    orderings.add(texts)
  }
  assert.ok(orderings.size >= 2)
})

test("suggestions fall back to representative entities with no recent context", () => {
  const suggestions = buildDirectorySuggestions({
    recents: [],
    scope: "all",
    fallbackEntities: [item({ id: "company__74", type: "company", name: "74 Construction" })],
    seed: 1,
  })
  assert.ok(suggestions.length >= 1)
  assert.ok(suggestions.every((s) => /74 Construction/.test(s.text)))
})

// ── Request guard (separate Directory budget) ────────────────────────────────

const GUARD_LIMITS: AiGuardLimits = {
  requestWindowMs: 10 * 60 * 1000,
  generationRequestsPerWindow: 3,
  transcriptionRequestsPerWindow: 2,
}

function acquire(state = emptyOutlookAiGuardState(), overrides: { operation?: "ask" | "transcription"; requestHash?: string; keyHash?: string; nowMs?: number } = {}) {
  return acquireOutlookAiGuardState(state, {
    operation: overrides.operation ?? "ask",
    requestHash: overrides.requestHash ?? `hash-${Math.random()}`,
    keyHash: overrides.keyHash ?? `key-${Math.random()}`,
    nowMs: overrides.nowMs ?? Date.now(),
    limits: GUARD_LIMITS,
  })
}

test("ask operation uses the generation bucket and enforces its own limit", () => {
  const now = Date.now()
  let state = emptyOutlookAiGuardState()
  for (let i = 0; i < GUARD_LIMITS.generationRequestsPerWindow; i += 1) {
    const decision = acquire(state, { operation: "ask", nowMs: now })
    // release the active lease so only the rolling counter blocks us
    state = completeOutlookAiGuardState(decision.state, decision.lease, now)
  }
  assert.throws(() => acquire(state, { operation: "ask", nowMs: now }), (error: unknown) => error instanceof AiError && error.code === "rate-limited")
})

test("ask and transcription have independent buckets", () => {
  const now = Date.now()
  let state = emptyOutlookAiGuardState()
  for (let i = 0; i < GUARD_LIMITS.generationRequestsPerWindow; i += 1) {
    const decision = acquire(state, { operation: "ask", nowMs: now })
    state = completeOutlookAiGuardState(decision.state, decision.lease, now)
  }
  // Ask bucket is full, but transcription is still allowed.
  assert.doesNotThrow(() => acquire(state, { operation: "transcription", nowMs: now }))
})

test("only one active AI request is allowed at a time", () => {
  const first = acquire(emptyOutlookAiGuardState(), { operation: "ask" })
  assert.throws(() => acquire(first.state, { operation: "ask" }), (error: unknown) => error instanceof AiError && error.code === "request-in-progress")
})

test("an identical completed request is treated as a duplicate", () => {
  const now = Date.now()
  const first = acquire(emptyOutlookAiGuardState(), { operation: "ask", requestHash: "same", keyHash: "k1", nowMs: now })
  const completed = completeOutlookAiGuardState(first.state, first.lease, now)
  assert.throws(
    () => acquire(completed, { operation: "ask", requestHash: "same", keyHash: "k2", nowMs: now }),
    (error: unknown) => error instanceof AiError && error.code === "duplicate-request",
  )
})

test("reusing an idempotency key for a different payload is rejected", () => {
  const now = Date.now()
  const first = acquire(emptyOutlookAiGuardState(), { operation: "ask", requestHash: "h1", keyHash: "reused", nowMs: now })
  const completed = completeOutlookAiGuardState(first.state, first.lease, now)
  assert.throws(
    () => acquire(completed, { operation: "ask", requestHash: "h2-different", keyHash: "reused", nowMs: now }),
    (error: unknown) => error instanceof AiError && error.code === "invalid-request",
  )
})

test("mock transcript is a realistic Directory question", () => {
  assert.match(MOCK_DIRECTORY_TRANSCRIPT, /\?$/)
})

// ── Tool layer ───────────────────────────────────────────────────────────────

function budget(overrides: Partial<ToolBudget> = {}): ToolBudget {
  return { maxRecordsPerTool: 12, maxNotesPerTool: 5, maxNoteChars: 400, remainingRecords: 24, ...overrides }
}

test("every tool advertises a JSON schema and is exposed to the model", () => {
  const specs = directoryToolSpecs()
  assert.equal(specs.length, DIRECTORY_TOOLS.length)
  assert.ok(specs.length >= 11, "the full Directory tool set should be available")
  for (const spec of specs) {
    assert.equal(spec.type, "function")
    assert.ok(spec.function.name.length > 0)
    assert.ok(spec.function.description.length > 0)
    assert.equal((spec.function.parameters as { type?: string }).type, "object")
  }
})

test("tool arguments are validated server-side, never trusted", async () => {
  const { provider } = createFixtureDeps()
  // Missing required argument.
  const bad = await runDirectoryTool("getEntityDetails", {}, provider, budget())
  assert.equal(bad.empty, true)
  assert.match(bad.summary, /Invalid arguments/i)

  // Unknown tool name.
  const unknown = await runDirectoryTool("dropEverything", { directoryId: "x" }, provider, budget())
  assert.equal(unknown.empty, true)
  assert.match(unknown.summary, /Unknown tool/i)

  // Out-of-range limit is rejected rather than clamped silently.
  const oversized = await runDirectoryTool("searchPeople", { query: "John", limit: 500 }, provider, budget())
  assert.equal(oversized.empty, true)
})

test("tool results respect the shared record budget", async () => {
  const { provider } = createFixtureDeps()
  const shared = budget({ remainingRecords: 2 })
  const result = await runDirectoryTool("getCompanyRelationships", { directoryId: "company__74" }, provider, shared)
  assert.ok((result.records?.length ?? 0) <= 2, "must not exceed the remaining record budget")
  assert.equal(shared.remainingRecords, 0)
})

test("findConnectingPaths returns the actual relationship chain", async () => {
  const { provider } = createFixtureDeps()
  const result = await runDirectoryTool(
    "findConnectingPaths",
    { fromId: "company__74", toId: "company__1901" },
    provider,
    budget(),
  )
  assert.ok(result.paths && result.paths.length > 0, "expected a connecting path")
  const path = result.paths[0]
  assert.equal(path[0].id, "company__74")
  assert.equal(path[path.length - 1].id, "company__1901")
  assert.ok(path.length >= 3, "the two companies connect through an intermediate record")
})

test("findSharedContacts names only genuinely shared records", async () => {
  const { provider } = createFixtureDeps()
  const result = await runDirectoryTool(
    "findSharedContacts",
    { entityIdA: "company__74", entityIdB: "company__1901" },
    provider,
    budget(),
  )
  assert.match(result.summary, /Melissa Wong/)
  assert.deepEqual(result.records?.map((entry) => entry.id), ["person__mwong"])
})

test("searchRelevantNotes truncates long notes to the budget", async () => {
  const { provider } = createFixtureDeps()
  const result = await runDirectoryTool(
    "searchRelevantNotes",
    { query: "electrical experience" },
    provider,
    budget({ maxNoteChars: 20 }),
  )
  for (const note of result.notes ?? []) {
    assert.ok(note.text.length <= 20, `note text should be truncated, got ${note.text.length}`)
  }
})
