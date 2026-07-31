#!/usr/bin/env node
/**
 * add-directory-relation.mjs
 *
 * Adds ONE relationship edge to /directoryRelations linking a job and a person
 * (person "works on" job). The Directory reads this collection directly (no
 * projection/rebuild needed), so both profiles show the link on next load.
 *
 * SAFETY: dry-run by default (writes NOTHING). Pass --write to actually create.
 * Idempotent: deterministic doc id, so re-running overwrites instead of duping.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node scripts/add-directory-relation.mjs           # dry-run
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node scripts/add-directory-relation.mjs --write    # create
 */

import { initializeApp, cert } from "firebase-admin/app"
import { getFirestore, FieldValue } from "firebase-admin/firestore"
import { getAuth } from "firebase-admin/auth"
import { readFileSync } from "fs"

// ── The relationship to add ──────────────────────────────────────────────────
const JOB_ID = "job__IMWA7xSzeDA805N63MFa"     // Wax the City
const JOB_NAME = "Wax the City"
const PERSON_ID = "person__ClLE6S83CMbY603OG5wX" // Robert Chaney
const PERSON_NAME = "Robert Chaney"
const ROLE = "Team"                             // "working on the job" — non-PM/supervisor bucket
const RELATIONSHIP_TYPE = "works_on"
const OWNER_EMAIL = "benjacostm100@gmail.com"

const DOC_ID = `rel__${JOB_ID}__${PERSON_ID}`

const WRITE = process.argv.includes("--write")
const SA = process.env.GOOGLE_APPLICATION_CREDENTIALS || "./service-account.json"
const serviceAccount = JSON.parse(readFileSync(SA, "utf8"))
initializeApp({ credential: cert(serviceAccount) })
const db = getFirestore()

const log = (...a) => console.log(...a)

async function main() {
  log(`\n=== add-directory-relation — ${WRITE ? "WRITE (PRODUCTION)" : "DRY-RUN (no writes)"} ===`)
  log(`Firestore project: ${serviceAccount.project_id}\n`)

  // 0) Verify both endpoints exist in the index.
  const [jobSnap, personSnap] = await Promise.all([
    db.collection("directoryIndex").doc(JOB_ID).get(),
    db.collection("directoryIndex").doc(PERSON_ID).get(),
  ])
  if (!jobSnap.exists) { log(`✗ Job ${JOB_ID} not found in directoryIndex. Aborting.`); process.exit(1) }
  if (!personSnap.exists) { log(`✗ Person ${PERSON_ID} not found in directoryIndex. Aborting.`); process.exit(1) }
  log(`✓ Job:    ${JOB_ID} → ${jobSnap.get("name")}`)
  log(`✓ Person: ${PERSON_ID} → ${personSnap.get("name")}`)

  // 1) Duplicate guard: any existing active edge between these two?
  const existing = await db.collection("directoryRelations")
    .where("entityIds", "array-contains", JOB_ID).where("active", "==", true).get()
  const dupes = existing.docs.filter((d) => (d.get("entityIds") || []).includes(PERSON_ID))
  if (dupes.length > 0) {
    log(`\n⚠ An active relation between these two already exists:`)
    dupes.forEach((d) => log(`   - directoryRelations/${d.id} (role: ${d.get("role") ?? "-"})`))
    log(`  (Deterministic doc id "${DOC_ID}" means --write overwrites rather than duplicating.)`)
  } else {
    log(`\n✓ No existing active relation between them.`)
  }

  // 2) Owner uid for provenance.
  let createdBy = null
  try { createdBy = (await getAuth().getUserByEmail(OWNER_EMAIL)).uid } catch { /* non-fatal */ }

  const docData = {
    fromDirectoryId: JOB_ID,
    fromName: JOB_NAME,
    toDirectoryId: PERSON_ID,
    toName: PERSON_NAME,
    entityIds: [JOB_ID, PERSON_ID],
    relationshipType: RELATIONSHIP_TYPE,
    role: ROLE,
    active: true,
    confidence: 1,
    source: "manual-directory-add",
    createdBy,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }

  log(`\nDocument to create at /directoryRelations/${DOC_ID}:`)
  log(JSON.stringify({ ...docData, createdAt: "<serverTimestamp>", updatedAt: "<serverTimestamp>" }, null, 2))

  if (!WRITE) {
    log(`\nDRY-RUN complete. Nothing was written. Re-run with --write to create it.\n`)
    return
  }

  await db.collection("directoryRelations").doc(DOC_ID).set(docData, { merge: true })
  log(`\n✓ Wrote /directoryRelations/${DOC_ID}`)

  // 3) Verify both directions resolve, exactly as the app loader does.
  const jobEdges = await db.collection("directoryRelations").where("entityIds", "array-contains", JOB_ID).where("active", "==", true).get()
  const personEdges = await db.collection("directoryRelations").where("entityIds", "array-contains", PERSON_ID).where("active", "==", true).get()
  const jobToPerson = jobEdges.docs.some((d) => d.get("toDirectoryId") === PERSON_ID || d.get("fromDirectoryId") === PERSON_ID)
  const personToJob = personEdges.docs.some((d) => d.get("toDirectoryId") === JOB_ID || d.get("fromDirectoryId") === JOB_ID)
  log(`\nVerification (same query the app runs):`)
  log(`  Job "${JOB_NAME}" relations include Robert Chaney:  ${jobToPerson ? "YES ✓" : "NO ✗"}`)
  log(`  Person "${PERSON_NAME}" relations include the job:  ${personToJob ? "YES ✓" : "NO ✗"}`)
  log(``)
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1) })
