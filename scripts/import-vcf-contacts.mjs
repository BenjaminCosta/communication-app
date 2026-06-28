#!/usr/bin/env node
/**
 * Imports a .vcf file into Firestore /contacts as unregistered/imported People.
 *
 * Dry-run by default:
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json OWNER_UID=<uid> node scripts/import-vcf-contacts.mjs jfhContacts.vcf
 *
 * Production write:
 *   DRY_RUN=false CONFIRM_IMPORT=true GOOGLE_APPLICATION_CREDENTIALS=./service-account.json OWNER_UID=<uid> node scripts/import-vcf-contacts.mjs jfhContacts.vcf
 */

import { initializeApp, cert } from "firebase-admin/app"
import { getAuth } from "firebase-admin/auth"
import { FieldValue, getFirestore } from "firebase-admin/firestore"
import { existsSync, readFileSync } from "fs"
import { basename } from "path"
import { parseVcfImportedContacts } from "../lib/vcf-import.ts"

const PROJECT_ID = "svc-comms"
const vcfPath = process.argv[2] ?? "jfhContacts.vcf"
const ownerUserId = process.env.OWNER_UID ?? ""
const dryRun = process.env.DRY_RUN !== "false"
const confirmed = process.env.CONFIRM_IMPORT === "true"
const saPath = process.env.GOOGLE_APPLICATION_CREDENTIALS

if (!saPath || !existsSync(saPath)) {
  console.error("ERROR: Set GOOGLE_APPLICATION_CREDENTIALS to your service account JSON path.")
  process.exit(1)
}

if (!existsSync(vcfPath)) {
  console.error(`ERROR: VCF file not found: ${vcfPath}`)
  process.exit(1)
}

if (!dryRun && !ownerUserId) {
  console.error("ERROR: OWNER_UID is required for a real import.")
  process.exit(1)
}

if (!dryRun && !confirmed) {
  console.error("ERROR: Real import requires CONFIRM_IMPORT=true.")
  process.exit(1)
}

const serviceAccount = JSON.parse(readFileSync(saPath, "utf8"))
const app = initializeApp({ credential: cert(serviceAccount), projectId: PROJECT_ID })
const auth = getAuth(app)
const db = getFirestore(app)

const users = await listRegisteredUsers(auth, db)
const owner = ownerUserId ? users.find((user) => user.id === ownerUserId) : null
if (ownerUserId && !owner) {
  console.error(`ERROR: OWNER_UID does not match a Firebase Auth/Firestore user: ${ownerUserId}`)
  process.exit(1)
}

const existingContactsSnap = ownerUserId
  ? await db.collection("contacts").where("ownerUserId", "==", ownerUserId).get()
  : await db.collection("contacts").get()

const existingImported = existingContactsSnap.docs.map((doc) => {
  const data = doc.data()
  return {
    id: doc.id,
    ownerUserId: data.ownerUserId,
    name: data.name ?? "",
    email: data.email,
    emailNormalized: data.emailNormalized,
    phone: data.phone,
    phoneNormalized: data.phoneNormalized,
    source: data.source ?? "manual",
    tags: Array.isArray(data.tags) ? data.tags : [],
    emails: Array.isArray(data.emails) ? data.emails : undefined,
    phones: Array.isArray(data.phones) ? data.phones : undefined,
    emailNormalizedCandidates: Array.isArray(data.emailNormalizedCandidates) ? data.emailNormalizedCandidates : undefined,
    linkedUserId: data.linkedUserId ?? null,
    status: data.status ?? "not_registered",
    visibility: data.visibility ?? "private",
    createdAt: new Date(),
    updatedAt: new Date(),
  }
})

const importBatchId = `vcf-${basename(vcfPath).replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${new Date().toISOString().replace(/[:.]/g, "-")}`
const text = readFileSync(vcfPath, "utf8")
const result = parseVcfImportedContacts(text, {
  ownerUserId: ownerUserId || "__dry_run_owner__",
  registeredUsers: users,
  existingImported,
  importBatchId,
})

printSummary(result, {
  ownerUserId,
  ownerName: owner?.name ?? "",
  ownerEmail: owner?.email ?? "",
  existingCount: existingImported.length,
  dryRun,
  importBatchId,
})

if (dryRun) {
  console.log("")
  console.log("Dry run only. No Firestore writes were made.")
  console.log("To import, rerun with DRY_RUN=false CONFIRM_IMPORT=true OWNER_UID=<uid>.")
  process.exit(0)
}

await writeContacts(db, result.contacts)
console.log("")
console.log(`Imported ${result.contacts.length} contacts into /contacts for owner ${ownerUserId}.`)
console.log(`Batch: ${importBatchId}`)

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
        initials: firestoreUser.initials ?? "",
        color: firestoreUser.color ?? "",
      }
    }))
    pageToken = page.pageToken
  } while (pageToken)
  return users
}

async function writeContacts(db, contacts) {
  for (let i = 0; i < contacts.length; i += 400) {
    const batch = db.batch()
    contacts.slice(i, i + 400).forEach((contact) => {
      const ref = db.collection("contacts").doc()
      batch.set(ref, sanitizeForFirestore({
        ...contact,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }))
    })
    await batch.commit()
    if (contacts.length > 400) {
      console.log(`Written ${Math.min(i + 400, contacts.length)} / ${contacts.length}`)
    }
  }
}

function sanitizeForFirestore(value) {
  if (Array.isArray(value)) {
    return value.map(sanitizeForFirestore).filter((item) => item !== undefined)
  }
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value)
        .map(([key, child]) => [key, sanitizeForFirestore(child)])
        .filter(([, child]) => child !== undefined)
    )
  }
  return value === undefined ? undefined : value
}

function printSummary(result, context) {
  const linkedCount = result.contacts.filter((contact) => contact.status === "registered").length
  const withEmail = result.contacts.filter((contact) => contact.email).length
  const withPhone = result.contacts.filter((contact) => contact.phone).length
  const withCompany = result.contacts.filter((contact) => contact.company).length
  const withRole = result.contacts.filter((contact) => contact.role).length
  const withNotes = result.contacts.filter((contact) => contact.notes).length
  const withAddress = result.contacts.filter((contact) => contact.addresses?.length).length
  const withUrls = result.contacts.filter((contact) => contact.urls?.length).length

  console.log("")
  console.log("VCF import summary")
  console.log("==================")
  console.log(`Mode: ${context.dryRun ? "DRY RUN" : "WRITE"}`)
  console.log(`Owner: ${context.ownerUserId || "(not set)"}${context.ownerName ? ` (${context.ownerName}${context.ownerEmail ? `, ${context.ownerEmail}` : ""})` : ""}`)
  console.log(`Existing contacts considered: ${context.existingCount}`)
  console.log(`Import batch: ${context.importBatchId}`)
  console.log("")
  console.log(`Cards read: ${result.stats.totalCards}`)
  console.log(`Will import: ${result.contacts.length}`)
  console.log(`Skipped: ${result.skipped.length}`)
  console.log(`Duplicate emails skipped: ${result.stats.duplicateEmails}`)
  console.log(`Duplicate phones skipped: ${result.stats.duplicatePhones}`)
  console.log("")
  console.log(`With email: ${withEmail}`)
  console.log(`With phone: ${withPhone}`)
  console.log(`Already registered by email: ${linkedCount}`)
  console.log(`With company: ${withCompany}`)
  console.log(`With role/title: ${withRole}`)
  console.log(`With notes: ${withNotes}`)
  console.log(`With address: ${withAddress}`)
  console.log(`With URLs: ${withUrls}`)
  console.log("")
  console.log("Sample imports:")
  result.contacts.slice(0, 12).forEach((contact) => {
    const bits = [
      contact.email,
      contact.phone,
      contact.company,
      contact.role,
    ].filter(Boolean)
    console.log(`- ${contact.name}${bits.length ? ` — ${bits.join(" | ")}` : ""}`)
  })
  if (result.contacts.length > 12) console.log(`- ...and ${result.contacts.length - 12} more`)

  const skippedSamples = result.skipped.slice(0, 8)
  if (skippedSamples.length > 0) {
    console.log("")
    console.log("Sample skipped:")
    skippedSamples.forEach((item) => console.log(`- ${item.name}: ${item.detail}`))
    if (result.skipped.length > skippedSamples.length) console.log(`- ...and ${result.skipped.length - skippedSamples.length} more`)
  }
}
