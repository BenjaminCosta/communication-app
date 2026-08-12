import assert from "node:assert/strict"
import test from "node:test"
import { createFixtureProvider as createDirectoryFixtureProvider } from "./directory-fixture"
import { createApplicationsTools, type ApplicationSummary, type ApplicationsToolsProvider } from "../lib/whatsapp-secretary/tools/applications"
import type { SecretaryToolBudget } from "../lib/whatsapp-secretary/tool-registry"

function budget(): SecretaryToolBudget {
  return { maxRecordsPerTool: 12, maxNotesPerTool: 0, maxNoteChars: 0, remainingRecords: 24 }
}

function makeApplication(overrides: Partial<ApplicationSummary> = {}): ApplicationSummary {
  return {
    candidateName: "Jane Rivera",
    trade: "Electrician",
    jobName: "North Ridge",
    jobLocation: "Newark, NJ",
    companyName: "74 Construction",
    status: "submitted",
    agreementStatus: null,
    pendingRequest: null,
    submittedAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  }
}

function createFixtureProvider(overrides: Partial<ApplicationsToolsProvider> = {}): ApplicationsToolsProvider {
  return {
    async findCandidatesByName(query) {
      return query === "Jane Rivera" ? [makeApplication()] : []
    },
    async getReviewQueue(limitPerStatus) {
      return {
        draft: { count: 0, recent: [] },
        submitted: { count: 3, recent: [makeApplication()].slice(0, limitPerStatus) },
        ready_for_review: { count: 1, recent: [makeApplication({ status: "ready_for_review" })].slice(0, limitPerStatus) },
        needs_information: { count: 2, recent: [makeApplication({ status: "needs_information", pendingRequest: "Upload a photo ID" })].slice(0, limitPerStatus) },
        approved: { count: 0, recent: [] },
        agreement_pending: { count: 0, recent: [] },
        payroll_in_progress: { count: 0, recent: [] },
        hired: { count: 0, recent: [] },
        archived: { count: 0, recent: [] },
      }
    },
    async getApplicationsForJob() {
      return [makeApplication()]
    },
    ...overrides,
  }
}

test("Applications tools are namespaced", () => {
  const tools = createApplicationsTools({ provider: createFixtureProvider(), directoryProvider: createDirectoryFixtureProvider() })
  const names = tools.map((tool) => tool.name)
  assert.deepEqual(names, ["applications_searchCandidates", "applications_getReviewQueue", "applications_getApplicationsForJob"])
  assert.ok(tools.every((tool) => tool.module === "applications"))
})

test("applications_searchCandidates finds an exact candidate", async () => {
  const tools = createApplicationsTools({ provider: createFixtureProvider(), directoryProvider: createDirectoryFixtureProvider() })
  const searchCandidates = tools.find((tool) => tool.name === "applications_searchCandidates")
  assert.ok(searchCandidates)

  const result = await searchCandidates.run({ query: "Jane Rivera" }, budget())
  const data = result.data as { applications?: ApplicationSummary[] }
  assert.equal(data.applications?.[0]?.candidateName, "Jane Rivera")
})

test("applications_getReviewQueue lists needs_information, not just a count (fixes the old gap)", async () => {
  const tools = createApplicationsTools({ provider: createFixtureProvider(), directoryProvider: createDirectoryFixtureProvider() })
  const getReviewQueue = tools.find((tool) => tool.name === "applications_getReviewQueue")
  assert.ok(getReviewQueue)

  const result = await getReviewQueue.run({}, budget())
  const data = result.data as { needsInformation?: { count: number; recent: ApplicationSummary[] } }
  assert.equal(data.needsInformation?.count, 2)
  assert.equal(data.needsInformation?.recent.length, 1)
  assert.match(data.needsInformation?.recent[0]?.pendingRequest ?? "", /Upload a photo ID/)
})

test("applications_getApplicationsForJob resolves the job via Directory then lists applications", async () => {
  const tools = createApplicationsTools({ provider: createFixtureProvider(), directoryProvider: createDirectoryFixtureProvider() })
  const getApplicationsForJob = tools.find((tool) => tool.name === "applications_getApplicationsForJob")
  assert.ok(getApplicationsForJob)

  const result = await getApplicationsForJob.run({ jobName: "Appaloosa" }, budget())
  const data = result.data as { applications?: ApplicationSummary[] }
  assert.equal(data.applications?.[0]?.candidateName, "Jane Rivera")
})

test("applications_getApplicationsForJob reports not-found rather than guessing when no job matches", async () => {
  const tools = createApplicationsTools({
    provider: createFixtureProvider({
      getApplicationsForJob: async () => {
        throw new Error("must not be called when the job name does not resolve")
      },
    }),
    directoryProvider: createDirectoryFixtureProvider(),
  })
  const getApplicationsForJob = tools.find((tool) => tool.name === "applications_getApplicationsForJob")
  assert.ok(getApplicationsForJob)

  const result = await getApplicationsForJob.run({ jobName: "A Job That Does Not Exist In Directory" }, budget())
  assert.equal(result.empty, true)
})
