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
import {
  classifyContext,
  directoryId as buildDirectoryId,
  parseDirectoryId,
  type CoreContext,
  type DirectoryType,
} from "@/lib/directory-core"

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

function cleanStr(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
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

/** Throws unless `data` (a /contexts doc) classifies as `expected` — guards merge/delete against a mistyped id. */
function assertContextType(id: string, data: Record<string, unknown>, expected: "company" | "job"): void {
  const actual = classifyContext({ id, ...data } as CoreContext)
  if (actual !== expected) throw new DirectoryServerWriteError(`This record is not a ${expected}.`, 400)
}

async function findContextsInvolving(db: Firestore, contactSourceId: string) {
  const snap = await db.collection("contexts").where("involvedContactIds", "array-contains", contactSourceId).get()
  return snap.docs
}

/**
 * Every /contacts and /contexts (job) doc whose company link points at this
 * company. Mirrors functions/src/directory/sync.ts's reRelatePeopleForCompany,
 * which uses the same three-source match (sourceCompanyId, exact name,
 * explicit companyContextId) to re-relate people on a company rename — a
 * company merge is the same operation plus combining the two docs' data.
 * Jobs only ever link by the explicit id (see normalizeJobContext).
 */
async function findEntitiesLinkedToCompany(
  db: Firestore,
  companyContextId: string,
  companyName: string,
  companySourceRecordId: string | null,
): Promise<{ contacts: FirebaseFirestore.QueryDocumentSnapshot[]; jobs: FirebaseFirestore.QueryDocumentSnapshot[] }> {
  const contactQueries = [
    db.collection("contacts").where("masterData.companyContextId", "==", companyContextId).get(),
  ]
  if (companyName) contactQueries.push(db.collection("contacts").where("company", "==", companyName).get())
  if (companySourceRecordId) {
    contactQueries.push(db.collection("contacts").where("sourceCompanyId", "==", companySourceRecordId).get())
  }
  const [contactSnaps, jobSnap] = await Promise.all([
    Promise.all(contactQueries),
    db.collection("contexts").where("masterData.companyContextId", "==", companyContextId).get(),
  ])
  const contactMap = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>()
  for (const snap of contactSnaps) for (const d of snap.docs) contactMap.set(d.id, d)
  return { contacts: [...contactMap.values()], jobs: jobSnap.docs }
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

/** Company's own displayName + sourceRecordId, used to find who links to it (see findEntitiesLinkedToCompany). */
function companyLinkKeyOf(data: Record<string, unknown>): { name: string; sourceRecordId: string | null } {
  const master = (data.masterData ?? {}) as Record<string, unknown>
  const name = cleanStr(master.displayName) ?? cleanStr(master.canonicalName) ?? cleanStr(data.name) ?? ""
  return { name, sourceRecordId: cleanStr(data.sourceRecordId) }
}

/** Null out the id-based company link on every contact/job that pointed at this company (delete path — text name is left as-is, harmless history; see repointCompanyReferences for the merge equivalent, which also updates the name). */
async function stripCompanyReferences(
  db: Firestore,
  companyContextId: string,
  companyName: string,
  companySourceRecordId: string | null,
): Promise<{ contacts: number; jobs: number }> {
  const { contacts, jobs } = await findEntitiesLinkedToCompany(db, companyContextId, companyName, companySourceRecordId)
  await commitInChunks(db, [...contacts, ...jobs].map((d) => (batch: WriteBatch) => batch.update(d.ref, {
    "masterData.companyContextId": null,
    updatedAt: FieldValue.serverTimestamp(),
  })))
  return { contacts: contacts.length, jobs: jobs.length }
}

// ── Delete ────────────────────────────────────────────────────────────────

export interface DirectoryDeleteImpact {
  /** Jobs/companies referencing this entity: person → contexts listing them; company → jobs pointing at it. */
  contexts: number
  /** Company only: contacts whose company link points at it. */
  contacts: number
  notes: number
  files: number
  messages: number
  messagesCapped: boolean
  relations: number
}

/** Read-only preview of what deleting this entity would touch, for the confirm UI. Also the existence check both this and deleteDirectoryEntity rely on. */
export async function computeDirectoryDeleteImpact(dirIdStr: string): Promise<DirectoryDeleteImpact> {
  const entity = resolveDirectoryId(dirIdStr)
  const db = await adminDb()
  const docRef = db.collection(entity.sourceCollection).doc(entity.sourceId)
  const docSnap = await docRef.get()
  if (!docSnap.exists) throw new DirectoryServerWriteError("This record no longer exists.", 404)
  const linkKey = entity.type === "company" ? companyLinkKeyOf(docSnap.data() ?? {}) : null

  const [contextDocs, companyLinks, notesFiles, relationDocs, messages] = await Promise.all([
    entity.type === "person" ? findContextsInvolving(db, entity.sourceId) : Promise.resolve([]),
    linkKey ? findEntitiesLinkedToCompany(db, entity.sourceId, linkKey.name, linkKey.sourceRecordId) : Promise.resolve({ contacts: [], jobs: [] }),
    findNotesFilesReferencing(db, entity.directoryId),
    findRelationsReferencing(db, entity.directoryId),
    entity.type === "person" ? countMessagesReferencing(db, entity.sourceId) : Promise.resolve({ count: 0, capped: false }),
  ])
  return {
    contexts: contextDocs.length + companyLinks.jobs.length,
    contacts: companyLinks.contacts.length,
    notes: notesFiles.notes.length,
    files: notesFiles.files.length,
    messages: messages.count,
    messagesCapped: messages.capped,
    relations: relationDocs.length,
  }
}

/**
 * Delete a person/company/job/other record, cleaning up every reference so
 * nothing dangles: job/company membership arrays (person) or company-link
 * fields on contacts/jobs (company), notes/files entityIds,
 * directoryRelations edges, and (person only) message tags. Jobs additionally
 * get a recursive delete — /contexts/{id}/outlooks is a subcollection, which
 * Firestore does not cascade-delete on its own.
 */
export async function deleteDirectoryEntity(dirIdStr: string): Promise<DirectoryDeleteImpact> {
  const entity = resolveDirectoryId(dirIdStr)
  const db = await adminDb()
  const docRef = db.collection(entity.sourceCollection).doc(entity.sourceId)

  // Also confirms the record still exists (throws 404 otherwise).
  const impact = await computeDirectoryDeleteImpact(dirIdStr)

  // Every step below touches a disjoint collection with no data dependency
  // on any other step, so they run concurrently rather than one at a time —
  // cuts wall-clock time roughly to the slowest step instead of the sum of
  // all of them, which matters for staying under a serverless timeout on a
  // heavily-referenced record.
  const cleanupSteps: Promise<unknown>[] = [
    stripFromNotesAndFiles(db, entity.directoryId),
    deleteRelationsReferencing(db, entity.directoryId),
  ]
  if (entity.type === "person") {
    cleanupSteps.push(stripPersonFromContexts(db, entity.sourceId))
    cleanupSteps.push(stripPersonFromMessages(db, entity.sourceId))
  }
  if (entity.type === "company") {
    cleanupSteps.push((async () => {
      const docSnap = await docRef.get()
      const linkKey = companyLinkKeyOf(docSnap.data() ?? {})
      await stripCompanyReferences(db, entity.sourceId, linkKey.name, linkKey.sourceRecordId)
    })())
  }
  await Promise.all(cleanupSteps)

  if (entity.type === "job") {
    await db.recursiveDelete(docRef)
  } else {
    await docRef.delete()
  }

  return impact
}

// ── Merge ─────────────────────────────────────────────────────────────────
//
// Every step below re-points a reference from the duplicate to the survivor
// rather than just deleting it, so relationships survive the merge instead
// of just avoiding a dangling id. People, companies and jobs each get their
// own merge function (their reference shapes genuinely differ — contacts are
// single-sourced records, companies are pointed-at by others via a name/id
// link, jobs hold their own membership array and a subcollection) but share
// the same helpers below where the work really is identical.

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
 * Re-point every contact/job whose company link pointed at the duplicate
 * company so it points at the survivor instead — both the id (durable) and
 * the display name (so old free-text/name-matched links resolve correctly
 * too). Same lookup as stripCompanyReferences (delete path); this one moves
 * the link forward instead of nulling it.
 */
async function repointCompanyReferences(
  db: Firestore,
  dup: { contextId: string; name: string; sourceRecordId: string | null },
  survivorId: string,
  survivorName: string,
): Promise<{ contacts: number; jobs: number }> {
  const { contacts, jobs } = await findEntitiesLinkedToCompany(db, dup.contextId, dup.name, dup.sourceRecordId)
  await commitInChunks(db, [
    ...contacts.map((d) => (batch: WriteBatch) => batch.update(d.ref, {
      company: survivorName,
      "masterData.companyContextId": survivorId,
      "masterData.companyMatchConfidence": 1,
      updatedAt: FieldValue.serverTimestamp(),
    })),
    ...jobs.map((d) => (batch: WriteBatch) => batch.update(d.ref, {
      "masterData.companyName": survivorName,
      "masterData.companyContextId": survivorId,
      updatedAt: FieldValue.serverTimestamp(),
    })),
  ])
  return { contacts: contacts.length, jobs: jobs.length }
}

/**
 * Re-point /directoryRelations edges from the duplicate's composite id to the
 * survivor's. Relation doc ids are deterministic (`rel__{from}__{to}`): if the
 * survivor already has an edge to that same other endpoint, the duplicate's
 * version is redundant and just dropped; otherwise the edge is moved (create
 * at the new id, delete the old) so its role/confidence/source metadata
 * survives instead of being silently lost. Type-neutral — used for merging
 * people, companies and jobs alike.
 */
async function repointRelations(db: Firestore, dupDirId: string, survivorDirId: string, survivorName: string): Promise<number> {
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

/** Normalize a contexts[].involvedPeople-shaped array: dedupe by id, drop malformed entries, cap at 50 (mirrors lib/directory-writes.ts's normalizedInvolvedPeople — reimplemented here rather than imported since that module pulls in the client Firestore SDK). */
function normalizeInvolvedPeopleList(value: unknown): Array<{ id: string; name: string }> {
  const seen = new Set<string>()
  const out: Array<{ id: string; name: string }> = []
  for (const raw of Array.isArray(value) ? value : []) {
    const id = cleanStr((raw as { id?: unknown })?.id)
    const name = cleanStr((raw as { name?: unknown })?.name)
    if (!id || !name || seen.has(id)) continue
    seen.add(id)
    out.push({ id, name })
    if (out.length === 50) break
  }
  return out
}

/** Shallow-fill scalar masterData fields: the survivor's non-empty values win; the duplicate only fills gaps. Arrays are left alone — callers union those explicitly per field (aliases, involvedPeople, …), since a blind fill isn't the right merge for a list. */
function fillMissingScalars(survivor: Record<string, unknown>, dup: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...survivor }
  for (const [key, value] of Object.entries(dup)) {
    if (Array.isArray(value)) continue
    const current = merged[key]
    const currentEmpty = current == null || (typeof current === "string" && current.trim() === "")
    const valueEmpty = value == null || (typeof value === "string" && value.trim() === "")
    if (currentEmpty && !valueEmpty) merged[key] = value
  }
  return merged
}

/**
 * Union two contexts[].fields[] arrays by label: the survivor's value for a
 * label wins if non-empty, else the duplicate's fills it; labels only the
 * duplicate has are appended. `excludeLabels` drops labels a caller
 * regenerates itself (e.g. "People involved", rebuilt from the merged
 * involvedPeople array rather than unioned as raw text).
 */
function unionFieldsByLabel(
  survivorFields: unknown,
  dupFields: unknown,
  excludeLabels: string[] = [],
): Array<{ label: string; value: string }> {
  const exclude = new Set(excludeLabels.map((l) => l.toLowerCase()))
  const asFields = (v: unknown) => (Array.isArray(v) ? (v as Array<{ label?: unknown; value?: unknown }>) : [])
  const byLabel = new Map<string, { label: string; value: string }>()
  for (const f of asFields(survivorFields)) {
    const label = String(f.label ?? "").trim()
    if (!label || exclude.has(label.toLowerCase())) continue
    byLabel.set(label.toLowerCase(), { label, value: String(f.value ?? "") })
  }
  for (const f of asFields(dupFields)) {
    const label = String(f.label ?? "").trim()
    if (!label || exclude.has(label.toLowerCase())) continue
    const key = label.toLowerCase()
    const existing = byLabel.get(key)
    if (!existing) { byLabel.set(key, { label, value: String(f.value ?? "") }); continue }
    if (!existing.value.trim() && String(f.value ?? "").trim()) existing.value = String(f.value ?? "")
  }
  return [...byLabel.values()]
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
    const dupMergedInto = cleanStr(d.mergedIntoId)
    // Only a genuine "already merged elsewhere" is a hard stop. If it was
    // already tombstoned into THIS survivor, a prior attempt at this exact
    // merge must have failed after the transaction committed but before the
    // repoint/delete steps below finished — retrying needs to fall through
    // and resume those steps, not get rejected here forever.
    if (dupMergedInto && dupMergedInto !== survivorContactId) {
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

  // Disjoint collections, no data dependency between them — run concurrently.
  await Promise.all([
    repointPersonInContexts(db, duplicateContactId, survivorContactId, survivorName),
    repointRelations(db, dupDirId, survivorDirId, survivorName),
    repointNotesAndFiles(db, dupDirId, survivorDirId),
    repointPersonInMessages(db, duplicateContactId, survivorContactId),
  ])

  await dupRef.delete()

  return { survivorDirectoryId: survivorDirId }
}

/**
 * Merge duplicateContextId into survivorContextId (both companies): unions
 * masterData/fields, folds the duplicate's name into the survivor's aliases
 * (same idea as a company rename accumulating its old name — see
 * functions/src/directory/sync.ts), re-points every contact/job whose
 * company link pointed at the duplicate, then deletes it.
 */
export async function mergeDirectoryCompanies(survivorContextId: string, duplicateContextId: string): Promise<DirectoryMergeResult> {
  if (!survivorContextId || !duplicateContextId) {
    throw new DirectoryServerWriteError("Both companies are required.", 400)
  }
  if (survivorContextId === duplicateContextId) {
    throw new DirectoryServerWriteError("Cannot merge a company into itself.", 400)
  }

  const db = await adminDb()
  const survivorRef = db.collection("contexts").doc(survivorContextId)
  const dupRef = db.collection("contexts").doc(duplicateContextId)

  const merged = await db.runTransaction(async (tx) => {
    const [sSnap, dSnap] = await Promise.all([tx.get(survivorRef), tx.get(dupRef)])
    if (!sSnap.exists) throw new DirectoryServerWriteError("The record to keep no longer exists.", 404)
    if (!dSnap.exists) throw new DirectoryServerWriteError("The duplicate record no longer exists.", 404)
    const s = sSnap.data() ?? {}
    const d = dSnap.data() ?? {}
    assertContextType(sSnap.id, s, "company")
    assertContextType(dSnap.id, d, "company")
    if (cleanStr(s.mergedIntoId)) {
      throw new DirectoryServerWriteError("The record to keep was itself already merged into another company.", 409)
    }
    const dupMergedInto = cleanStr(d.mergedIntoId)
    // See mergeDirectoryContacts for why this only rejects a genuine
    // "merged elsewhere" — a prior attempt at this exact merge may have
    // failed after tombstoning but before the repoint/delete steps finished,
    // and a retry needs to be able to resume rather than get stuck forever.
    if (dupMergedInto && dupMergedInto !== survivorContextId) {
      throw new DirectoryServerWriteError("This record has already been merged.", 409)
    }

    const sMaster = (s.masterData ?? {}) as Record<string, unknown>
    const dMaster = (d.masterData ?? {}) as Record<string, unknown>
    const survivorName = cleanStr(sMaster.displayName) ?? cleanStr(s.name) ?? cleanStr(dMaster.displayName) ?? cleanStr(d.name) ?? "Unknown"
    const dupName = cleanStr(dMaster.displayName) ?? cleanStr(d.name) ?? ""

    const mergedMaster = fillMissingScalars(sMaster, dMaster)
    mergedMaster.displayName = survivorName
    mergedMaster.aliases = unionDeduped<string>(sMaster.aliases, [...(Array.isArray(dMaster.aliases) ? dMaster.aliases : []), dupName].filter(Boolean))

    tx.update(survivorRef, {
      masterData: mergedMaster,
      fields: unionFieldsByLabel(s.fields, d.fields),
      description: cleanStr(s.description) ?? cleanStr(d.description) ?? null,
      mergedFromIds: FieldValue.arrayUnion(duplicateContextId),
      updatedAt: FieldValue.serverTimestamp(),
    })
    tx.update(dupRef, {
      mergedIntoId: survivorContextId,
      mergedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
    return { survivorName, dupName, dupSourceRecordId: cleanStr(d.sourceRecordId) }
  })

  const dupDirId = buildDirectoryId("company", duplicateContextId)
  const survivorDirId = buildDirectoryId("company", survivorContextId)

  // Disjoint collections, no data dependency between them — run concurrently.
  await Promise.all([
    repointCompanyReferences(
      db,
      { contextId: duplicateContextId, name: merged.dupName, sourceRecordId: merged.dupSourceRecordId },
      survivorContextId,
      merged.survivorName,
    ),
    repointRelations(db, dupDirId, survivorDirId, merged.survivorName),
    repointNotesAndFiles(db, dupDirId, survivorDirId),
  ])

  await dupRef.delete()

  return { survivorDirectoryId: survivorDirId }
}

/**
 * Merge duplicateContextId into survivorContextId (both jobs): unions the
 * involvedPeople/involvedContactIds membership and masterData/fields, then
 * deletes the duplicate — recursively, since /contexts/{id}/outlooks is a
 * subcollection Firestore won't cascade-delete on its own.
 */
export async function mergeDirectoryJobs(survivorContextId: string, duplicateContextId: string): Promise<DirectoryMergeResult> {
  if (!survivorContextId || !duplicateContextId) {
    throw new DirectoryServerWriteError("Both jobs are required.", 400)
  }
  if (survivorContextId === duplicateContextId) {
    throw new DirectoryServerWriteError("Cannot merge a job into itself.", 400)
  }

  const db = await adminDb()
  const survivorRef = db.collection("contexts").doc(survivorContextId)
  const dupRef = db.collection("contexts").doc(duplicateContextId)

  const survivorName = await db.runTransaction(async (tx) => {
    const [sSnap, dSnap] = await Promise.all([tx.get(survivorRef), tx.get(dupRef)])
    if (!sSnap.exists) throw new DirectoryServerWriteError("The record to keep no longer exists.", 404)
    if (!dSnap.exists) throw new DirectoryServerWriteError("The duplicate record no longer exists.", 404)
    const s = sSnap.data() ?? {}
    const d = dSnap.data() ?? {}
    assertContextType(sSnap.id, s, "job")
    assertContextType(dSnap.id, d, "job")
    if (cleanStr(s.mergedIntoId)) {
      throw new DirectoryServerWriteError("The record to keep was itself already merged into another job.", 409)
    }
    const dupMergedInto = cleanStr(d.mergedIntoId)
    // See mergeDirectoryContacts for why this only rejects a genuine
    // "merged elsewhere" — a prior attempt at this exact merge may have
    // failed after tombstoning but before the repoint/delete steps finished,
    // and a retry needs to be able to resume rather than get stuck forever.
    if (dupMergedInto && dupMergedInto !== survivorContextId) {
      throw new DirectoryServerWriteError("This record has already been merged.", 409)
    }

    const sMaster = (s.masterData ?? {}) as Record<string, unknown>
    const dMaster = (d.masterData ?? {}) as Record<string, unknown>
    const survivorName = cleanStr(sMaster.canonicalName) ?? cleanStr(s.name) ?? cleanStr(dMaster.canonicalName) ?? cleanStr(d.name) ?? "Unknown"

    const sPeople = normalizeInvolvedPeopleList(s.involvedPeople)
    const dPeople = normalizeInvolvedPeopleList(d.involvedPeople)
    const mergedPeopleMap = new Map(sPeople.map((p) => [p.id, p] as const))
    for (const p of dPeople) if (!mergedPeopleMap.has(p.id)) mergedPeopleMap.set(p.id, p)
    const mergedPeople = [...mergedPeopleMap.values()]

    const mergedMaster = fillMissingScalars(sMaster, dMaster)
    mergedMaster.canonicalName = survivorName

    const mergedFields = unionFieldsByLabel(s.fields, d.fields, ["People involved"])
    if (mergedPeople.length > 0) {
      mergedFields.push({ label: "People involved", value: mergedPeople.map((p) => p.name).join(", ") })
    }

    tx.update(survivorRef, {
      masterData: mergedMaster,
      fields: mergedFields,
      involvedContactIds: mergedPeople.map((p) => p.id),
      involvedPeople: mergedPeople,
      mergedFromIds: FieldValue.arrayUnion(duplicateContextId),
      updatedAt: FieldValue.serverTimestamp(),
    })
    tx.update(dupRef, {
      mergedIntoId: survivorContextId,
      mergedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
    return survivorName
  })

  const dupDirId = buildDirectoryId("job", duplicateContextId)
  const survivorDirId = buildDirectoryId("job", survivorContextId)

  // Disjoint collections, no data dependency between them — run concurrently.
  await Promise.all([
    repointRelations(db, dupDirId, survivorDirId, survivorName),
    repointNotesAndFiles(db, dupDirId, survivorDirId),
  ])

  await db.recursiveDelete(dupRef)

  return { survivorDirectoryId: survivorDirId }
}

export type DirectoryMergeEntityType = "person" | "company" | "job"

/** Dispatches to the right type-specific merge function — the API route's single entry point. */
export async function mergeDirectoryEntities(
  entityType: DirectoryMergeEntityType,
  survivorSourceId: string,
  duplicateSourceId: string,
): Promise<DirectoryMergeResult> {
  if (entityType === "person") return mergeDirectoryContacts(survivorSourceId, duplicateSourceId)
  if (entityType === "company") return mergeDirectoryCompanies(survivorSourceId, duplicateSourceId)
  return mergeDirectoryJobs(survivorSourceId, duplicateSourceId)
}

// Re-exported for API route input validation / response shaping.
export { buildDirectoryId }
