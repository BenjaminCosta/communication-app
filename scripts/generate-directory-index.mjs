#!/usr/bin/env node
/**
 * SVC Directory Index generator.
 *
 * Derives /directoryIndex from /contacts and /contexts. Fully idempotent:
 * every entry is keyed by a composite id ({type}__{sourceId}) so re-runs
 * update in place and never duplicate. Never writes to /contacts, /contexts,
 * or /messages.
 *
 * Modes (exactly one):
 *   --dry-run   Read + classify + report counts and quality. No writes. (default)
 *   --sample    Read + show detailed normalized samples (20 people, 20
 *               companies, 20 jobs, all others). No writes.
 *   --write     Upsert every derived entry into /directoryIndex (merge).
 *               Idempotent — safe to run repeatedly.
 *   --rebuild   Delete all /directoryIndex docs, then write fresh.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node scripts/generate-directory-index.mjs --sample
 *
 * Optional:
 *   --dump=<path>   In --sample/--dry-run, also write the compact MiniSearch
 *                   payload (DirectorySearchDoc[]) to a local JSON file.
 */

import { initializeApp, cert } from "firebase-admin/app"
import { FieldValue, getFirestore } from "firebase-admin/firestore"
import { readFileSync, existsSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { tsImport } from "tsx/esm/api"

const directoryCore = await tsImport("../lib/directory-core.ts", import.meta.url)
const {
  buildContactIndexEntry: buildCanonicalContactIndexEntry,
  buildContextIndexEntry: buildCanonicalContextIndexEntry,
  buildDirectorySearchShards: buildCanonicalDirectorySearchShards,
  buildSearchDoc: buildCanonicalSearchDoc,
  classifyContext: classifyCanonicalContext,
  directoryId: canonicalDirectoryId,
  normalizeName: normalizeCanonicalName,
  DIRECTORY_MINISEARCH_CONFIG: CANONICAL_MINISEARCH_CONFIG,
  DIRECTORY_SCHEMA_VERSION,
  DIRECTORY_SEARCH_SHARD_COUNT,
} = directoryCore

const MINISEARCH_CONFIG = CANONICAL_MINISEARCH_CONFIG

// ── Args ─────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2)
const modes = ["--dry-run", "--sample", "--write", "--rebuild", "--repair", "--lock", "--unlock"].filter((m) => argv.includes(m))
if (modes.length > 1) fail(`Choose exactly one mode. Got: ${modes.join(", ")}`)
const mode = modes[0] ?? "--dry-run"
const force = argv.includes("--force")
const dumpArg = argv.find((a) => a.startsWith("--dump="))
const dumpPath = dumpArg ? dumpArg.slice("--dump=".length) : null

const saPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
if (!saPath || !existsSync(saPath)) fail("Set GOOGLE_APPLICATION_CREDENTIALS to your service account JSON path.")

const serviceAccount = JSON.parse(readFileSync(saPath, "utf8"))
const app = initializeApp({ credential: cert(serviceAccount), projectId: "svc-comms" })
const db = getFirestore(app)
db.settings({ preferRest: true })

console.log(`Mode: ${mode}`)
console.log("")

// ── Import lock (suppresses incremental Cloud Function sync) ───────────────
// Use around a bulk import: --lock, run the import, then --rebuild, then --unlock.

if (mode === "--lock") {
  const minutes = Number(process.env.LOCK_MINUTES ?? 30)
  await db.doc("directoryControl/importLock").set({
    active: true,
    until: new Date(Date.now() + minutes * 60_000),
    reason: process.env.LOCK_REASON ?? "bulk-import",
    setAt: FieldValue.serverTimestamp(),
  }, { merge: true })
  console.log(`Import lock ACTIVE for ${minutes} min — incremental Directory sync is suppressed.`)
  process.exit(0)
}

if (mode === "--unlock") {
  await db.doc("directoryControl/importLock").set({ active: false, clearedAt: FieldValue.serverTimestamp() }, { merge: true })
  console.log("Import lock cleared — incremental Directory sync resumed.")
  process.exit(0)
}

// ── Read source collections ─────────────────────────────────────────────

console.log("Reading /contacts...")
const contacts = (await db.collection("contacts").get()).docs.map((d) => ({ id: d.id, ...d.data() }))
console.log(`  ${contacts.length} contacts`)
console.log("Reading /contexts...")
const contexts = (await db.collection("contexts").get()).docs.map((d) => ({ id: d.id, ...d.data() }))
console.log(`  ${contexts.length} contexts`)
console.log("")

// ── Classify + normalize ────────────────────────────────────────────────

const now = new Date()

const companiesRaw = []
const jobsRaw = []
const otherContextsRaw = []
for (const ctx of contexts) {
  const type = classifyCanonicalContext(ctx)
  if (type === "company") companiesRaw.push(ctx)
  else if (type === "job") jobsRaw.push(ctx)
  else otherContextsRaw.push(ctx)
}

// Company resolver: name → composite company id
const companyByName = new Map()
const companyBySourceRecordId = new Map()
for (const ctx of companiesRaw) {
  const companyId = canonicalDirectoryId("company", ctx.id)
  companyByName.set(normalizeCanonicalName(ctx.masterData?.displayName ?? ctx.masterData?.canonicalName ?? ctx.name ?? ""), companyId)
  if (typeof ctx.sourceRecordId === "string" && ctx.sourceRecordId.trim()) {
    companyBySourceRecordId.set(ctx.sourceRecordId.trim(), companyId)
  }
}
const resolveCompanyIdForPerson = (person) => {
  if (person.sourceCompanyId && companyBySourceRecordId.has(person.sourceCompanyId)) {
    return companyBySourceRecordId.get(person.sourceCompanyId)
  }
  return person.company ? companyByName.get(normalizeCanonicalName(person.company)) ?? null : null
}

// Stamp versioning metadata (mirrors lib/directory-core.ts finalizeEntry) so
// bulk-built docs carry the same schemaVersion/sourceUpdatedAt/indexedAt as
// Cloud-Function-built ones, enabling the rebuild guard below.
const toDateOrNull = (v) => (v && typeof v.toDate === "function") ? v.toDate() : (v instanceof Date ? v : null)
const personEntries = contacts.map((contact) => buildCanonicalContactIndexEntry(contact, {
  now,
  sourceUpdatedAt: toDateOrNull(contact.updatedAt),
  resolveCompanyIdForPerson,
}))
const companyEntries = companiesRaw.map((context) => buildCanonicalContextIndexEntry(context, {
  now,
  sourceUpdatedAt: toDateOrNull(context.updatedAt),
}))
const jobEntries = jobsRaw.map((context) => buildCanonicalContextIndexEntry(context, {
  now,
  sourceUpdatedAt: toDateOrNull(context.updatedAt),
}))
const otherEntries = otherContextsRaw.map((context) => buildCanonicalContextIndexEntry(context, {
  now,
  sourceUpdatedAt: toDateOrNull(context.updatedAt),
}))

const allEntries = [...personEntries, ...companyEntries, ...jobEntries, ...otherEntries]
const allSearchDocs = allEntries.map(buildCanonicalSearchDoc).sort((a, b) => a.id.localeCompare(b.id))
const searchRevision = createHash("sha256").update(JSON.stringify(allSearchDocs)).digest("hex").slice(0, 20)
const searchShards = buildCanonicalDirectorySearchShards(allEntries)
const shardedDocs = searchShards.flatMap((shard) => shard.entries)
if (shardedDocs.length !== allSearchDocs.length || new Set(shardedDocs.map((entry) => entry.id)).size !== allSearchDocs.length) {
  fail("Canonical search shards are incomplete or contain duplicate IDs.")
}
const shardBytes = searchShards.map((shard) => Buffer.byteLength(JSON.stringify(shard.entries), "utf8"))

// ── Counts ───────────────────────────────────────────────────────────────

const counts = {
  person: personEntries.length,
  company: companyEntries.length,
  job: jobEntries.length,
  other: otherEntries.length,
  total: allEntries.length,
}
const resolvedPersonCompany = personEntries.filter((p) => p.companyEntityId).length
const withCompanyName = personEntries.filter((p) => p.companyName).length

console.log("Classification")
console.log("──────────────")
console.log(`  person:  ${counts.person}`)
console.log(`  company: ${counts.company}`)
console.log(`  job:     ${counts.job}`)
console.log(`  other:   ${counts.other}`)
console.log(`  total:   ${counts.total}`)
console.log(`  person→company resolved: ${resolvedPersonCompany}/${withCompanyName} with a company name`)
console.log(`  search revision: ${searchRevision}`)
console.log(`  search shards:   ${searchShards.length} docs, ${Math.min(...shardBytes)}–${Math.max(...shardBytes)} bytes each`)
console.log("")

// ── Optional compact index dump ─────────────────────────────────────────

if (dumpPath) {
  writeFileSync(dumpPath, JSON.stringify({ config: MINISEARCH_CONFIG, docs: allSearchDocs }, null, 2))
  console.log(`Wrote compact MiniSearch payload (${allSearchDocs.length} docs) → ${dumpPath}`)
  console.log("")
}

// ── Mode dispatch ────────────────────────────────────────────────────────

if (mode === "--sample") {
  printSamples()
  process.exit(0)
}

if (mode === "--dry-run") {
  printQuality()
  console.log("Dry run only — no Firestore writes.")
  console.log("Run with --write to upsert, or --rebuild to replace the collection.")
  process.exit(0)
}

// ── Audit + repair ─────────────────────────────────────────────────────────
// Reconciles /directoryIndex against the sources: orphaned (index doc whose
// source is gone / wrong-type duplicate), missing (source with no index), stale
// (schemaVersion behind or source newer than indexed). Report-only unless --apply.
if (mode === "--repair") {
  console.log("Reconciling /directoryIndex against /contacts + /contexts...")
  const expected = new Map(allEntries.map((e) => [e.id, e]))
  const existing = new Map()
  const snap = await db.collection("directoryIndex").get()
  snap.docs.forEach((d) => existing.set(d.id, d.data()))

  const orphaned = [...existing.keys()].filter((id) => !expected.has(id))
  const missing = new Set([...expected.keys()].filter((id) => !existing.has(id)))
  const stale = new Set()
  for (const [id, e] of expected) {
    const x = existing.get(id)
    if (!x) continue
    const schemaOld = (x.schemaVersion ?? 1) !== DIRECTORY_SCHEMA_VERSION
    const es = e.sourceUpdatedAt ? e.sourceUpdatedAt.getTime() : 0
    const ps = toDateOrNull(x.sourceUpdatedAt)?.getTime() ?? 0
    if (schemaOld || es > ps) stale.add(id)
  }

  console.log("")
  console.log("Repair report")
  console.log("─────────────")
  console.log(`  index docs:        ${existing.size}`)
  console.log(`  expected docs:     ${expected.size}`)
  console.log(`  orphaned (delete): ${orphaned.length}`)
  console.log(`  missing  (create): ${missing.size}`)
  console.log(`  stale    (rewrite):${stale.size}`)
  if (orphaned.length) console.log(`  sample orphaned:   ${orphaned.slice(0, 5).join(", ")}`)

  const apply = force || argv.includes("--apply")
  if (apply) {
    console.log("")
    console.log("Applying repairs...")
    const col = db.collection("directoryIndex")
    for (let i = 0; i < orphaned.length; i += 400) {
      const b = db.batch()
      orphaned.slice(i, i + 400).forEach((id) => b.delete(col.doc(id)))
      await b.commit()
    }
    const toFix = allEntries.filter((e) => missing.has(e.id) || stale.has(e.id))
    await writeEntries(toFix)
    await writeDirectorySearchShards(searchShards, searchRevision)
    await writeDirectoryMeta(counts, searchRevision)
    console.log(`Repaired: -${orphaned.length} orphaned, +${missing.size} missing, ~${stale.size} stale.`)
  } else {
    console.log("")
    console.log("Report only. Re-run with --apply to fix.")
  }
  process.exit(0)
}

if (mode === "--rebuild") {
  await deleteCollection("directoryIndex")
}

// ── Rebuild guard ─────────────────────────────────────────────────────────
// In --write (not --rebuild, not --force), skip entries whose existing index
// doc is already current: same schemaVersion AND its sourceUpdatedAt is >= the
// source's updatedAt. This prevents a slow rebuild from clobbering fresher
// incremental Cloud-Function writes. --rebuild and --force always write.
let toWrite = allEntries
let skipped = 0
if (mode === "--write" && !force) {
  console.log("Applying rebuild guard (skip up-to-date entries)...")
  const existing = new Map()
  const snap = await db.collection("directoryIndex").get()
  snap.docs.forEach((d) => {
    const x = d.data()
    existing.set(d.id, {
      schemaVersion: x.schemaVersion ?? 1,
      sourceUpdatedAt: toDateOrNull(x.sourceUpdatedAt),
    })
  })
  toWrite = allEntries.filter((e) => {
    const prev = existing.get(e.id)
    if (!prev) return true // missing → write
    if (prev.schemaVersion !== DIRECTORY_SCHEMA_VERSION) return true // schema changed → write
    const es = e.sourceUpdatedAt ? e.sourceUpdatedAt.getTime() : 0
    const ps = prev.sourceUpdatedAt ? prev.sourceUpdatedAt.getTime() : 0
    // Write only if the source is newer than what we indexed.
    return es > ps
  })
  skipped = allEntries.length - toWrite.length
  console.log(`  ${toWrite.length} to write, ${skipped} already up-to-date (skipped).`)
}

await writeEntries(toWrite)
await writeDirectorySearchShards(searchShards, searchRevision)
await writeDirectoryMeta(counts, searchRevision)
console.log("")
console.log(`Done. ${mode === "--rebuild" ? "Rebuilt" : "Upserted"} ${toWrite.length} /directoryIndex docs${skipped ? ` (${skipped} skipped)` : ""}.`)
process.exit(0)

// All classification, normalization, index projection and shard distribution
// come from lib/directory-core.ts via tsx/esm/api at the top of this script.
// ══════════════════════════════════════════════════════════════════════════
// Firestore writers (idempotent)
// ══════════════════════════════════════════════════════════════════════════

async function writeEntries(entries) {
  const col = db.collection("directoryIndex")
  for (let i = 0; i < entries.length; i += 400) {
    const batch = db.batch()
    for (const entry of entries.slice(i, i + 400)) {
      // Deterministic doc id = composite id → re-runs update in place.
      batch.set(col.doc(entry.id), toFirestore(entry), { merge: true })
    }
    await batch.commit()
    console.log(`  written ${Math.min(i + 400, entries.length)} / ${entries.length}`)
  }
}

async function writeDirectorySearchShards(shards, revision) {
  const batch = db.batch()
  const collection = db.collection("directorySearchShards")
  for (const shard of shards) {
    const bytes = Buffer.byteLength(JSON.stringify(shard.entries), "utf8")
    if (bytes > 800_000) fail(`Search shard ${shard.shardId} is ${bytes} bytes; increase shard count before writing.`)
    batch.set(collection.doc(shard.shardId), {
      schemaVersion: DIRECTORY_SCHEMA_VERSION,
      shardId: shard.shardId,
      revision,
      entryCount: shard.entries.length,
      entries: shard.entries,
      updatedAt: FieldValue.serverTimestamp(),
    })
  }
  await batch.commit()
  console.log(`Wrote ${shards.length} /directorySearchShards docs (revision=${revision}).`)
}

async function writeDirectoryMeta(counts, revision) {
  await db.doc("directoryMeta/status").set({
    schemaVersion: DIRECTORY_SCHEMA_VERSION,
    lastRebuildAt: FieldValue.serverTimestamp(),
    lastChangeAt: FieldValue.serverTimestamp(),
    searchRevision: revision,
    searchSchemaVersion: DIRECTORY_SCHEMA_VERSION,
    searchShardCount: DIRECTORY_SEARCH_SHARD_COUNT,
    searchEntryCount: counts.total,
    searchBuiltAt: FieldValue.serverTimestamp(),
    counts: {
      person: counts.person,
      company: counts.company,
      job: counts.job,
      other: counts.other,
      total: counts.total,
    },
    lastMode: mode,
  }, { merge: true })
  console.log(`Wrote directoryMeta/status (schemaVersion=${DIRECTORY_SCHEMA_VERSION}, total=${counts.total})`)
}

async function deleteCollection(name) {
  console.log(`Deleting all /${name} docs...`)
  const col = db.collection(name)
  let deleted = 0
  while (true) {
    const snap = await col.limit(400).get()
    if (snap.empty) break
    const batch = db.batch()
    snap.docs.forEach((d) => batch.delete(d.ref))
    await batch.commit()
    deleted += snap.size
    console.log(`  deleted ${deleted}`)
  }
  console.log(`  removed ${deleted} docs`)
}

function toFirestore(entry) {
  // Convert Date → server timestamp; strip undefined.
  return sanitize({ ...entry, updatedAt: FieldValue.serverTimestamp() })
}

// ══════════════════════════════════════════════════════════════════════════
// Reporting
// ══════════════════════════════════════════════════════════════════════════

function printSamples() {
  console.log("═══════════════════════════════════════════════════════════")
  console.log("  SAMPLE — normalized Directory entries")
  console.log("═══════════════════════════════════════════════════════════")
  sampleBlock("PEOPLE", personEntries.slice(0, 20))
  sampleBlock("COMPANIES", companyEntries.slice(0, 20))
  sampleBlock("JOBS", jobEntries.slice(0, 20))
  sampleBlock("OTHER (all)", otherEntries)
}

function sampleBlock(title, entries) {
  console.log("")
  console.log(`── ${title} (${entries.length}) ─────────────────────────────`)
  for (const e of entries) {
    console.log("")
    console.log(`  id:            ${e.id}`)
    console.log(`  name:          ${e.name}`)
    console.log(`  subtitle:      ${e.subtitle ?? "—"}`)
    console.log(`  normalizedName:${e.normalizedName}`)
    if (e.email) console.log(`  email:         ${e.email}`)
    if (e.phone) console.log(`  phone:         ${e.phone}`)
    if (e.role) console.log(`  role:          ${e.role}`)
    if (e.location) console.log(`  location:      ${e.location}`)
    if (e.companyName) console.log(`  companyName:   ${e.companyName}`)
    console.log(`  companyEntity: ${e.companyEntityId ?? "null"}`)
    console.log(`  aliases:       ${e.aliases.length ? e.aliases.join(", ") : "—"}`)
    console.log(`  keywords:      ${e.keywords.slice(0, 12).join(", ")}${e.keywords.length > 12 ? " …" : ""}`)
    console.log(`  quality:       complete=${e.quality.isComplete}${e.quality.issues.length ? " | issues: " + e.quality.issues.join("; ") : ""}`)
    console.log(`  → searchDoc:   ${JSON.stringify(buildCanonicalSearchDoc(e))}`)
  }
}

function printQuality() {
  const issueCounts = {}
  for (const e of allEntries) {
    for (const issue of e.quality.issues) inc(issueCounts, `${e.type}:${issue}`)
  }
  console.log("Data quality")
  console.log("────────────")
  const complete = allEntries.filter((e) => e.quality.isComplete).length
  console.log(`  complete: ${complete}/${allEntries.length} (${pct(complete, allEntries.length)})`)
  console.log(`  issue breakdown:`)
  for (const [key, count] of Object.entries(issueCounts).sort((a, b) => b[1] - a[1])) {
    const [type, issue] = key.split(":")
    console.log(`   ├─ [${type}] ${issue}: ${count}`)
  }
  console.log("")
}

// ── misc helpers ─────────────────────────────────────────────────────────

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize).filter((x) => x !== undefined)
  if (value && typeof value === "object" && value.constructor === Object) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitize(v)]).filter(([, v]) => v !== undefined))
  }
  return value === undefined ? null : value
}
function inc(obj, key) { obj[key] = (obj[key] ?? 0) + 1 }
function pct(n, total) { return total > 0 ? `${((n / total) * 100).toFixed(1)}%` : "0%" }
function fail(msg) { console.error(`ERROR: ${msg}`); process.exit(1) }
