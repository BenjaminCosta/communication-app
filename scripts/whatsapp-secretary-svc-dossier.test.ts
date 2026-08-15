import assert from "node:assert/strict"
import test from "node:test"
import { buildDossier, createSvcTools, type Dossier, type DossierSources } from "../lib/whatsapp-secretary/tools/svc"
import type { SecretaryToolBudget } from "../lib/whatsapp-secretary/tool-registry"
import { directoryRecord, fixtureResolver } from "./secretary-test-resolver"

const TODAY = "2026-08-14"

function budget(): SecretaryToolBudget {
  return { maxRecordsPerTool: 15, maxNotesPerTool: 5, maxNoteChars: 400, remainingRecords: 60 }
}

function sources(overrides: Partial<DossierSources> = {}): DossierSources {
  return {
    async getOutlook() {
      return { windowStart: "2026-08-10", windowEnd: "2026-08-31", taskCount: 4, activeToday: true }
    },
    async getReports() {
      return [{ status: "submitted", createdAt: "2026-08-13T00:00:00.000Z", workCompleted: "Framing" }]
    },
    async getReportsByAuthor() {
      return [{ status: "submitted", createdAt: "2026-08-12T00:00:00.000Z", workCompleted: "Punch list" }]
    },
    async getClockActivity() {
      return { activeWorkerCount: 3, mostRecentClockInAt: "2026-08-14T11:00:00.000Z" }
    },
    async getOperationalMessages() {
      return [{ category: "outlook", authorName: "Jordan Blake", text: "Outlook published", createdAt: "2026-08-10T00:00:00.000Z" }]
    },
    async getApplications() {
      return [{ candidateName: "Dana Reyes", status: "submitted", updatedAt: "2026-08-01T00:00:00.000Z" }]
    },
    async getRelated() {
      return [{ name: "Turner", type: "company", relation: "Client" }]
    },
    async getProject() {
      return { status: "in_progress", progress: 60, ownerName: "Maya Lin", nextStep: "Draft the plan", recentUpdate: "Kickoff done" }
    },
    ...overrides,
  }
}

const linkedJob = {
  jobs: [directoryRecord({ name: "North Ridge", type: "job", sourceId: "ctx-north-ridge", id: "job__north-ridge" })],
  linkedJobs: { "ctx-north-ridge": { id: "job-nr", name: "North Ridge" } },
}

const ALL_MODULES = ["directory", "questCoral", "applications", "reports", "clocking", "outlooks", "messages", "me", "svc", "knowledge"] as const

function tools(deps: { sources?: DossierSources; enabledModules?: readonly string[] } = {}) {
  return createSvcTools({
    resolver: fixtureResolver(linkedJob),
    sources: deps.sources ?? sources(),
    today: TODAY,
    enabledModules: [...(deps.enabledModules ?? ALL_MODULES)] as never,
  })
}

function dossierTool(deps: Parameters<typeof tools>[0] = {}) {
  const tool = tools(deps).find((entry) => entry.name === "svc_getEntityDossier")
  assert.ok(tool)
  return tool
}

test("the dossier is one tool in its own module", () => {
  const all = tools()
  assert.deepEqual(all.map((tool) => tool.name), ["svc_getEntityDossier"])
  assert.ok(all.every((tool) => tool.module === "svc"))
})

test("one call assembles every section for a job", async () => {
  const result = await dossierTool().run({ name: "North Ridge" }, budget())
  const { dossier } = result.data as { dossier: Dossier }

  assert.equal(dossier.outlook?.activeToday, true)
  assert.equal(dossier.reports.length, 1)
  assert.equal(dossier.clocking?.activeWorkerCount, 3)
  assert.equal(dossier.messages.length, 1)
  assert.equal(dossier.applications.length, 1)
  assert.equal(dossier.related.length, 1)
  assert.match(result.summary, /Cross-module dossier for "North Ridge" \(job\)/)
  // Every section is a bounded slice by construction, and says so.
  assert.equal(result.truncated, true)
})

test("never exposes an internal id to the model", async () => {
  const result = await dossierTool().run({ name: "North Ridge" }, budget())
  const serialized = JSON.stringify(result.data)
  assert.ok(!serialized.includes("ctx-north-ridge"))
  assert.ok(!serialized.includes("job-nr"))
  assert.ok(!serialized.includes("job__north-ridge"))
})

test("a section whose module this sender cannot reach is dropped before any query runs", async () => {
  let clockingQueried = false
  let reportsQueried = false
  const tool = dossierTool({
    enabledModules: ["directory", "outlooks"],
    sources: sources({
      async getClockActivity() {
        clockingQueried = true
        return null
      },
      async getReports() {
        reportsQueried = true
        return []
      },
    }),
  })

  const result = await tool.run({ name: "North Ridge" }, budget())
  const { dossier } = result.data as { dossier: Dossier }

  assert.equal(clockingQueried, false, "permission is enforced in code, before the read")
  assert.equal(reportsQueried, false)
  assert.equal(dossier.clocking, null)
  assert.deepEqual(dossier.reports, [])
  // The permitted sections still work.
  assert.equal(dossier.outlook?.activeToday, true)
  assert.equal(dossier.related.length, 1)
})

test("one broken section degrades to empty instead of blanking the dossier", async () => {
  const result = await dossierTool({
    sources: sources({
      async getOutlook() {
        throw new Error("Firestore unavailable")
      },
      async getReports() {
        throw new Error("Firestore unavailable")
      },
    }),
  }).run({ name: "North Ridge" }, budget())

  const { dossier } = result.data as { dossier: Dossier }
  assert.equal(dossier.outlook, null)
  assert.deepEqual(dossier.reports, [])
  assert.equal(dossier.clocking?.activeWorkerCount, 3, "the other sections survived")
})

test("distinguishes 'nothing on file' from 'this record cannot have that'", async () => {
  const empty = sources({
    async getOutlook() {
      return null
    },
    async getReports() {
      return []
    },
    async getClockActivity() {
      return null
    },
    async getOperationalMessages() {
      return []
    },
    async getApplications() {
      return []
    },
    async getRelated() {
      return []
    },
  })

  // A job with every id: empty sections are genuinely empty.
  const withIds = await buildDossier(
    { ref: "e1", kind: "job", name: "North Ridge", sourceIds: { directoryId: "job__x", contextId: "ctx-x", byeByeDprJobId: "job-x" }, meta: {} },
    ["outlook", "reports", "clocking", "messages", "applications", "relationships"],
    empty,
    TODAY,
  )
  assert.ok(withIds.emptySections.some((entry) => entry.includes("no 3-Week Outlook")))
  assert.deepEqual(withIds.unavailableSections, [])

  // A job with no ByeByeDPR link: reports/clocking are unavailable, not empty.
  const withoutIds = await buildDossier(
    { ref: "e2", kind: "job", name: "Unlinked Job", sourceIds: { directoryId: "job__y" }, meta: {} },
    ["outlook", "reports", "clocking"],
    empty,
    TODAY,
  )
  assert.ok(withoutIds.unavailableSections.some((entry) => entry.startsWith("reports:")))
  assert.ok(withoutIds.unavailableSections.some((entry) => entry.startsWith("clocking:")))
  assert.ok(!withoutIds.emptySections.some((entry) => entry.includes("Daily Reports")))
})

test("a person's reports come from their linked account, not from a job id", async () => {
  const dossier = await buildDossier(
    { ref: "e1", kind: "person", name: "Courtney Roberts", sourceIds: { directoryId: "person__c", linkedUserId: "user-c" }, meta: {} },
    ["reports", "relationships"],
    sources(),
    TODAY,
  )
  assert.equal(dossier.reports[0]?.workCompleted, "Punch list", "used getReportsByAuthor, not getReports")
})

test("reports emptiness plainly when a real record simply has nothing", async () => {
  const result = await dossierTool({
    sources: sources({
      async getOutlook() {
        return null
      },
      async getReports() {
        return []
      },
      async getClockActivity() {
        return null
      },
      async getOperationalMessages() {
        return []
      },
      async getApplications() {
        return []
      },
      async getRelated() {
        return []
      },
    }),
  }).run({ name: "North Ridge" }, budget())

  assert.equal(result.empty, true)
  assert.match(result.summary, /Nothing is currently on file for "North Ridge"/)
})

test("refuses to guess when the name resolves to nothing or to several records", async () => {
  const notFound = await createSvcTools({
    resolver: fixtureResolver({ jobs: [] }),
    sources: sources(),
    today: TODAY,
  })[0].run({ name: "Nowhere" }, budget())
  assert.equal(notFound.empty, true)
  assert.match(notFound.summary, /No job matches "Nowhere"/)

  const ambiguous = await createSvcTools({
    resolver: fixtureResolver({
      jobs: [
        directoryRecord({ name: "North Ridge", type: "job" }),
        directoryRecord({ name: "North Ridge Tower", type: "job" }),
      ],
    }),
    sources: sources(),
    today: TODAY,
  })[0].run({ name: "North Ridge", kind: "job" }, budget())
  assert.match(ambiguous.summary, /More than one job matches/)
})

test("spends from the shared budget and stops when it is exhausted", async () => {
  const shared = budget()
  await dossierTool().run({ name: "North Ridge" }, shared)
  assert.ok(shared.remainingRecords < 60)

  const exhausted: SecretaryToolBudget = { ...budget(), remainingRecords: 0 }
  const result = await dossierTool().run({ name: "North Ridge" }, exhausted)
  assert.equal(result.empty, true)
  assert.match(result.summary, /budget/)
})

test("accepts a ref from an earlier tool instead of a name", async () => {
  const resolver = fixtureResolver(linkedJob)
  const first = await resolver.resolve("North Ridge", "job")
  assert.equal(first.status, "found")
  if (first.status !== "found") return

  const tool = createSvcTools({ resolver, sources: sources(), today: TODAY })[0]
  const result = await tool.run({ ref: first.entity.ref }, budget())
  assert.match(result.summary, /North Ridge/)
})
