import assert from "node:assert/strict"
import test from "node:test"
import { createFixtureProvider } from "./directory-fixture"
import { createDirectoryTools, type DirectoryContactDetails } from "../lib/whatsapp-secretary/tools/directory"
import type { SecretaryToolBudget } from "../lib/whatsapp-secretary/tool-registry"
import type { DirectoryDataProvider } from "../features/directory/ai/server/tools/types"

function budget(): SecretaryToolBudget {
  return { maxRecordsPerTool: 12, maxNotesPerTool: 0, maxNoteChars: 0, remainingRecords: 24 }
}

test("Directory tools are namespaced and exclude searchRelevantNotes", () => {
  const tools = createDirectoryTools({ provider: createFixtureProvider() })
  const names = tools.map((tool) => tool.name)
  assert.ok(names.includes("directory_searchPeople"))
  assert.ok(names.includes("directory_searchCompanies"))
  assert.ok(names.includes("directory_getEntityDetails"))
  assert.ok(names.includes("directory_findConnectingPaths"))
  assert.ok(!names.some((name) => name.includes("searchRelevantNotes")))
  assert.ok(names.every((name) => name.startsWith("directory_")))
  assert.ok(tools.every((tool) => tool.module === "directory"))
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
