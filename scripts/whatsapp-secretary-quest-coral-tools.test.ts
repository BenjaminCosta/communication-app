import assert from "node:assert/strict"
import test from "node:test"
import { createQuestCoralTools, type QuestCoralProjectSummary, type QuestCoralToolsProvider, type QuestCoralUpdateSummary } from "../lib/whatsapp-secretary/tools/quest-coral"
import type { SecretaryToolBudget } from "../lib/whatsapp-secretary/tool-registry"

function budget(): SecretaryToolBudget {
  return { maxRecordsPerTool: 12, maxNotesPerTool: 0, maxNoteChars: 0, remainingRecords: 24 }
}

const onboarding: QuestCoralProjectSummary = {
  id: "proj-onboarding",
  name: "Customer Onboarding Redesign",
  description: "Improve activation.",
  status: "on_track",
  progress: 72,
  ownerName: "Maya Lin",
  peopleNames: ["Maya Lin", "Arjun Patel"],
  nextStep: "User testing round 2",
  nextStepDue: "2026-08-02",
  timeline: null,
  updatedAt: "2026-07-24T15:00:00.000Z",
}

const crewScheduling: QuestCoralProjectSummary = {
  ...onboarding,
  id: "proj-crew",
  name: "Field Crew Scheduling Rollout",
}

function makeUpdate(overrides: Partial<QuestCoralUpdateSummary>): QuestCoralUpdateSummary {
  return {
    projectId: "proj-onboarding",
    type: "update",
    authorName: "Arjun Patel",
    body: "Completed first round of usability testing.",
    isBlocker: false,
    createdAt: "2026-07-24T15:00:00.000Z",
    ...overrides,
  }
}

function createFixtureProvider(overrides: Partial<QuestCoralToolsProvider> = {}): QuestCoralToolsProvider {
  return {
    async findProjectsByName(query) {
      if (query === "Customer Onboarding Redesign") return [onboarding]
      if (query === "Ambiguous Project") return [onboarding, crewScheduling]
      return []
    },
    async getProjectContext() {
      return "## Purpose\n\nGet new customers to value fast."
    },
    async getProjectUpdates() {
      return { updates: [makeUpdate({})], nextCursor: null }
    },
    async listRecentActivity() {
      return [makeUpdate({}), makeUpdate({ projectId: "proj-crew", projectName: "Field Crew Scheduling Rollout", type: "blocker", isBlocker: true })]
    },
    async listAllProjects(options) {
      const all = [onboarding, crewScheduling]
      return options.status ? all.filter((project) => project.status === options.status) : all
    },
    ...overrides,
  }
}

test("Quest Coral tools are namespaced", () => {
  const tools = createQuestCoralTools({ provider: createFixtureProvider() })
  const names = tools.map((tool) => tool.name)
  assert.deepEqual(names, ["questCoral_searchProjects", "questCoral_getProject", "questCoral_listRecentActivity"])
  assert.ok(tools.every((tool) => tool.module === "questCoral"))
})

test("questCoral_getProject returns project details for an exact name match", async () => {
  const tools = createQuestCoralTools({ provider: createFixtureProvider() })
  const getProject = tools.find((tool) => tool.name === "questCoral_getProject")
  assert.ok(getProject)

  const result = await getProject.run({ name: "Customer Onboarding Redesign", include: ["context"] }, budget())
  const data = result.data as { project?: QuestCoralProjectSummary; projectContext?: string | null }
  assert.equal(data.project?.name, "Customer Onboarding Redesign")
  assert.match(data.projectContext ?? "", /Purpose/)
  assert.equal(result.responseFormat?.kind, "detail-card")
  assert.equal(result.responseFormat?.title, "Customer Onboarding Redesign")
  assert.ok(result.responseFormat?.kind === "detail-card" && result.responseFormat.fields.some((field) => field.label === "Status" && /On track/.test(field.value)))
})

test("questCoral_getProject reports ambiguity instead of guessing", async () => {
  const tools = createQuestCoralTools({ provider: createFixtureProvider() })
  const getProject = tools.find((tool) => tool.name === "questCoral_getProject")
  assert.ok(getProject)

  const result = await getProject.run({ name: "Ambiguous Project" }, budget())
  const data = result.data as { candidates?: Array<{ name: string }> }
  assert.equal(data.candidates?.length, 2)
})

test("questCoral_getProject returns updates and decrements the shared budget", async () => {
  const tools = createQuestCoralTools({ provider: createFixtureProvider() })
  const getProjectUpdates = tools.find((tool) => tool.name === "questCoral_getProject")
  assert.ok(getProjectUpdates)

  const sharedBudget = budget()
  const result = await getProjectUpdates.run({ name: "Customer Onboarding Redesign", include: ["updates"], since: "2026-07-01" }, sharedBudget)
  const data = result.data as { updates?: QuestCoralUpdateSummary[] }
  assert.equal(data.updates?.length, 1)
  assert.ok(sharedBudget.remainingRecords < 24)
})

test("questCoral_listRecentActivity spans multiple projects with project names attached", async () => {
  const tools = createQuestCoralTools({ provider: createFixtureProvider() })
  const listRecentActivity = tools.find((tool) => tool.name === "questCoral_listRecentActivity")
  assert.ok(listRecentActivity)

  const result = await listRecentActivity.run({}, budget())
  const data = result.data as { updates?: QuestCoralUpdateSummary[] }
  assert.equal(data.updates?.length, 2)
  assert.ok(data.updates?.some((update) => update.projectName === "Field Crew Scheduling Rollout"))
})

test("questCoral_searchProjects reports no match without guessing", async () => {
  const tools = createQuestCoralTools({ provider: createFixtureProvider(), keywordSearchProvider: async () => [] })
  const searchProjects = tools.find((tool) => tool.name === "questCoral_searchProjects")
  assert.ok(searchProjects)

  const result = await searchProjects.run({ query: "Nonexistent Project" }, budget())
  assert.equal(result.empty, true)
})

test("questCoral_searchProjects falls back to keyword search when the exact/prefix name lookup finds nothing", async () => {
  const tools = createQuestCoralTools({
    // "Rollout" alone matches nothing in the fixture via exact/prefix — the
    // fixture has no project whose name starts with "Rollout".
    provider: createFixtureProvider(),
    keywordSearchProvider: async (tokens, limit) => {
      assert.ok(tokens.includes("rollout"))
      assert.equal(limit, 12)
      return [crewScheduling]
    },
  })
  const searchProjects = tools.find((tool) => tool.name === "questCoral_searchProjects")
  assert.ok(searchProjects)

  const result = await searchProjects.run({ query: "Rollout" }, budget())
  const data = result.data as { projects?: QuestCoralProjectSummary[] }
  assert.ok(data.projects?.some((project) => project.name === "Field Crew Scheduling Rollout"))
})

test("never calls the Quest Coral keyword fallback when the exact/prefix lookup already found a match", async () => {
  const tools = createQuestCoralTools({
    provider: createFixtureProvider(),
    keywordSearchProvider: async () => {
      throw new Error("must not be called when the exact/prefix lookup already found a match")
    },
  })
  const searchProjects = tools.find((tool) => tool.name === "questCoral_searchProjects")
  assert.ok(searchProjects)

  const result = await searchProjects.run({ query: "Customer Onboarding Redesign" }, budget())
  const data = result.data as { projects?: QuestCoralProjectSummary[] }
  assert.equal(data.projects?.length, 1)
})

// --- questCoral_searchProjects (2026-08-14): "what projects are there"
// without naming one ---

test("questCoral_searchProjects lists every project without a name argument", async () => {
  const tools = createQuestCoralTools({ provider: createFixtureProvider() })
  const listAllProjects = tools.find((tool) => tool.name === "questCoral_searchProjects")
  assert.ok(listAllProjects)

  const result = await listAllProjects.run({}, budget())
  const data = result.data as { projects?: QuestCoralProjectSummary[] }
  assert.equal(data.projects?.length, 2)
  assert.ok(data.projects?.some((project) => project.name === "Customer Onboarding Redesign"))
  assert.ok(data.projects?.some((project) => project.name === "Field Crew Scheduling Rollout"))
})

test("questCoral_searchProjects filters by status when given", async () => {
  const tools = createQuestCoralTools({
    provider: createFixtureProvider({
      async listAllProjects(options) {
        assert.equal(options.status, "at_risk")
        return []
      },
    }),
  })
  const listAllProjects = tools.find((tool) => tool.name === "questCoral_searchProjects")
  assert.ok(listAllProjects)

  const result = await listAllProjects.run({ status: "at_risk" }, budget())
  assert.equal(result.empty, true)
})

test("questCoral_searchProjects respects the shared budget", async () => {
  const tools = createQuestCoralTools({ provider: createFixtureProvider() })
  const listAllProjects = tools.find((tool) => tool.name === "questCoral_searchProjects")
  assert.ok(listAllProjects)

  const exhausted: SecretaryToolBudget = { maxRecordsPerTool: 12, maxNotesPerTool: 0, maxNoteChars: 0, remainingRecords: 0 }
  const result = await listAllProjects.run({}, exhausted)
  assert.equal(result.empty, true)
})
