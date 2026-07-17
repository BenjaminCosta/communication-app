#!/usr/bin/env node
/**
 * Enriches the Directory (/contacts + /contexts) from the consolidated
 * Operational_Master.xlsx (produced by consolidate-operational-master.py).
 *
 * NON-DESTRUCTIVE + ADDITIVE + IDEMPOTENT:
 *   - never deletes docs, never changes doc ids, never overwrites a VALID
 *     existing scalar, never touches `masterData` (Directory canonical identity);
 *   - writes a namespaced `operationalData` map (own contentHash) + fills only
 *     EMPTY top-level fields;
 *   - matched people/companies enriched in place; genuinely-new ones created
 *     (global); jobs are matched-only (unmatched → review, never bulk-created);
 *   - person→company surfaces automatically via directory-core name match;
 *     job→company + person→company relations go to /directoryRelations.
 *   - bank fields are already excluded upstream (consolidation drops them).
 *
 * Dry-run by default. Emulator-aware (FIRESTORE_EMULATOR_HOST) or prod
 * (GOOGLE_APPLICATION_CREDENTIALS). Modes: (dry-run) | --write | --verify.
 *
 *   # dry-run against emulator
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 OWNER_UID=<uid> \
 *     node scripts/enrich-directory-from-operational.mjs
 *   # write
 *   DRY_RUN=false CONFIRM_OPERATIONAL_ENRICHMENT=true OWNER_UID=<uid> \
 *     FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
 *     node scripts/enrich-directory-from-operational.mjs --write
 */
import { initializeApp, cert, applicationDefault } from "firebase-admin/app"
import { FieldValue, getFirestore } from "firebase-admin/firestore"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"

const PROJECT_ID = "svc-comms"
const SCHEMA_VERSION = 1
const MASTER_PATH = process.argv.find((a) => a.endsWith(".xlsx")) || "import-data/operational/out/Operational_Master.xlsx"
const mode = process.argv.includes("--verify") ? "verify" : process.argv.includes("--write") ? "write" : "dry-run"
const ownerUserId = process.env.OWNER_UID || ""
const usingEmulator = !!process.env.FIRESTORE_EMULATOR_HOST
const saPath = process.env.GOOGLE_APPLICATION_CREDENTIALS

if (!existsSync(MASTER_PATH)) fail(`Operational master not found: ${MASTER_PATH}`)
if (mode === "write" && (process.env.DRY_RUN !== "false" || process.env.CONFIRM_OPERATIONAL_ENRICHMENT !== "true"))
  fail("Write mode requires DRY_RUN=false and CONFIRM_OPERATIONAL_ENRICHMENT=true.")
if (!usingEmulator && !saPath) fail("Set FIRESTORE_EMULATOR_HOST (emulator) or GOOGLE_APPLICATION_CREDENTIALS (prod).")
if (mode !== "verify" && !ownerUserId) fail("OWNER_UID is required (owner for any newly created global doc).")

const app = usingEmulator
  ? initializeApp({ projectId: PROJECT_ID })
  : initializeApp({ credential: saPath ? cert(JSON.parse(readFileSync(saPath, "utf8"))) : applicationDefault(), projectId: PROJECT_ID })
const db = getFirestore(app)

const workbookHash = createHash("sha256").update(readFileSync(MASTER_PATH)).digest("hex")
const workbook = JSON.parse(execFileSync("python3", ["scripts/parse-database-xlsx.py", MASTER_PATH], { maxBuffer: 160 * 1024 * 1024, encoding: "utf8" }))

const people = workbook.People_Master ?? []
const companies = workbook.Companies_Master ?? []
const jobs = workbook.Jobs_Master ?? []

const existingContacts = await readCollection("contacts")
const existingContexts = await readCollection("contexts")
const existingRelations = await readRelations()
const existingReviews = await readReview()
const queuedContactIds = new Set()
const queuedContextIds = new Set()

const contactByEmail = new Map()
const contactByNameCompany = new Map()
for (const c of existingContacts) {
  for (const e of contactEmails(c.data)) if (e) push(contactByEmail, e, c.id)
  push(contactByNameCompany, `${nn(c.data.name)}|${nn(c.data.company)}`, c.id)
}
const companyByName = new Map()
const jobByName = new Map()
for (const ctx of existingContexts) {
  const type = classify(ctx.data)
  const names = [ctx.data.name, ctx.data.masterData?.canonicalName, ...(aliasFields(ctx.data))]
  for (const n of names) if (nn(n)) push(type === "company" ? companyByName : type === "job" ? jobByName : new Map(), nn(n), ctx.id)
}

const plan = { contactUpdates: [], contactCreates: [], contextUpdates: [], contextCreates: [], relationWrites: [], reviewWrites: [], skipped: { contacts: 0, contexts: 0, relations: 0 } }
const companyDirIdByMasterId = new Map()  // Operational company_id -> directory composite id
const personDirIdByMasterId = new Map()

// ---------------- COMPANIES ----------------
for (const row of companies) {
  const name = clean(row.canonical_name || row.display_name)
  if (!name) continue
  const matchId = single(companyByName.get(nn(name))) || firstAliasMatch(row, companyByName)
  const opData = companyOpData(row)
  if (matchId) {
    companyDirIdByMasterId.set(key(row.company_id), `company__${matchId}`)
    const existing = existingContexts.find((c) => c.id === matchId).data
    const update = buildContextUpdate(existing, row, opData)
    if (update && !queuedContextIds.has(matchId)) { queuedContextIds.add(matchId); plan.contextUpdates.push({ id: matchId, data: update }) }
    else plan.skipped.contexts++
  } else {
    const id = `op_company_${row.company_id}`
    companyDirIdByMasterId.set(key(row.company_id), `company__${id}`)
    plan.contextCreates.push({ id, data: newCompanyDoc(row, opData) })
  }
}

// ---------------- PEOPLE ----------------
for (const row of people) {
  const emails = splitList(row.all_emails).concat(clean(row.primary_email)).map(normEmail).filter(Boolean)
  const name = clean(row.display_name || row.canonical_name)
  let matchId = null
  for (const e of emails) { matchId = single(contactByEmail.get(e)); if (matchId) break }
  if (!matchId && !emails.length && name) matchId = single(contactByNameCompany.get(`${nn(name)}|${nn(row.company_name)}`))
  const opData = personOpData(row)
  if (matchId) {
    personDirIdByMasterId.set(key(row.person_id), `person__${matchId}`)
    const existing = existingContacts.find((c) => c.id === matchId).data
    const update = buildContactUpdate(existing, row, opData)
    if (update && !queuedContactIds.has(matchId)) { queuedContactIds.add(matchId); plan.contactUpdates.push({ id: matchId, data: update }) }
    else plan.skipped.contacts++
  } else if (emails.length || name) {
    const id = `op_person_${row.person_id}`
    personDirIdByMasterId.set(key(row.person_id), `person__${id}`)
    plan.contactCreates.push({ id, data: newContactDoc(row, opData) })
  }
}

// ---------------- JOBS (match-only; unmatched → review) ----------------
for (const row of jobs) {
  const name = clean(row.canonical_name)
  if (!name) continue
  const matchId = single(jobByName.get(nn(name)))
  if (matchId) {
    const jobDirId = `job__${matchId}`
    const existing = existingContexts.find((c) => c.id === matchId).data
    const update = buildJobUpdate(existing, row, jobOpData(row))
    if (update && !queuedContextIds.has(matchId)) { queuedContextIds.add(matchId); plan.contextUpdates.push({ id: matchId, data: update }) }
    else plan.skipped.contexts++
    queueRelation(jobDirId, row.company_id, row, "job_company", name, row.company_name)
  } else {
    const rev = reviewDoc("operational_job_unmatched", "job", row.job_id, name,
      `job "${name}" not found in Directory by name; not auto-created to avoid duplicates`, "0", row.source_sheets)
    if (existingReviews.get(rev.id)?.contentHash !== rev.data.contentHash) plan.reviewWrites.push(rev)
    else plan.skipped.relations += 0
  }
}

// ---------------- person→company relations ----------------
for (const row of people) {
  if (!confHigh(row.company_match_confidence) || !clean(row.company_id)) continue
  const fromDir = personDirIdByMasterId.get(key(row.person_id))
  if (fromDir) queueRelation(fromDir, row.company_id, row, "person_company", row.display_name, row.company_name)
}

printSummary()

if (mode === "dry-run") {
  console.log("\nDry run only. No writes. Rerun with --write DRY_RUN=false CONFIRM_OPERATIONAL_ENRICHMENT=true.")
  process.exit(0)
}
if (mode === "verify") {
  const pending = plan.contactUpdates.length + plan.contactCreates.length + plan.contextUpdates.length + plan.contextCreates.length + plan.relationWrites.length + plan.reviewWrites.length
  console.log(`\nVERIFY: ${pending} pending writes (0 == fully idempotent/applied).`)
  process.exit(pending === 0 ? 0 : 2)
}

await applyBatched("contacts", plan.contactUpdates, true)
await applyBatched("contacts", plan.contactCreates, false)
await applyBatched("contexts", plan.contextUpdates, true)
await applyBatched("contexts", plan.contextCreates, false)
await applyBatched("directoryRelations", plan.relationWrites, "id-set")
await applyBatched("directoryReviewQueue", plan.reviewWrites, "id-set")
console.log("\nOperational enrichment applied. Rebuild /directoryIndex, then --verify.")

// ======================= builders =======================
function personOpData(row) {
  const d = clean0({
    schemaVersion: SCHEMA_VERSION, sourceFile: "operational", workbookSha256: workbookHash,
    canonicalId: clean(row.person_id), canonicalName: clean(row.canonical_name), displayName: clean(row.display_name),
    sourceType: clean(row.source_type), isInternalUser: row.is_internal_user === "1",
    emails: splitList(row.all_emails).map(normEmail).filter(Boolean), primaryEmail: normEmail(row.primary_email) || null,
    phones: splitList(row.all_phones).map(normPhone).filter(Boolean), primaryPhone: normPhone(row.primary_phone) || null,
    address: clean(row.address) || null, roleName: clean(row.role_name) || null, roleRaw: splitList(row.role_raw),
    companyNameRaw: clean(row.company_name) || null, companyId: clean(row.company_id) || null,
    companyMatchConfidence: num(row.company_match_confidence), aliases: splitList(row.legacy_user_identifier),
    sourceSheets: splitList(row.source_sheets),
  })
  d.contentHash = hash(d); return d
}
function companyOpData(row) {
  const d = clean0({
    schemaVersion: SCHEMA_VERSION, sourceFile: "operational", workbookSha256: workbookHash,
    canonicalId: clean(row.company_id), canonicalName: clean(row.canonical_name), displayName: clean(row.display_name),
    aliases: splitList(row.aliases), phone: row.phone_valid === "1" ? clean(row.phone) || null : null,
    address: clean(row.address) || null, website: clean(row.website) || null, description: clean(row.description) || null,
    sourceSheets: splitList(row.source_sheets),
  })
  d.contentHash = hash(d); return d
}
function jobOpData(row) {
  const d = clean0({
    schemaVersion: SCHEMA_VERSION, sourceFile: "operational", workbookSha256: workbookHash,
    canonicalId: clean(row.job_id), canonicalName: clean(row.canonical_name), locationLabel: clean(row.location_label) || null,
    companyId: clean(row.company_id) || null, companyName: clean(row.company_name) || null,
    companyMatchConfidence: num(row.company_match_confidence),
    jobRateAmount: clean(row.job_rate_amount) || null, jobRateUnit: clean(row.job_rate_unit) || null,
    sourceSheets: splitList(row.source_sheets),
  })
  d.contentHash = hash(d); return d
}

function buildContactUpdate(existing, row, opData) {
  const data = {}
  if (existing.operationalData?.contentHash !== opData.contentHash) data.operationalData = opData
  if (isInvalid(existing.role) && clean(row.role_name)) data.role = clean(row.role_name)
  if ((!Array.isArray(existing.roles) || !existing.roles.length) && clean(row.role_name)) data.roles = [clean(row.role_name)]
  if (isInvalid(existing.company) && clean(row.company_name) && confHigh(row.company_match_confidence)) {
    data.company = clean(row.company_name); data.companies = [clean(row.company_name)]
  }
  if (isInvalid(existing.phone) && normPhone(row.primary_phone)) { data.phone = clean(row.primary_phone); data.phoneNormalized = normPhone(row.primary_phone) }
  const newEmails = splitList(row.all_emails).map(normEmail).filter((e) => e && !contactEmails(existing).includes(e))
  if (newEmails.length) data.emailNormalizedCandidates = FieldValue.arrayUnion(...newEmails)
  if (Object.keys(data).length === 0) return null
  data.updatedAt = FieldValue.serverTimestamp()
  return data
}
function buildContextUpdate(existing, row, opData) {
  const data = {}
  if (existing.operationalData?.contentHash !== opData.contentHash) data.operationalData = opData
  const merged = mergeFields(existing.fields, [
    ["Phone", row.phone_valid === "1" ? row.phone : ""], ["Address", row.address],
    ["Website", row.website], ["Description", row.description],
  ])
  if (merged) data.fields = merged
  if (isInvalid(existing.description) && clean(row.description)) data.description = clean(row.description)
  if (Object.keys(data).length === 0) return null
  data.updatedAt = FieldValue.serverTimestamp()
  return data
}
function buildJobUpdate(existing, row, opData) {
  const data = {}
  if (existing.operationalData?.contentHash !== opData.contentHash) data.operationalData = opData
  const merged = mergeFields(existing.fields, [["Location", row.location_label], ["Job Rate Amount", row.job_rate_amount]])
  if (merged) data.fields = merged
  if (Object.keys(data).length === 0) return null
  data.updatedAt = FieldValue.serverTimestamp()
  return data
}

function newContactDoc(row, opData) {
  const email = normEmail(row.primary_email)
  const phone = clean(row.primary_phone)
  return clean0({
    ownerUserId, name: clean(row.display_name || row.canonical_name) || email || phone || clean(row.person_id),
    email: email || undefined, emailNormalized: email || undefined, emailNormalizedCandidates: email ? [email] : undefined,
    phone: phone || undefined, phoneNormalized: normPhone(phone) || undefined,
    company: confHigh(row.company_match_confidence) ? clean(row.company_name) || undefined : clean(row.company_name) || undefined,
    companies: clean(row.company_name) ? [clean(row.company_name)] : undefined,
    role: clean(row.role_name) || undefined, roles: clean(row.role_name) ? [clean(row.role_name)] : undefined,
    source: "operational", visibility: "global", status: "not_registered", tags: [],
    operationalData: opData, sourceSheet: splitList(row.source_sheets)[0] || "operational", sourceRecordId: clean(row.person_id),
    createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
  })
}
function newCompanyDoc(row, opData) {
  const fields = mergeFields([], [
    ["Kind", "Company"], ["Source Sheet", "operational"], ["Source ID", row.company_id],
    ["Phone", row.phone_valid === "1" ? row.phone : ""], ["Address", row.address], ["Website", row.website], ["Description", row.description],
  ]) || []
  return clean0({
    name: clean(row.canonical_name), description: clean(row.description) || undefined, fields,
    directoryType: "company", createdBy: ownerUserId, source: "operational",
    operationalData: opData, sourceSheet: "operational", sourceRecordId: clean(row.company_id),
    createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
  })
}

function queueRelation(fromDir, companyMasterId, row, type, fromName, toName) {
  const toDir = companyDirIdByMasterId.get(key(companyMasterId))
  if (!fromDir || !toDir) { plan.skipped.relations++; return }
  const relationshipId = `oprel_${type}_${fromDir}__${toDir}`.replace(/[^a-zA-Z0-9_]/g, "_")
  const data = clean0({
    schemaVersion: SCHEMA_VERSION, relationshipId, relationshipType: type,
    fromDirectoryId: fromDir, fromName: clean(fromName) || null,
    toDirectoryId: toDir, toName: clean(toName) || null, entityIds: [fromDir, toDir],
    confidence: num(row.company_match_confidence), active: true, sourceFile: "operational", workbookSha256: workbookHash,
  })
  data.contentHash = hash(data)
  const prev = existingRelations.get(relationshipId)
  if (prev?.contentHash === data.contentHash) { plan.skipped.relations++; return }
  plan.relationWrites.push({ id: relationshipId, data })
}
function reviewDoc(issueType, entityType, masterId, name, reason, confidence, sourceSheets) {
  const issueId = `opreview_${issueType}_${masterId}`.replace(/[^a-zA-Z0-9_]/g, "_")
  return { id: issueId, data: clean0({
    schemaVersion: SCHEMA_VERSION, issueId, issueType, entityType, entityMasterId: clean(masterId), entityName: clean(name),
    reason, confidence: num(confidence), status: "open", sourceSheets: splitList(sourceSheets),
    sourceFile: "operational", workbookSha256: workbookHash, contentHash: hash({ issueType, masterId, reason }),
  }) }
}

// ======================= io =======================
async function readCollection(name) {
  const snap = await db.collection(name).get()
  return snap.docs.map((d) => ({ id: d.id, data: d.data() }))
}
async function readRelations() {
  const map = new Map()
  try {
    const snap = await db.collection("directoryRelations").get()
    snap.docs.forEach((d) => map.set(d.id, d.data()))
  } catch { /* collection may not exist */ }
  return map
}
async function readReview() {
  const map = new Map()
  try {
    const snap = await db.collection("directoryReviewQueue").get()
    snap.docs.forEach((d) => map.set(d.id, d.data()))
  } catch { /* collection may not exist */ }
  return map
}
async function applyBatched(collectionName, writes, updateMode) {
  for (let i = 0; i < writes.length; i += 400) {
    const batch = db.batch()
    for (const w of writes.slice(i, i + 400)) {
      const ref = w.id ? db.collection(collectionName).doc(w.id) : db.collection(collectionName).doc()
      if (updateMode === true) batch.update(ref, w.data)
      else if (updateMode === "id-set") batch.set(ref, w.data, { merge: true })
      else batch.set(ref, w.data)
    }
    await batch.commit()
    console.log(`  ${collectionName}: ${Math.min(i + 400, writes.length)}/${writes.length}`)
  }
}

function printSummary() {
  console.log("Operational → Directory enrichment")
  console.log("==================================")
  console.log(`Mode: ${mode.toUpperCase()}  ·  Target: ${usingEmulator ? "EMULATOR" : "PROD"}  ·  Master sha256: ${workbookHash.slice(0, 12)}`)
  console.log(`Existing: contacts ${existingContacts.length}, contexts ${existingContexts.length}, relations ${existingRelations.size}`)
  console.log(`Master rows: people ${people.length}, companies ${companies.length}, jobs ${jobs.length}`)
  console.log("")
  console.log(`People   → enrich ${plan.contactUpdates.length}, create ${plan.contactCreates.length}, unchanged ${plan.skipped.contacts}`)
  console.log(`Contexts → update ${plan.contextUpdates.length}, create ${plan.contextCreates.length}, unchanged ${plan.skipped.contexts}`)
  console.log(`Relations→ write ${plan.relationWrites.length}, unchanged/skip ${plan.skipped.relations}`)
  console.log(`Review   → ${plan.reviewWrites.length} (unmatched jobs etc.)`)
}

// ======================= helpers =======================
function classify(d) {
  const dt = clean(d.directoryType).toLowerCase()
  if (dt === "company" || dt === "job" || dt === "person") return dt
  const kind = clean(getField(d.fields, "Kind")).toLowerCase()
  const sheet = clean(d.sourceSheet).toLowerCase()
  if (kind === "company" || sheet === "companies") return "company"
  if (["project/job", "job"].includes(kind) || sheet === "jobs") return "job"
  return "other"
}
function aliasFields(d) {
  const a = getField(d.fields, "Aliases")
  return [...(d.masterData?.aliases ?? []), ...splitList(a)]
}
function getField(fields, label) {
  if (!Array.isArray(fields)) return ""
  const f = fields.find((x) => clean(x.label).toLowerCase() === label.toLowerCase())
  return f ? clean(f.value) : ""
}
function mergeFields(existing, entries) {
  const out = Array.isArray(existing) ? existing.map((f) => ({ ...f })) : []
  let changed = false
  for (const [label, value] of entries) {
    const v = clean(value)
    if (!v) continue
    const cur = out.find((f) => clean(f.label).toLowerCase() === label.toLowerCase())
    if (!cur) { out.push({ label, value: v }); changed = true }
    else if (isInvalid(cur.value)) { cur.value = v; changed = true }
  }
  return changed ? out : null
}
function contactEmails(d) {
  return [d.email, d.emailNormalized, ...(d.emailNormalizedCandidates ?? []), ...((d.emails ?? []).flatMap((e) => [e.value, e.normalized]))]
    .map(normEmail).filter(Boolean)
}
function firstAliasMatch(row, index) {
  for (const a of splitList(row.aliases)) { const id = single(index.get(nn(a))); if (id) return id }
  return null
}
function single(v) { return Array.isArray(v) ? (v.length === 1 ? v[0] : v[0]) : v || null }
function push(map, k, v) { if (!k) return; if (!map.has(k)) map.set(k, []); map.get(k).push(v) }
function splitList(v) { return [...new Set(clean(v).split(/;\s*/).map(clean).filter(Boolean))] }
function normEmail(v) { const m = clean(v).toLowerCase().match(/[^\s@;,]+@[^\s@;,]+\.[a-z]{2,}/); return m ? m[0] : "" }
function normPhone(v) { let r = clean(v); if (/^\d+\.\d+e\d+$/i.test(r)) r = String(Math.trunc(Number(r))); const d = r.replace(/\D/g, ""); return d.length === 11 && d.startsWith("1") ? d.slice(1) : (d.length >= 7 ? d : "") }
function nn(v) { return clean(v).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").replace(/^[ ,.\-]+|[ ,.\-]+$/g, "") }
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0 }
function confHigh(v) { return num(v) >= 0.75 }
function clean(v) { return String(v ?? "").trim() }
function isInvalid(v) { const c = clean(v).toLowerCase(); return !c || ["null", "none", "n/a", "#error!", "blank", "no title", "$1.00"].includes(c) }
function key(v) { return clean(v).toLowerCase() }
function clean0(o) { return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) }
function hash(o) { return createHash("sha256").update(JSON.stringify(sortKeys(o))).digest("hex") }
function sortKeys(o) {
  // Only ever called on plain data objects (opData/relation/review) built before
  // any FieldValue sentinel is attached; contentHash itself is excluded.
  if (Array.isArray(o)) return o.map(sortKeys)
  if (o && typeof o === "object" && o.constructor === Object) {
    return Object.fromEntries(Object.keys(o).filter((k) => k !== "contentHash").sort().map((k) => [k, sortKeys(o[k])]))
  }
  return o
}
function fail(m) { console.error(`ERROR: ${m}`); process.exit(1) }
