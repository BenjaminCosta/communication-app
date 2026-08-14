import assert from "node:assert/strict"
import test from "node:test"
import { createKnowledgeTools, type KnowledgeToolsProvider } from "../lib/whatsapp-secretary/tools/knowledge"
import { assertOnlyAllowedMessagesTools } from "../lib/whatsapp-secretary/tool-registry"
import type { SecretaryToolBudget } from "../lib/whatsapp-secretary/tool-registry"

function budget(overrides: Partial<SecretaryToolBudget> = {}): SecretaryToolBudget {
  return { maxRecordsPerTool: 12, maxNotesPerTool: 0, maxNoteChars: 0, remainingRecords: 10, ...overrides }
}

function fakeProvider(overrides: Partial<KnowledgeToolsProvider> = {}): KnowledgeToolsProvider & { searchCalls: number; getSectionCalls: number } {
  const state = { searchCalls: 0, getSectionCalls: 0 }
  return {
    get searchCalls() {
      return state.searchCalls
    },
    get getSectionCalls() {
      return state.getSectionCalls
    },
    search(query, limit) {
      state.searchCalls += 1
      if (overrides.search) return overrides.search(query, limit)
      return [
        { id: "sec-7", title: "Quest Coral", breadcrumb: "Quest Coral", excerpt: "Quest Coral is SVC's project tracker.", source: "SVC_AI_Secretary_Canonical_Knowledge_Pack.md" },
        { id: "sec-7-purpose", title: "Purpose", breadcrumb: "Quest Coral — Purpose", excerpt: "It exists to...", source: "SVC_AI_Secretary_Canonical_Knowledge_Pack.md" },
      ].slice(0, limit)
    },
    getSection(id) {
      state.getSectionCalls += 1
      if (overrides.getSection) return overrides.getSection(id)
      if (id === "sec-7") return { id: "sec-7", title: "Quest Coral", breadcrumb: "Quest Coral", content: "Full Quest Coral text.", source: "SVC_AI_Secretary_Canonical_Knowledge_Pack.md" }
      return null
    },
  }
}

test("tool names/module are correctly shaped and never match the Messages/Communications guard", () => {
  const tools = createKnowledgeTools({ provider: fakeProvider() })
  assert.deepEqual(tools.map((tool) => tool.name).sort(), ["knowledge_getSection", "knowledge_search"])
  assert.ok(tools.every((tool) => tool.module === "knowledge"))
  assert.doesNotThrow(() => assertOnlyAllowedMessagesTools(tools))
})

test("knowledge_search: returns results, decrements the shared budget by the result count", async () => {
  const provider = fakeProvider()
  const [search] = createKnowledgeTools({ provider })
  const sharedBudget = budget()

  const result = await search!.run({ query: "what is quest coral" }, sharedBudget)

  assert.equal(result.empty, undefined)
  assert.equal((result.data as { sections: unknown[] }).sections.length, 2)
  assert.equal(sharedBudget.remainingRecords, 8)
  assert.equal(provider.searchCalls, 1)
})

test("knowledge_search: caps the requested limit by maxRecordsPerTool and remainingRecords", async () => {
  const provider = fakeProvider()
  const [search] = createKnowledgeTools({ provider })
  const sharedBudget = budget({ remainingRecords: 1 })

  const result = await search!.run({ query: "quest coral" }, sharedBudget)

  // Only 1 record was available, so the provider should have been asked for at most 1.
  assert.equal((result.data as { sections: unknown[] }).sections.length, 1)
  assert.equal(sharedBudget.remainingRecords, 0)
})

test("knowledge_search: an exhausted budget returns an empty result without calling the provider", async () => {
  const provider = fakeProvider()
  const [search] = createKnowledgeTools({ provider })
  const sharedBudget = budget({ remainingRecords: 0 })

  const result = await search!.run({ query: "anything" }, sharedBudget)

  assert.equal(result.empty, true)
  assert.equal(provider.searchCalls, 0)
})

test("knowledge_search: no matches returns an empty result and does not decrement the budget", async () => {
  const provider = fakeProvider({ search: () => [] })
  const [search] = createKnowledgeTools({ provider })
  const sharedBudget = budget()

  const result = await search!.run({ query: "zzz nonexistent" }, sharedBudget)

  assert.equal(result.empty, true)
  assert.equal(sharedBudget.remainingRecords, 10)
})

test("knowledge_getSection: returns the full section and decrements the budget by one", async () => {
  const provider = fakeProvider()
  const [, getSection] = createKnowledgeTools({ provider })
  const sharedBudget = budget()

  const result = await getSection!.run({ id: "sec-7" }, sharedBudget)

  assert.equal(result.empty, undefined)
  assert.equal((result.data as { section: { content: string } }).section.content, "Full Quest Coral text.")
  assert.equal(sharedBudget.remainingRecords, 9)
})

test("knowledge_getSection: an unknown id returns a structured empty result instead of throwing", async () => {
  const provider = fakeProvider()
  const [, getSection] = createKnowledgeTools({ provider })
  const sharedBudget = budget()

  const result = await getSection!.run({ id: "sec-does-not-exist" }, sharedBudget)

  assert.equal(result.empty, true)
  assert.equal(sharedBudget.remainingRecords, 10)
})

test("knowledge_getSection: an exhausted budget short-circuits before calling the provider", async () => {
  const provider = fakeProvider()
  const [, getSection] = createKnowledgeTools({ provider })
  const sharedBudget = budget({ remainingRecords: 0 })

  const result = await getSection!.run({ id: "sec-7" }, sharedBudget)

  assert.equal(result.empty, true)
  assert.equal(provider.getSectionCalls, 0)
})

test("knowledge_search: each result carries its own source rather than one blanket source for the whole call", async () => {
  const provider = fakeProvider()
  const [search] = createKnowledgeTools({ provider })
  const result = await search!.run({ query: "what is quest coral" }, budget())
  const sections = (result.data as { sections: Array<{ source: string }> }).sections
  assert.ok(sections.every((section) => section.source === "SVC_AI_Secretary_Canonical_Knowledge_Pack.md"))
})

test("default provider (no injection) works end-to-end against the real knowledge pack", async () => {
  const [search, getSection] = createKnowledgeTools()
  const sharedBudget = budget()

  const searchResult = await search!.run({ query: "what is a 3-week outlook" }, sharedBudget)
  assert.equal(searchResult.empty, undefined)
  const sections = (searchResult.data as { sections: Array<{ id: string }> }).sections
  assert.ok(sections.length > 0)

  const sectionResult = await getSection!.run({ id: sections[0]!.id }, sharedBudget)
  assert.equal(sectionResult.empty, undefined)
})

test("default provider: a company/mission question retrieves the companion document, correctly sourced", async () => {
  const [search, getSection] = createKnowledgeTools()
  const sharedBudget = budget()

  const searchResult = await search!.run({ query: "what is Cool Breeze" }, sharedBudget)
  assert.equal(searchResult.empty, undefined)
  const sections = (searchResult.data as { sections: Array<{ id: string; source: string }> }).sections
  const coolBreeze = sections.find((section) => section.id.startsWith("mission-"))
  assert.ok(coolBreeze, `expected a mission-prefixed result, got: ${sections.map((s) => s.id).join(", ")}`)
  assert.equal(coolBreeze!.source, "SVC_Company_Mission_Operating_Framework_Knowledge.md")

  const sectionResult = await getSection!.run({ id: coolBreeze!.id }, sharedBudget)
  const section = (sectionResult.data as { section: { source: string; content: string } }).section
  assert.equal(section.source, "SVC_Company_Mission_Operating_Framework_Knowledge.md")
  assert.match(section.content, /Cool Breeze/i)
})
