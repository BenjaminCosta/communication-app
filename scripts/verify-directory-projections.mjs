#!/usr/bin/env node
/**
 * Read-only verification of Directory's derived index, search shards, manifest,
 * company links, and collaboration references.
 *
 * Emulator:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 pnpm exec tsx scripts/verify-directory-projections.mjs
 *
 * Remote project (still read-only; requires explicit credentials):
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json pnpm exec tsx scripts/verify-directory-projections.mjs
 */

import { cert, initializeApp } from "firebase-admin/app"
import { getFirestore } from "firebase-admin/firestore"
import { existsSync, readFileSync } from "node:fs"
import { inspectDirectoryConsistency } from "../lib/directory-consistency.ts"

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST
const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
const verbose = process.argv.includes("--verbose")
let app

if (emulatorHost) {
  app = initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? "svc-comms" })
} else {
  if (!credentialsPath || !existsSync(credentialsPath)) {
    throw new Error("Use FIRESTORE_EMULATOR_HOST or set GOOGLE_APPLICATION_CREDENTIALS.")
  }
  const serviceAccount = JSON.parse(readFileSync(credentialsPath, "utf8"))
  app = initializeApp({ credential: cert(serviceAccount), projectId: serviceAccount.project_id })
}

const db = getFirestore(app)
if (!emulatorHost) db.settings({ preferRest: true })

const [indexSnapshot, shardSnapshot, metaSnapshot, relationSnapshot, noteSnapshot, fileSnapshot] = await Promise.all([
  db.collection("directoryIndex").select("companyEntityId").get(),
  db.collection("directorySearchShards").get(),
  db.doc("directoryMeta/status").get(),
  db.collection("directoryRelations").select("entityIds").get(),
  db.collection("directoryNotes").select("entityIds").get(),
  db.collection("directoryFiles").select("entityIds").get(),
])

const references = [
  ...relationSnapshot.docs.map((document) => ({ collection: "directoryRelations", id: document.id, entityIds: strings(document.data().entityIds) })),
  ...noteSnapshot.docs.map((document) => ({ collection: "directoryNotes", id: document.id, entityIds: strings(document.data().entityIds) })),
  ...fileSnapshot.docs.map((document) => ({ collection: "directoryFiles", id: document.id, entityIds: strings(document.data().entityIds) })),
]

const report = inspectDirectoryConsistency({
  indexEntries: indexSnapshot.docs.map((document) => ({
    id: document.id,
    companyEntityId: typeof document.data().companyEntityId === "string" ? document.data().companyEntityId : null,
  })),
  shards: shardSnapshot.docs.map((document) => ({ id: document.id, ...document.data() })),
  meta: metaSnapshot.exists ? metaSnapshot.data() : null,
  references,
})

const issuesByCode = report.issues.reduce((counts, entry) => {
  counts[entry.code] = (counts[entry.code] ?? 0) + 1
  return counts
}, {})

console.log(JSON.stringify({
  mode: emulatorHost ? "emulator-read-only" : "remote-read-only",
  ok: report.ok,
  stats: report.stats,
  issueCount: report.issues.length,
  issuesByCode,
  ...((emulatorHost || verbose) ? { issues: report.issues } : {}),
}, null, 2))

if (!report.ok) process.exitCode = 1

function strings(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string" && entry.length > 0) : []
}
