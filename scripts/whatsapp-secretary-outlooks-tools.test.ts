import assert from "node:assert/strict"
import test from "node:test"
import { createFixtureProvider as createDirectoryFixtureProvider } from "./directory-fixture"
import { createOutlooksTools, type OutlookSummary, type OutlooksToolsProvider } from "../lib/whatsapp-secretary/tools/outlooks"
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
    ...overrides,
  }
}

test("Outlooks tools are namespaced", () => {
  const tools = createOutlooksTools({ provider: createFixtureProvider(), directoryProvider: createDirectoryFixtureProvider() })
  const names = tools.map((tool) => tool.name)
  assert.deepEqual(names, ["outlooks_getOutlookForJob"])
  assert.ok(tools.every((tool) => tool.module === "outlooks"))
})

test("outlooks_getOutlookForJob resolves the job via Directory and returns a real deep link", async () => {
  const tools = createOutlooksTools({ provider: createFixtureProvider(), directoryProvider: createDirectoryFixtureProvider() })
  const getOutlookForJob = tools.find((tool) => tool.name === "outlooks_getOutlookForJob")
  assert.ok(getOutlookForJob)

  const result = await getOutlookForJob.run({ jobName: "Appaloosa" }, budget())
  const data = result.data as { outlook?: Omit<OutlookSummary, "deepLink"> }
  assert.equal(data.outlook?.tasks[0]?.title, "Framing")
  assert.equal("deepLink" in (data.outlook ?? {}), false)
  const presentation = result.presentation as { deepLink?: string } | undefined
  assert.match(presentation?.deepLink ?? "", /\?directory=job__appaloosa&view=outlook$/)
})

test("outlooks_getOutlookForJob reports not-found when the job has no outlook yet", async () => {
  const tools = createOutlooksTools({
    provider: createFixtureProvider({ getOutlookForJob: async () => null }),
    directoryProvider: createDirectoryFixtureProvider(),
  })
  const getOutlookForJob = tools.find((tool) => tool.name === "outlooks_getOutlookForJob")
  assert.ok(getOutlookForJob)

  const result = await getOutlookForJob.run({ jobName: "Appaloosa" }, budget())
  assert.equal(result.empty, true)
})

test("outlooks_getOutlookForJob reports not-found for an unresolvable job name, never guessing", async () => {
  const tools = createOutlooksTools({ provider: createFixtureProvider(), directoryProvider: createDirectoryFixtureProvider() })
  const getOutlookForJob = tools.find((tool) => tool.name === "outlooks_getOutlookForJob")
  assert.ok(getOutlookForJob)

  const result = await getOutlookForJob.run({ jobName: "A Job That Does Not Exist" }, budget())
  assert.equal(result.empty, true)
})
