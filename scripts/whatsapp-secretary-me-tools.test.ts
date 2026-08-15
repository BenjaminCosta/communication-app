import assert from "node:assert/strict"
import test from "node:test"
import { buildPersonalizedExamples, createMeTools } from "../lib/whatsapp-secretary/tools/me"
import { clearSelfContextSnapshotCache, type SelfContextActor, type SelfContextProvider, type SelfContextSnapshot } from "../lib/whatsapp-secretary/self-context"
import type { SecretaryToolBudget } from "../lib/whatsapp-secretary/tool-registry"

const TODAY = "2026-08-14"

function budget(): SecretaryToolBudget {
  return { maxRecordsPerTool: 15, maxNotesPerTool: 5, maxNoteChars: 400, remainingRecords: 60 }
}

function actor(overrides: Partial<SelfContextActor> = {}): SelfContextActor {
  // A distinct personId per test keeps the process-wide snapshot memo from
  // leaking one test's fixture into another.
  return { personId: `contact-${Math.random().toString(36).slice(2)}`, userId: "user-ben", name: "Ben Acosta", role: "Site Supervisor", ...overrides }
}

function provider(overrides: Partial<SelfContextProvider> = {}): SelfContextProvider {
  return {
    async getDirectoryProfile() {
      return {
        profile: { phone: "+1 555 0100", email: "ben@svc.example", companyName: "SVC", location: "Miami, FL", directoryRole: "Site Supervisor" },
        jobs: [{ name: "North Ridge", relationship: "Supervisor", contextId: "ctx-north-ridge" }],
        companies: [{ name: "Turner", relationship: "Client" }],
      }
    },
    async getQuestCoralInvolvement() {
      return [{ name: "Cool Breeze Rollout", status: "in_progress", involvement: "owner", nextStep: null, updatedAt: "2026-08-12T10:00:00.000Z" }]
    },
    async getRecentReports() {
      return [{ jobName: "North Ridge", status: "submitted", createdAt: "2026-08-13T18:00:00.000Z" }]
    },
    async getActiveClock() {
      return { jobName: "North Ridge", clockInAt: "2026-08-14T12:00:00.000Z" }
    },
    async getOutlooksForJobs(jobs) {
      return jobs.map((job) => ({ jobName: job.name, windowStart: "2026-08-10", windowEnd: "2026-08-31", taskCount: 4, activeToday: true }))
    },
    async getVisibleMessageActivity() {
      return { visibleRecentCount: 6, latestAt: "2026-08-14T09:00:00.000Z" }
    },
    async findOwnApplication() {
      return null
    },
    async getRecentJobActivity() {
      return []
    },
    ...overrides,
  }
}

function emptyProvider(): SelfContextProvider {
  return {
    async getDirectoryProfile() {
      return null
    },
    async getQuestCoralInvolvement() {
      return []
    },
    async getRecentReports() {
      return []
    },
    async getActiveClock() {
      return null
    },
    async getOutlooksForJobs() {
      return []
    },
    async getVisibleMessageActivity() {
      return null
    },
    async findOwnApplication() {
      return null
    },
    async getRecentJobActivity() {
      return []
    },
  }
}

function tools(deps: { provider?: SelfContextProvider; actor?: SelfContextActor; enabledModules?: Parameters<typeof createMeTools>[0]["enabledModules"] } = {}) {
  return createMeTools({
    actor: deps.actor ?? actor(),
    enabledModules: deps.enabledModules ?? ["directory", "questCoral", "applications", "reports", "clocking", "outlooks", "messages", "knowledge", "me"],
    provider: deps.provider ?? provider(),
    today: TODAY,
  })
}

function tool(name: string, deps: Parameters<typeof tools>[0] = {}) {
  const found = tools(deps).find((entry) => entry.name === name)
  assert.ok(found, `${name} must exist`)
  return found
}

test("Me tools are namespaced and take no arguments at all", () => {
  const names = tools().map((entry) => entry.name)
  assert.deepEqual(names, ["me_getMyProfile", "me_getMySvcContext", "me_getDailyBrief", "me_getSecretaryGuide"])
  assert.ok(tools().every((entry) => entry.module === "me"))
  // No argument means no way for the model to point any of these at someone else.
  assert.ok(tools().every((entry) => Object.keys((entry.parameters as { properties: Record<string, unknown> }).properties).length === 0))
})

test("me_getMyProfile reports the recognized identity, linked records, and explicit gaps", async () => {
  const result = await tool("me_getMyProfile").run({}, budget())
  const profile = (result.data as { profile: Record<string, unknown> }).profile
  assert.equal(profile.name, "Ben Acosta")
  assert.equal(profile.role, "Site Supervisor")
  assert.equal(profile.phone, "+1 555 0100")
  assert.deepEqual((profile.jobs as Array<{ name: string }>).map((job) => job.name), ["North Ridge"])
  assert.deepEqual(profile.gaps, [])
  assert.match(result.summary, /Recognized as Ben Acosta, Site Supervisor/)
})

test("me_getMyProfile never leaks a Directory context id to the model", async () => {
  const result = await tool("me_getMyProfile").run({}, budget())
  assert.ok(!JSON.stringify(result.data).includes("ctx-north-ridge"))
})

test("me_getMyProfile states the missing role instead of inventing one", async () => {
  const rolelessProvider = provider({
    async getDirectoryProfile() {
      return { profile: { phone: null, email: null, companyName: "SVC", location: null, directoryRole: null }, jobs: [], companies: [] }
    },
  })
  const result = await tool("me_getMyProfile", { provider: rolelessProvider, actor: actor({ role: null }) }).run({}, budget())
  const profile = (result.data as { profile: { role: unknown; gaps: string[] } }).profile
  assert.equal(profile.role, null)
  assert.ok(profile.gaps.some((gap) => gap.includes("No role/title is on file")))
  assert.match(result.summary, /no role on file/)
})

test("me_getMySvcContext returns the cross-module picture and never exposes internal ids", async () => {
  const result = await tool("me_getMySvcContext").run({}, budget())
  const context = (result.data as { context: SelfContextSnapshot }).context
  assert.equal(context.jobs.length, 1)
  assert.equal(context.projects[0]?.name, "Cool Breeze Rollout")
  assert.equal(context.clock?.jobName, "North Ridge")
  assert.equal(context.outlooks[0]?.activeToday, true)
  assert.ok(!JSON.stringify(result.data).includes("ctx-north-ridge"))
  assert.match(result.summary, /currently clocked in at North Ridge/)
  assert.notEqual(result.empty, true)
})

test("me_getMySvcContext marks itself empty — with the gaps intact — when nothing is on file", async () => {
  const result = await tool("me_getMySvcContext", { provider: emptyProvider() }).run({}, budget())
  assert.equal(result.empty, true)
  const context = (result.data as { context: SelfContextSnapshot }).context
  assert.ok(context.gaps.length > 0)
  assert.match(result.summary, /No SVC records are currently linked/)
})

test("me_getMySvcContext respects the shared retrieval budget", async () => {
  const shared = budget()
  await tool("me_getMySvcContext").run({}, shared)
  assert.ok(shared.remainingRecords < 60)

  const exhausted: SecretaryToolBudget = { ...budget(), remainingRecords: 0 }
  const result = await tool("me_getMySvcContext").run({}, exhausted)
  assert.equal(result.empty, true)
  assert.match(result.summary, /budget/)
})

test("me_getSecretaryGuide describes only the modules this sender's policy actually enabled", async () => {
  const narrow = await tool("me_getSecretaryGuide", { enabledModules: ["directory", "knowledge", "me"] }).run({}, budget())
  const capabilities = (narrow.data as { capabilities: string[] }).capabilities
  // `me` is dropped from the ordered profile — it describes the guide itself,
  // not something to suggest asking about.
  assert.equal(capabilities.length, 2)
  assert.ok(capabilities.some((line) => line.startsWith("SVC Directory")))
  assert.ok(!capabilities.some((line) => line.includes("Quest Coral —")), "a module that is off must not be advertised")

  const wide = await tool("me_getSecretaryGuide").run({}, budget())
  assert.equal((wide.data as { capabilities: string[] }).capabilities.length, 8)
})

test("me_getSecretaryGuide leads with what fits this person's role", async () => {
  const result = await tool("me_getSecretaryGuide").run({}, budget())
  const data = result.data as { capabilities: string[]; focus: string }
  // A Site Supervisor should see field work first, not the catalog's own order.
  assert.match(data.capabilities[0], /Daily Reports/)
  assert.match(data.focus, /For Site Supervisor work/)
})

test("me_getSecretaryGuide ships a real usage tutorial, including the exact draft command", async () => {
  const result = await tool("me_getSecretaryGuide").run({}, budget())
  const howToUse = (result.data as { howToUse: string[] }).howToUse
  assert.ok(howToUse.length >= 5)
  assert.ok(howToUse.some((line) => line.includes("CONFIRM DRAFT")))
  assert.ok(howToUse.some((line) => /follow-up/i.test(line)))
})

test("me_getSecretaryGuide's examples name only records the snapshot really returned", async () => {
  const result = await tool("me_getSecretaryGuide").run({}, budget())
  const examples = (result.data as { exampleQuestions: string[] }).exampleQuestions
  assert.ok(examples.some((example) => example.includes("North Ridge")))
  assert.ok(examples.some((example) => example.includes("Cool Breeze Rollout")))
  assert.ok(examples.length <= 5)
})

test("personalized examples fall back to capability examples — never invented records — when nothing is on file", () => {
  const bare: SelfContextSnapshot = {
    identity: { name: "Ben Acosta", role: null, hasLinkedAccount: false, recognizedVia: "directory-contact" },
    profile: null,
    jobs: [],
    companies: [],
    projects: [],
    reports: [],
    clock: null,
    outlooks: [],
    messages: null,
    application: null,
    gaps: ["No jobs are linked to them in the SVC Directory."],
  }
  const examples = buildPersonalizedExamples(bare)
  assert.ok(examples.length > 0)
  // Every fallback example is either a capability question or an explicit placeholder.
  assert.ok(examples.every((example) => example.includes("[a person's name]") || !/North Ridge|Cool Breeze/.test(example)))
  assert.ok(examples.some((example) => example.includes("Which jobs don't have a recent Daily Report?")))
})

test("personalized examples lead with what is live right now", () => {
  const snapshot: SelfContextSnapshot = {
    identity: { name: "Ben Acosta", role: "Site Supervisor", hasLinkedAccount: true, recognizedVia: "directory-contact" },
    profile: null,
    jobs: [{ name: "North Ridge", relationship: null, contextId: null }],
    companies: [],
    projects: [],
    reports: [],
    clock: { jobName: "North Ridge", clockInAt: "2026-08-14T12:00:00.000Z" },
    outlooks: [],
    messages: null,
    application: null,
    gaps: [],
  }
  assert.match(buildPersonalizedExamples(snapshot)[0], /clocked in at North Ridge/)
})

test("clears the shared snapshot cache between suites", () => {
  clearSelfContextSnapshotCache()
})
