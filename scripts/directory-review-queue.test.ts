/**
 * directory-review-queue.test.ts
 *
 * Exercises lib/directory-review-queue.ts's listFlaggedDirectoryEntities()
 * against a real Firestore emulator — the two masterData.needsReview
 * queries (contacts + contexts) and the type/name resolution for each.
 *
 * Emulator only. Run the emulator first (pnpm emulator), then:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 GCLOUD_PROJECT=directory-cleanup-test \
 *     tsx --test scripts/directory-review-queue.test.ts
 */

import assert from "node:assert/strict"
import test from "node:test"
import { getApps, initializeApp } from "firebase-admin/app"
import { getFirestore } from "firebase-admin/firestore"
import { listFlaggedDirectoryEntities } from "../lib/directory-review-queue"

process.env.GCLOUD_PROJECT ||= "directory-cleanup-test"
process.env.GOOGLE_CLOUD_PROJECT ||= process.env.GCLOUD_PROJECT

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("FIRESTORE_EMULATOR_HOST must be set — this suite only ever runs against the emulator.")
}

if (!getApps().length) initializeApp({ projectId: process.env.GCLOUD_PROJECT })
const db = getFirestore()

async function wipe(): Promise<void> {
  for (const name of ["contacts", "contexts"]) {
    const snap = await db.collection(name).get()
    const batch = db.batch()
    for (const d of snap.docs) batch.delete(d.ref)
    if (!snap.empty) await batch.commit()
  }
}

test("listFlaggedDirectoryEntities: finds flagged people, companies and jobs; ignores unflagged records", async () => {
  await wipe()

  await db.collection("contacts").doc("flagged-person").set({
    ownerUserId: "u", name: "Ivy Chen",
    masterData: { needsReview: true, reviewReason: "Duplicate — looks like Ivy C." },
  })
  await db.collection("contacts").doc("clean-person").set({
    ownerUserId: "u", name: "Not Flagged", masterData: {},
  })
  await db.collection("contexts").doc("flagged-company").set({
    name: "Acme", directoryType: "company", createdBy: "u",
    masterData: { displayName: "Acme Corp", needsReview: true, reviewReason: "Incorrect info" },
  })
  await db.collection("contexts").doc("flagged-job").set({
    name: "Job", directoryType: "job", createdBy: "u",
    masterData: { canonicalName: "Riverside Job", needsReview: true, reviewReason: "Inactive" },
  })
  await db.collection("contexts").doc("clean-company").set({
    name: "Clean Co", directoryType: "company", createdBy: "u", masterData: {},
  })

  const flagged = await listFlaggedDirectoryEntities()

  assert.equal(flagged.length, 3, "only the three flagged records are returned")
  const byName = new Map(flagged.map((f) => [f.name, f]))

  const person = byName.get("Ivy Chen")
  assert.ok(person)
  assert.equal(person!.type, "person")
  assert.equal(person!.directoryId, "person__flagged-person")
  assert.equal(person!.sourceId, "flagged-person")
  assert.equal(person!.reviewReason, "Duplicate — looks like Ivy C.")

  const company = byName.get("Acme Corp")
  assert.ok(company)
  assert.equal(company!.type, "company")
  assert.equal(company!.directoryId, "company__flagged-company")
  assert.equal(company!.reviewReason, "Incorrect info")

  const job = byName.get("Riverside Job")
  assert.ok(job)
  assert.equal(job!.type, "job")
  assert.equal(job!.directoryId, "job__flagged-job")
  assert.equal(job!.reviewReason, "Inactive")

  // Sorted by name.
  assert.deepEqual(flagged.map((f) => f.name), [...flagged.map((f) => f.name)].sort((a, b) => a.localeCompare(b)))
})

test("listFlaggedDirectoryEntities: empty when nothing is flagged", async () => {
  await wipe()
  await db.collection("contacts").doc("a").set({ ownerUserId: "u", name: "A", masterData: {} })
  await db.collection("contexts").doc("b").set({ name: "B", directoryType: "company", createdBy: "u", masterData: {} })
  assert.deepEqual(await listFlaggedDirectoryEntities(), [])
})

test("listFlaggedDirectoryEntities: falls back to the top-level name when masterData has none", async () => {
  await wipe()
  await db.collection("contexts").doc("legacy").set({
    name: "Legacy Name Only", directoryType: "company", createdBy: "u",
    masterData: { needsReview: true },
  })
  const [entry] = await listFlaggedDirectoryEntities()
  assert.equal(entry.name, "Legacy Name Only")
  assert.equal(entry.reviewReason, null)
})
