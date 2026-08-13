import assert from "node:assert/strict"
import test from "node:test"
import { resolveJobByNameViaDirectory } from "../lib/whatsapp-secretary/tools/job-fanout"
import type { DirectoryDataProvider } from "../features/directory/ai/server/tools/types"
import type { DirectoryIndexRecord } from "../lib/ai/server/directory-data"
import type { WhatsAppReportJob } from "../lib/whatsapp-reports"

function directoryJobRecord(overrides: Partial<DirectoryIndexRecord> = {}): DirectoryIndexRecord {
  return {
    id: "job__north-ridge",
    type: "job",
    sourceCollection: "contexts",
    sourceId: "north-ridge",
    name: "North Ridge",
    normalizedName: "north ridge",
    companyName: "",
    location: "",
    role: "",
    subtitle: "",
    description: "",
    status: "",
    askContext: null,
    sourceUpdatedAtMs: null,
    ...overrides,
  }
}

function directoryProviderReturning(records: DirectoryIndexRecord[]): Pick<DirectoryDataProvider, "findByName"> {
  return { findByName: async () => records }
}

function fallbackReturning(jobs: WhatsAppReportJob[]): (name: string) => Promise<WhatsAppReportJob[]> {
  return async () => jobs
}

function neverCalledFallback(): (name: string) => Promise<WhatsAppReportJob[]> {
  return async () => {
    throw new Error("fallback must not be called when Directory already resolved a linked job")
  }
}

test("resolveJobByNameViaDirectory: a single linked Directory match resolves directly, without the fallback", async () => {
  const directoryProvider = directoryProviderReturning([directoryJobRecord()])
  const result = await resolveJobByNameViaDirectory(
    "North Ridge",
    directoryProvider,
    neverCalledFallback(),
    async (directoryContextId) => (directoryContextId === "north-ridge" ? { id: "job-1", name: "North Ridge" } : null),
  )
  assert.deepEqual(result, [{ id: "job-1", name: "North Ridge" }])
})

test("resolveJobByNameViaDirectory: a single Directory match with no linked ByeByeDPR job falls back", async () => {
  const directoryProvider = directoryProviderReturning([directoryJobRecord()])
  const fallbackJobs: WhatsAppReportJob[] = [{ id: "legacy-1", name: "North Ridge (legacy)" }]
  const result = await resolveJobByNameViaDirectory("North Ridge", directoryProvider, fallbackReturning(fallbackJobs), async () => null)
  assert.deepEqual(result, fallbackJobs)
})

test("resolveJobByNameViaDirectory: no Directory match falls back", async () => {
  const directoryProvider = directoryProviderReturning([])
  const fallbackJobs: WhatsAppReportJob[] = [{ id: "legacy-2", name: "Some Job" }]
  const result = await resolveJobByNameViaDirectory("Some Job", directoryProvider, fallbackReturning(fallbackJobs), async () => {
    throw new Error("must not look up a linked job when Directory found nothing")
  })
  assert.deepEqual(result, fallbackJobs)
})

test("resolveJobByNameViaDirectory: an ambiguous Directory match (more than one) falls back", async () => {
  const directoryProvider = directoryProviderReturning([
    directoryJobRecord({ id: "job__a", sourceId: "a", name: "Ridge Site A" }),
    directoryJobRecord({ id: "job__b", sourceId: "b", name: "Ridge Site B" }),
  ])
  const fallbackJobs: WhatsAppReportJob[] = [
    { id: "legacy-a", name: "Ridge Site A" },
    { id: "legacy-b", name: "Ridge Site B" },
  ]
  const result = await resolveJobByNameViaDirectory("Ridge Site", directoryProvider, fallbackReturning(fallbackJobs), async () => {
    throw new Error("must not look up a linked job for an ambiguous Directory match")
  })
  assert.deepEqual(result, fallbackJobs)
})

test("resolveJobByNameViaDirectory: a Directory match on a contact (not a job context) falls back", async () => {
  const directoryProvider = directoryProviderReturning([
    directoryJobRecord({ sourceCollection: "contacts", sourceId: "contact-1" }),
  ])
  const fallbackJobs: WhatsAppReportJob[] = [{ id: "legacy-3", name: "North Ridge" }]
  const result = await resolveJobByNameViaDirectory("North Ridge", directoryProvider, fallbackReturning(fallbackJobs), async () => {
    throw new Error("must not look up a linked job for a non-context match")
  })
  assert.deepEqual(result, fallbackJobs)
})
