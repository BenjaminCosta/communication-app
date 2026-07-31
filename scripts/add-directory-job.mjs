#!/usr/bin/env node
/**
 * add-directory-job.mjs
 *
 * Adds ONE new job to the SVC Directory by creating a /contexts document with
 * directoryType:"job". The deployed Cloud Function `syncDirectoryOnContextWrite`
 * then projects it into /directoryIndex automatically (job__<contextId>).
 *
 * SAFETY: dry-run by default (writes NOTHING). Pass --write to actually create.
 * Additive only — never updates or deletes anything.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node scripts/add-directory-job.mjs           # dry-run
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node scripts/add-directory-job.mjs --write    # create
 */

import { initializeApp, cert } from "firebase-admin/app"
import { getFirestore, FieldValue } from "firebase-admin/firestore"
import { getAuth } from "firebase-admin/auth"
import { readFileSync } from "fs"

// ── The job to add ──────────────────────────────────────────────────────────
const NAME = "Wax the City"
const LOCATION = "Arlington, VA"
const RELATED_CONTACTS = "Robert Chaney"
const OWNER_EMAIL = "benjacostm100@gmail.com"

const WRITE = process.argv.includes("--write")
const SA = process.env.GOOGLE_APPLICATION_CREDENTIALS || "./service-account.json"

const serviceAccount = JSON.parse(readFileSync(SA, "utf8"))
initializeApp({ credential: cert(serviceAccount) })
const db = getFirestore()

function log(...a) { console.log(...a) }

async function main() {
  log(`\n=== add-directory-job — ${WRITE ? "WRITE (PRODUCTION)" : "DRY-RUN (no writes)"} ===`)
  log(`Firestore project: ${serviceAccount.project_id}\n`)

  // 1) Duplicate guard: any existing context with this exact name?
  const byName = await db.collection("contexts").where("name", "==", NAME).get()
  const existing = byName.docs.map((d) => ({ id: d.id, directoryType: d.get("directoryType") ?? "(unset)" }))
  if (existing.length > 0) {
    log(`⚠ Found ${existing.length} existing context(s) named "${NAME}":`)
    for (const e of existing) log(`   - contexts/${e.id} (directoryType: ${e.directoryType}) → directoryIndex job__${e.id}`)
    log(`  If one of these is already the job, adding again would DUPLICATE it. Review before --write.\n`)
  } else {
    log(`✓ No existing context named "${NAME}" — safe to add.\n`)
  }

  // 2) Resolve owner uid so the user can edit/delete it from the app.
  let createdBy = null
  try {
    const user = await getAuth().getUserByEmail(OWNER_EMAIL)
    createdBy = user.uid
    log(`Owner resolved: ${OWNER_EMAIL} → uid ${createdBy}`)
  } catch (err) {
    log(`⚠ Could not resolve owner uid for ${OWNER_EMAIL}: ${err.message}`)
    log(`  Aborting — createdBy is required for app-side edit/delete permissions.\n`)
    process.exit(1)
  }

  // 3) The exact document to create.
  const docData = {
    name: NAME,
    directoryType: "job",
    masterData: {
      canonicalName: NAME,
      location: LOCATION,
    },
    fields: [
      { label: "Location", value: LOCATION },
      { label: "Related Contacts", value: RELATED_CONTACTS },
    ],
    createdBy,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    source: "manual-directory-add",
  }

  log(`\nDocument to create at /contexts/<auto-id>:`)
  log(JSON.stringify({ ...docData, createdAt: "<serverTimestamp>", updatedAt: "<serverTimestamp>" }, null, 2))

  if (!WRITE) {
    log(`\nDRY-RUN complete. Nothing was written. Re-run with --write to create it.\n`)
    return
  }

  // 4) Create the context. The Cloud Function derives the /directoryIndex entry.
  const ref = await db.collection("contexts").add(docData)
  log(`\n✓ Created /contexts/${ref.id}`)
  log(`  Directory id (once projected): job__${ref.id}`)

  // 5) Confirm the Cloud Function projected it into /directoryIndex.
  const indexId = `job__${ref.id}`
  log(`\nWaiting for syncDirectoryOnContextWrite to project ${indexId} …`)
  let projected = false
  for (let i = 0; i < 12; i++) {
    const snap = await db.collection("directoryIndex").doc(indexId).get()
    if (snap.exists) {
      projected = true
      log(`✓ /directoryIndex/${indexId} exists:`)
      log(`   name: ${snap.get("name")} | type: ${snap.get("type")} | location: ${snap.get("location") ?? "(n/a)"}`)
      break
    }
    await new Promise((r) => setTimeout(r, 2500))
  }
  if (!projected) {
    log(`… not visible yet after ~30s. The context was created; the index projection may still be catching up (check the app's Directory shortly).`)
  }
  log(``)
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1) })
