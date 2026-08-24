/**
 * directory-cleanup-server.test.ts
 *
 * Exercises lib/directory-server-writes.ts (merge + delete) against a real
 * Firestore emulator with the Admin SDK — the exact code path
 * app/api/directory/{merge,delete} run in production, just invoked directly
 * instead of through an HTTP request + requireDirectoryAdmin(). Confirms the
 * reference-cleanup promises in the Directory cleanup flow actually hold:
 * job/company membership, notes/files entityIds, directoryRelations edges,
 * message contactIds, and (for jobs) the outlooks subcollection.
 *
 * Emulator only. Run the emulator first (pnpm emulator), then:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 GCLOUD_PROJECT=directory-cleanup-test \
 *     tsx --test scripts/directory-cleanup-server.test.ts
 */

import assert from "node:assert/strict"
import test from "node:test"
import { getApps, initializeApp } from "firebase-admin/app"
import { getFirestore } from "firebase-admin/firestore"
import { computeDirectoryDeleteImpact, deleteDirectoryEntity, mergeDirectoryContacts } from "../lib/directory-server-writes"

process.env.GCLOUD_PROJECT ||= "directory-cleanup-test"
process.env.GOOGLE_CLOUD_PROJECT ||= process.env.GCLOUD_PROJECT

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("FIRESTORE_EMULATOR_HOST must be set — this suite only ever runs against the emulator.")
}

if (!getApps().length) initializeApp({ projectId: process.env.GCLOUD_PROJECT })
const db = getFirestore()

async function wipe(): Promise<void> {
  const collections = ["contacts", "contexts", "directoryNotes", "directoryFiles", "directoryRelations", "messages"]
  for (const name of collections) {
    const snap = await db.collection(name).get()
    const batch = db.batch()
    for (const d of snap.docs) batch.delete(d.ref)
    if (!snap.empty) await batch.commit()
  }
}

test("merge: unions contact fields, re-points references, deletes the duplicate", async () => {
  await wipe()

  await db.collection("contacts").doc("survivor").set({
    ownerUserId: "owner-1", name: "Alex Rivera", company: "", role: "Foreman",
    emails: [{ label: "email", value: "alex@work.example", normalized: "alex@work.example" }],
    phones: [], urls: [], tags: ["vip"], companies: [], roles: [],
  })
  await db.collection("contacts").doc("dup").set({
    ownerUserId: "owner-1", name: "Alex R.", company: "Acme Co", role: "",
    emails: [{ label: "email", value: "a.rivera@personal.example", normalized: "a.rivera@personal.example" }],
    phones: [{ label: "phone", value: "555-0100", normalized: "5550100" }],
    urls: [], tags: ["site-a"], companies: [], roles: [],
  })

  await db.collection("contexts").doc("job-1").set({
    name: "Job One", directoryType: "job", createdBy: "owner-1",
    fields: [{ label: "People involved", value: "Alex R." }],
    involvedContactIds: ["dup"],
    involvedPeople: [{ id: "dup", name: "Alex R." }],
  })
  // A job the SURVIVOR is already on too — must not end up with a duplicate entry.
  await db.collection("contexts").doc("job-2").set({
    name: "Job Two", directoryType: "job", createdBy: "owner-1",
    fields: [{ label: "People involved", value: "Alex Rivera, Someone Else" }],
    involvedContactIds: ["survivor", "someone-else"],
    involvedPeople: [{ id: "survivor", name: "Alex Rivera" }, { id: "someone-else", name: "Someone Else" }],
  })

  await db.collection("directoryNotes").doc("note-1").set({
    entityIds: ["person__dup"], text: "note", createdBy: "owner-1",
  })
  await db.collection("directoryFiles").doc("file-1").set({
    entityIds: ["person__dup", "job__job-1"], fileName: "f.pdf", uploadedBy: "owner-1",
  })

  // A relation the survivor doesn't have yet (should move) and one it already has (should collapse).
  await db.collection("directoryRelations").doc("rel__job__job-1__person__dup").set({
    fromDirectoryId: "job__job-1", fromName: "Job One", toDirectoryId: "person__dup", toName: "Alex R.",
    entityIds: ["job__job-1", "person__dup"], active: true, confidence: 1, source: "context-sync",
  })
  await db.collection("directoryRelations").doc("rel__job__job-2__person__survivor").set({
    fromDirectoryId: "job__job-2", fromName: "Job Two", toDirectoryId: "person__survivor", toName: "Alex Rivera",
    entityIds: ["job__job-2", "person__survivor"], active: true, confidence: 1, source: "context-sync",
  })
  await db.collection("directoryRelations").doc("rel__job__job-2__person__dup").set({
    fromDirectoryId: "job__job-2", fromName: "Job Two", toDirectoryId: "person__dup", toName: "Alex R.",
    entityIds: ["job__job-2", "person__dup"], active: true, confidence: 1, source: "context-sync",
  })

  await db.collection("messages").doc("msg-1").set({ authorName: "Someone", contactIds: ["dup"], text: "hi" })
  await db.collection("messages").doc("msg-2").set({ authorName: "Someone", contactIds: ["dup", "survivor"], text: "hi again" })

  const result = await mergeDirectoryContacts("survivor", "dup")
  assert.equal(result.survivorDirectoryId, "person__survivor")

  const survivorSnap = await db.collection("contacts").doc("survivor").get()
  const survivor = survivorSnap.data()!
  assert.equal(survivor.role, "Foreman", "survivor's own non-empty role wins over the duplicate's")
  assert.equal(survivor.company, "Acme Co", "duplicate's company fills in the survivor's empty one")
  assert.deepEqual(new Set((survivor.emails as Array<{value:string}>).map((e) => e.value)),
    new Set(["alex@work.example", "a.rivera@personal.example"]), "emails unioned")
  assert.deepEqual(survivor.phones, [{ label: "phone", value: "555-0100", normalized: "5550100" }])
  assert.deepEqual(new Set(survivor.tags as string[]), new Set(["vip", "site-a"]), "tags unioned")
  assert.ok((survivor.mergedFromIds as string[]).includes("dup"))

  const dupSnap = await db.collection("contacts").doc("dup").get()
  assert.equal(dupSnap.exists, false, "duplicate contact is deleted")

  const job1 = (await db.collection("contexts").doc("job-1").get()).data()!
  assert.deepEqual(job1.involvedContactIds, ["survivor"], "job-1 now lists the survivor instead of the duplicate")
  assert.deepEqual(job1.involvedPeople, [{ id: "survivor", name: "Alex Rivera" }])
  assert.equal((job1.fields as Array<{label:string,value:string}>).find((f) => f.label === "People involved")?.value, "Alex Rivera")

  const job2 = (await db.collection("contexts").doc("job-2").get()).data()!
  assert.deepEqual(new Set(job2.involvedContactIds as string[]), new Set(["survivor", "someone-else"]),
    "job-2 already had the survivor — merge must not add a duplicate entry")

  const note1 = (await db.collection("directoryNotes").doc("note-1").get()).data()!
  assert.deepEqual(note1.entityIds, ["person__survivor"])

  const file1 = (await db.collection("directoryFiles").doc("file-1").get()).data()!
  assert.deepEqual(new Set(file1.entityIds as string[]), new Set(["person__survivor", "job__job-1"]))

  const movedRelation = await db.collection("directoryRelations").doc("rel__job__job-1__person__survivor").get()
  assert.equal(movedRelation.exists, true, "the duplicate's unique relation moved to the survivor's id")
  const oldRelation = await db.collection("directoryRelations").doc("rel__job__job-1__person__dup").get()
  assert.equal(oldRelation.exists, false, "the old duplicate-pointing relation doc is gone")
  const collapsedDupRelation = await db.collection("directoryRelations").doc("rel__job__job-2__person__dup").get()
  assert.equal(collapsedDupRelation.exists, false, "the redundant duplicate relation (survivor already had one) is dropped, not duplicated")
  const survivorRelationStillThere = await db.collection("directoryRelations").doc("rel__job__job-2__person__survivor").get()
  assert.equal(survivorRelationStillThere.exists, true, "the survivor's pre-existing relation is untouched")

  const msg1 = (await db.collection("messages").doc("msg-1").get()).data()!
  assert.deepEqual(msg1.contactIds, ["survivor"])
  const msg2 = (await db.collection("messages").doc("msg-2").get()).data()!
  assert.deepEqual(new Set(msg2.contactIds as string[]), new Set(["survivor"]), "no duplicate survivor id after union")
})

test("merge: rejects merging a record into itself, and merging an already-merged duplicate", async () => {
  await wipe()
  await db.collection("contacts").doc("a").set({ ownerUserId: "u", name: "A" })
  await assert.rejects(() => mergeDirectoryContacts("a", "a"))

  await db.collection("contacts").doc("b").set({ ownerUserId: "u", name: "B" })
  await mergeDirectoryContacts("a", "b")
  await db.collection("contacts").doc("c").set({ ownerUserId: "u", name: "C" })
  // "b" no longer exists (deleted after merge) — merging it again must fail cleanly, not throw an unrelated error.
  await assert.rejects(() => mergeDirectoryContacts("c", "b"))
})

test("delete: strips person from job membership, notes/files, relations and messages", async () => {
  await wipe()
  await db.collection("contacts").doc("gone").set({ ownerUserId: "owner-1", name: "Gone Person" })
  await db.collection("contexts").doc("job-1").set({
    name: "Job One", directoryType: "job", createdBy: "owner-1",
    fields: [{ label: "People involved", value: "Gone Person" }],
    involvedContactIds: ["gone"],
    involvedPeople: [{ id: "gone", name: "Gone Person" }],
  })
  await db.collection("directoryNotes").doc("note-1").set({ entityIds: ["person__gone", "job__job-1"], text: "x", createdBy: "owner-1" })
  await db.collection("directoryRelations").doc("rel__job__job-1__person__gone").set({
    fromDirectoryId: "job__job-1", toDirectoryId: "person__gone", entityIds: ["job__job-1", "person__gone"], active: true, source: "context-sync",
  })
  await db.collection("messages").doc("msg-1").set({ authorName: "Gone Person", contactIds: ["gone"], text: "hi" })

  const impact = await computeDirectoryDeleteImpact("person__gone")
  assert.equal(impact.contexts, 1)
  assert.equal(impact.notes, 1)
  assert.equal(impact.relations, 1)
  assert.equal(impact.messages, 1)

  await deleteDirectoryEntity("person__gone")

  assert.equal((await db.collection("contacts").doc("gone").get()).exists, false)
  const job1 = (await db.collection("contexts").doc("job-1").get()).data()!
  assert.deepEqual(job1.involvedContactIds, [])
  assert.deepEqual(job1.involvedPeople, [])
  assert.equal((job1.fields as unknown[]).length, 0, "the now-empty People involved field is dropped, not left blank")
  const note1 = (await db.collection("directoryNotes").doc("note-1").get()).data()!
  assert.deepEqual(note1.entityIds, ["job__job-1"], "note keeps the other entity it's tagged to")
  assert.equal((await db.collection("directoryRelations").doc("rel__job__job-1__person__gone").get()).exists, false)
  const msg1 = (await db.collection("messages").doc("msg-1").get()).data()!
  assert.deepEqual(msg1.contactIds, [])
})

test("delete: a job's outlooks subcollection is recursively removed (Firestore doesn't cascade)", async () => {
  await wipe()
  await db.collection("contexts").doc("job-with-outlook").set({ name: "Job", directoryType: "job", createdBy: "owner-1" })
  await db.collection("contexts").doc("job-with-outlook").collection("outlooks").doc("2026-01-01").set({
    jobId: "job-with-outlook", createdBy: "owner-1", updatedBy: "owner-1", revision: 1,
  })

  await deleteDirectoryEntity("job__job-with-outlook")

  assert.equal((await db.collection("contexts").doc("job-with-outlook").get()).exists, false)
  const outlookSnap = await db.collection("contexts").doc("job-with-outlook").collection("outlooks").doc("2026-01-01").get()
  assert.equal(outlookSnap.exists, false, "the outlook subdoc must not survive a plain doc delete")
})

test("delete: company/job carry no messages impact (person-only concept)", async () => {
  await wipe()
  await db.collection("contexts").doc("company-1").set({ name: "Acme", directoryType: "company", createdBy: "owner-1" })
  const impact = await computeDirectoryDeleteImpact("company__company-1")
  assert.equal(impact.messages, 0)
  assert.equal(impact.contexts, 0)
  await deleteDirectoryEntity("company__company-1")
  assert.equal((await db.collection("contexts").doc("company-1").get()).exists, false)
})
