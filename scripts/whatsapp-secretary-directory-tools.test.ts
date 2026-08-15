import assert from "node:assert/strict"
import test from "node:test"
import { createFixtureProvider } from "./directory-fixture"
import { createDirectoryTools, rerankKeywordMatches, type DirectoryContactDetails } from "../lib/whatsapp-secretary/tools/directory"
import type { SecretaryToolBudget } from "../lib/whatsapp-secretary/tool-registry"
import type { DirectoryDataProvider } from "../features/directory/ai/server/tools/types"
import type { DirectoryIndexRecord } from "../lib/ai/server/directory-data"

function budget(): SecretaryToolBudget {
  return { maxRecordsPerTool: 12, maxNotesPerTool: 5, maxNoteChars: 400, remainingRecords: 24 }
}

test("Directory tools are namespaced and include the full stack, including searchRelevantNotes", () => {
  const tools = createDirectoryTools({ provider: createFixtureProvider() })
  const names = tools.map((tool) => tool.name)
  assert.ok(names.includes("directory_searchPeople"))
  assert.ok(names.includes("directory_searchCompanies"))
  assert.ok(names.includes("directory_getEntityDetails"))
  assert.ok(names.includes("directory_findConnectingPaths"))
  // Every sender who can reach any Directory tool is already a uniquely
  // identified internal SVC user (buildToolRegistry gates on canReadDirectory),
  // so there is no narrower internal audience notes/relationship data needs
  // protection from — nothing is excluded.
  assert.ok(names.includes("directory_searchRelevantNotes"))
  assert.ok(names.every((name) => name.startsWith("directory_")))
  assert.ok(tools.every((tool) => tool.module === "directory"))
})

test("directory_searchRelevantNotes results are passed through to the model", async () => {
  const tools = createDirectoryTools({ provider: createFixtureProvider() })
  const searchNotes = tools.find((tool) => tool.name === "directory_searchRelevantNotes")
  assert.ok(searchNotes)

  const result = await searchNotes.run({ query: "electrical experience" }, budget())
  const data = result.data as { notes?: Array<{ text: string }> }
  assert.ok(data.notes?.some((note) => note.text.includes("electrical")))
})

test("directory_searchCompanies returns a compact, bounded record set", async () => {
  const tools = createDirectoryTools({ provider: createFixtureProvider() })
  const searchCompanies = tools.find((tool) => tool.name === "directory_searchCompanies")
  assert.ok(searchCompanies)

  const result = await searchCompanies.run({ query: "74 Construction" }, budget())
  assert.equal(result.empty, undefined)
  const data = result.data as { records?: Array<{ name: string }> }
  assert.ok(data.records?.some((record) => record.name === "74 Construction"))
})

test("directory_getEntityDetails resolves one entity and its relationship counts", async () => {
  const tools = createDirectoryTools({ provider: createFixtureProvider() })
  const getEntityDetails = tools.find((tool) => tool.name === "directory_getEntityDetails")
  assert.ok(getEntityDetails)

  const result = await getEntityDetails.run({ directoryId: "person__jdemarco" }, budget())
  const data = result.data as { records?: Array<{ name: string }>; counts?: Record<string, number> }
  assert.ok(data.records?.some((record) => record.name === "John DeMarco"))
  assert.ok(typeof data.counts?.linkedCompanies === "number")
})

test("the shared budget is decremented across a tool call", async () => {
  const tools = createDirectoryTools({ provider: createFixtureProvider() })
  const searchCompanies = tools.find((tool) => tool.name === "directory_searchCompanies")
  assert.ok(searchCompanies)

  const sharedBudget = budget()
  await searchCompanies.run({ query: "74 Construction" }, sharedBudget)
  assert.ok(sharedBudget.remainingRecords < 24)
})

/** Wraps the shared fixture but reports one person as contacts-sourced, so
 * enrichment has something real to key off without touching real Firestore. */
function createContactsSourcedProvider(directoryId: string, sourceId: string): DirectoryDataProvider {
  const base = createFixtureProvider()
  return {
    ...base,
    async getEntity(id) {
      const entity = await base.getEntity(id)
      if (!entity || id !== directoryId) return entity
      return { ...entity, sourceCollection: "contacts", sourceId }
    },
  }
}

test("enriches a person record with phone/email from a linked contact, for an internal sender", async () => {
  const tools = createDirectoryTools({
    provider: createContactsSourcedProvider("person__jdemarco", "contact-jdemarco"),
    contactDetailsProvider: async (sourceIds) => {
      const result = new Map<string, DirectoryContactDetails>()
      if (sourceIds.includes("contact-jdemarco")) {
        result.set("contact-jdemarco", { phone: "+1 555-0100", email: "john@74construction.com" })
      }
      return result
    },
  })
  const getEntityDetails = tools.find((tool) => tool.name === "directory_getEntityDetails")
  assert.ok(getEntityDetails)

  const result = await getEntityDetails.run({ directoryId: "person__jdemarco" }, budget())
  const data = result.data as { records?: Array<{ name: string; phone?: string; email?: string }> }
  const record = data.records?.find((entry) => entry.name === "John DeMarco")
  assert.equal(record?.phone, "+1 555-0100")
  assert.equal(record?.email, "john@74construction.com")
})

test("never fabricates phone/email for a person with no linked contact details", async () => {
  const tools = createDirectoryTools({
    provider: createFixtureProvider(),
    contactDetailsProvider: async () => {
      throw new Error("must not be called when no person record resolves to a /contacts source")
    },
  })
  const getEntityDetails = tools.find((tool) => tool.name === "directory_getEntityDetails")
  assert.ok(getEntityDetails)

  const result = await getEntityDetails.run({ directoryId: "person__jdemarco" }, budget())
  const data = result.data as { records?: Array<{ name: string; phone?: string; email?: string }> }
  const record = data.records?.find((entry) => entry.name === "John DeMarco")
  assert.equal(record?.phone, undefined)
  assert.equal(record?.email, undefined)
})

test("falls back to keyword search when the exact/prefix name lookup finds nothing (e.g. a single trailing word)", async () => {
  const keywordRecord: DirectoryIndexRecord = {
    id: "job__miamibeach",
    type: "job",
    sourceCollection: "contexts",
    sourceId: "miamibeach",
    name: "Miami Beach Project",
    normalizedName: "miami beach project",
    companyName: "",
    location: "Miami, FL",
    role: "",
    subtitle: "",
    description: "",
    status: "",
    askContext: null,
    sourceUpdatedAtMs: null,
  }
  const tools = createDirectoryTools({
    // "Beach" alone matches nothing in the fixture via exact/prefix — the
    // fixture has no job whose name starts with "beach".
    provider: createFixtureProvider(),
    keywordSearchProvider: async (tokens, options) => {
      assert.ok(tokens.includes("beach"))
      assert.equal(options.type, "job")
      return [keywordRecord]
    },
  })
  const searchJobs = tools.find((tool) => tool.name === "directory_searchJobs")
  assert.ok(searchJobs)

  const result = await searchJobs.run({ query: "Beach" }, budget())
  const data = result.data as { records?: Array<{ name: string }> }
  assert.ok(data.records?.some((record) => record.name === "Miami Beach Project"))
})

function keywordRecordFixture(id: string, name: string): DirectoryIndexRecord {
  return {
    id,
    type: "person",
    sourceCollection: "contacts",
    sourceId: id,
    name,
    normalizedName: name.toLocaleLowerCase(),
    companyName: "",
    location: "",
    role: "",
    subtitle: "",
    description: "",
    status: "",
    askContext: null,
    sourceUpdatedAtMs: null,
  }
}

test("rerankKeywordMatches prefers a full multi-token match over noisy single-token matches", () => {
  // Real production case: searching "courtney roberts" (no middle initial)
  // against directoryIndex's array-contains-any keyword match returns a
  // dozen unrelated "Roberts"-someone and "Courtney"-someone records
  // alongside the one actual "Courtney D. P. Roberts" match. Only the full
  // match should survive.
  const fullMatch = keywordRecordFixture("person__courtneyRoberts", "Courtney D. P. Roberts")
  const partialRoberts = keywordRecordFixture("person__lamarRoberts", "Lamar Roberts")
  const partialCourtney = keywordRecordFixture("person__courtneyGlazer", "Courtney Glazer")

  const results = rerankKeywordMatches(
    [
      { record: partialRoberts, score: 1 },
      { record: fullMatch, score: 2 },
      { record: partialCourtney, score: 1 },
    ],
    2,
    10,
  )

  assert.equal(results.length, 1)
  assert.equal(results[0]?.name, "Courtney D. P. Roberts")
})

test("rerankKeywordMatches falls back to the best partial matches when nothing matched every token", () => {
  const results = rerankKeywordMatches(
    [
      { record: keywordRecordFixture("person__a", "Josh Roberts"), score: 1 },
      { record: keywordRecordFixture("person__b", "Dana Roberts"), score: 1 },
    ],
    2,
    10,
  )

  assert.equal(results.length, 2)
})

test("rerankKeywordMatches drops zero-score noise and respects the limit", () => {
  const results = rerankKeywordMatches(
    [
      { record: keywordRecordFixture("person__a", "Match One"), score: 1 },
      { record: keywordRecordFixture("person__b", "Match Two"), score: 1 },
      { record: keywordRecordFixture("person__c", "No Match"), score: 0 },
    ],
    1,
    1,
  )

  assert.equal(results.length, 1)
})

test("never calls the keyword fallback when the exact/prefix lookup already found a match", async () => {
  const tools = createDirectoryTools({
    provider: createFixtureProvider(),
    keywordSearchProvider: async () => {
      throw new Error("must not be called when the primary lookup already found a match")
    },
  })
  const searchCompanies = tools.find((tool) => tool.name === "directory_searchCompanies")
  assert.ok(searchCompanies)

  const result = await searchCompanies.run({ query: "74 Construction" }, budget())
  assert.equal(result.empty, undefined)
})

// --- directory_getActiveUsers (2026-08-14): reuses the exact "active now"
// signal the web app itself shows (lastSeen within the last 90s) ---

test("directory_getActiveUsers is registered alongside the rest of the Directory stack", () => {
  const tools = createDirectoryTools({ provider: createFixtureProvider(), activeUsersProvider: async () => [] })
  assert.ok(tools.some((tool) => tool.name === "directory_getActiveUsers"))
})

test("directory_getActiveUsers returns the users the injected provider reports as currently active", async () => {
  const tools = createDirectoryTools({
    provider: createFixtureProvider(),
    activeUsersProvider: async () => [
      { name: "Jordan Blake", role: "Superintendent" },
      { name: "Sam Rivera", role: null },
    ],
  })
  const getActiveUsers = tools.find((tool) => tool.name === "directory_getActiveUsers")
  assert.ok(getActiveUsers)

  const result = await getActiveUsers.run({}, budget())
  assert.equal(result.empty, undefined)
  const data = result.data as { users: Array<{ name: string; role: string | null }> }
  assert.deepEqual(data.users, [
    { name: "Jordan Blake", role: "Superintendent" },
    { name: "Sam Rivera", role: null },
  ])
})

test("directory_getActiveUsers reports no one active rather than guessing", async () => {
  const tools = createDirectoryTools({ provider: createFixtureProvider(), activeUsersProvider: async () => [] })
  const getActiveUsers = tools.find((tool) => tool.name === "directory_getActiveUsers")
  assert.ok(getActiveUsers)

  const result = await getActiveUsers.run({}, budget())
  assert.equal(result.empty, true)
})

test("directory_getActiveUsers respects the shared budget and never calls the provider when it's exhausted", async () => {
  const tools = createDirectoryTools({
    provider: createFixtureProvider(),
    activeUsersProvider: async () => {
      throw new Error("must not be called when the budget is exhausted")
    },
  })
  const getActiveUsers = tools.find((tool) => tool.name === "directory_getActiveUsers")
  assert.ok(getActiveUsers)

  const exhausted: SecretaryToolBudget = { maxRecordsPerTool: 12, maxNotesPerTool: 0, maxNoteChars: 0, remainingRecords: 0 }
  const result = await getActiveUsers.run({}, exhausted)
  assert.equal(result.empty, true)
})

test("directory_getActiveUsers caps returned users by the shared budget's remainingRecords", async () => {
  const tools = createDirectoryTools({
    provider: createFixtureProvider(),
    activeUsersProvider: async () => [
      { name: "A", role: null },
      { name: "B", role: null },
      { name: "C", role: null },
    ],
  })
  const getActiveUsers = tools.find((tool) => tool.name === "directory_getActiveUsers")
  assert.ok(getActiveUsers)

  const sharedBudget: SecretaryToolBudget = { maxRecordsPerTool: 12, maxNotesPerTool: 0, maxNoteChars: 0, remainingRecords: 2 }
  const result = await getActiveUsers.run({}, sharedBudget)
  const data = result.data as { users: unknown[] }
  assert.equal(data.users.length, 2)
  assert.equal(sharedBudget.remainingRecords, 0)
})

// --- directory_listRegisteredUsers (2026-08-14): "who's registered" is a
// different question from "who's active right now" ---

test("directory_listRegisteredUsers is registered alongside the rest of the Directory stack", () => {
  const tools = createDirectoryTools({ provider: createFixtureProvider(), registeredUsersProvider: async () => [] })
  assert.ok(tools.some((tool) => tool.name === "directory_listRegisteredUsers"))
})

test("directory_listRegisteredUsers returns every user the injected provider reports, independent of presence", async () => {
  const tools = createDirectoryTools({
    provider: createFixtureProvider(),
    registeredUsersProvider: async () => [
      { name: "Jordan Blake", role: "Superintendent" },
      { name: "Inactive Ivan", role: null },
    ],
  })
  const listRegisteredUsers = tools.find((tool) => tool.name === "directory_listRegisteredUsers")
  assert.ok(listRegisteredUsers)

  const result = await listRegisteredUsers.run({}, budget())
  assert.equal(result.empty, undefined)
  const data = result.data as { users: Array<{ name: string; role: string | null }> }
  assert.deepEqual(data.users, [
    { name: "Jordan Blake", role: "Superintendent" },
    { name: "Inactive Ivan", role: null },
  ])
})

test("directory_listRegisteredUsers reports no one registered rather than guessing", async () => {
  const tools = createDirectoryTools({ provider: createFixtureProvider(), registeredUsersProvider: async () => [] })
  const listRegisteredUsers = tools.find((tool) => tool.name === "directory_listRegisteredUsers")
  assert.ok(listRegisteredUsers)

  const result = await listRegisteredUsers.run({}, budget())
  assert.equal(result.empty, true)
})

test("directory_listRegisteredUsers respects the shared budget and never calls the provider when it's exhausted", async () => {
  const tools = createDirectoryTools({
    provider: createFixtureProvider(),
    registeredUsersProvider: async () => {
      throw new Error("must not be called when the budget is exhausted")
    },
  })
  const listRegisteredUsers = tools.find((tool) => tool.name === "directory_listRegisteredUsers")
  assert.ok(listRegisteredUsers)

  const exhausted: SecretaryToolBudget = { maxRecordsPerTool: 12, maxNotesPerTool: 0, maxNoteChars: 0, remainingRecords: 0 }
  const result = await listRegisteredUsers.run({}, exhausted)
  assert.equal(result.empty, true)
})
