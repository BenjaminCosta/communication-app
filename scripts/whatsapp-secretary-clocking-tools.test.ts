import assert from "node:assert/strict"
import test from "node:test"
import { createClockingTools, type ClockHistoryEntry, type ClockingToolsProvider } from "../lib/whatsapp-secretary/tools/clocking"
import type { SecretaryToolBudget } from "../lib/whatsapp-secretary/tool-registry"
import type { WhatsAppReportJob } from "../lib/whatsapp-reports"

function budget(): SecretaryToolBudget {
  return { maxRecordsPerTool: 12, maxNotesPerTool: 0, maxNoteChars: 0, remainingRecords: 24 }
}

function makeEntry(overrides: Partial<ClockHistoryEntry> = {}): ClockHistoryEntry {
  return {
    userName: "Alan Turner",
    status: "closed",
    clockInAt: "2026-08-01T08:00:00.000Z",
    clockOutAt: "2026-08-01T16:00:00.000Z",
    durationMinutes: 480,
    hadClockInLocation: true,
    hadClockOutLocation: true,
    ...overrides,
  }
}

function fixtureJobResolver(jobs: WhatsAppReportJob[]): (name: string) => Promise<WhatsAppReportJob[]> {
  return async (name) => (name === "North Ridge" ? jobs : [])
}

test("Clocking tools are namespaced", () => {
  const tools = createClockingTools({
    provider: { getClockHistoryForJob: async () => [] },
    resolveJobsByName: fixtureJobResolver([]),
  })
  const names = tools.map((tool) => tool.name)
  assert.deepEqual(names, ["clocking_getClockHistoryForJob"])
  assert.ok(tools.every((tool) => tool.module === "clocking"))
})

test("clocking_getClockHistoryForJob resolves the job then lists history, never raw coordinates", async () => {
  const provider: ClockingToolsProvider = { getClockHistoryForJob: async () => [makeEntry()] }
  const tools = createClockingTools({
    provider,
    resolveJobsByName: fixtureJobResolver([{ id: "job-north-ridge", name: "North Ridge" }]),
  })
  const getClockHistoryForJob = tools.find((tool) => tool.name === "clocking_getClockHistoryForJob")
  assert.ok(getClockHistoryForJob)

  const sharedBudget = budget()
  const result = await getClockHistoryForJob.run({ jobName: "North Ridge", since: "2026-07-01" }, sharedBudget)
  const data = result.data as { history?: ClockHistoryEntry[] }
  assert.equal(data.history?.[0]?.userName, "Alan Turner")
  assert.equal(data.history?.[0]?.hadClockInLocation, true)
  assert.ok(!("clockInLocation" in (data.history?.[0] ?? {})))
  assert.ok(sharedBudget.remainingRecords < 24)
})

test("clocking_getClockHistoryForJob reports ambiguity across matching jobs without guessing", async () => {
  const tools = createClockingTools({
    provider: {
      getClockHistoryForJob: async () => {
        throw new Error("must not be called when the job name is ambiguous")
      },
    },
    resolveJobsByName: fixtureJobResolver([
      { id: "job-a", name: "North Ridge A" },
      { id: "job-b", name: "North Ridge B" },
    ]),
  })
  const getClockHistoryForJob = tools.find((tool) => tool.name === "clocking_getClockHistoryForJob")
  assert.ok(getClockHistoryForJob)

  const result = await getClockHistoryForJob.run({ jobName: "North Ridge" }, budget())
  const data = result.data as { candidates?: Array<{ name: string }> }
  assert.equal(data.candidates?.length, 2)
})

test("clocking_getClockHistoryForJob reports not-found rather than guessing when no job matches", async () => {
  const tools = createClockingTools({
    provider: {
      getClockHistoryForJob: async () => {
        throw new Error("must not be called when the job name does not resolve")
      },
    },
    resolveJobsByName: fixtureJobResolver([]),
  })
  const getClockHistoryForJob = tools.find((tool) => tool.name === "clocking_getClockHistoryForJob")
  assert.ok(getClockHistoryForJob)

  const result = await getClockHistoryForJob.run({ jobName: "Unknown Job" }, budget())
  assert.equal(result.empty, true)
})
