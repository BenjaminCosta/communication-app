#!/usr/bin/env node
/**
 * SVC Directory Audit — read-only analysis of /contacts and /contexts.
 *
 * Classifies every document, detects relationships, finds duplicates,
 * and reports data quality issues. Does NOT write to Firestore.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node scripts/audit-directory.mjs
 *
 * Optional:
 *   --json   Output raw JSON instead of formatted report
 */

import { initializeApp, cert } from "firebase-admin/app"
import { getFirestore } from "firebase-admin/firestore"
import { readFileSync, existsSync } from "node:fs"

const saPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
if (!saPath || !existsSync(saPath)) {
  console.error("ERROR: Set GOOGLE_APPLICATION_CREDENTIALS to your service account JSON path.")
  process.exit(1)
}

const jsonMode = process.argv.includes("--json")

const serviceAccount = JSON.parse(readFileSync(saPath, "utf8"))
const app = initializeApp({ credential: cert(serviceAccount), projectId: "svc-comms" })
const db = getFirestore(app)

// ── Read all documents ──────────────────────────────────────────────────

console.log("Reading /contacts...")
const contactSnap = await db.collection("contacts").get()
const contacts = contactSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
console.log(`  ${contacts.length} contacts`)

console.log("Reading /contexts...")
const contextSnap = await db.collection("contexts").get()
const contexts = contextSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
console.log(`  ${contexts.length} contexts`)

console.log("Reading /messages (for relationship analysis)...")
const messageSnap = await db.collection("messages").get()
const messages = messageSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
console.log(`  ${messages.length} messages`)

console.log("")

// ── Classify contacts ───────────────────────────────────────────────────

const classifiedContacts = contacts.map((c) => {
  const sourceSheet = (c.sourceSheet ?? "").toLowerCase()
  return {
    id: c.id,
    name: c.name ?? "(blank)",
    directoryType: "person",
    sourceSheet: c.sourceSheet ?? null,
    source: c.source ?? null,
    email: c.email ?? c.emailNormalized ?? null,
    phone: c.phone ?? null,
    company: c.company ?? null,
    role: c.role ?? null,
    linkedUserId: c.linkedUserId ?? null,
    visibility: c.visibility ?? "private",
    hasEmails: Array.isArray(c.emails) && c.emails.length > 0,
    hasPhones: Array.isArray(c.phones) && c.phones.length > 0,
    hasAddresses: Array.isArray(c.addresses) && c.addresses.length > 0,
    hasNotes: !!c.notes,
    sourceRecordId: c.sourceRecordId ?? null,
  }
})

// ── Classify contexts ───────────────────────────────────────────────────

function getFieldValue(fields, label) {
  if (!Array.isArray(fields)) return null
  const f = fields.find((f) => f.label?.toLowerCase() === label.toLowerCase())
  return f?.value?.trim() || null
}

function hasAnyField(fields, labels) {
  if (!Array.isArray(fields)) return false
  const normalized = new Set(labels.map((l) => l.toLowerCase()))
  return fields.some((f) => normalized.has(f.label?.toLowerCase()) && f.value?.trim())
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

const classifiedContexts = contexts.map((ctx) => {
  const directoryType = classifyContext(ctx)
  return {
    id: ctx.id,
    name: ctx.name ?? "(blank)",
    directoryType,
    sourceSheet: ctx.sourceSheet ?? null,
    description: ctx.description ?? null,
    fieldCount: Array.isArray(ctx.fields) ? ctx.fields.length : 0,
    kind: getFieldValue(ctx.fields ?? [], "Kind"),
    sourceRecordId: ctx.sourceRecordId ?? null,
    hasAddress: !!getFieldValue(ctx.fields ?? [], "Address"),
    hasPhone: !!getFieldValue(ctx.fields ?? [], "Phone"),
    hasWebsite: !!getFieldValue(ctx.fields ?? [], "Website"),
    hasStatus: !!getFieldValue(ctx.fields ?? [], "Status"),
    company: getFieldValue(ctx.fields ?? [], "Company"),
    projectManager: getFieldValue(ctx.fields ?? [], "Project Manager"),
  }
})

// ── Classification summary ──────────────────────────────────────────────

const contactsByType = groupBy(classifiedContacts, (c) => c.directoryType)
const contextsByType = groupBy(classifiedContexts, (c) => c.directoryType)

const totalDocs = contacts.length + contexts.length
const classified = {
  person: (contactsByType.get("person") ?? []).length,
  company: (contextsByType.get("company") ?? []).length,
  job: (contextsByType.get("job") ?? []).length,
  other: (contextsByType.get("other") ?? []).length,
}
const classifiedCount = classified.person + classified.company + classified.job
const classifiedPct = totalDocs > 0 ? ((classifiedCount / totalDocs) * 100).toFixed(1) : "0"

// ── Contact breakdown by source ─────────────────────────────────────────

const contactsBySource = groupBy(classifiedContacts, (c) => c.source ?? "unknown")
const contactsBySheet = groupBy(classifiedContacts, (c) => c.sourceSheet ?? "unknown")
const contactsByVisibility = groupBy(classifiedContacts, (c) => c.visibility)

// ── Context breakdown by source sheet ───────────────────────────────────

const contextsBySheet = groupBy(classifiedContexts, (c) => c.sourceSheet ?? "unknown")
const contextsByKind = groupBy(classifiedContexts, (c) => c.kind ?? "(none)")

// ── Detect person↔company relationships ─────────────────────────────────

const companyNames = new Map()
for (const ctx of classifiedContexts) {
  if (ctx.directoryType === "company") {
    companyNames.set(ctx.name.toLowerCase().trim(), ctx)
  }
}

const personCompanyLinks = []
const personCompanyUnresolved = []
for (const contact of classifiedContacts) {
  if (!contact.company) continue
  const key = contact.company.toLowerCase().trim()
  if (companyNames.has(key)) {
    personCompanyLinks.push({
      personId: contact.id,
      personName: contact.name,
      companyId: companyNames.get(key).id,
      companyName: companyNames.get(key).name,
      role: contact.role,
    })
  } else {
    personCompanyUnresolved.push({
      personId: contact.id,
      personName: contact.name,
      companyName: contact.company,
      role: contact.role,
    })
  }
}

// ── Detect job↔company relationships ────────────────────────────────────

const jobCompanyLinks = []
const jobCompanyUnresolved = []
for (const ctx of classifiedContexts) {
  if (ctx.directoryType !== "job" || !ctx.company) continue
  const key = ctx.company.toLowerCase().trim()
  if (companyNames.has(key)) {
    jobCompanyLinks.push({
      jobId: ctx.id,
      jobName: ctx.name,
      companyId: companyNames.get(key).id,
      companyName: companyNames.get(key).name,
    })
  } else {
    jobCompanyUnresolved.push({
      jobId: ctx.id,
      jobName: ctx.name,
      companyName: ctx.company,
    })
  }
}

// ── Message references audit ────────────────────────────────────────────

const contactIdSet = new Set(contacts.map((c) => c.id))
const contextIdSet = new Set(contexts.map((c) => c.id))

let msgsWithContacts = 0
let msgsWithContexts = 0
let brokenContactRefs = 0
let brokenContextRefs = 0
const brokenContactRefSamples = []
const brokenContextRefSamples = []

for (const msg of messages) {
  const cIds = msg.contactIds ?? []
  const ctxIds = msg.contextIds ?? []
  if (cIds.length > 0) msgsWithContacts++
  if (ctxIds.length > 0) msgsWithContexts++
  for (const id of cIds) {
    if (!contactIdSet.has(id)) {
      brokenContactRefs++
      if (brokenContactRefSamples.length < 10) {
        brokenContactRefSamples.push({ messageId: msg.id, contactId: id, text: (msg.text ?? "").slice(0, 60) })
      }
    }
  }
  for (const id of ctxIds) {
    if (!contextIdSet.has(id)) {
      brokenContextRefs++
      if (brokenContextRefSamples.length < 10) {
        brokenContextRefSamples.push({ messageId: msg.id, contextId: id, text: (msg.text ?? "").slice(0, 60) })
      }
    }
  }
}

// ── Duplicate detection ─────────────────────────────────────────────────

const dupEmails = findDuplicates(classifiedContacts, (c) => c.email?.toLowerCase().trim()).filter((g) => g.key)
const dupPhones = findDuplicates(classifiedContacts, (c) => {
  const digits = (c.phone ?? "").replace(/\D/g, "")
  return digits.length >= 7 ? digits : null
})
const dupContextNames = findDuplicates(classifiedContexts, (c) => c.name.toLowerCase().trim())

// ── Data quality issues ─────────────────────────────────────────────────

const qualityIssues = { error: 0, warning: 0, details: [] }

for (const c of classifiedContacts) {
  if (!c.name.trim() || c.name === "(blank)") addIssue("error", "person", c.id, c.name, "Missing name")
  if (!c.email && !c.phone) addIssue("warning", "person", c.id, c.name, "No email or phone")
  if (!c.company) addIssue("warning", "person", c.id, c.name, "No company")
  if (!c.role) addIssue("warning", "person", c.id, c.name, "No role")
}

for (const ctx of classifiedContexts) {
  if (!ctx.name.trim() || ctx.name === "(blank)") addIssue("error", ctx.directoryType, ctx.id, ctx.name, "Missing name")
  if (ctx.directoryType === "company" && !ctx.hasPhone && !ctx.hasAddress && !ctx.hasWebsite) {
    addIssue("warning", "company", ctx.id, ctx.name, "No phone, address, or website")
  }
  if (ctx.directoryType === "job" && !ctx.hasStatus) {
    addIssue("warning", "job", ctx.id, ctx.name, "No status")
  }
  if (ctx.directoryType === "job" && !ctx.hasAddress) {
    addIssue("warning", "job", ctx.id, ctx.name, "No address")
  }
  if (ctx.directoryType === "job" && !ctx.company) {
    addIssue("warning", "job", ctx.id, ctx.name, "No company association")
  }
}

function addIssue(severity, type, id, name, issue) {
  qualityIssues[severity]++
  if (qualityIssues.details.length < 200) {
    qualityIssues.details.push({ severity, type, id, name, issue })
  }
}

// ── Issue summary by type ───────────────────────────────────────────────

const issueCounts = {}
for (const issue of qualityIssues.details) {
  const key = `${issue.type}:${issue.issue}`
  issueCounts[key] = (issueCounts[key] ?? 0) + 1
}
// Extrapolate if capped at 200
if (qualityIssues.details.length >= 200) {
  // Re-count from full data
  const fullCounts = {}
  for (const c of classifiedContacts) {
    if (!c.name.trim() || c.name === "(blank)") inc(fullCounts, "person:Missing name")
    if (!c.email && !c.phone) inc(fullCounts, "person:No email or phone")
    if (!c.company) inc(fullCounts, "person:No company")
    if (!c.role) inc(fullCounts, "person:No role")
  }
  for (const ctx of classifiedContexts) {
    if (!ctx.name.trim() || ctx.name === "(blank)") inc(fullCounts, `${ctx.directoryType}:Missing name`)
    if (ctx.directoryType === "company" && !ctx.hasPhone && !ctx.hasAddress && !ctx.hasWebsite) inc(fullCounts, "company:No phone, address, or website")
    if (ctx.directoryType === "job" && !ctx.hasStatus) inc(fullCounts, "job:No status")
    if (ctx.directoryType === "job" && !ctx.hasAddress) inc(fullCounts, "job:No address")
    if (ctx.directoryType === "job" && !ctx.company) inc(fullCounts, "job:No company association")
  }
  Object.assign(issueCounts, fullCounts)
}

function inc(obj, key) { obj[key] = (obj[key] ?? 0) + 1 }

// ── Linked users analysis ───────────────────────────────────────────────

const linkedContacts = classifiedContacts.filter((c) => c.linkedUserId)

// ── Output ──────────────────────────────────────────────────────────────

if (jsonMode) {
  console.log(JSON.stringify({
    summary: { totalDocs, classified, classifiedPct, messages: messages.length },
    contactsBySource: mapToObj(contactsBySource, (v) => v.length),
    contactsBySheet: mapToObj(contactsBySheet, (v) => v.length),
    contactsByVisibility: mapToObj(contactsByVisibility, (v) => v.length),
    contextsBySheet: mapToObj(contextsBySheet, (v) => v.length),
    contextsByKind: mapToObj(contextsByKind, (v) => v.length),
    relationships: {
      personCompany: { resolved: personCompanyLinks.length, unresolved: personCompanyUnresolved.length },
      jobCompany: { resolved: jobCompanyLinks.length, unresolved: jobCompanyUnresolved.length },
    },
    messageRefs: { msgsWithContacts, msgsWithContexts, brokenContactRefs, brokenContextRefs },
    duplicates: { emails: dupEmails.length, phones: dupPhones.length, contextNames: dupContextNames.length },
    quality: { errors: qualityIssues.error, warnings: qualityIssues.warning, issueCounts },
    linkedUsers: linkedContacts.length,
  }, null, 2))
  process.exit(0)
}

// ── Formatted report ────────────────────────────────────────────────────

console.log("╔══════════════════════════════════════════════════════════════════╗")
console.log("║              SVC DIRECTORY AUDIT REPORT                         ║")
console.log("╚══════════════════════════════════════════════════════════════════╝")
console.log("")

console.log("1. CLASSIFICATION SUMMARY")
console.log("─────────────────────────")
console.log(`   Total documents:   ${totalDocs}`)
console.log(`   ├─ /contacts:      ${contacts.length}`)
console.log(`   └─ /contexts:      ${contexts.length}`)
console.log(`   Messages:          ${messages.length}`)
console.log("")
console.log(`   Directory types:`)
console.log(`   ├─ person:         ${classified.person}  (${pct(classified.person, totalDocs)})`)
console.log(`   ├─ company:        ${classified.company}  (${pct(classified.company, totalDocs)})`)
console.log(`   ├─ job:            ${classified.job}  (${pct(classified.job, totalDocs)})`)
console.log(`   └─ other:          ${classified.other}  (${pct(classified.other, totalDocs)})`)
console.log(`   Classification:    ${classifiedPct}% classified (person+company+job)`)
console.log("")

console.log("2. CONTACTS BREAKDOWN")
console.log("─────────────────────")
console.log(`   By source:`)
for (const [source, items] of contactsBySource) {
  console.log(`   ├─ ${source}: ${items.length}`)
}
console.log(`   By sheet:`)
for (const [sheet, items] of contactsBySheet) {
  console.log(`   ├─ ${sheet}: ${items.length}`)
}
console.log(`   By visibility:`)
for (const [vis, items] of contactsByVisibility) {
  console.log(`   ├─ ${vis}: ${items.length}`)
}
console.log(`   Linked to Firebase user: ${linkedContacts.length}`)
console.log("")

console.log("3. CONTEXTS BREAKDOWN")
console.log("─────────────────────")
console.log(`   By source sheet:`)
for (const [sheet, items] of contextsBySheet) {
  console.log(`   ├─ ${sheet}: ${items.length}`)
}
console.log(`   By Kind field:`)
for (const [kind, items] of contextsByKind) {
  console.log(`   ├─ ${kind}: ${items.length}`)
}
console.log(`   By directory type:`)
for (const [type, items] of contextsByType) {
  console.log(`   ├─ ${type}: ${items.length}`)
}
console.log("")

console.log("4. RELATIONSHIPS")
console.log("────────────────")
console.log(`   Person → Company:`)
console.log(`   ├─ Resolved:    ${personCompanyLinks.length}`)
console.log(`   └─ Unresolved:  ${personCompanyUnresolved.length}`)
if (personCompanyUnresolved.length > 0) {
  console.log(`      Unresolved company names (sample):`)
  const uniqueCompanies = [...new Set(personCompanyUnresolved.map((u) => u.companyName))]
  uniqueCompanies.slice(0, 15).forEach((name) => {
    const count = personCompanyUnresolved.filter((u) => u.companyName === name).length
    console.log(`      ├─ "${name}" (${count} people)`)
  })
  if (uniqueCompanies.length > 15) console.log(`      └─ ... and ${uniqueCompanies.length - 15} more`)
}
console.log(`   Job → Company:`)
console.log(`   ├─ Resolved:    ${jobCompanyLinks.length}`)
console.log(`   └─ Unresolved:  ${jobCompanyUnresolved.length}`)
if (jobCompanyUnresolved.length > 0) {
  console.log(`      Unresolved company names (sample):`)
  const uniqueCompanies = [...new Set(jobCompanyUnresolved.map((u) => u.companyName))]
  uniqueCompanies.slice(0, 10).forEach((name) => {
    console.log(`      ├─ "${name}"`)
  })
}
console.log("")

console.log("5. MESSAGE REFERENCES")
console.log("─────────────────────")
console.log(`   Messages referencing contacts: ${msgsWithContacts}`)
console.log(`   Messages referencing contexts: ${msgsWithContexts}`)
console.log(`   Broken contact refs:           ${brokenContactRefs}`)
console.log(`   Broken context refs:           ${brokenContextRefs}`)
if (brokenContactRefSamples.length > 0) {
  console.log(`   Broken contact ref samples:`)
  brokenContactRefSamples.slice(0, 5).forEach((s) => {
    console.log(`   ├─ msg=${s.messageId} → contact=${s.contactId}`)
  })
}
if (brokenContextRefSamples.length > 0) {
  console.log(`   Broken context ref samples:`)
  brokenContextRefSamples.slice(0, 5).forEach((s) => {
    console.log(`   ├─ msg=${s.messageId} → context=${s.contextId}`)
  })
}
console.log("")

console.log("6. DUPLICATES")
console.log("─────────────")
console.log(`   Duplicate email groups:        ${dupEmails.length}`)
console.log(`   Duplicate phone groups:        ${dupPhones.length}`)
console.log(`   Duplicate context name groups: ${dupContextNames.length}`)
if (dupEmails.length > 0) {
  console.log(`   Sample duplicate emails:`)
  dupEmails.slice(0, 5).forEach((g) => {
    console.log(`   ├─ ${g.key}: ${g.entries.map((e) => e.name).join(", ")}`)
  })
}
if (dupContextNames.length > 0) {
  console.log(`   Sample duplicate context names:`)
  dupContextNames.slice(0, 5).forEach((g) => {
    console.log(`   ├─ "${g.key}": ${g.entries.map((e) => `${e.name} (${e.source})`).join(", ")}`)
  })
}
console.log("")

console.log("7. DATA QUALITY")
console.log("───────────────")
console.log(`   Errors:    ${qualityIssues.error}`)
console.log(`   Warnings:  ${qualityIssues.warning}`)
console.log(`   Issue breakdown:`)
const sortedIssues = Object.entries(issueCounts).sort((a, b) => b[1] - a[1])
for (const [key, count] of sortedIssues) {
  const [type, issue] = key.split(":")
  console.log(`   ├─ [${type}] ${issue}: ${count}`)
}
console.log("")

console.log("╔══════════════════════════════════════════════════════════════════╗")
console.log(`║  Classification rate: ${classifiedPct}% of ${totalDocs} documents                  `)
console.log("╚══════════════════════════════════════════════════════════════════╝")

// ── Helpers ─────────────────────────────────────────────────────────────

function groupBy(items, keyFn) {
  const groups = new Map()
  items.forEach((item) => {
    const key = keyFn(item)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(item)
  })
  return groups
}

function findDuplicates(items, keyFn) {
  const groups = new Map()
  items.forEach((item) => {
    const key = keyFn(item)
    if (!key) return
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(item)
  })
  return [...groups.entries()]
    .filter(([, entries]) => entries.length > 1)
    .map(([key, entries]) => ({
      key,
      entries: entries.map((e) => ({ id: e.id, name: e.name, source: e.sourceSheet ?? e.source ?? "" })),
    }))
}

function pct(n, total) {
  return total > 0 ? `${((n / total) * 100).toFixed(1)}%` : "0%"
}

function mapToObj(map, valueFn) {
  const obj = {}
  for (const [key, value] of map) obj[key] = valueFn(value)
  return obj
}
