import assert from "node:assert/strict"
import test from "node:test"
import {
  buildContactIndexEntry,
  buildContextIndexEntry,
  DIRECTORY_SCHEMA_VERSION,
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

const documents: DirectorySearchDoc[] = [
  {
    id: "person__marcus-whitfield",
    type: "person",
    name: "Marcus Whitfield",
    aliases: "marcusw",
    email: "marcus@meridian.example",
    phone: "+1 (214) 555-0188 12145550188",
    keywords: "site supervisor construction",
    companyName: "Meridian Construction",
    location: "Dallas, TX",
    role: "Site Supervisor",
    searchText: "Marcus Whitfield marcus@meridian.example Site Supervisor Meridian Construction Dallas TX",
    subtitle: "Site Supervisor @ Meridian Construction",
  },
  {
    id: "company__meridian",
    type: "company",
    name: "Meridian Construction",
    aliases: "meridianbuild.com",
    email: "",
    phone: "",
    keywords: "construction dallas",
    companyName: "",
    location: "Dallas, TX",
    role: "",
    searchText: "Meridian Construction construction Dallas TX",
    subtitle: "Construction company",
  },
  {
    id: "job__dallas-site",
    type: "job",
    name: "Dallas Site Project",
    aliases: "",
    email: "",
    phone: "",
    keywords: "site project active",
    companyName: "",
    location: "Dallas, TX",
    role: "",
    searchText: "Dallas Site Project active Dallas TX",
    subtitle: "Active | Dallas, TX",
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

test("paginates results without mutating the ranked source list", async () => {
  const index = await createDirectorySearchIndex(documents)
  const results = searchDirectory(index, "Dallas")
  const page = paginateDirectoryItems(results, 2)
  assert.equal(page.length, 2)
  assert.ok(results.length >= page.length)
  assert.notEqual(page, results)
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

  assert.equal(DIRECTORY_SCHEMA_VERSION, 3)
  assert.equal(entry.name, "Canonical Name")
  assert.equal(entry.email, "canonical@example.com")
  assert.equal(entry.companyName, "Canonical Company")
  assert.equal(entry.companyEntityId, "company__company-context-id")
  assert.equal(entry.role, "Canonical Role")
  assert.match(entry.searchText, /legacy@example\.com/)
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
