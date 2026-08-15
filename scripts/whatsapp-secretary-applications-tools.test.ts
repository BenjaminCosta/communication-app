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
    phone: null,
    email: null,
    cityState: null,
    yearsExperience: null,
    workReference: null,
    resumeFileName: null,
    videoState: null,
    documents: [],
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
    async listAllApplications(options) {
      const all = [makeApplication(), makeApplication({ candidateName: "Alex Kim", status: "draft" })]
      return options.status ? all.filter((application) => application.status === options.status) : all
    },
    ...overrides,
  }
}

test("Applications tools are namespaced", () => {
  const tools = createApplicationsTools({ provider: createFixtureProvider(), directoryProvider: createDirectoryFixtureProvider() })
  const names = tools.map((tool) => tool.name)
  assert.deepEqual(names, ["applications_search", "applications_getReviewQueue"])
  assert.ok(tools.every((tool) => tool.module === "applications"))
})

test("applications_search finds an exact candidate", async () => {
  const tools = createApplicationsTools({ provider: createFixtureProvider(), directoryProvider: createDirectoryFixtureProvider() })
  const searchCandidates = tools.find((tool) => tool.name === "applications_search")
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

test("applications_search resolves the job via Directory then lists applications", async () => {
  const tools = createApplicationsTools({ provider: createFixtureProvider(), directoryProvider: createDirectoryFixtureProvider() })
  const getApplicationsForJob = tools.find((tool) => tool.name === "applications_search")
  assert.ok(getApplicationsForJob)

  const result = await getApplicationsForJob.run({ jobName: "Appaloosa" }, budget())
  const data = result.data as { applications?: ApplicationSummary[] }
  assert.equal(data.applications?.[0]?.candidateName, "Jane Rivera")
})

test("applications_search reports not-found rather than guessing when no job matches", async () => {
  const tools = createApplicationsTools({
    provider: createFixtureProvider({
      getApplicationsForJob: async () => {
        throw new Error("must not be called when the job name does not resolve")
      },
    }),
    directoryProvider: createDirectoryFixtureProvider(),
  })
  const getApplicationsForJob = tools.find((tool) => tool.name === "applications_search")
  assert.ok(getApplicationsForJob)

  const result = await getApplicationsForJob.run({ jobName: "A Job That Does Not Exist In Directory" }, budget())
  assert.equal(result.empty, true)
})

test("applications_search falls back to keyword search when the exact/prefix name lookup finds nothing", async () => {
  const rivera = makeApplication()
  const tools = createApplicationsTools({
    // "Rivera" alone matches nothing in the fixture via exact/prefix — the
    // fixture only exact-matches the full "Jane Rivera".
    provider: createFixtureProvider(),
    directoryProvider: createDirectoryFixtureProvider(),
    keywordSearchProvider: async (tokens, limit) => {
      assert.ok(tokens.includes("rivera"))
      assert.equal(limit, 12)
      return [rivera]
    },
  })
  const searchCandidates = tools.find((tool) => tool.name === "applications_search")
  assert.ok(searchCandidates)

  const result = await searchCandidates.run({ query: "Rivera" }, budget())
  const data = result.data as { applications?: ApplicationSummary[] }
  assert.ok(data.applications?.some((application) => application.candidateName === "Jane Rivera"))
})

test("never calls the Applications keyword fallback when the exact/prefix lookup already found a match", async () => {
  const tools = createApplicationsTools({
    provider: createFixtureProvider(),
    directoryProvider: createDirectoryFixtureProvider(),
    keywordSearchProvider: async () => {
      throw new Error("must not be called when the exact/prefix lookup already found a match")
    },
  })
  const searchCandidates = tools.find((tool) => tool.name === "applications_search")
  assert.ok(searchCandidates)

  const result = await searchCandidates.run({ query: "Jane Rivera" }, budget())
  const data = result.data as { applications?: ApplicationSummary[] }
  assert.equal(data.applications?.length, 1)
})

test("applications_search reports no match without guessing, even after the keyword fallback", async () => {
  const tools = createApplicationsTools({
    provider: createFixtureProvider(),
    directoryProvider: createDirectoryFixtureProvider(),
    keywordSearchProvider: async () => [],
  })
  const searchCandidates = tools.find((tool) => tool.name === "applications_search")
  assert.ok(searchCandidates)

  const result = await searchCandidates.run({ query: "Nonexistent Candidate" }, budget())
  assert.equal(result.empty, true)
})

// --- Enriched candidate details (2026-08-14): phone/email/experience/
// documents/video status, same sharing treatment as Directory contact info. ---

test("applications_search surfaces the candidate's contact and document/video details", async () => {
  const tools = createApplicationsTools({
    provider: createFixtureProvider({
      async findCandidatesByName() {
        return [
          makeApplication({
            phone: "+1 555-0142",
            email: "jane.rivera@example.com",
            cityState: "Newark, NJ",
            yearsExperience: "6",
            workReference: "Mike Torres, 555-0199",
            resumeFileName: "jane-rivera-resume.pdf",
            videoState: "ready",
            documents: [{ label: "Photo ID", status: "verified", required: true }, { label: "Certification", status: "missing", required: true }],
          }),
        ]
      },
    }),
    directoryProvider: createDirectoryFixtureProvider(),
  })
  const searchCandidates = tools.find((tool) => tool.name === "applications_search")
  assert.ok(searchCandidates)

  const result = await searchCandidates.run({ query: "Jane Rivera" }, budget())
  const data = result.data as { applications?: ApplicationSummary[] }
  const application = data.applications?.[0]
  assert.equal(application?.phone, "+1 555-0142")
  assert.equal(application?.email, "jane.rivera@example.com")
  assert.equal(application?.yearsExperience, "6")
  assert.equal(application?.videoState, "ready")
  assert.deepEqual(application?.documents, [
    { label: "Photo ID", status: "verified", required: true },
    { label: "Certification", status: "missing", required: true },
  ])
})

// --- applications_search (2026-08-14): "what applications are
// there" without naming a candidate or job ---

test("applications_search lists every application without a name argument", async () => {
  const tools = createApplicationsTools({ provider: createFixtureProvider(), directoryProvider: createDirectoryFixtureProvider() })
  const listAllApplications = tools.find((tool) => tool.name === "applications_search")
  assert.ok(listAllApplications)

  const result = await listAllApplications.run({}, budget())
  const data = result.data as { applications?: ApplicationSummary[] }
  assert.equal(data.applications?.length, 2)
  assert.ok(data.applications?.some((application) => application.candidateName === "Jane Rivera"))
  assert.ok(data.applications?.some((application) => application.candidateName === "Alex Kim"))
})

test("applications_search filters by status when given", async () => {
  const tools = createApplicationsTools({
    provider: createFixtureProvider({
      async listAllApplications(options) {
        assert.equal(options.status, "draft")
        return []
      },
    }),
    directoryProvider: createDirectoryFixtureProvider(),
  })
  const listAllApplications = tools.find((tool) => tool.name === "applications_search")
  assert.ok(listAllApplications)

  const result = await listAllApplications.run({ status: "draft" }, budget())
  assert.equal(result.empty, true)
})

test("applications_search respects the shared budget", async () => {
  const tools = createApplicationsTools({ provider: createFixtureProvider(), directoryProvider: createDirectoryFixtureProvider() })
  const listAllApplications = tools.find((tool) => tool.name === "applications_search")
  assert.ok(listAllApplications)

  const exhausted: SecretaryToolBudget = { maxRecordsPerTool: 12, maxNotesPerTool: 0, maxNoteChars: 0, remainingRecords: 0 }
  const result = await listAllApplications.run({}, exhausted)
  assert.equal(result.empty, true)
})
