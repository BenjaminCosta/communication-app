#!/usr/bin/env node
/**
 * Imports the legacy company database workbook into global contacts and contexts.
 *
 * Dry-run by default:
 *   OWNER_UID=<uid> GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node scripts/import-database-xlsx.mjs "New Database.xlsx"
 *
 * Production write:
 *   DRY_RUN=false CONFIRM_IMPORT=true OWNER_UID=<uid> GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node scripts/import-database-xlsx.mjs "New Database.xlsx"
 */

import { initializeApp, cert } from "firebase-admin/app"
import { getAuth } from "firebase-admin/auth"
import { FieldValue, getFirestore } from "firebase-admin/firestore"
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { basename } from "node:path"

const PROJECT_ID = "svc-comms"
const workbookPath = process.argv[2] ?? "New Database.xlsx"
const ownerUserId = process.env.OWNER_UID ?? ""
const dryRun = process.env.DRY_RUN !== "false"
const confirmed = process.env.CONFIRM_IMPORT === "true"
const saPath = process.env.GOOGLE_APPLICATION_CREDENTIALS

if (!saPath || !existsSync(saPath)) fail("Set GOOGLE_APPLICATION_CREDENTIALS to your service account JSON path.")
if (!existsSync(workbookPath)) fail(`Workbook not found: ${workbookPath}`)
if (!ownerUserId) fail("OWNER_UID is required, even for dry-run, because global contacts still need an owner.")
if (!dryRun && !confirmed) fail("Real import requires CONFIRM_IMPORT=true.")

const serviceAccount = JSON.parse(readFileSync(saPath, "utf8"))
const app = initializeApp({ credential: cert(serviceAccount), projectId: PROJECT_ID })
const auth = getAuth(app)
const db = getFirestore(app)

const users = await listRegisteredUsers(auth, db)
const owner = users.find((user) => user.id === ownerUserId)
if (!owner) fail(`OWNER_UID does not match a Firebase user: ${ownerUserId}`)

const workbook = JSON.parse(execFileSync("python3", ["scripts/parse-database-xlsx.py", workbookPath], {
  cwd: process.cwd(),
  encoding: "utf8",
  maxBuffer: 80 * 1024 * 1024,
}))

const importBatchId = `database-${basename(workbookPath).replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${new Date().toISOString().replace(/[:.]/g, "-")}`
const registeredEmailToUid = new Map(users.map((user) => [normalizeEmail(user.emailNormalized || user.email), user.id]).filter(([email]) => email))
const existingContacts = await readExistingContacts(db)
const existingContexts = await readExistingContexts(db)
const plan = buildImportPlan(workbook, {
  ownerUserId,
  registeredEmailToUid,
  existingContacts,
  existingContexts,
  importBatchId,
})

printSummary(plan, {
  workbookPath,
  owner,
  dryRun,
  importBatchId,
})

if (dryRun) {
  console.log("")
  console.log("Dry run only. No Firestore writes were made.")
  console.log("To import, rerun with DRY_RUN=false CONFIRM_IMPORT=true.")
  process.exit(0)
}

await writeCollection(db, "contexts", plan.contexts)
await writeCollection(db, "contacts", plan.contacts)
console.log("")
console.log(`Imported ${plan.contacts.length} contacts and ${plan.contexts.length} contexts.`)
console.log(`Batch: ${importBatchId}`)

function buildImportPlan(workbook, options) {
  const companies = workbook.Companies ?? []
  const contacts = workbook.Contacts ?? []
  const users = workbook.Users ?? []
  const jobs = workbook.Jobs ?? []
  const jobContacts = workbook["Job Contacts"] ?? []
  const roles = workbook.Roles ?? []

  const companyById = new Map(companies.map((row) => [upper(row.unique_id), row]).filter(([id]) => id))
  const roleById = new Map(roles.map((row) => [lower(row.ROW_ID), clean(row.Name)]).filter(([id, name]) => id && name))
  const contactBySourceId = new Map(contacts.map((row) => [upper(row.Key), row]).filter(([id]) => id))
  const jobContactsByJob = groupBy(jobContacts, (row) => upper(row.Job))

  const seenEmails = new Set(options.existingContacts.emails)
  const seenPhones = new Set(options.existingContacts.phones)
  const seenNameCompany = new Set(options.existingContacts.nameCompany)
  const seenSourceIds = new Set(options.existingContacts.sourceIds)
  const contextNames = new Set(options.existingContexts.names)
  const contextSourceIds = new Set(options.existingContexts.sourceIds)
  const plannedContextNames = new Set()
  const plannedContextSourceIds = new Set()
  const skippedContacts = []
  const skippedContexts = []

  const importContacts = []
  for (const row of contacts) {
    const mapped = mapContactRow(row, {
      sheet: "Contacts",
      ownerUserId: options.ownerUserId,
      importBatchId: options.importBatchId,
      companyById,
      roleById,
      registeredEmailToUid: options.registeredEmailToUid,
    })
    addContact(mapped, importContacts, skippedContacts, { emails: seenEmails, phones: seenPhones, nameCompany: seenNameCompany, sourceIds: seenSourceIds })
  }

  for (const row of users) {
    const mapped = mapUserRow(row, {
      ownerUserId: options.ownerUserId,
      importBatchId: options.importBatchId,
      roleById,
      registeredEmailToUid: options.registeredEmailToUid,
    })
    addContact(mapped, importContacts, skippedContacts, { emails: seenEmails, phones: seenPhones, nameCompany: seenNameCompany, sourceIds: seenSourceIds })
  }

  const contexts = []
  for (const row of companies) {
    const sourceId = upper(row.unique_id)
    const name = clean(row.Name)
    const fields = fieldsFrom([
      ["Kind", "Company"],
      ["Source Sheet", "Companies"],
      ["Source ID", sourceId],
      ["Phone", clean(row["Phone Number"])],
      ["Address", clean(row.Address)],
      ["Timezone", clean(row.Timezone)],
      ["Website", clean(row.Website)],
      ["Old VON X Key", clean(row["Old VON X Key"])],
      ["Description", clean(row.Description)],
    ])
    addContext({
      name,
      description: clean(row.Description) || undefined,
      fields,
      createdBy: options.ownerUserId,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      importBatchId: options.importBatchId,
      sourceSheet: "Companies",
      sourceRecordId: sourceId,
      sourceDatabaseFile: basename(workbookPath),
    }, contexts, skippedContexts, { contextNames, contextSourceIds, plannedContextNames, plannedContextSourceIds })
  }

  const jobNameCounts = countBy(jobs, (row) => normalizeName(row["Project Name"]))
  for (const row of jobs) {
    const sourceId = upper(row["Unique Id"])
    const baseName = clean(row["Project Name"])
    const relatedContacts = (jobContactsByJob.get(sourceId) ?? [])
      .map((link) => contactBySourceId.get(upper(link.Contact)))
      .filter(Boolean)
      .map((contact) => [clean(contact.Name), clean(contact.Email), clean(contact["Phone Number"])].filter(Boolean).join(" / "))
      .filter(Boolean)
    const name = jobNameCounts.get(normalizeName(baseName)) > 1
      ? uniqueContextName(`${baseName} - ${shortAddress(row.Address) || sourceId}`, plannedContextNames, contextNames)
      : baseName
    const pm = resolveContactRef(clean(row["Project Manager"]), contactBySourceId)
    const fields = fieldsFrom([
      ["Kind", "Project/Job"],
      ["Source Sheet", "Jobs"],
      ["Source ID", sourceId],
      ["Date Added", excelDate(row["DATE ADDED"])],
      ["Address", clean(row.Address)],
      ["Project Manager", pm || clean(row["Project Manager"])],
      ["Project Lead", clean(row["Project Lead"])],
      ["Estimated Start Date", excelDate(row["Estimated Start Date"])],
      ["Confirmed Start Date", excelDate(row["Confirmed Start Date"])],
      ["Duration in Weeks", clean(row["Duration in Weeks"])],
      ["Status", clean(row.Status)],
      ["LatLong", clean(row.LatLong)],
      ["Send Daily Report", clean(row["Send Daily Report"])],
      ["Image Folder Url", clean(row["Image Folder Url"])],
      ["Type", clean(row.TYPE)],
      ["RIZZ", clean(row.RIZZ)],
      ["Job Rate", clean(row["Job Rate"])],
      ["NET", clean(row.NET)],
      ["Company", clean(row.Company)],
      ["Related Contacts", relatedContacts.slice(0, 20).join("; ")],
    ])
    addContext({
      name,
      description: clean(row.Status) ? `Job status: ${clean(row.Status)}` : undefined,
      fields,
      createdBy: options.ownerUserId,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      importBatchId: options.importBatchId,
      sourceSheet: "Jobs",
      sourceRecordId: sourceId,
      sourceDatabaseFile: basename(workbookPath),
    }, contexts, skippedContexts, { contextNames, contextSourceIds, plannedContextNames, plannedContextSourceIds })
  }

  return { contacts: importContacts, contexts, skippedContacts, skippedContexts }
}

function mapContactRow(row, ctx) {
  const sourceId = upper(row.Key)
  const email = normalizeEmail(row.Email)
  const phone = displayPhone(row["Phone Number"])
  const phoneNormalized = normalizePhone(phone)
  const companyRow = ctx.companyById.get(upper(row.Company))
  const companyName = clean(companyRow?.Name) || clean(row.Company)
  const roleFromPosition = ctx.roleById.get(lower(row.Position)) || clean(row.Position)
  const jobTitle = clean(row["Job Title"])
  const role = jobTitle || roleFromPosition
  const notes = usefulNotes([row.Type].filter((value) => normalizeName(value) !== "a whiteboard!"))
  const linkedUserId = email ? ctx.registeredEmailToUid.get(email) ?? null : null
  const name = clean(row.Name) || email || phone || sourceId
  return cleanObject({
    ownerUserId: ctx.ownerUserId,
    name,
    email: email || undefined,
    emailNormalized: email || undefined,
    phone: phone || undefined,
    phoneNormalized: phoneNormalized || undefined,
    source: "database",
    visibility: "global",
    tags: [],
    linkedUserId,
    status: linkedUserId ? "registered" : "not_registered",
    emails: email ? [{ label: "email", value: email, normalized: email, isPrimary: true }] : undefined,
    phones: phone ? [{ label: "phone", value: phone, normalized: phoneNormalized || undefined, isPrimary: true }] : undefined,
    emailNormalizedCandidates: email ? [email] : undefined,
    company: companyName || undefined,
    companies: companyName ? [companyName] : undefined,
    role: role || undefined,
    roles: unique([jobTitle, roleFromPosition]).filter(Boolean),
    notes: notes || undefined,
    addresses: clean(row.Address) ? [{ label: "address", formatted: clean(row.Address) }] : undefined,
    urls: clean(row.Photo) ? [{ label: "Photo", value: clean(row.Photo) }] : undefined,
    importBatchId: ctx.importBatchId,
    sourceSheet: ctx.sheet,
    sourceRecordId: sourceId,
    sourceDatabaseFile: basename(workbookPath),
    sourceCompanyId: upper(row.Company) || undefined,
    sourcePositionId: lower(row.Position) || undefined,
    oldVonXKey: clean(row["Old VON X Key"]) || undefined,
    oldVonXCompanyKey: clean(row["Old VON X Company Key"]) || undefined,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })
}

function mapUserRow(row, ctx) {
  const email = normalizeEmail(row.Email)
  const phone = displayPhone(row["Phone Number"])
  const phoneNormalized = normalizePhone(phone)
  const role = ctx.roleById.get(lower(row.Role)) || clean(row.Role)
  const linkedUserId = email ? ctx.registeredEmailToUid.get(email) ?? null : null
  const activeValue = clean(row.Active)
  const notes = activeValue && !["true", "false"].includes(activeValue.toLowerCase()) ? activeValue : ""
  return cleanObject({
    ownerUserId: ctx.ownerUserId,
    name: clean(row.Username) || email,
    email: email || undefined,
    emailNormalized: email || undefined,
    phone: phone || undefined,
    phoneNormalized: phoneNormalized || undefined,
    source: "database",
    visibility: "global",
    tags: [],
    linkedUserId,
    status: linkedUserId ? "registered" : "not_registered",
    emails: email ? [{ label: "email", value: email, normalized: email, isPrimary: true }] : undefined,
    phones: phone ? [{ label: "phone", value: phone, normalized: phoneNormalized || undefined, isPrimary: true }] : undefined,
    emailNormalizedCandidates: email ? [email] : undefined,
    role: role || undefined,
    roles: role ? [role] : undefined,
    notes: notes || undefined,
    addresses: clean(row.Address) ? [{ label: "address", formatted: clean(row.Address) }] : undefined,
    importBatchId: ctx.importBatchId,
    sourceSheet: "Users",
    sourceRecordId: email || clean(row.Username),
    sourceDatabaseFile: basename(workbookPath),
    sourceRoleId: lower(row.Role) || undefined,
    sourceCurrentJobId: clean(row["Current Job"]) || undefined,
    geolocation: clean(row.Geolocation) || undefined,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })
}

function addContact(contact, contacts, skipped, seen) {
  if (!contact?.name || (!contact.email && !contact.phone)) {
    skipped.push({ name: contact?.name ?? "(blank)", reason: "no_contact_signal" })
    return
  }
  if (contact.sourceRecordId && seen.sourceIds.has(contact.sourceRecordId)) {
    skipped.push({ name: contact.name, reason: "duplicate_source_id" })
    return
  }
  if (contact.email && seen.emails.has(contact.email)) {
    skipped.push({ name: contact.name, reason: "duplicate_email", key: contact.email })
    return
  }
  if (contact.phoneNormalized && seen.phones.has(contact.phoneNormalized)) {
    skipped.push({ name: contact.name, reason: "duplicate_phone", key: contact.phoneNormalized })
    return
  }
  const nc = `${normalizeName(contact.name)}|${normalizeName(contact.company)}`
  if (!contact.email && !contact.phoneNormalized && seen.nameCompany.has(nc)) {
    skipped.push({ name: contact.name, reason: "duplicate_name_company", key: nc })
    return
  }
  if (contact.email) seen.emails.add(contact.email)
  if (contact.phoneNormalized) seen.phones.add(contact.phoneNormalized)
  if (contact.sourceRecordId) seen.sourceIds.add(contact.sourceRecordId)
  seen.nameCompany.add(nc)
  contacts.push(contact)
}

function addContext(context, contexts, skipped, seen) {
  const nameKey = normalizeName(context.name)
  const sourceKey = `${context.sourceSheet}:${context.sourceRecordId}`
  if (!context.name) {
    skipped.push({ name: "(blank)", reason: "blank_name" })
    return
  }
  if (context.sourceRecordId && (seen.contextSourceIds.has(sourceKey) || seen.plannedContextSourceIds.has(sourceKey))) {
    skipped.push({ name: context.name, reason: "duplicate_source_id" })
    return
  }
  if (seen.contextNames.has(nameKey) || seen.plannedContextNames.has(nameKey)) {
    skipped.push({ name: context.name, reason: "duplicate_name" })
    return
  }
  seen.plannedContextNames.add(nameKey)
  if (context.sourceRecordId) seen.plannedContextSourceIds.add(sourceKey)
  contexts.push(context)
}

async function readExistingContacts(db) {
  const snap = await db.collection("contacts").get()
  const emails = new Set()
  const phones = new Set()
  const nameCompany = new Set()
  const sourceIds = new Set()
  snap.docs.forEach((doc) => {
    const data = doc.data()
    ;[data.email, data.emailNormalized, ...(data.emailNormalizedCandidates ?? []), ...(data.emails ?? []).flatMap((item) => [item.value, item.normalized])].forEach((value) => {
      const email = normalizeEmail(value)
      if (email) emails.add(email)
    })
    ;[data.phone, data.phoneNormalized, ...(data.phones ?? []).flatMap((item) => [item.value, item.normalized])].forEach((value) => {
      const phone = normalizePhone(value)
      if (phone) phones.add(phone)
    })
    nameCompany.add(`${normalizeName(data.name)}|${normalizeName(data.company)}`)
    if (data.sourceRecordId) sourceIds.add(upper(data.sourceRecordId))
  })
  return { emails, phones, nameCompany, sourceIds }
}

async function readExistingContexts(db) {
  const snap = await db.collection("contexts").get()
  const names = new Set()
  const sourceIds = new Set()
  snap.docs.forEach((doc) => {
    const data = doc.data()
    names.add(normalizeName(data.name))
    if (data.sourceRecordId && data.sourceSheet) sourceIds.add(`${data.sourceSheet}:${data.sourceRecordId}`)
  })
  return { names, sourceIds }
}

async function listRegisteredUsers(auth, db) {
  const userDocs = await db.collection("users").get()
  const byUid = new Map(userDocs.docs.map((doc) => [doc.id, doc.data()]))
  const users = []
  let pageToken
  do {
    const page = await auth.listUsers(1000, pageToken)
    users.push(...page.users.map((user) => {
      const firestoreUser = byUid.get(user.uid) ?? {}
      return {
        id: user.uid,
        name: firestoreUser.name ?? user.displayName ?? user.email ?? user.uid,
        email: user.email ?? firestoreUser.email ?? "",
        emailNormalized: firestoreUser.emailNormalized ?? user.email?.toLowerCase() ?? "",
      }
    }))
    pageToken = page.pageToken
  } while (pageToken)
  return users
}

async function writeCollection(db, collectionName, docs) {
  for (let i = 0; i < docs.length; i += 400) {
    const batch = db.batch()
    docs.slice(i, i + 400).forEach((data) => {
      batch.set(db.collection(collectionName).doc(), sanitize(data))
    })
    await batch.commit()
    if (docs.length > 400) console.log(`Written ${collectionName}: ${Math.min(i + 400, docs.length)} / ${docs.length}`)
  }
}

function printSummary(plan, context) {
  const contactBySheet = countBy(plan.contacts, (contact) => contact.sourceSheet)
  const contextBySheet = countBy(plan.contexts, (ctx) => ctx.sourceSheet)
  console.log("")
  console.log("Database import summary")
  console.log("=======================")
  console.log(`Mode: ${context.dryRun ? "DRY RUN" : "WRITE"}`)
  console.log(`Workbook: ${context.workbookPath}`)
  console.log(`Owner: ${context.owner.id} (${context.owner.name}, ${context.owner.email})`)
  console.log(`Batch: ${context.importBatchId}`)
  console.log("")
  console.log(`Contacts to import: ${plan.contacts.length}`)
  console.log(`  Contacts sheet: ${contactBySheet.get("Contacts") ?? 0}`)
  console.log(`  Users sheet: ${contactBySheet.get("Users") ?? 0}`)
  console.log(`Skipped contacts: ${plan.skippedContacts.length}`)
  console.log(`Contexts to import: ${plan.contexts.length}`)
  console.log(`  Companies: ${contextBySheet.get("Companies") ?? 0}`)
  console.log(`  Jobs: ${contextBySheet.get("Jobs") ?? 0}`)
  console.log(`Skipped contexts: ${plan.skippedContexts.length}`)
  console.log("")
  console.log("Sample contacts:")
  plan.contacts.slice(0, 10).forEach((contact) => console.log(`- ${contact.name}${contact.company ? ` — ${contact.company}` : ""}${contact.email ? ` | ${contact.email}` : ""}${contact.phone ? ` | ${contact.phone}` : ""}`))
  console.log("")
  console.log("Sample contexts:")
  plan.contexts.slice(0, 10).forEach((ctx) => console.log(`- ${ctx.name} (${ctx.sourceSheet})`))
  console.log("")
  console.log("Skipped contact reasons:", formatReasonCounts(plan.skippedContacts))
  console.log("Skipped context reasons:", formatReasonCounts(plan.skippedContexts))
}

function fieldsFrom(entries) {
  return entries
    .filter(([, value]) => clean(value))
    .map(([label, value]) => ({ label, value: clean(value) }))
}

function resolveContactRef(id, contactBySourceId) {
  const contact = contactBySourceId.get(upper(id))
  if (!contact) return ""
  return [clean(contact.Name), clean(contact.Email), clean(contact["Phone Number"])].filter(Boolean).join(" / ")
}

function excelDate(value) {
  const raw = clean(value)
  if (!/^\d+(\.\d+)?$/.test(raw)) return raw
  const serial = Number(raw)
  if (!Number.isFinite(serial) || serial < 20000 || serial > 70000) return raw
  const millis = Math.round((serial - 25569) * 86400 * 1000)
  return new Date(millis).toISOString().slice(0, 10)
}

function shortAddress(value) {
  return clean(value).split(",").slice(0, 2).join(", ").slice(0, 60)
}

function uniqueContextName(base, plannedNames, existingNames) {
  let candidate = clean(base)
  let i = 2
  while (plannedNames.has(normalizeName(candidate)) || existingNames.has(normalizeName(candidate))) {
    candidate = `${base} ${i}`
    i += 1
  }
  return candidate
}

function countBy(items, keyFn) {
  const counts = new Map()
  items.forEach((item) => {
    const key = keyFn(item)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  })
  return counts
}

function groupBy(items, keyFn) {
  const groups = new Map()
  items.forEach((item) => {
    const key = keyFn(item)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(item)
  })
  return groups
}

function formatReasonCounts(items) {
  return [...countBy(items, (item) => item.reason).entries()].map(([reason, count]) => `${reason}: ${count}`).join(", ") || "none"
}

function usefulNotes(values) {
  return unique(values.map(clean).filter(Boolean)).join("\n")
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize).filter((item) => item !== undefined)
  if (value && typeof value === "object" && value.constructor === Object) {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, sanitize(child)]).filter(([, child]) => child !== undefined))
  }
  return value === undefined ? undefined : value
}

function cleanObject(value) {
  return sanitize(value)
}

function unique(values) {
  const seen = new Set()
  const out = []
  values.forEach((value) => {
    const cleaned = clean(value)
    const key = normalizeName(cleaned)
    if (!cleaned || seen.has(key)) return
    seen.add(key)
    out.push(cleaned)
  })
  return out
}

function normalizeEmail(value) {
  return clean(value).toLowerCase()
}

function normalizePhone(value) {
  let raw = clean(value)
  if (/^\d+\.\d+e\d+$/i.test(raw)) raw = String(Math.trunc(Number(raw)))
  const digits = raw.replace(/\D/g, "")
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits
}

function displayPhone(value) {
  const raw = clean(value)
  if (/^\d+\.\d+e\d+$/i.test(raw)) return normalizePhone(raw)
  return raw
}

function normalizeName(value) {
  return clean(value).toLowerCase().replace(/\s+/g, " ")
}

function clean(value) {
  return String(value ?? "").trim()
}

function upper(value) {
  return clean(value).toUpperCase()
}

function lower(value) {
  return clean(value).toLowerCase()
}

function fail(message) {
  console.error(`ERROR: ${message}`)
  process.exit(1)
}
