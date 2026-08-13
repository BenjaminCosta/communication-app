import assert from "node:assert/strict"
import test from "node:test"
import { createReportsTools, type DailyReportSummary, type ReportsToolsProvider, type StaleJobReportSummary } from "../lib/whatsapp-secretary/tools/reports"
import type { SecretaryToolBudget } from "../lib/whatsapp-secretary/tool-registry"
import type { WhatsAppReportJob } from "../lib/whatsapp-reports"
import type { FanOutJob } from "../lib/whatsapp-secretary/tools/job-fanout"

function budget(): SecretaryToolBudget {
  return { maxRecordsPerTool: 12, maxNotesPerTool: 0, maxNoteChars: 0, remainingRecords: 24 }
}

function makeReport(overrides: Partial<DailyReportSummary> = {}): DailyReportSummary {
  return {
    jobId: "job-north-ridge",
    jobName: "North Ridge",
    status: "submitted",
    createdAt: "2026-08-01T00:00:00.000Z",
    submittedAt: "2026-08-01T01:00:00.000Z",
    workCompleted: "Installed framing.",
    issuesOrDelays: null,
    nextSteps: "Finish east wall.",
    ...overrides,
  }
}

function createFixtureProvider(overrides: Partial<ReportsToolsProvider> = {}): ReportsToolsProvider {
  return {
    async getReportsForJob() {
      return { reports: [makeReport()], nextCursor: null }
    },
    async getRecentReports() {
      return [makeReport(), makeReport({ jobId: "job-warehouse", jobName: "Warehouse Expansion" })]
    },
    async getReportsByAuthor() {
      return [makeReport()]
    },
    async getMostRecentReportDateForJob() {
      return makeReport().createdAt
    },
    ...overrides,
  }
}

function fixtureJobResolver(jobs: WhatsAppReportJob[]): (name: string) => Promise<WhatsAppReportJob[]> {
  return async (name) => (name === "North Ridge" ? jobs : [])
}

test("Reports tools are namespaced", () => {
  const tools = createReportsTools({ provider: createFixtureProvider(), resolveJobsByName: fixtureJobResolver([]) })
  const names = tools.map((tool) => tool.name)
  assert.deepEqual(names, [
    "reports_searchDailyReportsForJob",
    "reports_getRecentDailyReports",
    "reports_getDailyReportsByAuthor",
    "reports_getJobsWithoutRecentReports",
  ])
  assert.ok(tools.every((tool) => tool.module === "reports"))
})

test("reports_searchDailyReportsForJob resolves the job then lists reports with a cursor", async () => {
  const tools = createReportsTools({
    provider: createFixtureProvider(),
    resolveJobsByName: fixtureJobResolver([{ id: "job-north-ridge", name: "North Ridge" }]),
  })
  const searchDailyReportsForJob = tools.find((tool) => tool.name === "reports_searchDailyReportsForJob")
  assert.ok(searchDailyReportsForJob)

  const sharedBudget = budget()
  const result = await searchDailyReportsForJob.run({ jobName: "North Ridge", since: "2026-07-01" }, sharedBudget)
  const data = result.data as { reports?: DailyReportSummary[] }
  assert.equal(data.reports?.[0]?.jobName, "North Ridge")
  assert.ok(sharedBudget.remainingRecords < 24)
})

test("reports_searchDailyReportsForJob reports ambiguity across matching jobs without guessing", async () => {
  const tools = createReportsTools({
    provider: createFixtureProvider({
      getReportsForJob: async () => {
        throw new Error("must not be called when the job name is ambiguous")
      },
    }),
    resolveJobsByName: fixtureJobResolver([
      { id: "job-a", name: "North Ridge A" },
      { id: "job-b", name: "North Ridge B" },
    ]),
  })
  const searchDailyReportsForJob = tools.find((tool) => tool.name === "reports_searchDailyReportsForJob")
  assert.ok(searchDailyReportsForJob)

  const result = await searchDailyReportsForJob.run({ jobName: "North Ridge" }, budget())
  const data = result.data as { candidates?: Array<{ name: string }> }
  assert.equal(data.candidates?.length, 2)
})

test("reports_getRecentDailyReports lists across jobs", async () => {
  const tools = createReportsTools({ provider: createFixtureProvider(), resolveJobsByName: fixtureJobResolver([]) })
  const getRecentDailyReports = tools.find((tool) => tool.name === "reports_getRecentDailyReports")
  assert.ok(getRecentDailyReports)

  const result = await getRecentDailyReports.run({}, budget())
  const data = result.data as { reports?: DailyReportSummary[] }
  assert.equal(data.reports?.length, 2)
})

test("reports_getDailyReportsByAuthor refuses to guess when the person cannot be resolved to a linked user", async () => {
  const tools = createReportsTools({
    provider: createFixtureProvider({
      getReportsByAuthor: async () => {
        throw new Error("must not be called when the author cannot be resolved")
      },
    }),
    resolveJobsByName: fixtureJobResolver([]),
    resolveAuthorIdByName: async () => null,
  })
  const getDailyReportsByAuthor = tools.find((tool) => tool.name === "reports_getDailyReportsByAuthor")
  assert.ok(getDailyReportsByAuthor)

  const result = await getDailyReportsByAuthor.run({ personName: "Unlinked Person" }, budget())
  assert.equal(result.empty, true)
})

test("reports_getDailyReportsByAuthor lists reports once the person resolves to a linked user", async () => {
  const tools = createReportsTools({
    provider: createFixtureProvider(),
    resolveJobsByName: fixtureJobResolver([]),
    resolveAuthorIdByName: async (name) => (name === "John DeMarco" ? "user-jdemarco" : null),
  })
  const getDailyReportsByAuthor = tools.find((tool) => tool.name === "reports_getDailyReportsByAuthor")
  assert.ok(getDailyReportsByAuthor)

  const result = await getDailyReportsByAuthor.run({ personName: "John DeMarco" }, budget())
  const data = result.data as { reports?: DailyReportSummary[] }
  assert.equal(data.reports?.length, 1)
})

function makeJob(overrides: Partial<FanOutJob> = {}): FanOutJob {
  return { id: "job-fresh", name: "Fresh Job", directoryContextId: null, ...overrides }
}

test("reports_getJobsWithoutRecentReports lists only stale/report-less jobs, oldest/none first", async () => {
  const now = Date.now()
  const fresh = makeJob({ id: "job-fresh", name: "Fresh Job" })
  const stale = makeJob({ id: "job-stale", name: "Stale Job" })
  const never = makeJob({ id: "job-never", name: "Never Reported Job" })
  const datesByJobId: Record<string, string | null> = {
    "job-fresh": new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString(),
    "job-stale": new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString(),
    "job-never": null,
  }

  const tools = createReportsTools({
    provider: createFixtureProvider({
      getMostRecentReportDateForJob: async (jobId) => datesByJobId[jobId] ?? null,
    }),
    resolveJobsByName: fixtureJobResolver([]),
    listJobsProvider: async () => [fresh, stale, never],
  })
  const getJobsWithoutRecentReports = tools.find((tool) => tool.name === "reports_getJobsWithoutRecentReports")
  assert.ok(getJobsWithoutRecentReports)

  const result = await getJobsWithoutRecentReports.run({ withinDays: 14 }, budget())
  const data = result.data as { jobs?: StaleJobReportSummary[] }
  assert.deepEqual(
    data.jobs?.map((job) => job.jobName),
    ["Never Reported Job", "Stale Job"],
  )
  assert.equal(data.jobs?.[0]?.mostRecentReportAt, null)
})

test("reports_getJobsWithoutRecentReports reports every job is current, without guessing at cadence", async () => {
  const tools = createReportsTools({
    provider: createFixtureProvider({
      getMostRecentReportDateForJob: async () => new Date().toISOString(),
    }),
    resolveJobsByName: fixtureJobResolver([]),
    listJobsProvider: async () => [makeJob()],
  })
  const getJobsWithoutRecentReports = tools.find((tool) => tool.name === "reports_getJobsWithoutRecentReports")
  assert.ok(getJobsWithoutRecentReports)

  const result = await getJobsWithoutRecentReports.run({}, budget())
  assert.equal(result.empty, true)
  assert.doesNotMatch(result.summary, /missing|required/i)
})

test("reports_getJobsWithoutRecentReports reports nothing rather than guessing when there are no active jobs", async () => {
  const tools = createReportsTools({
    provider: createFixtureProvider({
      getMostRecentReportDateForJob: async () => {
        throw new Error("must not be called when there are no active jobs")
      },
    }),
    resolveJobsByName: fixtureJobResolver([]),
    listJobsProvider: async () => [],
  })
  const getJobsWithoutRecentReports = tools.find((tool) => tool.name === "reports_getJobsWithoutRecentReports")
  assert.ok(getJobsWithoutRecentReports)

  const result = await getJobsWithoutRecentReports.run({}, budget())
  assert.equal(result.empty, true)
})
