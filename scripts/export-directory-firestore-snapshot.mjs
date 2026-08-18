#!/usr/bin/env node
/**
 * SVC Directory — read-only snapshot export.
 *
 * Reads /contacts, /contexts, /directoryRelations, /directoryReviewQueue and
 * /directoryReferenceData from Firestore and dumps them verbatim (with doc
 * IDs) to a single JSON file. Writes NOTHING to Firestore.
 *
 * This is step 1 of building the "Master CURRENT" workbook: step 2
 * (scripts/build-directory-master-current.py) turns this JSON into the
 * People_Master / Companies_Master / Jobs_Master / Relationships_Master /
 * Review_Queue / Reference_Data xlsx, using the same column contract as
 * SVC_Directory_Master_Source_of_Truth(1).xlsx (see scripts/enrich-directory-from-master.mjs).
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     node scripts/export-directory-firestore-snapshot.mjs [output-path]
 */

import { initializeApp, cert } from "firebase-admin/app"
import { getFirestore } from "firebase-admin/firestore"
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

const saPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
if (!saPath || !existsSync(saPath)) {
  console.error("ERROR: Set GOOGLE_APPLICATION_CREDENTIALS to your service account JSON path.")
  process.exit(1)
}

const outPath = process.argv[2] ?? "import-data/directory-master/firestore-snapshot.json"

const serviceAccount = JSON.parse(readFileSync(saPath, "utf8"))
const app = initializeApp({ credential: cert(serviceAccount), projectId: "svc-comms" })
const db = getFirestore(app)

function serialize(data) {
  // Firestore Timestamps -> ISO strings; everything else passes through.
  return JSON.parse(
    JSON.stringify(data, (_key, value) => {
      if (value && typeof value === "object" && typeof value.toDate === "function") {
        return value.toDate().toISOString()
      }
      return value
    })
  )
}

async function readCollection(name) {
  console.log(`Reading /${name}...`)
  const snap = await db.collection(name).get()
  const docs = snap.docs.map((d) => ({ id: d.id, ...serialize(d.data()) }))
  console.log(`  ${docs.length} docs`)
  return docs
}

const [contacts, contexts, directoryRelations, directoryReviewQueue, directoryReferenceData] = await Promise.all([
  readCollection("contacts"),
  readCollection("contexts"),
  readCollection("directoryRelations"),
  readCollection("directoryReviewQueue"),
  readCollection("directoryReferenceData"),
])

const snapshot = {
  exportedAt: new Date().toISOString(),
  projectId: "svc-comms",
  counts: {
    contacts: contacts.length,
    contexts: contexts.length,
    directoryRelations: directoryRelations.length,
    directoryReviewQueue: directoryReviewQueue.length,
    directoryReferenceData: directoryReferenceData.length,
  },
  contacts,
  contexts,
  directoryRelations,
  directoryReviewQueue,
  directoryReferenceData,
}

mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, JSON.stringify(snapshot))

console.log("")
console.log(`Wrote ${outPath}`)
console.log(snapshot.counts)
