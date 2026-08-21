import type { DirectorySearchDoc } from "../lib/directory"
import type { DirectoryType } from "../lib/directory"
import { directoryRelationsFromEdges, type RelationEntityRef } from "../lib/directory-relations-core"
import { normalizeName, type DirectoryIndexRecord } from "../lib/ai/server/directory-data"
import type { AskDeps } from "../features/directory/ai/server/ask-service"
import type { DirectoryDataProvider, DirectoryNoteRecord } from "../features/directory/ai/server/tools/types"

/**
 * Synthetic SVC Directory used by the Ask evaluation suite.
 *
 * Deliberately shaped to exercise the hard cases: two companies sharing a job
 * and a contact, an indirect (multi-hop) connection, duplicate names that must
 * trigger disambiguation, a record with conflicting status text, entities with
 * missing fields, and free-text notes. Everything runs in memory — no Firebase.
 */

function doc(partial: Partial<DirectorySearchDoc> & Pick<DirectorySearchDoc, "id" | "type" | "name">): DirectorySearchDoc {
  return {
    sourceCollection: "contexts",
    sourceId: partial.id.split("__")[1] ?? partial.id,
    ownerUserId: "",
    aliases: "",
    email: "",
    phone: "",
    phoneDisplay: "",
    keywords: "",
    companyName: "",
    location: "",
    role: "",
    searchText: "",
    subtitle: "",
    linkedUserId: "",
    status: "",
    tags: [],
    description: "",
    fieldCount: 6,
    ...partial,
  }
}

export const FIXTURE_DOCS: DirectorySearchDoc[] = [
  // Companies
  doc({ id: "company__74", type: "company", name: "74 Construction", location: "Short Hills, NJ", description: "General contractor for the Short Hills portfolio." }),
  doc({ id: "company__1901", type: "company", name: "1901 Contracting", location: "Jacksonville, FL", description: "Specialty contractor." }),
  doc({ id: "company__sfv", type: "company", name: "SFV Services", location: "Delafield, WI" }),

  // Jobs
  doc({ id: "job__appaloosa", type: "job", name: "Appaloosa", location: "Short Hills, NJ", subtitle: "Job status: In Progress", companyName: "74 Construction" }),
  doc({ id: "job__warehouse", type: "job", name: "Warehouse Expansion", location: "Piscataway, NJ", subtitle: "Job status: In Progress" }),
  doc({ id: "job__siteutils", type: "job", name: "Site Utilities Upgrade", location: "Newark, NJ", subtitle: "Job status: Planning" }),
  doc({ id: "job__voodoo", type: "job", name: "Voodoo Brewery", location: "Delafield, WI", subtitle: "Job status: Cancelled" }),
  // Conflicting record: subtitle says active, description says cancelled.
  doc({ id: "job__riverside", type: "job", name: "Riverside Plaza", location: "Newark, NJ", subtitle: "Job status: In Progress", description: "Project was cancelled in 2024 per the owner." }),

  // People
  doc({ id: "person__jdemarco", type: "person", name: "John DeMarco", role: "Project Manager", companyName: "74 Construction", location: "Short Hills, NJ" }),
  doc({ id: "person__mwong", type: "person", name: "Melissa Wong", role: "Estimator", companyName: "74 Construction" }),
  doc({ id: "person__rlopez", type: "person", name: "Ricardo Lopez", role: "Supervisor", companyName: "1901 Contracting", keywords: "electrical" }),
  doc({ id: "person__aturner", type: "person", name: "Alan Turner", role: "Foreman", keywords: "plumbing" }),
  // Duplicate names → must trigger disambiguation, never a guess.
  doc({ id: "person__jsmith1", type: "person", name: "John Smith", role: "Superintendent", companyName: "74 Construction" }),
  doc({ id: "person__jsmith2", type: "person", name: "John Smith", role: "Estimator", companyName: "1901 Contracting" }),
  // Sparse record → missing-data questions.
  doc({ id: "person__pnolan", type: "person", name: "Patricia Nolan", fieldCount: 1 }),
]

interface FixtureEdge {
  a: string
  b: string
  role?: string
}

export const FIXTURE_EDGES: FixtureEdge[] = [
  { a: "company__74", b: "job__appaloosa" },
  { a: "company__74", b: "job__warehouse" },
  { a: "company__74", b: "job__siteutils" },
  { a: "company__74", b: "person__jdemarco", role: "Project Manager" },
  { a: "company__74", b: "person__mwong", role: "Estimator" },
  { a: "company__74", b: "person__jsmith1", role: "Superintendent" },
  // Melissa Wong works with both companies → the shared contact.
  { a: "company__1901", b: "person__mwong", role: "Estimator" },
  { a: "company__1901", b: "person__rlopez", role: "Supervisor" },
  { a: "company__1901", b: "person__jsmith2", role: "Estimator" },
  // Warehouse Expansion is the job both companies are on → connecting job.
  { a: "company__1901", b: "job__warehouse" },
  { a: "job__appaloosa", b: "person__jdemarco", role: "Project Manager" },
  { a: "job__appaloosa", b: "person__rlopez", role: "Supervisor" },
  { a: "job__warehouse", b: "person__aturner", role: "Foreman" },
  { a: "company__sfv", b: "job__voodoo" },
]

export const FIXTURE_NOTES: DirectoryNoteRecord[] = [
  {
    id: "note__appaloosa1",
    entityIds: ["job__appaloosa"],
    text: "Concrete pour delayed by weather. Electrical rough-in starts next week once the slab cures.",
    noteType: "general",
    createdAtMs: Date.parse("2026-07-10T00:00:00Z"),
  },
  {
    id: "note__rlopez1",
    entityIds: ["person__rlopez"],
    text: "Ricardo has ten years of electrical experience, mostly on hospital projects.",
    noteType: "general",
    createdAtMs: Date.parse("2026-07-12T00:00:00Z"),
  },
  {
    id: "note__74a",
    entityIds: ["company__74"],
    text: "Primary general contractor for the Short Hills portfolio this year.",
    noteType: "general",
    createdAtMs: Date.parse("2026-07-01T00:00:00Z"),
  },
]

export const FIXTURE_IDS = new Set(FIXTURE_DOCS.map((entry) => entry.id))
export const FIXTURE_NAMES = FIXTURE_DOCS.map((entry) => entry.name)

const byId = new Map(FIXTURE_DOCS.map((entry) => [entry.id, entry]))

function edgesFor(directoryId: string): RelationEntityRef[] {
  return FIXTURE_EDGES.flatMap((edge) => {
    if (edge.a !== directoryId && edge.b !== directoryId) return []
    const otherId = edge.a === directoryId ? edge.b : edge.a
    const other = byId.get(otherId)
    if (!other) return []
    return [{ id: otherId, type: other.type, name: other.name, role: edge.role }]
  })
}

/** Project a fixture doc into the server-side index record shape. */
function toIndexRecord(entry: DirectorySearchDoc): DirectoryIndexRecord {
  const aiText = `${entry.description ?? ""}`.trim()
  return {
    id: entry.id,
    type: entry.type,
    sourceCollection: entry.sourceCollection,
    sourceId: entry.sourceId,
    name: entry.name,
    normalizedName: normalizeName(entry.name),
    companyName: entry.companyName,
    location: entry.location,
    role: entry.role,
    subtitle: entry.subtitle,
    description: entry.description,
    status: entry.status,
    // Mirrors the derived projection: AI text comes from askContext, never searchText.
    askContext: aiText
      ? {
          version: 1,
          personIds: [],
          companyIds: [],
          jobIds: [],
          tokens: [],
          aiText,
          aiTextHash: "fixture",
          aiEligible: aiText.length >= 80,
        }
      : null,
    sourceUpdatedAtMs: null,
  }
}

const indexRecords = FIXTURE_DOCS.map(toIndexRecord)
const recordsById = new Map(indexRecords.map((entry) => [entry.id, entry]))

export function createFixtureProvider(): DirectoryDataProvider {
  return {
    async findByName(name: string, options: { type?: DirectoryType; limit?: number } = {}) {
      const normalized = normalizeName(name)
      if (normalized.length < 2) return []
      const limit = options.limit ?? 8
      // Mirrors the real provider: exact normalizedName first, then prefix.
      let matches = indexRecords.filter((entry) => entry.normalizedName === normalized)
      if (matches.length === 0) {
        matches = indexRecords.filter((entry) => entry.normalizedName.startsWith(normalized))
      }
      const scoped = options.type ? matches.filter((entry) => entry.type === options.type) : matches
      return scoped.slice(0, limit)
    },
    async getEntity(directoryId: string) {
      return recordsById.get(directoryId) ?? null
    },
    async getRelations(directoryId: string) {
      const edges = edgesFor(directoryId)
      return { relations: directoryRelationsFromEdges(edges), edges, hasMore: false, nextCursor: null, total: edges.length }
    },
    async getNotes(entityIds: string[], limit: number) {
      if (entityIds.length === 0) return FIXTURE_NOTES.slice(0, limit)
      const scope = new Set(entityIds)
      return FIXTURE_NOTES.filter((note) => note.entityIds.some((id) => scope.has(id))).slice(0, limit)
    },
    // No semantic path in the fixture → exercises the lexical fallback.
  }
}

export function createFixtureDeps(): AskDeps {
  return { provider: createFixtureProvider() }
}
