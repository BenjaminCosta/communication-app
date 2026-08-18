import assert from "node:assert/strict"
import test from "node:test"
import {
  buildContactIndexEntry,
  buildContextIndexEntry,
  buildDirectorySearchShards,
  DIRECTORY_SCHEMA_VERSION,
  DIRECTORY_SEARCH_SHARD_COUNT,
  type DirectorySearchDoc,
} from "../lib/directory-core"
import {
  createDirectorySearchIndex,
  directoryItemsForIds,
  getDirectoryTitleSuggestions,
  makeDirectoryCacheKey,
  paginateDirectoryItems,
  searchDirectory,
} from "../lib/directory-search"
import { importedContactsFromCatalog } from "../lib/entity-catalog-adapters"
import { directoryRelationPageWindow } from "../lib/directory-relations"
import { inspectDirectoryConsistency } from "../lib/directory-consistency"

const documents: DirectorySearchDoc[] = [
  {
    id: "person__marcus-whitfield",
    type: "person",
    sourceCollection: "contacts",
    sourceId: "marcus-whitfield",
    ownerUserId: "user-a",
    name: "Marcus Whitfield",
    aliases: "marcusw",
    email: "marcus@meridian.example",
    phone: "+1 (214) 555-0188 12145550188",
    phoneDisplay: "+1 (214) 555-0188",
    keywords: "site supervisor construction",
    companyName: "Meridian Construction",
    location: "Dallas, TX",
    role: "Site Supervisor",
    searchText: "Marcus Whitfield marcus@meridian.example Site Supervisor Meridian Construction Dallas TX",
    subtitle: "Site Supervisor @ Meridian Construction",
    linkedUserId: "",
    status: "not_registered",
    tags: ["supervisor"],
    description: "",
    fieldCount: 0,
  },
  {
    id: "company__meridian",
    type: "company",
    sourceCollection: "contexts",
    sourceId: "meridian",
    ownerUserId: "",
    name: "Meridian Construction",
    aliases: "meridianbuild.com",
    email: "",
    phone: "",
    phoneDisplay: "",
    keywords: "construction dallas",
    companyName: "",
    location: "Dallas, TX",
    role: "",
    searchText: "Meridian Construction construction Dallas TX",
    subtitle: "Construction company",
    linkedUserId: "",
    status: "",
    tags: [],
    description: "Construction company",
    fieldCount: 4,
  },
  {
    id: "job__dallas-site",
    type: "job",
    sourceCollection: "contexts",
    sourceId: "dallas-site",
    ownerUserId: "",
    name: "Dallas Site Project",
    aliases: "",
    email: "",
    phone: "",
    phoneDisplay: "",
    keywords: "site project active",
    companyName: "",
    location: "Dallas, TX",
    role: "",
    searchText: "Dallas Site Project active Dallas TX",
    subtitle: "Active | Dallas, TX",
    linkedUserId: "",
    status: "",
    tags: [],
    description: "",
    fieldCount: 6,
  },
]

test("ranks an exact name match before metadata matches", async () => {
  const index = await createDirectorySearchIndex(documents)
  const results = searchDirectory(index, "Meridian")
  assert.equal(results[0]?.id, "company__meridian")
  assert.equal(results[1]?.id, "person__marcus-whitfield")
})

test("filters the mixed index by Directory scope", async () => {
  const index = await createDirectorySearchIndex(documents)
  assert.deepEqual(searchDirectory(index, "Dallas", "person").map((item) => item.type), ["person"])
  assert.deepEqual(searchDirectory(index, "Dallas", "company").map((item) => item.type), ["company"])
  assert.deepEqual(searchDirectory(index, "Dallas", "job").map((item) => item.type), ["job"])
})

test("searches enriched email, phone, and canonical text while preserving exact-match priority", async () => {
  const index = await createDirectorySearchIndex(documents)
  assert.equal(searchDirectory(index, "marcus@meridian.example")[0]?.id, "person__marcus-whitfield")
  assert.equal(searchDirectory(index, "12145550188")[0]?.id, "person__marcus-whitfield")
  assert.equal(searchDirectory(index, "supervisor")[0]?.id, "person__marcus-whitfield")
})

test("returns a short title-only suggestion list and respects the selected scope", async () => {
  const index = await createDirectorySearchIndex(documents)
  assert.deepEqual(getDirectoryTitleSuggestions(index, "me").map((item) => item.name), ["Meridian Construction"])
  assert.deepEqual(getDirectoryTitleSuggestions(index, "da", "job").map((item) => item.name), ["Dallas Site Project"])
  assert.deepEqual(getDirectoryTitleSuggestions(index, "m").map((item) => item.name), [])
})

test("maps stored docs in requested order for recents and favorites", async () => {
  const index = await createDirectorySearchIndex(documents)
  const items = directoryItemsForIds(index, ["job__dallas-site", "person__marcus-whitfield", "missing"])
  assert.deepEqual(items.map((item) => item.id), ["job__dallas-site", "person__marcus-whitfield"])
  assert.equal(items[0]?.location, "Dallas, TX")
})

test("preserves contact ownership and linked-user status in the Communications catalog", async () => {
  const index = await createDirectorySearchIndex([
    { ...documents[0], linkedUserId: "linked-user", status: "" },
  ])
  const [contact] = importedContactsFromCatalog(index)
  assert.equal(contact.ownerUserId, "user-a")
  assert.equal(contact.linkedUserId, "linked-user")
  assert.equal(contact.status, "registered")
})

test("paginates results without mutating the ranked source list", async () => {
  const index = await createDirectorySearchIndex(documents)
  const results = searchDirectory(index, "Dallas")
  const page = paginateDirectoryItems(results, 2)
  assert.equal(page.length, 2)
  assert.ok(results.length >= page.length)
  assert.notEqual(page, results)
})

test("handles relation pagination boundaries at 50, 51, and 141 edges", () => {
  const fifty = directoryRelationPageWindow(Array.from({ length: 50 }, (_, index) => index), 50)
  const fiftyOne = directoryRelationPageWindow(Array.from({ length: 51 }, (_, index) => index), 50)
  const oneFortyOne = directoryRelationPageWindow(Array.from({ length: 141 }, (_, index) => index), 50)
  assert.equal(fifty.items.length, 50)
  assert.equal(fifty.hasMore, false)
  assert.equal(fiftyOne.items.length, 50)
  assert.equal(fiftyOne.hasMore, true)
  assert.equal(oneFortyOne.items.length, 50)
  assert.equal(oneFortyOne.hasMore, true)
})

test("cache key changes with user, schema, and metadata timestamp", () => {
  const base = makeDirectoryCacheKey("user-a", 2, "100")
  assert.notEqual(base, makeDirectoryCacheKey("user-b", 2, "100"))
  assert.notEqual(base, makeDirectoryCacheKey("user-a", 3, "100"))
  assert.notEqual(base, makeDirectoryCacheKey("user-a", 2, "101"))
})

test("prefers canonical master enrichment without discarding source contact data", () => {
  const entry = buildContactIndexEntry({
    id: "contact-1",
    name: "Legacy Name",
    email: "legacy@example.com",
    company: "Legacy Company",
    role: "Legacy Role",
    masterData: {
      displayName: "Canonical Name",
      emails: ["canonical@example.com"],
      phones: ["212-555-0100"],
      address: "New York, NY",
      companyId: "company-master-id",
      companyName: "Canonical Company",
      companyContextId: "company-context-id",
      companyMatchConfidence: 1,
      roleName: "Canonical Role",
    },
  })

  assert.equal(DIRECTORY_SCHEMA_VERSION, 4)
  assert.equal(entry.name, "Canonical Name")
  assert.equal(entry.email, "canonical@example.com")
  assert.equal(entry.companyName, "Canonical Company")
  assert.equal(entry.companyEntityId, "company__company-context-id")
  assert.equal(entry.role, "Canonical Role")
  assert.match(entry.searchText, /legacy@example\.com/)
})

test("builds a deterministic, complete 32-shard catalog", () => {
  const entries = [
    buildContactIndexEntry({ id: "a", name: "A" }),
    buildContactIndexEntry({ id: "b", name: "B" }),
    buildContextIndexEntry({ id: "c", name: "C", sourceSheet: "Companies" }),
  ]
  const first = buildDirectorySearchShards(entries)
  const second = buildDirectorySearchShards([...entries].reverse())
  assert.equal(first.length, DIRECTORY_SEARCH_SHARD_COUNT)
  assert.equal(first.flatMap((shard) => shard.entries).length, entries.length)
  assert.deepEqual(first, second)
})

test("projects a safe master job-company relation into the Directory index", () => {
  const entry = buildContextIndexEntry({
    id: "job-context-id",
    name: "Legacy Job Name",
    sourceSheet: "Jobs",
    fields: [{ label: "Kind", value: "Project/Job" }],
    masterData: {
      canonicalName: "Canonical Job",
      location: "Newark, NJ",
      companyName: "Canonical Company",
      companyContextId: "company-context-id",
      status: "In Progress",
    },
  })

  assert.equal(entry.type, "job")
  assert.equal(entry.name, "Canonical Job")
  assert.equal(entry.companyName, "Canonical Company")
  assert.equal(entry.companyEntityId, "company__company-context-id")
  assert.equal(entry.quality.hasCompany, true)
})

test("projects created company and job contexts with their involved contacts", () => {
  const company = buildContextIndexEntry({
    id: "company-context-id",
    name: "Acme Construction",
    directoryType: "company",
    fields: [{ label: "People involved", value: "Courtney Roberts" }],
    masterData: { displayName: "Acme Construction" },
  })
  const job = buildContextIndexEntry({
    id: "job-context-id",
    name: "Downtown renovation",
    directoryType: "job",
    fields: [{ label: "People involved", value: "Courtney Roberts" }],
    masterData: {
      canonicalName: "Downtown renovation",
      companyName: "Acme Construction",
      companyContextId: "company-context-id",
    },
  })

  assert.equal(company.type, "company")
  assert.match(company.searchText, /courtney roberts/)
  assert.equal(job.type, "job")
  assert.equal(job.companyEntityId, "company__company-context-id")
  assert.match(job.searchText, /courtney roberts/)
})

test("accepts a complete Directory index, shard set, and manifest", () => {
  const entries = [
    buildContactIndexEntry({ id: "person-a", name: "Person A" }),
    buildContextIndexEntry({ id: "company-a", name: "Company A", sourceSheet: "Companies" }),
  ]
  const revision = "revision-1"
  const shards = buildDirectorySearchShards(entries).map((shard) => ({
    id: shard.shardId,
    ...shard,
    revision,
    entryCount: shard.entries.length,
  }))
  const report = inspectDirectoryConsistency({
    indexEntries: entries.map((entry) => ({ id: entry.id, companyEntityId: entry.companyEntityId })),
    shards,
    meta: {
      schemaVersion: DIRECTORY_SCHEMA_VERSION,
      searchSchemaVersion: DIRECTORY_SCHEMA_VERSION,
      searchRevision: revision,
      searchShardCount: DIRECTORY_SEARCH_SHARD_COUNT,
      searchEntryCount: entries.length,
    },
  })

  assert.equal(report.ok, true)
  assert.deepEqual(report.issues, [])
})

test("reports projection drift and dangling entity references", () => {
  const report = inspectDirectoryConsistency({
    indexEntries: [{ id: "person__a", companyEntityId: "company__missing" }],
    shards: [],
    meta: null,
    references: [{ collection: "directoryNotes", id: "note-a", entityIds: ["person__missing"] }],
  })
  const codes = new Set(report.issues.map((entry) => entry.code))

  assert.equal(report.ok, false)
  assert.equal(codes.has("meta_missing"), true)
  assert.equal(codes.has("shard_missing"), true)
  assert.equal(codes.has("company_reference_missing"), true)
  assert.equal(codes.has("entity_reference_missing"), true)
})

test("reports a Directory manifest without a search revision", () => {
  const report = inspectDirectoryConsistency({
    indexEntries: [],
    shards: [],
    meta: {
      schemaVersion: DIRECTORY_SCHEMA_VERSION,
      searchSchemaVersion: DIRECTORY_SCHEMA_VERSION,
      searchShardCount: DIRECTORY_SEARCH_SHARD_COUNT,
      searchEntryCount: 0,
    },
  })

  assert.equal(report.issues.some((entry) => entry.code === "meta_revision"), true)
})
