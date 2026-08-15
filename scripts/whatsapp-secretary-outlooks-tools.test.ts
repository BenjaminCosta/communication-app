import assert from "node:assert/strict"
import test from "node:test"
import { createFixtureProvider as createDirectoryFixtureProvider } from "./directory-fixture"
import { createOutlooksTools, type ActiveOutlookSummary, type OutlookSummary, type OutlooksToolsProvider } from "../lib/whatsapp-secretary/tools/outlooks"
import type { FanOutJob } from "../lib/whatsapp-secretary/tools/job-fanout"
import type { SecretaryToolBudget } from "../lib/whatsapp-secretary/tool-registry"

function budget(): SecretaryToolBudget {
  return { maxRecordsPerTool: 12, maxNotesPerTool: 0, maxNoteChars: 0, remainingRecords: 24 }
}

function createFixtureProvider(overrides: Partial<OutlooksToolsProvider> = {}): OutlooksToolsProvider {
  return {
    async getOutlookForJob(jobId, windowStart) {
      if (jobId !== "appaloosa") return null
      return {
        windowStart: windowStart ?? "2026-08-03",
        windowEnd: "2026-08-23",
        tasks: [
          { title: "Framing", trade: "Carpentry", companyName: "74 Construction", startDate: "2026-08-03", durationDays: 5, endDate: "2026-08-07", status: "in_progress", completionPercent: 40 },
        ],
      }
    },
    async getMostRecentOutlookWindow(jobId) {
      if (jobId === "appaloosa") return { windowStart: "2026-08-03", windowEnd: "2026-08-23", taskCount: 3 }
      if (jobId === "warehouse") return { windowStart: "2026-06-01", windowEnd: "2026-06-21", taskCount: 2 }
      return null
    },
    ...overrides,
  }
}

const activeJobs: FanOutJob[] = [
  { id: "job-appaloosa", name: "Appaloosa", directoryContextId: "appaloosa" },
  { id: "job-warehouse", name: "Warehouse Expansion", directoryContextId: "warehouse" },
  { id: "job-unlinked", name: "Unlinked Job", directoryContextId: null },
  { id: "job-nooutlook", name: "No Outlook Job", directoryContextId: "no-outlook" },
]

test("Outlooks tools are namespaced", () => {
  const tools = createOutlooksTools({ provider: createFixtureProvider(), directoryProvider: createDirectoryFixtureProvider() })
  const names = tools.map((tool) => tool.name)
  assert.deepEqual(names, ["outlooks_get"])
  assert.ok(tools.every((tool) => tool.module === "outlooks"))
})

test("outlooks_get resolves the job via Directory and returns a real deep link", async () => {
  const tools = createOutlooksTools({ provider: createFixtureProvider(), directoryProvider: createDirectoryFixtureProvider() })
  const getOutlookForJob = tools.find((tool) => tool.name === "outlooks_get")
  assert.ok(getOutlookForJob)

  const result = await getOutlookForJob.run({ jobName: "Appaloosa" }, budget())
  const data = result.data as { outlook?: Omit<OutlookSummary, "deepLink"> }
  assert.equal(data.outlook?.tasks[0]?.title, "Framing")
  assert.equal("deepLink" in (data.outlook ?? {}), false)
  const presentation = result.presentation as { deepLink?: string } | undefined
  assert.match(presentation?.deepLink ?? "", /\?directory=job__appaloosa&view=outlook$/)
})

test("outlooks_get reports not-found when the job has no outlook yet", async () => {
  const tools = createOutlooksTools({
    provider: createFixtureProvider({ getOutlookForJob: async () => null }),
    directoryProvider: createDirectoryFixtureProvider(),
  })
  const getOutlookForJob = tools.find((tool) => tool.name === "outlooks_get")
  assert.ok(getOutlookForJob)

  const result = await getOutlookForJob.run({ jobName: "Appaloosa" }, budget())
  assert.equal(result.empty, true)
})

test("outlooks_get reports not-found for an unresolvable job name, never guessing", async () => {
  const tools = createOutlooksTools({ provider: createFixtureProvider(), directoryProvider: createDirectoryFixtureProvider() })
  const getOutlookForJob = tools.find((tool) => tool.name === "outlooks_get")
  assert.ok(getOutlookForJob)

  const result = await getOutlookForJob.run({ jobName: "A Job That Does Not Exist" }, budget())
  assert.equal(result.empty, true)
})

test("outlooks_get returns only jobs whose window covers the given date, skipping unlinked/outlook-less jobs", async () => {
  const tools = createOutlooksTools({
    provider: createFixtureProvider(),
    directoryProvider: createDirectoryFixtureProvider(),
    listJobsProvider: async () => activeJobs,
  })
  const listActiveOutlooks = tools.find((tool) => tool.name === "outlooks_get")
  assert.ok(listActiveOutlooks)

  const result = await listActiveOutlooks.run({ onDate: "2026-08-13" }, budget())
  const data = result.data as { outlooks?: Array<Omit<ActiveOutlookSummary, "deepLink">> }
  assert.equal(data.outlooks?.length, 1)
  assert.equal(data.outlooks?.[0]?.jobName, "Appaloosa")
  const presentation = result.presentation as { deepLinks?: Array<{ jobName: string; deepLink: string }> } | undefined
  assert.equal(presentation?.deepLinks?.[0]?.jobName, "Appaloosa")
})

test("outlooks_get defaults to today and reports none active without guessing", async () => {
  const tools = createOutlooksTools({
    provider: createFixtureProvider(),
    directoryProvider: createDirectoryFixtureProvider(),
    listJobsProvider: async () => activeJobs,
  })
  const listActiveOutlooks = tools.find((tool) => tool.name === "outlooks_get")
  assert.ok(listActiveOutlooks)

  // Warehouse's window (Jun 1-21) and Appaloosa's (Aug 3-23) both miss this date.
  const result = await listActiveOutlooks.run({ onDate: "2026-12-25" }, budget())
  assert.equal(result.empty, true)
})
