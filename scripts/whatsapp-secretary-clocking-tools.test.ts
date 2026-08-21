import assert from "node:assert/strict"
import test from "node:test"
import { createClockingTools, type ClockHistoryEntry, type ClockingToolsProvider, type JobClockActivity, type MostActiveJobSummary } from "../lib/whatsapp-secretary/tools/clocking"
import type { SecretaryToolBudget } from "../lib/whatsapp-secretary/tool-registry"
import type { WhatsAppReportJob } from "../lib/whatsapp-reports"
import type { FanOutJob } from "../lib/whatsapp-secretary/tools/job-fanout"

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

function neverGetActivity(): Promise<JobClockActivity | null> {
  throw new Error("must not be called by clocking_getClockHistoryForJob")
}

test("Clocking tools are namespaced", () => {
  const tools = createClockingTools({
    provider: { getClockHistoryForJob: async () => [], getJobClockActivity: neverGetActivity },
    resolveJobsByName: fixtureJobResolver([]),
    listJobsProvider: async () => [],
  })
  const names = tools.map((tool) => tool.name)
  assert.deepEqual(names, ["clocking_getClockHistoryForJob", "clocking_getMostActiveJobs"])
  assert.ok(tools.every((tool) => tool.module === "clocking"))
})

test("clocking_getClockHistoryForJob resolves the job then lists history, never raw coordinates", async () => {
  const provider: ClockingToolsProvider = { getClockHistoryForJob: async () => [makeEntry()], getJobClockActivity: neverGetActivity }
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
  assert.equal(result.responseFormat?.kind, "timeline")
  assert.equal(result.responseFormat?.title, "Clock activity — North Ridge")
  assert.match(result.responseFormat?.kind === "timeline" ? result.responseFormat.items[0] ?? "" : "", /Alan Turner.*8h/)
})

test("clocking_getClockHistoryForJob reports ambiguity across matching jobs without guessing", async () => {
  const tools = createClockingTools({
    provider: {
      getClockHistoryForJob: async () => {
        throw new Error("must not be called when the job name is ambiguous")
      },
      getJobClockActivity: neverGetActivity,
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
      getJobClockActivity: neverGetActivity,
    },
    resolveJobsByName: fixtureJobResolver([]),
  })
  const getClockHistoryForJob = tools.find((tool) => tool.name === "clocking_getClockHistoryForJob")
  assert.ok(getClockHistoryForJob)

  const result = await getClockHistoryForJob.run({ jobName: "Unknown Job" }, budget())
  assert.equal(result.empty, true)
})

const fanOutJobs: FanOutJob[] = [
  { id: "job-north-ridge", name: "North Ridge", directoryContextId: "north-ridge" },
  { id: "job-appaloosa", name: "Appaloosa", directoryContextId: "appaloosa" },
  { id: "job-quiet", name: "Quiet Job", directoryContextId: "quiet" },
]

function activityFixture(overrides: Record<string, JobClockActivity | null>): (jobId: string) => Promise<JobClockActivity | null> {
  return async (jobId) => (jobId in overrides ? overrides[jobId]! : null)
}

test("clocking_getMostActiveJobs ranks currently-clocked-in worker count first, then most recent clock-in", async () => {
  const tools = createClockingTools({
    provider: {
      getClockHistoryForJob: async () => {
        throw new Error("must not be called by clocking_getMostActiveJobs")
      },
      getJobClockActivity: activityFixture({
        "job-north-ridge": { activeWorkerCount: 0, mostRecentClockInAt: "2026-08-12T08:00:00.000Z" },
        "job-appaloosa": { activeWorkerCount: 3, mostRecentClockInAt: "2026-08-13T07:00:00.000Z" },
        "job-quiet": { activeWorkerCount: 0, mostRecentClockInAt: "2026-08-01T08:00:00.000Z" },
      }),
    },
    listJobsProvider: async () => fanOutJobs,
  })
  const getMostActiveJobs = tools.find((tool) => tool.name === "clocking_getMostActiveJobs")
  assert.ok(getMostActiveJobs)

  const result = await getMostActiveJobs.run({}, budget())
  const data = result.data as { jobs?: MostActiveJobSummary[] }
  assert.equal(data.jobs?.[0]?.jobName, "Appaloosa")
  assert.equal(data.jobs?.[0]?.activeWorkerCount, 3)
  assert.equal(data.jobs?.[1]?.jobName, "North Ridge")
  assert.equal(data.jobs?.[2]?.jobName, "Quiet Job")
})

test("clocking_getMostActiveJobs reports nothing rather than guessing when no job has any clock activity", async () => {
  const tools = createClockingTools({
    provider: {
      getClockHistoryForJob: async () => {
        throw new Error("must not be called by clocking_getMostActiveJobs")
      },
      getJobClockActivity: async () => null,
    },
    listJobsProvider: async () => fanOutJobs,
  })
  const getMostActiveJobs = tools.find((tool) => tool.name === "clocking_getMostActiveJobs")
  assert.ok(getMostActiveJobs)

  const result = await getMostActiveJobs.run({}, budget())
  assert.equal(result.empty, true)
})
