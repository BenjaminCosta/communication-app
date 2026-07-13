#!/usr/bin/env node

import { cert, initializeApp } from "firebase-admin/app"
import { getFirestore } from "firebase-admin/firestore"
import { existsSync, readFileSync } from "node:fs"

const write = process.argv.includes("--write")
const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
if (!credentialsPath || !existsSync(credentialsPath)) {
  throw new Error("Set GOOGLE_APPLICATION_CREDENTIALS to the service account JSON path.")
}
if (write && process.env.CONFIRM_DIRECTORY_PERFORMANCE_BACKFILL !== "true") {
  throw new Error("Set CONFIRM_DIRECTORY_PERFORMANCE_BACKFILL=true when using --write.")
}

const serviceAccount = JSON.parse(readFileSync(credentialsPath, "utf8"))
initializeApp({ credential: cert(serviceAccount), projectId: serviceAccount.project_id })
const db = getFirestore()
db.settings({ preferRest: true })
const [snapshot, indexSnapshot] = await Promise.all([
  db.collection("directoryRelations").get(),
  db.collection("directoryIndex").select().get(),
])
const validDirectoryIds = new Set(indexSnapshot.docs.map((document) => document.id))
const updates = []
let invalid = 0
let missingEndpointRelations = 0
const degreeByEntity = new Map()

for (const document of snapshot.docs) {
  const data = document.data()
  const from = typeof data.fromDirectoryId === "string" ? data.fromDirectoryId.trim() : ""
  const to = typeof data.toDirectoryId === "string" ? data.toDirectoryId.trim() : ""
  if (!from || !to) { invalid += 1; continue }
  if (!validDirectoryIds.has(from) || !validDirectoryIds.has(to)) missingEndpointRelations += 1
  for (const entityId of new Set([from, to])) degreeByEntity.set(entityId, (degreeByEntity.get(entityId) ?? 0) + 1)
  const expected = [from, to]
  const current = Array.isArray(data.entityIds) ? data.entityIds : []
  if (current.length !== 2 || current[0] !== from || current[1] !== to) updates.push({ ref: document.ref, entityIds: expected })
}

const degrees = [...degreeByEntity.values()]
const maxDegree = Math.max(0, ...degrees)
console.log(JSON.stringify({
  mode: write ? "write" : "dry-run",
  directoryEntries: validDirectoryIds.size,
  relations: snapshot.size,
  updates: updates.length,
  invalid,
  missingEndpointRelations,
  degreeCases: {
    0: validDirectoryIds.size - degreeByEntity.size,
    1: degrees.filter((degree) => degree === 1).length,
    50: degrees.filter((degree) => degree === 50).length,
    51: degrees.filter((degree) => degree === 51).length,
    maxDegree,
    maxDegreeEntities: degrees.filter((degree) => degree === maxDegree).length,
  },
}, null, 2))
if (!write) process.exit(invalid === 0 && missingEndpointRelations === 0 ? 0 : 1)
if (invalid > 0 || missingEndpointRelations > 0) {
  throw new Error(`Refusing to write: invalid=${invalid}, missingEndpointRelations=${missingEndpointRelations}.`)
}

for (let index = 0; index < updates.length; index += 400) {
  const batch = db.batch()
  for (const update of updates.slice(index, index + 400)) batch.update(update.ref, { entityIds: update.entityIds })
  await batch.commit()
  console.log(`updated ${Math.min(index + 400, updates.length)} / ${updates.length}`)
}

const verification = await db.collection("directoryRelations").get()
const missing = verification.docs.filter((document) => {
  const data = document.data()
  return !Array.isArray(data.entityIds) || data.entityIds.length !== 2
}).length
console.log(JSON.stringify({ verified: verification.size, missingEntityIds: missing }, null, 2))
if (missing > 0) process.exitCode = 1
