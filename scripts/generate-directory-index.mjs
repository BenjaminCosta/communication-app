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

// Declared up top so the hoisted normalizer functions can reference them
// during top-level execution (const is not hoisted — temporal dead zone).
const STOPWORDS = new Set(["the", "and", "for", "inc", "llc", "co", "ltd", "of", "a", "an", "to", "in", "on", "at", "by", "with", "de", "la", "el", "los", "las"])

const MINISEARCH_CONFIG = {
  idField: "id",
  fields: ["name", "aliases", "keywords", "companyName", "location", "role"],
  storeFields: ["type", "name", "subtitle", "companyName", "location"],
  searchOptions: { boost: { name: 3, aliases: 2, companyName: 1.5 }, prefix: true, fuzzy: 0.2 },
}

// ── Args ─────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2)
const modes = ["--dry-run", "--sample", "--write", "--rebuild"].filter((m) => argv.includes(m))
if (modes.length > 1) fail(`Choose exactly one mode. Got: ${modes.join(", ")}`)
const mode = modes[0] ?? "--dry-run"
const dumpArg = argv.find((a) => a.startsWith("--dump="))
const dumpPath = dumpArg ? dumpArg.slice("--dump=".length) : null

const saPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
if (!saPath || !existsSync(saPath)) fail("Set GOOGLE_APPLICATION_CREDENTIALS to your service account JSON path.")

const serviceAccount = JSON.parse(readFileSync(saPath, "utf8"))
const app = initializeApp({ credential: cert(serviceAccount), projectId: "svc-comms" })
const db = getFirestore(app)

console.log(`Mode: ${mode}`)
console.log("")

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
  const type = classifyContext(ctx)
  if (type === "company") companiesRaw.push(ctx)
  else if (type === "job") jobsRaw.push(ctx)
  else otherContextsRaw.push(ctx)
}

// Company resolver: name → composite company id
const companyByName = new Map()
for (const ctx of companiesRaw) {
  companyByName.set(normalizeName(ctx.name ?? ""), directoryId("company", ctx.id))
}
const resolveCompanyId = (name) => companyByName.get(normalizeName(name ?? "")) ?? null

const personEntries = contacts.map((c) => buildPersonIndex(c, now, resolveCompanyId))
const companyEntries = companiesRaw.map((c) => buildCompanyIndex(c, now))
const jobEntries = jobsRaw.map((c) => buildJobIndex(c, now))
const otherEntries = otherContextsRaw.map((c) => buildOtherIndex(c, now))

const allEntries = [...personEntries, ...companyEntries, ...jobEntries, ...otherEntries]

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
console.log("")

// ── Optional compact index dump ─────────────────────────────────────────

if (dumpPath) {
  const searchDocs = allEntries.map(buildSearchDoc)
  writeFileSync(dumpPath, JSON.stringify({ config: MINISEARCH_CONFIG, docs: searchDocs }, null, 2))
  console.log(`Wrote compact MiniSearch payload (${searchDocs.length} docs) → ${dumpPath}`)
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

if (mode === "--rebuild") {
  await deleteCollection("directoryIndex")
}

await writeEntries(allEntries)
console.log("")
console.log(`Done. ${mode === "--rebuild" ? "Rebuilt" : "Upserted"} ${allEntries.length} /directoryIndex docs.`)
process.exit(0)

// ══════════════════════════════════════════════════════════════════════════
// Normalizers (ported from lib/directory.ts — kept in sync intentionally)
//
// TECH DEBT: this logic is duplicated from lib/directory.ts because Node ESM
// cannot import the .ts module directly (it imports ./store which pulls in the
// whole app). Consolidate to a single source of truth — e.g. extract the pure
// normalizers into a framework-free lib/directory-core.(m)js (or add a tsx/esbuild
// loader for the script) so this .mjs imports them instead of re-declaring.
// Until then: any change to a normalizer MUST be mirrored in both files.
// ══════════════════════════════════════════════════════════════════════════

function directoryId(type, sourceId) {
  return `${type}__${sourceId}`
}

function classifyContext(ctx) {
  const kind = getFieldValue(ctx.fields, "Kind")?.toLowerCase() ?? ""
  const sheet = (ctx.sourceSheet ?? "").toLowerCase()
  if (kind === "company" || sheet === "companies") return "company"
  if (kind === "project/job" || kind === "job" || sheet === "jobs") return "job"
  if (hasAnyField(ctx.fields, ["Phone", "Website", "Timezone"])) return "company"
  if (hasAnyField(ctx.fields, ["Project Manager", "Project Lead", "Duration in Weeks", "Job Rate"])) return "job"
  return "other"
}

function buildPersonIndex(c, now, resolveCompany) {
  const emails = Array.isArray(c.emails) && c.emails.length
    ? c.emails
    : (c.email ? [{ label: "email", value: c.email, normalized: c.emailNormalized }] : [])
  const phones = Array.isArray(c.phones) && c.phones.length
    ? c.phones
    : (c.phone ? [{ label: "phone", value: c.phone, normalized: c.phoneNormalized }] : [])
  const addresses = Array.isArray(c.addresses) ? c.addresses : []
  const companies = Array.isArray(c.companies) && c.companies.length ? c.companies : (c.company ? [c.company] : [])
  const roles = Array.isArray(c.roles) && c.roles.length ? c.roles : (c.role ? [c.role] : [])
  const tags = Array.isArray(c.tags) ? c.tags : []
  const name = c.name ?? ""

  const primaryEmail = emails.find((e) => e.isPrimary)?.value ?? emails[0]?.value ?? null
  const primaryPhone = phones.find((p) => p.isPrimary)?.value ?? phones[0]?.value ?? null
  const location = addresses[0]?.locality ?? extractLocality(addresses[0]?.formatted) ?? null
  const subtitle = [c.role, c.company].filter(Boolean).join(" @ ") || null
  const companyEntityId = c.company ? resolveCompany(c.company) : null

  const emailLocalParts = emails.map((e) => (e.normalized ?? e.value)?.split("@")[0]).filter(Boolean)
  const aliases = uniqueStrings([...emailLocalParts, ...companies])
  const keywords = extractKeywords([name, c.role, ...roles, c.company, ...companies, ...tags, location])
  const searchText = lowerJoin([
    name,
    ...emails.flatMap((e) => [e.value, e.normalized]),
    ...phones.flatMap((p) => [p.value, p.normalized]),
    c.company, ...companies, c.role, ...roles, c.notes, ...tags,
    ...addresses.map((a) => a.formatted),
  ])

  const hasEmail = emails.length > 0
  const hasPhone = phones.length > 0
  const issues = []
  if (!name.trim()) issues.push("Missing name")
  if (!hasEmail && !hasPhone) issues.push("No email or phone")
  if (!c.company) issues.push("No company")
  else if (!companyEntityId) issues.push("Company not resolved to an entity")
  if (!c.role) issues.push("No role")

  return {
    id: directoryId("person", c.id),
    type: "person",
    sourceCollection: "contacts",
    sourceId: c.id,
    name,
    normalizedName: normalizeName(name),
    aliases,
    keywords,
    searchText,
    subtitle,
    email: primaryEmail,
    phone: primaryPhone,
    role: c.role ?? null,
    location,
    companyName: c.company ?? null,
    companyEntityId,
    linkedUserId: c.linkedUserId ?? null,
    sourceSheet: c.sourceSheet ?? null,
    sourceRecordId: c.sourceRecordId ?? null,
    quality: {
      hasEmail, hasPhone, hasCompany: !!c.company, hasRole: !!c.role,
      hasLocation: addresses.length > 0, isLinkedUser: !!c.linkedUserId,
      isComplete: !!name.trim() && (hasEmail || hasPhone),
      issues,
    },
    updatedAt: now,
  }
}

function buildCompanyIndex(ctx, now) {
  const name = ctx.name ?? ""
  const phone = getFieldValue(ctx.fields, "Phone")
  const address = getFieldValue(ctx.fields, "Address")
  const timezone = getFieldValue(ctx.fields, "Timezone")
  const website = getFieldValue(ctx.fields, "Website")
  const location = extractLocality(address)
  const subtitle = [address, phone].filter(Boolean).join(" | ") || ctx.description || null

  const issues = []
  if (!name.trim()) issues.push("Missing name")
  if (!phone && !address && !website) issues.push("No phone, address, or website")

  return {
    id: directoryId("company", ctx.id),
    type: "company",
    sourceCollection: "contexts",
    sourceId: ctx.id,
    name,
    normalizedName: normalizeName(name),
    aliases: uniqueStrings([extractDomain(website)]),
    keywords: extractKeywords([name, ctx.description, address, location]),
    searchText: lowerJoin([name, ctx.description, phone, address, timezone, website, ...fieldValues(ctx.fields)]),
    subtitle,
    email: null,
    phone,
    role: null,
    location,
    companyName: null,
    companyEntityId: null,
    linkedUserId: null,
    sourceSheet: ctx.sourceSheet ?? null,
    sourceRecordId: ctx.sourceRecordId ?? null,
    quality: {
      hasEmail: false, hasPhone: !!phone, hasCompany: false, hasRole: false,
      hasLocation: !!address, isLinkedUser: false,
      isComplete: !!name.trim() && (!!phone || !!address || !!website),
      issues,
    },
    updatedAt: now,
  }
}

function buildJobIndex(ctx, now) {
  const name = ctx.name ?? ""
  const address = getFieldValue(ctx.fields, "Address")
  // Jobs "Company" column actually holds a location string.
  const location = getFieldValue(ctx.fields, "Company")
  const projectManager = getFieldValue(ctx.fields, "Project Manager")
  const projectLead = getFieldValue(ctx.fields, "Project Lead")
  const status = getFieldValue(ctx.fields, "Status")
  const relatedContacts = getFieldValue(ctx.fields, "Related Contacts")
  const loc = location ?? extractLocality(address)
  const subtitle = [status, location, address].filter(Boolean).join(" | ") || ctx.description || null

  const issues = []
  if (!name.trim()) issues.push("Missing name")
  if (!status) issues.push("No status")
  if (!location && !address) issues.push("No location or address")

  return {
    id: directoryId("job", ctx.id),
    type: "job",
    sourceCollection: "contexts",
    sourceId: ctx.id,
    name,
    normalizedName: normalizeName(name),
    aliases: [],
    keywords: extractKeywords([name, status, loc, address, nameSegment(projectManager), nameSegment(projectLead)]),
    searchText: lowerJoin([name, ctx.description, address, location, projectManager, projectLead, status, relatedContacts, ...fieldValues(ctx.fields)]),
    subtitle,
    email: null,
    phone: null,
    role: null,
    location: loc,
    companyName: null,
    companyEntityId: null, // deferred
    linkedUserId: null,
    sourceSheet: ctx.sourceSheet ?? null,
    sourceRecordId: ctx.sourceRecordId ?? null,
    quality: {
      hasEmail: false, hasPhone: false, hasCompany: false, hasRole: false,
      hasLocation: !!(location || address), isLinkedUser: false,
      isComplete: !!name.trim(),
      issues,
    },
    updatedAt: now,
  }
}

function buildOtherIndex(ctx, now) {
  const name = ctx.name ?? ""
  return {
    id: directoryId("other", ctx.id),
    type: "other",
    sourceCollection: "contexts",
    sourceId: ctx.id,
    name,
    normalizedName: normalizeName(name),
    aliases: [],
    keywords: extractKeywords([name, ctx.description]),
    searchText: lowerJoin([name, ctx.description, ...fieldValues(ctx.fields)]),
    subtitle: ctx.description ?? null,
    email: null,
    phone: null,
    role: null,
    location: null,
    companyName: null,
    companyEntityId: null,
    linkedUserId: null,
    sourceSheet: ctx.sourceSheet ?? null,
    sourceRecordId: ctx.sourceRecordId ?? null,
    quality: {
      hasEmail: false, hasPhone: false, hasCompany: false, hasRole: false,
      hasLocation: false, isLinkedUser: false,
      isComplete: !!name.trim(),
      issues: name.trim() ? [] : ["Missing name"],
    },
    updatedAt: now,
  }
}

function buildSearchDoc(entry) {
  return {
    id: entry.id,
    type: entry.type,
    name: entry.name,
    aliases: entry.aliases.join(" "),
    keywords: entry.keywords.join(" "),
    companyName: entry.companyName ?? "",
    location: entry.location ?? "",
    role: entry.role ?? "",
    subtitle: entry.subtitle ?? "",
  }
}

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
    console.log(`  → searchDoc:   ${JSON.stringify(buildSearchDoc(e))}`)
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

// ══════════════════════════════════════════════════════════════════════════
// Text helpers (ported from lib/directory.ts)
// ══════════════════════════════════════════════════════════════════════════

function stripAccents(v) {
  return String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
}
function normalizeName(v) {
  return stripAccents(v).toLowerCase().replace(/\s+/g, " ").trim()
}
function tokenize(v) {
  return stripAccents(v).toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 2 && !STOPWORDS.has(t))
}
function extractKeywords(values) {
  const set = new Set()
  for (const v of values) { if (!v) continue; for (const t of tokenize(v)) set.add(t) }
  return [...set]
}
function uniqueStrings(values) {
  const set = new Set()
  for (const v of values) { const c = String(v ?? "").trim(); if (c) set.add(c) }
  return [...set]
}
function lowerJoin(values) {
  return values.filter(Boolean).join(" ").toLowerCase()
}
function extractLocality(formatted) {
  if (!formatted) return null
  const parts = String(formatted).split(",").map((p) => p.trim()).filter(Boolean)
  if (parts.length >= 2) return parts.slice(-2).join(", ")
  return parts[0] ?? null
}
function extractDomain(website) {
  if (!website) return null
  const m = String(website).replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0]
  return m || null
}
function nameSegment(value) {
  if (!value) return null
  return String(value).split("/")[0].trim() || null
}
function getFieldValue(fields, label) {
  if (!Array.isArray(fields)) return null
  const f = fields.find((f) => f.label?.toLowerCase() === label.toLowerCase())
  return f?.value?.trim() || null
}
function hasAnyField(fields, labels) {
  if (!Array.isArray(fields)) return false
  const set = new Set(labels.map((l) => l.toLowerCase()))
  return fields.some((f) => set.has(f.label?.toLowerCase()) && f.value?.trim())
}
function fieldValues(fields) {
  return Array.isArray(fields) ? fields.map((f) => f.value).filter(Boolean) : []
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
