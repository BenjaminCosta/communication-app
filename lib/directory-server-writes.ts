/**
 * SVC Directory — ADMIN-SDK write helpers for the merge/delete cleanup flow.
 *
 * Server-only (imports firebase-admin/firestore). These are the operations a
 * browser client structurally cannot perform itself: re-pointing /messages
 * (a client can't write messages it doesn't own) and /directoryRelations
 * (client write is `if false`), and deleting a /contacts or /contexts doc
 * most users don't own. Callers must run these behind requireDirectoryAdmin()
 * (see lib/directory-admin-guard.ts) — nothing here re-checks permissions.
 *
 * Every step here is idempotent / safe to retry: array membership removal,
 * `arrayRemove`, and doc deletes of things that may already be gone are all
 * no-ops on a second pass. That matters because a large delete/merge chunks
 * its message re-pointing across multiple batched commits (Firestore caps a
 * batch at 500 writes) rather than one atomic transaction.
 */

import { FieldValue, type Firestore, type WriteBatch, getFirestore } from "firebase-admin/firestore"
import { getFirebaseAdminApp } from "@/lib/ai/server/firebase-admin"
import { directoryId as buildDirectoryId, parseDirectoryId, type DirectoryType } from "@/lib/directory-core"

export class DirectoryServerWriteError extends Error {
  readonly status: number
  constructor(message: string, status = 400) {
    super(message)
    this.name = "DirectoryServerWriteError"
    this.status = status
  }
}

async function adminDb(): Promise<Firestore> {
  return getFirestore(await getFirebaseAdminApp())
}

interface ResolvedEntity {
  type: DirectoryType
  sourceCollection: "contacts" | "contexts"
  sourceId: string
  directoryId: string
}

function resolveDirectoryId(id: string): ResolvedEntity {
  const parsed = parseDirectoryId(id)
  if (!parsed) throw new DirectoryServerWriteError("Invalid directory id.", 400)
  return {
    type: parsed.type,
    sourceCollection: parsed.type === "person" ? "contacts" : "contexts",
    sourceId: parsed.sourceId,
    directoryId: id,
  }
}

// Stay comfortably under Firestore's 500-write-per-batch cap.
const BATCH_LIMIT = 400
// Bound how many messages a single delete/merge request re-points
// synchronously, so an unusually high-traffic contact can't blow a
// serverless function's time limit. Directory has ~7.8k entities total, so
// this ceiling is not expected to bite in practice.
const MESSAGE_SCAN_LIMIT = 2000

async function commitInChunks(db: Firestore, ops: Array<(batch: WriteBatch) => void>): Promise<void> {
  for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
    const batch = db.batch()
    for (const op of ops.slice(i, i + BATCH_LIMIT)) op(batch)
    await batch.commit()
  }
}

async function findContextsInvolving(db: Firestore, contactSourceId: string) {
  const snap = await db.collection("contexts").where("involvedContactIds", "array-contains", contactSourceId).get()
  return snap.docs
}

async function findNotesFilesReferencing(db: Firestore, dirId: string) {
  const [notes, files] = await Promise.all([
    db.collection("directoryNotes").where("entityIds", "array-contains", dirId).get(),
    db.collection("directoryFiles").where("entityIds", "array-contains", dirId).get(),
  ])
  return { notes: notes.docs, files: files.docs }
}

async function findRelationsReferencing(db: Firestore, dirId: string) {
  const snap = await db.collection("directoryRelations").where("entityIds", "array-contains", dirId).get()
  return snap.docs
}

async function countMessagesReferencing(db: Firestore, contactSourceId: string): Promise<{ count: number; capped: boolean }> {
  const snap = await db.collection("messages")
    .where("contactIds", "array-contains", contactSourceId)
    .limit(MESSAGE_SCAN_LIMIT + 1)
    .get()
  return { count: Math.min(snap.size, MESSAGE_SCAN_LIMIT), capped: snap.size > MESSAGE_SCAN_LIMIT }
}

/** Strip a person from every job/company's involvedContactIds/involvedPeople/"People involved" field. */
async function stripPersonFromContexts(db: Firestore, contactSourceId: string): Promise<number> {
  const contextDocs = await findContextsInvolving(db, contactSourceId)
  await commitInChunks(db, contextDocs.map((ctxDoc) => (batch: WriteBatch) => {
    const data = ctxDoc.data()
    const involvedPeople = Array.isArray(data.involvedPeople)
      ? (data.involvedPeople as Array<{ id?: unknown; name?: unknown }>)
      : []
    const nextPeople = involvedPeople.filter((p) => p?.id !== contactSourceId)
    const fields = Array.isArray(data.fields) ? (data.fields as Array<{ label?: unknown; value?: unknown }>) : []
    const withoutPeopleField = fields.filter((f) => String(f.label ?? "").toLowerCase() !== "people involved")
    const nextFields = nextPeople.length > 0
      ? [...withoutPeopleField, { label: "People involved", value: nextPeople.map((p) => String(p.name ?? "")).join(", ") }]
      : withoutPeopleField
    batch.update(ctxDoc.ref, {
      involvedContactIds: FieldValue.arrayRemove(contactSourceId),
      involvedPeople: nextPeople,
      fields: nextFields,
      updatedAt: FieldValue.serverTimestamp(),
    })
  }))
  return contextDocs.length
}

/** Remove a directory id from every note/file's entityIds (keeps the note/file itself — it may reference other entities). */
async function stripFromNotesAndFiles(db: Firestore, dirId: string): Promise<{ notes: number; files: number }> {
  const { notes, files } = await findNotesFilesReferencing(db, dirId)
  await commitInChunks(db, [
    ...notes.map((n) => (batch: WriteBatch) => batch.update(n.ref, { entityIds: FieldValue.arrayRemove(dirId) })),
    ...files.map((f) => (batch: WriteBatch) => batch.update(f.ref, { entityIds: FieldValue.arrayRemove(dirId) })),
  ])
  return { notes: notes.length, files: files.length }
}

/**
 * Delete every /directoryRelations edge touching this id, regardless of
 * `source` — unlike the sync Cloud Function's own cleanup on contact/context
 * delete, which only retires edges it wrote itself ("context-sync"), leaving
 * import-authored edges dangling forever otherwise.
 */
async function deleteRelationsReferencing(db: Firestore, dirId: string): Promise<number> {
  const relationDocs = await findRelationsReferencing(db, dirId)
  await commitInChunks(db, relationDocs.map((r) => (batch: WriteBatch) => batch.delete(r.ref)))
  return relationDocs.length
}

/** Strip a contact id from messages.contactIds, paginated so a high-traffic contact can't exceed one request. */
async function stripPersonFromMessages(db: Firestore, contactSourceId: string): Promise<number> {
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined
  let processed = 0
  while (processed < MESSAGE_SCAN_LIMIT) {
    let q = db.collection("messages").where("contactIds", "array-contains", contactSourceId).limit(BATCH_LIMIT)
    if (cursor) q = q.startAfter(cursor)
    const snap = await q.get()
    if (snap.empty) break
    const batch = db.batch()
    for (const messageDoc of snap.docs) batch.update(messageDoc.ref, { contactIds: FieldValue.arrayRemove(contactSourceId) })
    await batch.commit()
    processed += snap.size
    cursor = snap.docs[snap.docs.length - 1]
    if (snap.size < BATCH_LIMIT) break
  }
  return processed
}

// ── Delete ────────────────────────────────────────────────────────────────

export interface DirectoryDeleteImpact {
  contexts: number
  notes: number
  files: number
  messages: number
  messagesCapped: boolean
  relations: number
}

/** Read-only preview of what deleting this entity would touch, for the confirm UI. */
export async function computeDirectoryDeleteImpact(dirIdStr: string): Promise<DirectoryDeleteImpact> {
  const entity = resolveDirectoryId(dirIdStr)
  const db = await adminDb()
  const [contextDocs, notesFiles, relationDocs, messages] = await Promise.all([
    entity.type === "person" ? findContextsInvolving(db, entity.sourceId) : Promise.resolve([]),
    findNotesFilesReferencing(db, entity.directoryId),
    findRelationsReferencing(db, entity.directoryId),
    entity.type === "person" ? countMessagesReferencing(db, entity.sourceId) : Promise.resolve({ count: 0, capped: false }),
  ])
  return {
    contexts: contextDocs.length,
    notes: notesFiles.notes.length,
    files: notesFiles.files.length,
    messages: messages.count,
    messagesCapped: messages.capped,
    relations: relationDocs.length,
  }
}

/**
 * Delete a person/company/job/other record, cleaning up every reference so
 * nothing dangles: job/company membership arrays, notes/files entityIds,
 * directoryRelations edges, and (person only) message tags. Jobs additionally
 * get a recursive delete — /contexts/{id}/outlooks is a subcollection, which
 * Firestore does not cascade-delete on its own.
 */
export async function deleteDirectoryEntity(dirIdStr: string): Promise<DirectoryDeleteImpact> {
  const entity = resolveDirectoryId(dirIdStr)
  const db = await adminDb()
  const docRef = db.collection(entity.sourceCollection).doc(entity.sourceId)
  const docSnap = await docRef.get()
  if (!docSnap.exists) throw new DirectoryServerWriteError("This record no longer exists.", 404)

  const impact = await computeDirectoryDeleteImpact(dirIdStr)

  if (entity.type === "person") await stripPersonFromContexts(db, entity.sourceId)
  await stripFromNotesAndFiles(db, entity.directoryId)
  await deleteRelationsReferencing(db, entity.directoryId)
  if (entity.type === "person") await stripPersonFromMessages(db, entity.sourceId)

  if (entity.type === "job") {
    await db.recursiveDelete(docRef)
  } else {
    await docRef.delete()
  }

  return impact
}

// ── Merge (people only, V1) ─────────────────────────────────────────────
//
// Companies/jobs aren't supported here: contexts are collaboratively shared
// (not single-sourced like an imported contact), and person duplicates are
// the actual, explicitly-called-out product gap this closes. Every step
// below re-points a reference from the duplicate to the survivor rather than
// just deleting it, so relationships survive the merge instead of just
// avoiding a dangling id.

/** Re-point a person's job/company "People involved" membership, deduping if the survivor is already listed. */
async function repointPersonInContexts(db: Firestore, dupSourceId: string, survivorSourceId: string, survivorName: string): Promise<number> {
  const contextDocs = await findContextsInvolving(db, dupSourceId)
  await commitInChunks(db, contextDocs.map((ctxDoc) => (batch: WriteBatch) => {
    const data = ctxDoc.data()
    const involvedPeople = Array.isArray(data.involvedPeople)
      ? (data.involvedPeople as Array<{ id?: unknown; name?: unknown }>)
      : []
    const withoutDup = involvedPeople.filter((p) => p?.id !== dupSourceId)
    const alreadyHasSurvivor = withoutDup.some((p) => p?.id === survivorSourceId)
    const nextPeople = alreadyHasSurvivor ? withoutDup : [...withoutDup, { id: survivorSourceId, name: survivorName }]
    const fields = Array.isArray(data.fields) ? (data.fields as Array<{ label?: unknown; value?: unknown }>) : []
    const withoutPeopleField = fields.filter((f) => String(f.label ?? "").toLowerCase() !== "people involved")
    const nextFields = nextPeople.length > 0
      ? [...withoutPeopleField, { label: "People involved", value: nextPeople.map((p) => String(p.name ?? "")).join(", ") }]
      : withoutPeopleField
    batch.update(ctxDoc.ref, {
      involvedContactIds: nextPeople.map((p) => String(p.id)),
      involvedPeople: nextPeople,
      fields: nextFields,
      updatedAt: FieldValue.serverTimestamp(),
    })
  }))
  return contextDocs.length
}

/**
 * Re-point /directoryRelations edges from the duplicate's composite id to the
 * survivor's. Relation doc ids are deterministic (`rel__{from}__{to}`): if the
 * survivor already has an edge to that same other endpoint, the duplicate's
 * version is redundant and just dropped; otherwise the edge is moved (create
 * at the new id, delete the old) so its role/confidence/source metadata
 * survives instead of being silently lost.
 */
async function repointPersonRelations(db: Firestore, dupDirId: string, survivorDirId: string, survivorName: string): Promise<number> {
  const relationDocs = await findRelationsReferencing(db, dupDirId)
  await Promise.all(relationDocs.map(async (relDoc) => {
    const data = relDoc.data()
    const from = String(data.fromDirectoryId ?? "")
    const to = String(data.toDirectoryId ?? "")
    const newFrom = from === dupDirId ? survivorDirId : from
    const newTo = to === dupDirId ? survivorDirId : to
    if (newFrom === newTo) { await relDoc.ref.delete(); return } // degenerate self-edge after repoint
    const newRef = db.collection("directoryRelations").doc(`rel__${newFrom}__${newTo}`)
    if (newRef.id === relDoc.id) return // already pointed correctly (shouldn't happen given the query, kept defensive)
    const existing = await newRef.get()
    if (existing.exists) {
      await relDoc.ref.delete() // survivor already has this edge — the duplicate's is redundant
      return
    }
    const patch: Record<string, unknown> = { ...data, fromDirectoryId: newFrom, toDirectoryId: newTo, entityIds: [newFrom, newTo] }
    if (from === dupDirId) patch.fromName = survivorName
    if (to === dupDirId) patch.toName = survivorName
    await db.runTransaction(async (tx) => {
      tx.set(newRef, patch)
      tx.delete(relDoc.ref)
    })
  }))
  return relationDocs.length
}

/** Re-point notes/files entityIds from the duplicate's composite id to the survivor's (deduped). */
async function repointNotesAndFiles(db: Firestore, dupDirId: string, survivorDirId: string): Promise<{ notes: number; files: number }> {
  const { notes, files } = await findNotesFilesReferencing(db, dupDirId)
  const patch = (docSnap: FirebaseFirestore.QueryDocumentSnapshot) => (batch: WriteBatch) => {
    const entityIds = Array.isArray(docSnap.data().entityIds) ? (docSnap.data().entityIds as unknown[]).map(String) : []
    const next = [...new Set(entityIds.filter((id) => id !== dupDirId).concat(survivorDirId))]
    batch.update(docSnap.ref, { entityIds: next })
  }
  await commitInChunks(db, [...notes.map(patch), ...files.map(patch)])
  return { notes: notes.length, files: files.length }
}

/** Re-point messages.contactIds from the duplicate to the survivor, paginated so a high-traffic contact can't exceed one request. */
async function repointPersonInMessages(db: Firestore, dupSourceId: string, survivorSourceId: string): Promise<number> {
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined
  let processed = 0
  while (processed < MESSAGE_SCAN_LIMIT) {
    let q = db.collection("messages").where("contactIds", "array-contains", dupSourceId).limit(BATCH_LIMIT)
    if (cursor) q = q.startAfter(cursor)
    const snap = await q.get()
    if (snap.empty) break
    const batch = db.batch()
    for (const messageDoc of snap.docs) {
      const contactIds = Array.isArray(messageDoc.data().contactIds) ? (messageDoc.data().contactIds as unknown[]).map(String) : []
      const next = [...new Set(contactIds.filter((id) => id !== dupSourceId).concat(survivorSourceId))]
      batch.update(messageDoc.ref, { contactIds: next })
    }
    await batch.commit()
    processed += snap.size
    cursor = snap.docs[snap.docs.length - 1]
    if (snap.size < BATCH_LIMIT) break
  }
  return processed
}

function unionDeduped<T>(a: unknown, b: unknown): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const item of [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])]) {
    const key = JSON.stringify(item)
    if (!seen.has(key)) { seen.add(key); out.push(item as T) }
  }
  return out
}

function cleanStr(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

export interface DirectoryMergeResult {
  survivorDirectoryId: string
}

/**
 * Merge duplicateContactId into survivorContactId: unions contact fields,
 * re-points every reference (job/company membership, relations, notes/files,
 * message tags) from the duplicate to the survivor, then deletes the
 * duplicate. Mirrors the union logic that used to live in the client-only
 * mergeContactData() (lib/directory-writes.ts, now removed — it could only
 * ever merge contact fields, never the message/relation re-pointing this
 * needs, and the /contacts owner-scoped update rule blocked it for most
 * real duplicates anyway).
 */
export async function mergeDirectoryContacts(survivorContactId: string, duplicateContactId: string): Promise<DirectoryMergeResult> {
  if (!survivorContactId || !duplicateContactId) {
    throw new DirectoryServerWriteError("Both contacts are required.", 400)
  }
  if (survivorContactId === duplicateContactId) {
    throw new DirectoryServerWriteError("Cannot merge a contact into itself.", 400)
  }

  const db = await adminDb()
  const survivorRef = db.collection("contacts").doc(survivorContactId)
  const dupRef = db.collection("contacts").doc(duplicateContactId)

  const survivorName = await db.runTransaction(async (tx) => {
    const [sSnap, dSnap] = await Promise.all([tx.get(survivorRef), tx.get(dupRef)])
    if (!sSnap.exists) throw new DirectoryServerWriteError("The record to keep no longer exists.", 404)
    if (!dSnap.exists) throw new DirectoryServerWriteError("The duplicate record no longer exists.", 404)
    const s = sSnap.data() ?? {}
    const d = dSnap.data() ?? {}
    if (cleanStr(s.mergedIntoId)) {
      throw new DirectoryServerWriteError("The record to keep was itself already merged into another contact.", 409)
    }
    if (cleanStr(d.mergedIntoId)) {
      throw new DirectoryServerWriteError("This record has already been merged.", 409)
    }

    const aliasNames = unionDeduped<string>(s.aliasNames, [d.name].filter(Boolean))
    tx.update(survivorRef, {
      emails: unionDeduped(s.emails, d.emails),
      phones: unionDeduped(s.phones, d.phones),
      urls: unionDeduped(s.urls, d.urls),
      tags: unionDeduped(s.tags, d.tags),
      companies: unionDeduped(s.companies, d.companies),
      roles: unionDeduped(s.roles, d.roles),
      company: cleanStr(s.company) ?? cleanStr(d.company) ?? null,
      role: cleanStr(s.role) ?? cleanStr(d.role) ?? null,
      aliasNames,
      mergedFromIds: FieldValue.arrayUnion(duplicateContactId),
      updatedAt: FieldValue.serverTimestamp(),
    })
    // Tombstone immediately so the duplicate stops surfacing while the rest
    // of this function re-points its references; it's deleted for real once
    // that's done.
    tx.update(dupRef, {
      mergedIntoId: survivorContactId,
      mergedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
    return cleanStr(s.name) ?? cleanStr(d.name) ?? "Unknown"
  })

  const dupDirId = buildDirectoryId("person", duplicateContactId)
  const survivorDirId = buildDirectoryId("person", survivorContactId)

  await repointPersonInContexts(db, duplicateContactId, survivorContactId, survivorName)
  await repointPersonRelations(db, dupDirId, survivorDirId, survivorName)
  await repointNotesAndFiles(db, dupDirId, survivorDirId)
  await repointPersonInMessages(db, duplicateContactId, survivorContactId)

  await dupRef.delete()

  return { survivorDirectoryId: survivorDirId }
}

// Re-exported for API route input validation / response shaping.
export { buildDirectoryId }
