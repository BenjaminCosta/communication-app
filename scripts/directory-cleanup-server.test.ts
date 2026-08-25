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
import {
  computeDirectoryDeleteImpact,
  deleteDirectoryEntity,
  mergeDirectoryCompanies,
  mergeDirectoryContacts,
  mergeDirectoryJobs,
} from "../lib/directory-server-writes"

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

test("merge: resumes and completes after a simulated partial failure (tombstoned but not yet repointed/deleted)", async () => {
  await wipe()

  await db.collection("contacts").doc("survivor").set({ ownerUserId: "u", name: "Kim Lee", emails: [], tags: [] })
  // Seed the duplicate exactly as a first attempt would have left it after
  // its transaction committed but before repointPersonInContexts/etc. ran —
  // i.e. simulating a crash/network failure in that window.
  await db.collection("contacts").doc("dup").set({
    ownerUserId: "u", name: "K. Lee", tags: ["from-dup"],
    mergedIntoId: "survivor", mergedAt: new Date(),
  })
  await db.collection("contexts").doc("job-1").set({
    name: "Job One", directoryType: "job", createdBy: "u",
    involvedContactIds: ["dup"], involvedPeople: [{ id: "dup", name: "K. Lee" }],
    fields: [{ label: "People involved", value: "K. Lee" }],
  })

  // A retry of the SAME merge must resume and finish, not reject as
  // "already merged" — that was the bug: the hard tombstone check blocked
  // any retry from ever completing the interrupted repoint/delete work.
  const result = await mergeDirectoryContacts("survivor", "dup")
  assert.equal(result.survivorDirectoryId, "person__survivor")

  assert.equal((await db.collection("contacts").doc("dup").get()).exists, false, "the stuck duplicate is finally deleted")
  const job1 = (await db.collection("contexts").doc("job-1").get()).data()!
  assert.deepEqual(job1.involvedContactIds, ["survivor"], "the repoint step the first attempt never reached now completes")
  const survivor = (await db.collection("contacts").doc("survivor").get()).data()!
  assert.ok((survivor.tags as string[]).includes("from-dup"), "the duplicate's data still gets merged in on the resumed attempt")
})

test("merge: a duplicate already merged into a DIFFERENT survivor is still rejected", async () => {
  await wipe()
  await db.collection("contacts").doc("other-survivor").set({ ownerUserId: "u", name: "Other" })
  await db.collection("contacts").doc("dup").set({ ownerUserId: "u", name: "Dup", mergedIntoId: "other-survivor" })
  await db.collection("contacts").doc("new-survivor").set({ ownerUserId: "u", name: "New" })
  await assert.rejects(() => mergeDirectoryContacts("new-survivor", "dup"))
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

test("merge (company): re-points contacts by name-match AND explicit id, re-points jobs, unions masterData/aliases, deletes the duplicate", async () => {
  await wipe()

  await db.collection("contexts").doc("acme").set({
    name: "Acme Corp", directoryType: "company", createdBy: "owner-1",
    masterData: { displayName: "Acme Corp", phone: "555-1000", aliases: ["Acme"] },
    fields: [{ label: "Timezone", value: "America/Chicago" }],
  })
  await db.collection("contexts").doc("acme-llc").set({
    name: "Acme LLC", directoryType: "company", createdBy: "owner-1", sourceRecordId: "acme-llc-src",
    masterData: { displayName: "Acme LLC", website: "https://acme.example" },
    fields: [{ label: "Website", value: "https://acme.example" }],
  })

  // Points at the duplicate purely by text name match (no explicit id) — the common case for imported data.
  await db.collection("contacts").doc("contact-name-match").set({
    ownerUserId: "owner-1", name: "Nadia", company: "Acme LLC", masterData: {},
  })
  // Points at the duplicate by the explicit id link (e.g. picked via the Company selector).
  await db.collection("contacts").doc("contact-id-match").set({
    ownerUserId: "owner-1", name: "Omar", company: "Acme LLC", masterData: { companyContextId: "acme-llc" },
  })
  // A job whose company link points at the duplicate.
  await db.collection("contexts").doc("job-at-dup").set({
    name: "Job At Dup", directoryType: "job", createdBy: "owner-1",
    masterData: { canonicalName: "Job At Dup", companyName: "Acme LLC", companyContextId: "acme-llc" },
  })

  const impact = await computeDirectoryDeleteImpact("company__acme-llc")
  assert.equal(impact.contacts, 2, "both the name-matched and id-matched contact are found")
  assert.equal(impact.contexts, 1, "the linked job is found")

  const result = await mergeDirectoryCompanies("acme", "acme-llc")
  assert.equal(result.survivorDirectoryId, "company__acme")

  assert.equal((await db.collection("contexts").doc("acme-llc").get()).exists, false, "duplicate company is deleted")

  const survivor = (await db.collection("contexts").doc("acme").get()).data()!
  const survivorMaster = survivor.masterData as Record<string, unknown>
  assert.equal(survivorMaster.displayName, "Acme Corp", "survivor keeps its own name")
  assert.equal(survivorMaster.phone, "555-1000", "survivor's own non-empty field is untouched")
  assert.equal(survivorMaster.website, "https://acme.example", "duplicate's website fills the survivor's empty one")
  assert.deepEqual(new Set(survivorMaster.aliases as string[]), new Set(["Acme", "Acme LLC"]), "duplicate's name folds into aliases")
  assert.ok((survivor.fields as Array<{ label: string }>).some((f) => f.label === "Timezone"), "survivor's own field is kept")
  assert.ok((survivor.fields as Array<{ label: string }>).some((f) => f.label === "Website"), "duplicate-only field is appended")

  const contactByName = (await db.collection("contacts").doc("contact-name-match").get()).data()!
  assert.equal(contactByName.company, "Acme Corp")
  assert.equal((contactByName.masterData as Record<string, unknown>).companyContextId, "acme")

  const contactById = (await db.collection("contacts").doc("contact-id-match").get()).data()!
  assert.equal(contactById.company, "Acme Corp")
  assert.equal((contactById.masterData as Record<string, unknown>).companyContextId, "acme")

  const job = (await db.collection("contexts").doc("job-at-dup").get()).data()!
  const jobMaster = job.masterData as Record<string, unknown>
  assert.equal(jobMaster.companyName, "Acme Corp")
  assert.equal(jobMaster.companyContextId, "acme")
})

test("merge (job): unions involvedPeople (survivor wins on id conflict) and masterData fields, recursively deletes the duplicate's outlooks", async () => {
  await wipe()

  await db.collection("contexts").doc("job-a").set({
    name: "Job A", directoryType: "job", createdBy: "owner-1",
    masterData: { canonicalName: "Job A", status: "", address: "123 Main St" },
    involvedContactIds: ["p1"],
    involvedPeople: [{ id: "p1", name: "Person One" }],
    fields: [{ label: "Address", value: "123 Main St" }],
  })
  await db.collection("contexts").doc("job-b").set({
    name: "Job B", directoryType: "job", createdBy: "owner-1",
    masterData: { canonicalName: "Job B", status: "In Progress", address: "456 Oak Ave", durationWeeks: "3" },
    involvedContactIds: ["p2", "p1"],
    // Deliberately a different name for p1 than the survivor's — survivor's own entry must win, not this one.
    involvedPeople: [{ id: "p2", name: "Person Two" }, { id: "p1", name: "Person One (from dup)" }],
    fields: [{ label: "People involved", value: "Person Two, Person One (from dup)" }, { label: "Duration in Weeks", value: "3" }],
  })
  await db.collection("contexts").doc("job-b").collection("outlooks").doc("2026-02-01").set({
    jobId: "job-b", createdBy: "owner-1", updatedBy: "owner-1", revision: 1,
  })

  const result = await mergeDirectoryJobs("job-a", "job-b")
  assert.equal(result.survivorDirectoryId, "job__job-a")

  assert.equal((await db.collection("contexts").doc("job-b").get()).exists, false, "duplicate job is deleted")
  const outlookSnap = await db.collection("contexts").doc("job-b").collection("outlooks").doc("2026-02-01").get()
  assert.equal(outlookSnap.exists, false, "the duplicate's outlooks subcollection does not survive the merge")

  const survivor = (await db.collection("contexts").doc("job-a").get()).data()!
  const survivorMaster = survivor.masterData as Record<string, unknown>
  assert.equal(survivorMaster.canonicalName, "Job A")
  assert.equal(survivorMaster.status, "In Progress", "duplicate fills the survivor's empty status")
  assert.equal(survivorMaster.address, "123 Main St", "survivor's own non-empty address is untouched")
  assert.equal(survivorMaster.durationWeeks, "3", "duplicate-only scalar field fills in")
  assert.deepEqual(new Set(survivor.involvedContactIds as string[]), new Set(["p1", "p2"]))
  const people = survivor.involvedPeople as Array<{ id: string; name: string }>
  assert.equal(people.find((p) => p.id === "p1")?.name, "Person One", "survivor's own entry wins over the duplicate's for the same id")
  assert.equal(people.find((p) => p.id === "p2")?.name, "Person Two")
  const peopleField = (survivor.fields as Array<{ label: string; value: string }>).find((f) => f.label === "People involved")
  assert.equal(peopleField?.value, "Person One, Person Two", "the People involved field is regenerated from the merged list, not unioned as raw text")
})

test("merge: rejects a type mismatch (a job id passed to the company merge, and vice versa)", async () => {
  await wipe()
  await db.collection("contexts").doc("real-company").set({ name: "Real Co", directoryType: "company", createdBy: "owner-1" })
  await db.collection("contexts").doc("real-job").set({ name: "Real Job", directoryType: "job", createdBy: "owner-1" })
  await assert.rejects(() => mergeDirectoryCompanies("real-company", "real-job"))
  await assert.rejects(() => mergeDirectoryJobs("real-job", "real-company"))
})

test("delete (company): nulls the id-based company link on referencing contacts/jobs but leaves the display text alone", async () => {
  await wipe()
  await db.collection("contexts").doc("widgets-co").set({
    name: "Widgets Co", directoryType: "company", createdBy: "owner-1",
    masterData: { displayName: "Widgets Co" },
  })
  await db.collection("contacts").doc("contact-1").set({
    ownerUserId: "owner-1", name: "Priya", company: "Widgets Co", masterData: { companyContextId: "widgets-co" },
  })
  await db.collection("contexts").doc("job-1").set({
    name: "Job One", directoryType: "job", createdBy: "owner-1",
    masterData: { canonicalName: "Job One", companyName: "Widgets Co", companyContextId: "widgets-co" },
  })

  const impact = await computeDirectoryDeleteImpact("company__widgets-co")
  assert.equal(impact.contacts, 1)
  assert.equal(impact.contexts, 1)

  await deleteDirectoryEntity("company__widgets-co")

  assert.equal((await db.collection("contexts").doc("widgets-co").get()).exists, false)
  const contact = (await db.collection("contacts").doc("contact-1").get()).data()!
  assert.equal(contact.company, "Widgets Co", "the free-text company name is left as harmless history")
  assert.equal((contact.masterData as Record<string, unknown>).companyContextId, null, "the id link is nulled so it can't dangle")
  const job = (await db.collection("contexts").doc("job-1").get()).data()!
  assert.equal((job.masterData as Record<string, unknown>).companyContextId, null)
  assert.equal((job.masterData as Record<string, unknown>).companyName, "Widgets Co", "job's free-text company name is also left alone")
})
