#!/usr/bin/env node
/**
 * Enriches SVC Directory source collections from the curated master workbook.
 *
 * Safety contract:
 * - dry-run by default;
 * - never deletes or changes Firestore document IDs;
 * - existing scalar values are preserved; canonical corrections live in
 *   `masterData` and missing/invalid top-level values are filled only;
 * - safe relationships are stored separately in /directoryRelations;
 * - ambiguous records are written to /directoryReviewQueue;
 * - /messages is read only during verification and is never written.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     node scripts/enrich-directory-from-master.mjs master.xlsx
 *
 *   DRY_RUN=false CONFIRM_MASTER_ENRICHMENT=true \
 *     GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     node scripts/enrich-directory-from-master.mjs master.xlsx --write
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     node scripts/enrich-directory-from-master.mjs master.xlsx --verify
 */

import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { basename } from "node:path"
import { cert, initializeApp } from "firebase-admin/app"
import { getAuth } from "firebase-admin/auth"
import { FieldValue, getFirestore } from "firebase-admin/firestore"

const PROJECT_ID = "svc-comms"
const MASTER_SCHEMA_VERSION = 1
const INVALID_VALUE_RE = /^(#(error|n\/?a|ref|value|name|div\/0|num|null)!?|n\/?a|null|undefined|none|—|–|-|\.+)$/i

const argv = process.argv.slice(2)
const mode = argv.includes("--verify") ? "verify" : argv.includes("--write") ? "write" : "dry-run"
const workbookPath = argv.find((arg) => !arg.startsWith("--")) ?? "SVC_Directory_Master_Source_of_Truth.xlsx"
const saPath = process.env.GOOGLE_APPLICATION_CREDENTIALS

if (!saPath || !existsSync(saPath)) fail("Set GOOGLE_APPLICATION_CREDENTIALS to a service account JSON path.")
if (!existsSync(workbookPath)) fail(`Workbook not found: ${workbookPath}`)
if (mode === "write" && (process.env.DRY_RUN !== "false" || process.env.CONFIRM_MASTER_ENRICHMENT !== "true")) {
  fail("Write mode requires DRY_RUN=false and CONFIRM_MASTER_ENRICHMENT=true.")
}

const sourceFile = basename(workbookPath)
const workbookHash = createHash("sha256").update(readFileSync(workbookPath)).digest("hex")
const migrationId = `svc-directory-master-v${MASTER_SCHEMA_VERSION}-${workbookHash.slice(0, 16)}`
const workbook = parseWorkbook(workbookPath)
validateWorkbook(workbook)

const serviceAccount = JSON.parse(readFileSync(saPath, "utf8"))
const app = initializeApp({ credential: cert(serviceAccount), projectId: PROJECT_ID })
const db = getFirestore(app)
const auth = getAuth(app)

const [contactSnap, contextSnap, relationSnap, reviewSnap, referenceSnap, messageSnap, authUsers, directoryIndexSnap, directoryMetaSnap] = await Promise.all([
  db.collection("contacts").get(),
  db.collection("contexts").get(),
  db.collection("directoryRelations").get(),
  db.collection("directoryReviewQueue").get(),
  db.collection("directoryReferenceData").get(),
  db.collection("messages").get(),
  listAuthUsers(auth),
  mode === "verify" ? db.collection("directoryIndex").get() : Promise.resolve({ docs: [], size: 0 }),
  mode === "verify" ? db.doc("directoryMeta/status").get() : Promise.resolve({ data: () => null }),
])

const contacts = contactSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
const contexts = contextSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
const existingRelations = new Map(relationSnap.docs.map((doc) => [doc.id, doc.data()]))
const existingReviews = new Map(reviewSnap.docs.map((doc) => [doc.id, doc.data()]))
const existingReferences = new Map(referenceSnap.docs.map((doc) => [doc.id, doc.data()]))
const authByEmail = new Map(authUsers.filter((user) => user.email).map((user) => [normalizeEmail(user.email), user.uid]))

const ownerUserId = inferOwnerUserId(contacts)
if (!ownerUserId) fail("Could not infer a unique ownerUserId from existing database contacts.")
if (process.env.OWNER_UID && process.env.OWNER_UID !== ownerUserId) {
  fail(`OWNER_UID ${process.env.OWNER_UID} does not match inferred database owner ${ownerUserId}.`)
}

const plan = buildPlan({
  workbook,
  contacts,
  contexts,
  existingRelations,
  existingReviews,
  existingReferences,
  authByEmail,
  ownerUserId,
})

printPlan(plan, {
  mode,
  sourceFile,
  workbookHash,
  migrationId,
  before: {
    contacts: contacts.length,
    contexts: contexts.length,
    relations: relationSnap.size,
    reviews: reviewSnap.size,
    references: referenceSnap.size,
    messages: messageSnap.size,
  },
})

if (mode === "dry-run") process.exit(0)

if (mode === "write") {
  await applyPlan(db, plan)
  await db.doc("directoryMeta/masterSource").set({
    schemaVersion: MASTER_SCHEMA_VERSION,
    sourceFile,
    workbookSha256: workbookHash,
    migrationId,
    sourceCounts: plan.sourceCounts,
    lastRunWrites: plan.counts,
    resultCounts: {
      resolvedPeople: plan.resolvedCounts.people,
      resolvedCompanies: plan.resolvedCounts.companies,
      resolvedJobs: plan.resolvedCounts.jobs,
      safeRelationships: plan.sourceCounts.safeRelationships - plan.generatedReviews.filter((issue) => issue.issue_type === "unresolved_firestore_relationship_endpoint").length,
      reviewIssues: plan.sourceCounts.reviews + plan.generatedReviews.length,
      referenceRecords: plan.sourceCounts.references,
    },
    lastAppliedAt: FieldValue.serverTimestamp(),
  })
  console.log("")
  console.log("Master enrichment applied. Re-run with --verify, then rebuild /directoryIndex.")
  process.exit(0)
}

const verification = verifyState({ contacts, contexts, plan, messageSnap, relationSnap, reviewSnap, referenceSnap, directoryIndexSnap, directoryMetaSnap })
console.log("")
console.log("Verification")
console.log("────────────")
for (const [key, value] of Object.entries(verification)) console.log(`  ${key}: ${formatValue(value)}`)
if (!verification.ok) process.exitCode = 1

function buildPlan({ workbook, contacts, contexts, existingRelations, existingReviews, existingReferences, authByEmail, ownerUserId }) {
  const people = workbook.People_Master
  const companies = workbook.Companies_Master
  const jobs = workbook.Jobs_Master
  const masterRelations = workbook.Relationships_Master
  const reviews = workbook.Review_Queue
  const references = workbook.Reference_Data

  const contactMatcher = buildContactMatcher(contacts, people)
  const contextMatcher = buildContextMatcher(contexts, companies, jobs)
  const contactByMasterId = new Map()
  const companyByMasterId = new Map()
  const jobByMasterId = new Map()
  const assignedContactIds = new Map()
  const assignedCompanyIds = new Map()
  const assignedJobIds = new Map()
  const contactWrites = []
  const contextWrites = []
  const generatedReviews = []
  const matchStats = { people: countMap(), companies: countMap(), jobs: countMap() }

  for (const row of people) {
    const masterData = personMasterData(row)
    const match = contactMatcher.match(row)
    matchStats.people.inc(match.method)
    if (match.status === "ambiguous") {
      generatedReviews.push(matchReview("person", row.person_id, row.display_name || row.canonical_name, match))
      continue
    }
    const existing = match.doc ?? null
    const id = existing?.id ?? stableDocId(row.person_id, "person")
    if (!existing && contactMatcher.byId.has(id)) {
      generatedReviews.push(matchReview("person", row.person_id, row.display_name || row.canonical_name, {
        status: "ambiguous", method: "document_id_collision", candidateIds: [id],
      }))
      continue
    }
    if (assignedContactIds.has(id)) {
      generatedReviews.push(canonicalCollisionReview("person", row.person_id, row.display_name || row.canonical_name, id, assignedContactIds.get(id)))
      continue
    }
    assignedContactIds.set(id, row.person_id)
    contactByMasterId.set(key(row.person_id), id)
    const data = buildContactWrite(existing, row, masterData, { id, ownerUserId, authByEmail })
    if (data) contactWrites.push({ id, exists: !!existing, data, previousHash: existing?.masterData?.contentHash ?? null })
  }

  for (const row of companies) {
    const masterData = companyMasterData(row)
    const match = contextMatcher.matchCompany(row)
    matchStats.companies.inc(match.method)
    if (match.status === "ambiguous") {
      generatedReviews.push(matchReview("company", row.company_id, row.display_name || row.canonical_name, match))
      continue
    }
    const existing = match.doc ?? null
    const id = existing?.id ?? stableDocId(row.company_id, "company")
    if (assignedCompanyIds.has(id)) {
      generatedReviews.push(canonicalCollisionReview("company", row.company_id, row.display_name || row.canonical_name, id, assignedCompanyIds.get(id)))
      continue
    }
    assignedCompanyIds.set(id, row.company_id)
    companyByMasterId.set(key(row.company_id), id)
    for (const legacyId of splitList(row.legacy_company_ids)) companyByMasterId.set(key(legacyId), id)
    const data = buildCompanyWrite(existing, row, masterData, { id, ownerUserId })
    if (data) contextWrites.push({ id, exists: !!existing, data })
  }

  for (const row of jobs) {
    const masterData = jobMasterData(row)
    const match = contextMatcher.matchJob(row)
    matchStats.jobs.inc(match.method)
    if (match.status === "ambiguous") {
      generatedReviews.push(matchReview("job", row.job_id, row.canonical_name, match))
      continue
    }
    const existing = match.doc ?? null
    const id = existing?.id ?? stableDocId(row.job_id, "job")
    if (assignedJobIds.has(id)) {
      generatedReviews.push(canonicalCollisionReview("job", row.job_id, row.canonical_name, id, assignedJobIds.get(id)))
      continue
    }
    assignedJobIds.set(id, row.job_id)
    jobByMasterId.set(key(row.job_id), id)
    masterData.companyContextId = companyByMasterId.get(key(row.company_id)) ?? null
    masterData.projectManagerContactId = contactByMasterId.get(key(row.project_manager_person_id)) ?? null
    masterData.projectLeadContactId = contactByMasterId.get(key(row.project_lead_person_id)) ?? null
    masterData.contentHash = contentHash(withoutContentHash(masterData))
    const data = buildJobWrite(existing, row, masterData, { id, ownerUserId })
    if (data) contextWrites.push({ id, exists: !!existing, data })
  }

  // Backfill resolved source IDs into person masterData after every company/job
  // has been matched. This affects only writes already planned in memory.
  for (const write of contactWrites) {
    const md = write.data.masterData
    if (!md) continue
    md.companyContextId = companyByMasterId.get(key(md.companyId)) ?? null
    md.currentJobContextId = jobByMasterId.get(key(md.currentJobId)) ?? null
    md.contentHash = contentHash(withoutContentHash(md))
  }
  const changedContactWrites = contactWrites.filter((write) => write.previousHash !== write.data.masterData.contentHash)

  const entityMaps = { person: contactByMasterId, company: companyByMasterId, job: jobByMasterId }
  const unmatchedExisting = {
    companies: contexts.filter((ctx) => classifyContext(ctx) === "company" && !assignedCompanyIds.has(ctx.id))
      .map((ctx) => ({ id: ctx.id, name: ctx.name, sourceRecordId: ctx.sourceRecordId })),
    jobs: contexts.filter((ctx) => classifyContext(ctx) === "job" && !assignedJobIds.has(ctx.id))
      .map((ctx) => ({ id: ctx.id, name: ctx.name, sourceRecordId: ctx.sourceRecordId, address: fieldValue(ctx.fields, "Address") })),
  }
  for (const company of unmatchedExisting.companies) generatedReviews.push(unmatchedSourceReview("company", company))
  for (const job of unmatchedExisting.jobs) generatedReviews.push(unmatchedSourceReview("job", job))
  const relationWrites = []
  for (const row of masterRelations) {
    if (!isSafeRelationship(row)) continue
    const fromSourceId = entityMaps[row.from_entity_type]?.get(key(row.from_entity_id)) ?? null
    const toSourceId = entityMaps[row.to_entity_type]?.get(key(row.to_entity_id)) ?? null
    if (!fromSourceId || !toSourceId) {
      generatedReviews.push(relationEndpointReview(row, fromSourceId, toSourceId))
      continue
    }
    const supervisorSourceId = contactByMasterId.get(key(row.super_person_id)) ?? null
    const data = relationshipData(row, fromSourceId, toSourceId, supervisorSourceId)
    const previous = existingRelations.get(row.relationship_id)
    if (previous?.contentHash !== data.contentHash) relationWrites.push({ id: row.relationship_id, exists: !!previous, data })
  }

  const reviewWrites = []
  for (const row of [...reviews, ...generatedReviews]) {
    const data = reviewData(row)
    const previous = existingReviews.get(data.issueId)
    if (previous?.contentHash !== data.contentHash) reviewWrites.push({ id: data.issueId, exists: !!previous, data })
  }

  const referenceWrites = []
  for (const row of references) {
    const data = referenceData(row)
    const id = `${safeSegment(data.referenceType)}__${safeSegment(data.referenceId)}`
    const previous = existingReferences.get(id)
    if (previous?.contentHash !== data.contentHash) referenceWrites.push({ id, exists: !!previous, data })
  }

  return {
    contactWrites: changedContactWrites,
    contextWrites,
    relationWrites,
    reviewWrites,
    referenceWrites,
    generatedReviews,
    matchStats,
    maps: entityMaps,
    unmatchedExisting,
    resolvedCounts: {
      people: assignedContactIds.size,
      companies: assignedCompanyIds.size,
      jobs: assignedJobIds.size,
    },
    sourceCounts: {
      people: people.length,
      companies: companies.length,
      jobs: jobs.length,
      relationships: masterRelations.length,
      safeRelationships: masterRelations.filter(isSafeRelationship).length,
      reviews: reviews.length,
      references: references.length,
    },
    counts: {
      contactsCreate: changedContactWrites.filter((w) => !w.exists).length,
      contactsUpdate: changedContactWrites.filter((w) => w.exists).length,
      contextsCreate: contextWrites.filter((w) => !w.exists).length,
      contextsUpdate: contextWrites.filter((w) => w.exists).length,
      relationsCreate: relationWrites.filter((w) => !w.exists).length,
      relationsUpdate: relationWrites.filter((w) => w.exists).length,
      reviewsCreate: reviewWrites.filter((w) => !w.exists).length,
      reviewsUpdate: reviewWrites.filter((w) => w.exists).length,
      referencesCreate: referenceWrites.filter((w) => !w.exists).length,
      referencesUpdate: referenceWrites.filter((w) => w.exists).length,
    },
  }
}

function buildContactMatcher(contacts, masterPeople) {
  const byId = new Map(contacts.map((doc) => [doc.id, doc]))
  const bySourceId = multiIndex(contacts, (doc) => [doc.sourceRecordId, doc.masterData?.canonicalId, ...(doc.masterData?.legacyContactIds ?? [])])
  const byEmail = multiIndex(contacts, contactEmails)
  const byPhone = multiIndex(contacts, contactPhones, normalizePhone)
  const byNameCompany = multiIndex(contacts, (doc) => [`${normalizeName(doc.name)}|${normalizeName(doc.company)}`])
  const masterEmailFrequency = valueFrequency(masterPeople, (row) => [...splitList(row.all_emails), row.primary_email, ...splitList(row.firebase_user_email)], normalizeEmail)
  const masterPhoneFrequency = valueFrequency(masterPeople, (row) => [...splitList(row.all_phones), row.primary_phone], normalizePhone)
  const masterNameCompanyFrequency = valueFrequency(masterPeople, (row) => [`${normalizeName(row.display_name || row.canonical_name)}|${normalizeName(row.company_name)}`])

  return {
    byId,
    match(row) {
      const direct = candidates(bySourceId, [...splitList(row.legacy_contact_id), row.person_id, ...splitList(row.legacy_user_identifier)])
      if (direct.size) return resolveCandidateSet(direct, "source_id")
      const emailValues = [...splitList(row.all_emails), row.primary_email, ...splitList(row.firebase_user_email)]
        .filter((value) => masterEmailFrequency.get(normalizeEmail(value)) === 1)
      const emails = candidates(byEmail, emailValues, normalizeEmail)
      if (emails.size) return resolveCandidateSet(emails, "email")
      const phoneValues = [...splitList(row.all_phones), row.primary_phone]
        .filter((value) => masterPhoneFrequency.get(normalizePhone(value)) === 1)
      const phones = candidates(byPhone, phoneValues, normalizePhone)
      if (phones.size) return resolveCandidateSet(phones, "phone")
      const nc = `${normalizeName(row.display_name || row.canonical_name)}|${normalizeName(row.company_name)}`
      const nameCompany = masterNameCompanyFrequency.get(nc) === 1 ? candidates(byNameCompany, [nc]) : new Set()
      if (nameCompany.size) return resolveCandidateSet(nameCompany, "name_company")
      return { status: "missing", method: "new", doc: null, candidateIds: [] }
    },
  }
}

function buildContextMatcher(contexts, masterCompanies, masterJobs) {
  const companies = contexts.filter((ctx) => classifyContext(ctx) === "company")
  const jobs = contexts.filter((ctx) => classifyContext(ctx) === "job")
  const companyBySource = multiIndex(companies, (ctx) => [ctx.sourceRecordId, ctx.masterData?.canonicalId, ...(ctx.masterData?.legacyCompanyIds ?? [])])
  const companyByName = multiIndex(companies, (ctx) => [ctx.name, ctx.masterData?.canonicalName, ctx.masterData?.displayName], normalizeName)
  const jobBySource = multiIndex(jobs, (ctx) => [ctx.sourceRecordId, ctx.masterData?.canonicalId])
  const jobByNameAddress = multiIndex(jobs, (ctx) => [`${normalizeName(ctx.name)}|${normalizeName(fieldValue(ctx.fields, "Address"))}`])
  const masterCompanyNameFrequency = valueFrequency(masterCompanies, (row) => [row.display_name, row.canonical_name, ...splitList(row.aliases)], normalizeName)
  const masterJobNameAddressFrequency = valueFrequency(masterJobs, (row) => [`${normalizeName(row.canonical_name)}|${normalizeName(row.address)}`])
  return {
    matchCompany(row) {
      const direct = candidates(companyBySource, [row.company_id, ...splitList(row.legacy_company_ids)])
      if (direct.size) return resolveCandidateSet(direct, "source_id")
      const uniqueNames = [row.display_name, row.canonical_name, ...splitList(row.aliases)]
        .filter((value) => masterCompanyNameFrequency.get(normalizeName(value)) === 1)
      const names = candidates(companyByName, uniqueNames, normalizeName)
      if (names.size) return resolveCandidateSet(names, "name")
      return { status: "missing", method: "new", doc: null, candidateIds: [] }
    },
    matchJob(row) {
      const direct = candidates(jobBySource, [row.job_id])
      if (direct.size) return resolveCandidateSet(direct, "source_id")
      const nameAddress = `${normalizeName(row.canonical_name)}|${normalizeName(row.address)}`
      const fallback = masterJobNameAddressFrequency.get(nameAddress) === 1 ? candidates(jobByNameAddress, [nameAddress]) : new Set()
      if (fallback.size) return resolveCandidateSet(fallback, "name_address")
      return { status: "missing", method: "new", doc: null, candidateIds: [] }
    },
  }
}

function buildContactWrite(existing, row, masterData, { ownerUserId, authByEmail }) {
  const emails = validEmails([...splitList(row.all_emails), row.primary_email, ...splitList(row.firebase_user_email)])
  const phones = validPhones([...splitList(row.all_phones), row.primary_phone])
  const name = clean(row.display_name || row.canonical_name) || emails[0] || phones[0] || clean(row.person_id)
  const safeCompany = confidence(row.company_match_confidence) >= 0.75 ? clean(row.company_name) : ""
  const role = clean(row.role_name)
  const address = clean(row.address)
  const linkedUserId = emails.map((email) => authByEmail.get(normalizeEmail(email))).find(Boolean) ?? null
  const data = { masterData }

  if (!existing) {
    Object.assign(data, cleanObject({
      ownerUserId,
      name,
      email: emails[0] || undefined,
      emailNormalized: emails[0] ? normalizeEmail(emails[0]) : undefined,
      phone: phones[0] || undefined,
      phoneNormalized: phones[0] ? normalizePhone(phones[0]) : undefined,
      source: "database",
      visibility: "global",
      tags: [],
      linkedUserId,
      status: linkedUserId ? "registered" : "not_registered",
      emails: contactPointList(emails, "email"),
      phones: contactPointList(phones, "phone", normalizePhone),
      emailNormalizedCandidates: emails.map(normalizeEmail),
      company: safeCompany || undefined,
      companies: safeCompany ? [safeCompany] : undefined,
      role: role || undefined,
      roles: role ? [role] : undefined,
      notes: clean(row.notes) || undefined,
      addresses: address ? [{ label: "address", formatted: address }] : undefined,
      urls: usefulPhoto(row.photo_url) ? [{ label: "Photo", value: clean(row.photo_url) }] : undefined,
      importBatchId: migrationId,
      sourceSheet: splitList(row.source_sheets)[0] || "People_Master",
      sourceRecordId: splitList(row.legacy_contact_id)[0] || splitList(row.legacy_user_identifier)[0] || row.person_id,
      sourceDatabaseFile: sourceFile,
      sourceCompanyId: clean(row.company_id) || undefined,
      sourcePositionId: clean(row.role_id) || undefined,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }))
    return data
  }

  if (isInvalid(existing.name) && name) data.name = name
  if (isInvalid(existing.email) && emails[0]) {
    data.email = emails[0]
    data.emailNormalized = normalizeEmail(emails[0])
  }
  if (isInvalid(existing.phone) && phones[0]) {
    data.phone = phones[0]
    data.phoneNormalized = normalizePhone(phones[0])
  }
  if (isInvalid(existing.company) && safeCompany) data.company = safeCompany
  if (isInvalid(existing.role) && role) data.role = role
  if (isInvalid(existing.notes) && clean(row.notes)) data.notes = clean(row.notes)
  data.emails = mergeContactPoints(existing.emails, emails, "email", normalizeEmail)
  data.phones = mergeContactPoints(existing.phones, phones, "phone", normalizePhone)
  data.emailNormalizedCandidates = unique([...(existing.emailNormalizedCandidates ?? []), ...emails.map(normalizeEmail)])
  data.companies = unique([...(existing.companies ?? []), existing.company, safeCompany])
  data.roles = unique([...(existing.roles ?? []), existing.role, role])
  if (address && !(existing.addresses ?? []).some((a) => normalizeName(a?.formatted) === normalizeName(address))) {
    data.addresses = [...(existing.addresses ?? []), { label: "address", formatted: address }]
  }
  if (!existing.linkedUserId && linkedUserId) {
    data.linkedUserId = linkedUserId
    data.status = "registered"
    data.linkedAt = FieldValue.serverTimestamp()
  }
  data.updatedAt = FieldValue.serverTimestamp()
  return cleanObject(data)
}

function buildCompanyWrite(existing, row, masterData, { ownerUserId }) {
  if (existing?.masterData?.contentHash === masterData.contentHash) return null
  const name = clean(row.display_name || row.canonical_name)
  const fields = mergeFields(existing?.fields, [
    ["Master ID", row.company_id],
    ["Aliases", row.aliases],
    ["Legacy Company IDs", row.legacy_company_ids],
    ["Phone", row.phone_valid === "1" ? row.phone : ""],
    ["Address", row.address],
    ["Website", row.website],
    ["Description", row.description],
  ])
  if (!existing) return cleanObject({
    name,
    description: clean(row.description) || undefined,
    fields: mergeFields([], [["Kind", "Company"], ["Source Sheet", "Companies"], ["Source ID", row.company_id], ...fields.map((f) => [f.label, f.value])]),
    directoryType: "company",
    createdBy: ownerUserId,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    importBatchId: migrationId,
    sourceSheet: "Companies",
    sourceRecordId: row.company_id,
    sourceDatabaseFile: sourceFile,
    masterData,
  })
  const data = { masterData, fields, directoryType: "company", updatedAt: FieldValue.serverTimestamp() }
  if (isInvalid(existing.name) && name) data.name = name
  if (isInvalid(existing.description) && clean(row.description)) data.description = clean(row.description)
  return cleanObject(data)
}

function buildJobWrite(existing, row, masterData, { ownerUserId }) {
  if (existing?.masterData?.contentHash === masterData.contentHash) return null
  const fields = mergeFields(existing?.fields, [
    ["Master ID", row.job_id],
    ["Address", row.address],
    ["Location", row.location_label],
    ["Latitude", row.latitude],
    ["Longitude", row.longitude],
    ["Parent Company", row.company_name],
    ["Parent Company Context ID", masterData.companyContextId],
    ["Parent Company Source ID", row.company_id],
    ["Company Match Method", row.company_match_method],
    ["Company Match Confidence", row.company_match_confidence],
    ["Project Manager", row.project_manager_name || row.project_manager_raw],
    ["Project Manager Contact ID", masterData.projectManagerContactId],
    ["Project Lead", row.project_lead_name || row.project_lead_raw],
    ["Project Lead Contact ID", masterData.projectLeadContactId],
    ["Estimated Start Date", excelDate(row.estimated_start_date)],
    ["Confirmed Start Date", excelDate(row.confirmed_start_date)],
    ["Confirmed Start Date Source", row.confirmed_start_date_source],
    ["Operational Notes", row.operational_notes],
    ["Duration in Weeks", row.duration_weeks],
    ["Status", row.status],
    ["Report Cadence", row.report_cadence],
    ["Image Folder Url", row.image_folder_url],
    ["Operating Zone", row.operating_zone],
    ["Project Type", row.project_type],
    ["Heat Label", row.heat_label],
    ["Recruiting Stages", row.recruiting_stages],
    ["Job Rate Amount", row.job_rate_amount],
    ["Job Rate Currency", row.job_rate_currency],
    ["Job Rate Unit", row.job_rate_unit],
  ])
  const name = clean(row.canonical_name || row.source_project_name)
  if (!existing) return cleanObject({
    name,
    description: clean(row.status) ? `Job status: ${clean(row.status)}` : undefined,
    fields: mergeFields([], [["Kind", "Project/Job"], ["Source Sheet", "Jobs_Master"], ["Source ID", row.job_id], ["Company", row.location_label], ...fields.map((f) => [f.label, f.value])]),
    directoryType: "job",
    createdBy: ownerUserId,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    importBatchId: migrationId,
    sourceSheet: "Jobs",
    sourceRecordId: row.job_id,
    sourceDatabaseFile: sourceFile,
    masterData,
  })
  const data = { masterData, fields, directoryType: "job", updatedAt: FieldValue.serverTimestamp() }
  if (isInvalid(existing.name) && name) data.name = name
  if (isInvalid(existing.description) && clean(row.status)) data.description = `Job status: ${clean(row.status)}`
  return cleanObject(data)
}

function personMasterData(row) {
  const data = {
    schemaVersion: MASTER_SCHEMA_VERSION,
    sourceFile,
    workbookSha256: workbookHash,
    canonicalId: clean(row.person_id),
    canonicalName: clean(row.canonical_name),
    displayName: clean(row.display_name),
    sourceType: clean(row.source_type),
    isInternalUser: booleanOrNull(row.is_internal_user),
    firebaseUserEmails: splitList(row.firebase_user_email),
    emails: validEmails([...splitList(row.all_emails), row.primary_email]),
    primaryEmail: validEmails([row.primary_email])[0] ?? null,
    phones: validPhones([...splitList(row.all_phones), row.primary_phone]),
    primaryPhone: validPhones([row.primary_phone])[0] ?? null,
    address: cleanOrNull(row.address),
    latitude: numberOrNull(row.latitude),
    longitude: numberOrNull(row.longitude),
    roleId: cleanOrNull(row.role_id),
    roleName: cleanOrNull(row.role_name),
    roleRaw: splitList(row.role_raw),
    companyId: cleanOrNull(row.company_id),
    companyName: confidence(row.company_match_confidence) >= 0.75 ? cleanOrNull(row.company_name) : null,
    companyContextId: null,
    companyMatchMethod: cleanOrNull(row.company_match_method),
    companyMatchConfidence: confidence(row.company_match_confidence),
    currentJobId: cleanOrNull(row.current_job_id),
    currentJobName: cleanOrNull(row.current_job_name),
    currentJobContextId: null,
    active: booleanOrNull(row.active),
    profilePicturePath: cleanOrNull(row.profile_picture_path),
    photoUrl: usefulPhoto(row.photo_url) ? clean(row.photo_url) : null,
    notes: cleanOrNull(row.notes),
    legacyContactIds: splitList(row.legacy_contact_id),
    legacyUserIdentifiers: splitList(row.legacy_user_identifier),
    oldVonXKeys: splitList(row.old_von_x_key),
    oldVonXCompanyKeys: splitList(row.old_von_x_company_key),
    sourceCompanyRaw: splitList(row.source_company_raw),
    sourcePositionRaw: splitList(row.source_position_raw),
    sourceSheets: splitList(row.source_sheets),
    sourceRowIds: splitList(row.source_row_ids),
    needsReview: row.needs_review === "1",
    reviewReason: cleanOrNull(row.review_reason),
  }
  data.contentHash = contentHash(data)
  return data
}

function companyMasterData(row) {
  const data = {
    schemaVersion: MASTER_SCHEMA_VERSION,
    sourceFile,
    workbookSha256: workbookHash,
    canonicalId: clean(row.company_id),
    canonicalName: clean(row.canonical_name),
    displayName: clean(row.display_name),
    aliases: unique([...splitList(row.aliases), ...splitList(row.short_names), ...splitList(row.old_von_x_names)]),
    phone: row.phone_valid === "1" ? cleanOrNull(row.phone) : null,
    phoneRaw: splitList(row.phone_raw),
    address: cleanOrNull(row.address),
    website: cleanOrNull(row.website),
    description: cleanOrNull(row.description),
    legacyCompanyIds: splitList(row.legacy_company_ids),
    sourceRowIds: splitList(row.source_rows),
    mergedRecordCount: numberOrNull(row.merged_record_count),
    needsReview: row.needs_review === "1",
    reviewReason: cleanOrNull(row.review_reason),
  }
  data.contentHash = contentHash(data)
  return data
}

function jobMasterData(row) {
  const data = {
    schemaVersion: MASTER_SCHEMA_VERSION,
    sourceFile,
    workbookSha256: workbookHash,
    canonicalId: clean(row.job_id),
    canonicalName: clean(row.canonical_name),
    sourceProjectName: cleanOrNull(row.source_project_name),
    dateAdded: excelDate(row.date_added),
    address: cleanOrNull(row.address),
    location: cleanOrNull(row.location_label),
    sourceCompanyRaw: cleanOrNull(row.source_company_raw),
    latitude: numberOrNull(row.latitude),
    longitude: numberOrNull(row.longitude),
    companyId: confidence(row.company_match_confidence) >= 0.75 ? cleanOrNull(row.company_id) : null,
    companyName: confidence(row.company_match_confidence) >= 0.75 ? cleanOrNull(row.company_name) : null,
    companyContextId: null,
    companyMatchMethod: cleanOrNull(row.company_match_method),
    companyMatchConfidence: confidence(row.company_match_confidence),
    projectManagerPersonId: cleanOrNull(row.project_manager_person_id),
    projectManagerName: cleanOrNull(row.project_manager_name),
    projectManagerRaw: cleanOrNull(row.project_manager_raw),
    projectManagerContactId: null,
    projectLeadPersonId: cleanOrNull(row.project_lead_person_id),
    projectLeadName: cleanOrNull(row.project_lead_name),
    projectLeadRaw: cleanOrNull(row.project_lead_raw),
    projectLeadContactId: null,
    estimatedStartDate: excelDate(row.estimated_start_date),
    confirmedStartDate: excelDate(row.confirmed_start_date),
    confirmedStartDateSource: cleanOrNull(row.confirmed_start_date_source),
    operationalNotes: cleanOrNull(row.operational_notes),
    durationWeeks: numberOrNull(row.duration_weeks),
    status: cleanOrNull(row.status),
    reportCadence: cleanOrNull(row.report_cadence),
    imageFolderUrl: cleanOrNull(row.image_folder_url),
    operatingZone: cleanOrNull(row.operating_zone),
    projectType: cleanOrNull(row.project_type),
    heatLabel: cleanOrNull(row.heat_label),
    recruitingStages: cleanOrNull(row.recruiting_stages),
    jobRateAmount: numberOrNull(row.job_rate_amount),
    jobRateCurrency: cleanOrNull(row.job_rate_currency),
    jobRateUnit: cleanOrNull(row.job_rate_unit),
    legacyNetRaw: cleanOrNull(row.legacy_net_raw),
    legacyRizzRaw: cleanOrNull(row.legacy_rizz_raw),
    sourceSheets: splitList(row.source_sheets),
    sourceRowIds: splitList(row.source_row_ids),
    isLegacyOrArchived: row.is_legacy_or_archived === "1",
    needsReview: row.needs_review === "1",
    reviewReason: cleanOrNull(row.review_reason),
  }
  data.contentHash = contentHash(data)
  return data
}

function relationshipData(row, fromSourceId, toSourceId, supervisorSourceId) {
  const fromDirectoryId = `${directoryType(row.from_entity_type)}__${fromSourceId}`
  const toDirectoryId = `${directoryType(row.to_entity_type)}__${toSourceId}`
  const data = cleanObject({
    schemaVersion: MASTER_SCHEMA_VERSION,
    relationshipId: row.relationship_id,
    relationshipType: row.relationship_type,
    fromEntityType: row.from_entity_type,
    fromMasterId: row.from_entity_id,
    fromSourceId,
    fromDirectoryId,
    fromName: cleanOrNull(row.from_entity_name),
    toEntityType: row.to_entity_type,
    toMasterId: row.to_entity_id,
    toSourceId,
    toDirectoryId,
    toName: cleanOrNull(row.to_entity_name),
    role: cleanOrNull(row.role),
    supervisorMasterId: cleanOrNull(row.super_person_id),
    supervisorSourceId,
    supervisorDirectoryId: supervisorSourceId ? directoryId("person", supervisorSourceId) : null,
    supervisorName: cleanOrNull(row.super_name),
    sourceRelationIds: splitList(row.source_relation_id),
    sourceSheets: splitList(row.source_sheet),
    sourceValue: cleanOrNull(row.source_value),
    confidence: confidence(row.confidence),
    sourceFile,
    workbookSha256: workbookHash,
    active: true,
  })
  data.contentHash = contentHash(data)
  return data
}

function reviewData(row) {
  const issueId = clean(row.issue_id) || deterministicId("review", row)
  const data = cleanObject({
    schemaVersion: MASTER_SCHEMA_VERSION,
    issueId,
    issueType: clean(row.issue_type),
    entityType: clean(row.entity_type),
    entityMasterId: cleanOrNull(row.entity_id),
    entityName: cleanOrNull(row.entity_name),
    sourceSheets: splitList(row.source_sheet),
    sourceRowIds: splitList(row.source_row_id),
    rawValue: cleanOrNull(row.raw_value),
    candidateMatches: splitList(row.candidate_matches),
    recommendedAction: cleanOrNull(row.recommended_action),
    confidence: confidence(row.confidence),
    reason: cleanOrNull(row.reason || row.review_reason),
    status: clean(row.status) || "open",
    sourceFile,
    workbookSha256: workbookHash,
  })
  data.contentHash = contentHash(data)
  return data
}

function referenceData(row) {
  const data = cleanObject({
    schemaVersion: MASTER_SCHEMA_VERSION,
    referenceType: clean(row.reference_type),
    referenceId: clean(row.reference_id),
    canonicalValue: cleanOrNull(row.canonical_value),
    displayValue: cleanOrNull(row.display_value),
    aliases: splitList(row.aliases),
    url: cleanOrNull(row.url),
    imagePath: cleanOrNull(row.image_path),
    sourceSheets: splitList(row.source_sheet),
    notes: cleanOrNull(row.notes),
    sourceFile,
    workbookSha256: workbookHash,
  })
  data.contentHash = contentHash(data)
  return data
}

async function applyPlan(db, plan) {
  await writeBatches(db, "contacts", plan.contactWrites)
  await writeBatches(db, "contexts", plan.contextWrites)
  await writeBatches(db, "directoryRelations", plan.relationWrites)
  await writeBatches(db, "directoryReviewQueue", plan.reviewWrites)
  await writeBatches(db, "directoryReferenceData", plan.referenceWrites)
}

async function writeBatches(db, collectionName, writes) {
  for (let i = 0; i < writes.length; i += 400) {
    const batch = db.batch()
    for (const write of writes.slice(i, i + 400)) {
      const ref = db.collection(collectionName).doc(write.id)
      if (write.exists) batch.update(ref, { ...write.data, updatedAt: FieldValue.serverTimestamp() })
      else batch.set(ref, { ...write.data, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
    }
    await batch.commit()
    console.log(`  ${collectionName}: ${Math.min(i + 400, writes.length)} / ${writes.length}`)
  }
  if (!writes.length) console.log(`  ${collectionName}: no changes`)
}

function verifyState({ contacts, contexts, plan, messageSnap, relationSnap, reviewSnap, referenceSnap, directoryIndexSnap, directoryMetaSnap }) {
  const contactIds = new Set(contacts.map((doc) => doc.id))
  const contextIds = new Set(contexts.map((doc) => doc.id))
  let brokenContactRefs = 0
  let brokenContextRefs = 0
  for (const doc of messageSnap.docs) {
    const data = doc.data()
    for (const id of data.contactIds ?? []) if (!contactIds.has(id)) brokenContactRefs += 1
    for (const id of data.contextIds ?? []) if (!contextIds.has(id)) brokenContextRefs += 1
  }
  const enrichedContacts = contacts.filter((doc) => doc.masterData?.workbookSha256 === workbookHash).length
  const enrichedContexts = contexts.filter((doc) => doc.masterData?.workbookSha256 === workbookHash).length
  const expectedPeople = plan.resolvedCounts.people
  const expectedContexts = plan.resolvedCounts.companies + plan.resolvedCounts.jobs
  const expectedRelations = plan.sourceCounts.safeRelationships - plan.generatedReviews.filter((issue) => issue.issue_type === "unresolved_firestore_relationship_endpoint").length
  const expectedReviews = plan.sourceCounts.reviews + plan.generatedReviews.length
  const enrichedRelations = relationSnap.docs.filter((doc) => doc.data().workbookSha256 === workbookHash && doc.data().active === true).length
  const enrichedReviews = reviewSnap.docs.filter((doc) => doc.data().workbookSha256 === workbookHash).length
  const enrichedReferences = referenceSnap.docs.filter((doc) => doc.data().workbookSha256 === workbookHash).length
  const schema3IndexDocs = directoryIndexSnap.docs.filter((doc) => doc.data().schemaVersion === 3).length
  const indexedJobCompanyRelations = directoryIndexSnap.docs.filter((doc) => doc.data().type === "job" && !!doc.data().companyEntityId).length
  const expectedJobCompanyRelations = contexts.filter((ctx) => classifyContext(ctx) === "job" && !!ctx.masterData?.companyContextId).length
  const directoryMeta = directoryMetaSnap.data?.() ?? {}
  const pendingWrites = Object.values(plan.counts).reduce((sum, count) => sum + count, 0)
  return {
    ok: enrichedContacts === expectedPeople && enrichedContexts === expectedContexts && enrichedRelations === expectedRelations && enrichedReviews === expectedReviews && enrichedReferences === plan.sourceCounts.references && directoryIndexSnap.size === contacts.length + contexts.length && schema3IndexDocs === directoryIndexSnap.size && indexedJobCompanyRelations === expectedJobCompanyRelations && directoryMeta.schemaVersion === 3 && directoryMeta.counts?.total === directoryIndexSnap.size && brokenContactRefs === 0 && brokenContextRefs === 0 && pendingWrites === 0,
    enrichedContacts: `${enrichedContacts}/${expectedPeople}`,
    enrichedContexts: `${enrichedContexts}/${expectedContexts}`,
    safeRelations: `${enrichedRelations}/${expectedRelations}`,
    reviewIssues: `${enrichedReviews}/${expectedReviews}`,
    referenceRecords: `${enrichedReferences}/${plan.sourceCounts.references}`,
    directoryIndexDocs: `${directoryIndexSnap.size}/${contacts.length + contexts.length}`,
    directoryIndexSchema3: `${schema3IndexDocs}/${directoryIndexSnap.size}`,
    indexedJobCompanyRelations: `${indexedJobCompanyRelations}/${expectedJobCompanyRelations}`,
    directoryMetaSchema: directoryMeta.schemaVersion ?? "missing",
    brokenMessageContactRefs: brokenContactRefs,
    brokenMessageContextRefs: brokenContextRefs,
    pendingWrites,
  }
}

function printPlan(plan, context) {
  console.log("")
  console.log("SVC Directory master enrichment")
  console.log("═══════════════════════════════")
  console.log(`Mode: ${context.mode}`)
  console.log(`Workbook: ${context.sourceFile}`)
  console.log(`SHA-256: ${context.workbookHash}`)
  console.log(`Migration: ${context.migrationId}`)
  console.log(`Before: contacts=${context.before.contacts}, contexts=${context.before.contexts}, messages=${context.before.messages}`)
  console.log("")
  console.log("Source counts")
  for (const [key, value] of Object.entries(plan.sourceCounts)) console.log(`  ${key}: ${value}`)
  console.log("")
  console.log("Match methods")
  console.log(`  people: ${plan.matchStats.people.format()}`)
  console.log(`  companies: ${plan.matchStats.companies.format()}`)
  console.log(`  jobs: ${plan.matchStats.jobs.format()}`)
  console.log("")
  console.log("Planned writes")
  for (const [key, value] of Object.entries(plan.counts)) console.log(`  ${key}: ${value}`)
  console.log(`  generated review issues: ${plan.generatedReviews.length}`)
  if (plan.generatedReviews.length) {
    for (const issue of plan.generatedReviews.slice(0, 20)) {
      console.log(`    - ${issue.issue_type}: ${issue.entity_type}/${issue.entity_id}${issue.candidate_matches ? ` [${issue.candidate_matches}]` : ""}`)
    }
  }
  const newContacts = plan.contactWrites.filter((write) => !write.exists).map((write) => `${write.data.masterData.canonicalId}:${write.data.masterData.displayName || write.data.masterData.canonicalName}`)
  const newContexts = plan.contextWrites.filter((write) => !write.exists).map((write) => `${write.data.masterData.canonicalId}:${write.data.masterData.canonicalName}`)
  console.log(`  new contact sample: ${newContacts.slice(0, 10).join(" | ") || "none"}`)
  console.log(`  new contexts: ${newContexts.join(" | ") || "none"}`)
  console.log(`  unmatched existing companies: ${plan.unmatchedExisting.companies.map((item) => `${item.id}:${item.sourceRecordId}:${item.name}`).join(" | ") || "none"}`)
  console.log(`  unmatched existing jobs: ${plan.unmatchedExisting.jobs.map((item) => `${item.id}:${item.sourceRecordId}:${item.name}:${item.address}`).join(" | ") || "none"}`)
  if (context.mode === "dry-run") console.log("\nDry run only. No Firestore writes were made.")
}

function matchReview(entityType, entityId, entityName, match) {
  return {
    issue_id: deterministicId("match", { entityType, entityId, candidates: match.candidateIds }),
    issue_type: "ambiguous_existing_entity_match",
    entity_type: entityType,
    entity_id: entityId,
    entity_name: entityName,
    candidate_matches: (match.candidateIds ?? []).join("; "),
    recommended_action: "Choose the surviving Firestore source document before enrichment.",
    confidence: "0.5",
    reason: `Master row matched multiple existing documents via ${match.method}.`,
    status: "open",
  }
}

function canonicalCollisionReview(entityType, entityId, entityName, sourceId, priorMasterId) {
  return {
    issue_id: deterministicId("canonical-collision", { entityType, entityId, sourceId, priorMasterId }),
    issue_type: "multiple_master_entities_match_one_source_document",
    entity_type: entityType,
    entity_id: entityId,
    entity_name: entityName,
    candidate_matches: sourceId,
    recommended_action: `Review canonical ${entityType} ${priorMasterId} and ${entityId} before merging either one.`,
    confidence: "0.5",
    reason: "Two canonical master rows resolved to the same existing Firestore source document.",
    status: "open",
  }
}

function relationEndpointReview(row, fromSourceId, toSourceId) {
  return {
    issue_id: deterministicId("relation-endpoint", row.relationship_id),
    issue_type: "unresolved_firestore_relationship_endpoint",
    entity_type: "relationship",
    entity_id: row.relationship_id,
    entity_name: `${row.from_entity_name || row.from_entity_id} → ${row.to_entity_name || row.to_entity_id}`,
    source_sheet: row.source_sheet,
    source_row_id: row.source_relation_id,
    raw_value: row.source_value,
    candidate_matches: `from=${fromSourceId || "unresolved"}; to=${toSourceId || "unresolved"}`,
    recommended_action: "Resolve the ambiguous entity match, then rerun the idempotent enrichment.",
    confidence: "0",
    reason: "A safe master relationship could not be mapped to both Firestore source documents.",
    status: "open",
  }
}

function unmatchedSourceReview(entityType, entity) {
  return {
    issue_id: deterministicId("unmatched-source", { entityType, id: entity.id, sourceRecordId: entity.sourceRecordId }),
    issue_type: "existing_source_not_in_master",
    entity_type: entityType,
    entity_id: entity.sourceRecordId || entity.id,
    entity_name: entity.name,
    candidate_matches: entity.id,
    recommended_action: "Confirm whether this preserved source document is a legacy duplicate, archived record, or valid exception.",
    confidence: "0",
    reason: "The existing Firestore source document has no canonical entity match in the master workbook and was intentionally left unchanged.",
    status: "open",
  }
}

function resolveCandidateSet(set, method) {
  const docs = [...set]
  if (docs.length === 1) return { status: "matched", method, doc: docs[0], candidateIds: [docs[0].id] }
  return { status: "ambiguous", method, doc: null, candidateIds: docs.map((doc) => doc.id).sort() }
}

function multiIndex(items, valuesFn, normalizer = key) {
  const index = new Map()
  for (const item of items) {
    for (const raw of valuesFn(item) ?? []) {
      const normalized = normalizer(raw)
      if (!normalized) continue
      if (!index.has(normalized)) index.set(normalized, new Set())
      index.get(normalized).add(item)
    }
  }
  return index
}

function valueFrequency(items, valuesFn, normalizer = key) {
  const counts = new Map()
  for (const item of items) {
    const perItem = new Set((valuesFn(item) ?? []).map(normalizer).filter(Boolean))
    for (const value of perItem) counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return counts
}

function candidates(index, values, normalizer = key) {
  const found = new Set()
  for (const value of values) for (const doc of index.get(normalizer(value)) ?? []) found.add(doc)
  return found
}

function contactEmails(doc) {
  return [doc.email, doc.emailNormalized, ...(doc.emailNormalizedCandidates ?? []), ...(doc.emails ?? []).flatMap((item) => [item?.value, item?.normalized])]
}

function contactPhones(doc) {
  return [doc.phone, doc.phoneNormalized, ...(doc.phones ?? []).flatMap((item) => [item?.value, item?.normalized])]
}

function classifyContext(ctx) {
  const explicit = clean(ctx.directoryType).toLowerCase()
  if (["company", "job", "other"].includes(explicit)) return explicit
  const kind = clean(fieldValue(ctx.fields, "Kind")).toLowerCase()
  const sheet = clean(ctx.sourceSheet).toLowerCase()
  if (kind === "company" || sheet === "companies") return "company"
  if (["project/job", "job"].includes(kind) || sheet === "jobs") return "job"
  return "other"
}

function mergeFields(existing, entries) {
  const out = Array.isArray(existing) ? existing.filter((f) => clean(f?.label)).map((f) => ({ label: clean(f.label), value: clean(f.value) })) : []
  const byLabel = new Map(out.map((field, index) => [normalizeName(field.label), index]))
  for (const entry of entries) {
    const [label, rawValue] = Array.isArray(entry) ? entry : [entry?.label, entry?.value]
    const value = clean(rawValue)
    if (!label || isInvalid(value)) continue
    const labelKey = normalizeName(label)
    const index = byLabel.get(labelKey)
    if (index == null) {
      byLabel.set(labelKey, out.length)
      out.push({ label: clean(label), value })
    }
  }
  return out
}

function mergeContactPoints(existing, values, label, normalizer) {
  const out = Array.isArray(existing) ? existing.filter((p) => !isInvalid(p?.value)).map((p) => cleanObject(p)) : []
  const seen = new Set(out.map((p) => normalizer(p.normalized || p.value)).filter(Boolean))
  for (const value of values) {
    const normalized = normalizer(value)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    out.push({ label, value: clean(value), normalized, isPrimary: out.length === 0 })
  }
  return out
}

function contactPointList(values, label, normalizer = normalizeEmail) {
  return values.map((value, index) => ({ label, value, normalized: normalizer(value), isPrimary: index === 0 }))
}

function fieldValue(fields, label) {
  if (!Array.isArray(fields)) return ""
  return clean(fields.find((field) => normalizeName(field?.label) === normalizeName(label))?.value)
}

function isSafeRelationship(row) {
  return row.is_valid === "1" && row.needs_review !== "1" && confidence(row.confidence) >= 0.75
}

function directoryType(entityType) {
  return entityType === "person" ? "person" : entityType === "company" ? "company" : "job"
}
function directoryId(type, sourceId) { return `${type}__${sourceId}` }

function inferOwnerUserId(contacts) {
  const counts = new Map()
  for (const contact of contacts.filter((doc) => doc.source === "database" && clean(doc.ownerUserId))) {
    counts.set(contact.ownerUserId, (counts.get(contact.ownerUserId) ?? 0) + 1)
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1])
  return sorted[0]?.[0] ?? null
}

async function listAuthUsers(auth) {
  const users = []
  let pageToken
  do {
    const page = await auth.listUsers(1000, pageToken)
    users.push(...page.users.map((user) => ({ uid: user.uid, email: user.email ?? "" })))
    pageToken = page.pageToken
  } while (pageToken)
  return users
}

function parseWorkbook(path) {
  const output = execFileSync("python3", ["scripts/parse-database-xlsx.py", path], {
    cwd: process.cwd(), encoding: "utf8", maxBuffer: 160 * 1024 * 1024,
  })
  return JSON.parse(output)
}

function validateWorkbook(workbook) {
  const required = ["People_Master", "Companies_Master", "Jobs_Master", "Relationships_Master", "Reference_Data", "Review_Queue"]
  for (const sheet of required) if (!Array.isArray(workbook[sheet])) fail(`Missing required sheet: ${sheet}`)
}

function splitList(value) {
  return unique(clean(value).split(/;\s*/).map(clean).filter(Boolean))
}

function validEmails(values) {
  return unique(values.map(clean).filter((value) => !isInvalid(value) && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)), normalizeEmail)
}

function validPhones(values) {
  return unique(values.map(clean).filter((value) => !isInvalid(value) && normalizePhone(value).length >= 7), normalizePhone)
}

function unique(values, normalizer = normalizeName) {
  const seen = new Set()
  const out = []
  for (const value of values) {
    const cleaned = clean(value)
    const normalized = normalizer(cleaned)
    if (!cleaned || !normalized || seen.has(normalized)) continue
    seen.add(normalized)
    out.push(cleaned)
  }
  return out
}

function normalizeEmail(value) { return clean(value).toLowerCase() }
function normalizePhone(value) {
  let raw = clean(value)
  if (/^\d+\.\d+e\d+$/i.test(raw)) raw = String(Math.trunc(Number(raw)))
  const digits = raw.replace(/\D/g, "")
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits
}
function normalizeName(value) { return clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ") }
function key(value) { return clean(value).toLowerCase() }
function clean(value) { return String(value ?? "").trim() }
function cleanOrNull(value) { const v = clean(value); return isInvalid(v) ? null : v }
function isInvalid(value) { const v = clean(value); return !v || INVALID_VALUE_RE.test(v) }
function confidence(value) { const n = Number(value); return Number.isFinite(n) ? n : 0 }
function numberOrNull(value) { const n = Number(value); return Number.isFinite(n) && clean(value) ? n : null }
function booleanOrNull(value) { return value === "1" || /^true$/i.test(value) ? true : value === "0" || /^false$/i.test(value) ? false : null }

function excelDate(value) {
  const raw = clean(value)
  if (!raw) return null
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10)
  if (!/^\d+(\.\d+)?$/.test(raw)) return raw
  const serial = Number(raw)
  if (serial < 20000 || serial > 70000) return raw
  return new Date(Math.round((serial - 25569) * 86400 * 1000)).toISOString().slice(0, 10)
}

function usefulPhoto(value) {
  const url = clean(value)
  return !!url && !/craftypixels\.com\/placeholder-image/i.test(url) && !isInvalid(url)
}

function stableDocId(value, prefix) {
  const id = clean(value).replace(/\//g, "_")
  return id || deterministicId(prefix, value)
}

function safeSegment(value) { return clean(value).replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "unknown" }
function deterministicId(prefix, value) { return `${prefix}_${contentHash(value).slice(0, 20)}` }
function contentHash(value) { return createHash("sha256").update(stableStringify(value)).digest("hex") }
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`
  if (value && typeof value === "object" && value.constructor === Object) {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`
  }
  return JSON.stringify(value)
}
function withoutContentHash(value) { const { contentHash: _ignored, ...rest } = value; return rest }

function cleanObject(value) {
  if (Array.isArray(value)) return value.map(cleanObject).filter((item) => item !== undefined)
  if (value && typeof value === "object" && value.constructor === Object) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, cleanObject(v)]).filter(([, v]) => v !== undefined))
  }
  return value === undefined ? undefined : value
}

function countMap() {
  const map = new Map()
  return {
    inc(key) { map.set(key, (map.get(key) ?? 0) + 1) },
    format() { return [...map.entries()].sort().map(([k, v]) => `${k}=${v}`).join(", ") || "none" },
  }
}

function formatValue(value) { return typeof value === "boolean" ? (value ? "PASS" : "FAIL") : String(value) }
function fail(message) { console.error(`ERROR: ${message}`); process.exit(1) }
