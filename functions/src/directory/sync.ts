import { getFirestore, FieldValue, Firestore } from "firebase-admin/firestore"
import * as functionsV1 from "firebase-functions/v1"
import { createHash } from "node:crypto"
import { buildAskContext } from "../directory-ask-context"
import {
  buildContactIndexEntry,
  buildContextIndexEntry,
  buildSearchDoc,
  classifyContext,
  directoryId,
  directorySearchShardId,
  contextCompositeIds,
  normalizeName,
  DIRECTORY_SCHEMA_VERSION,
  DIRECTORY_SEARCH_SHARD_COUNT,
  type CoreContact,
  type CoreContext,
  type DirectoryIndexEntry,
  type DirectoryPerson,
} from "../directory-core"

// ══════════════════════════════════════════════════════════════════════════
// SVC Directory sync — keeps /directoryIndex in lockstep with the source
// collections (/contacts, /contexts).
//
// /directoryIndex is a DERIVED, client-read-only projection. These functions
// are its ONLY writers (Admin SDK bypasses security rules). The source
// collections remain the sole source of truth and are NEVER modified here, so
// no existing Communications flow changes. All Directory edits must therefore
// write to /contacts or /contexts first; the change then flows here.
//
// Reuses the exact normalizer logic from lib/directory-core.ts via the
// generated ./directory-core copy (no duplicated logic). 1st-gen triggers,
// matching the rest of this file (avoids Eventarc/Cloud Run IAM setup).
// ══════════════════════════════════════════════════════════════════════════

/** Recursively drop undefined (Firestore rejects it); leave Dates/sentinels intact. */
function sanitizeUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeUndefined).filter((v) => v !== undefined)
  if (
    value &&
    typeof value === "object" &&
    !(value instanceof Date) &&
    (value as { constructor?: unknown }).constructor === Object
  ) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([k, v]) => [k, sanitizeUndefined(v)])
        .filter(([, v]) => v !== undefined)
    )
  }
  return value === undefined ? null : value
}

/** Read a source doc's updatedAt (Timestamp → Date), if present. */
function sourceUpdatedAtOf(data: Record<string, unknown>): Date | null {
  const u = data.updatedAt
  if (u && typeof (u as { toDate?: unknown }).toDate === "function") return (u as { toDate(): Date }).toDate()
  return null
}

/**
 * Stamp server indexedAt/updatedAt + schemaVersion and strip undefined before
 * writing an index doc. The built entry already carries sourceUpdatedAt.
 */
function toIndexDoc(entry: object): Record<string, unknown> {
  return sanitizeUndefined({
    ...entry,
    indexedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    schemaVersion: DIRECTORY_SCHEMA_VERSION,
  }) as Record<string, unknown>
}

/**
 * Import suppression: while /directoryControl/importLock is active, incremental
 * sync skips the expensive index writes so a bulk import doesn't trigger
 * thousands of per-doc syncs. After the import, a controlled rebuild reindexes
 * everything. One cheap read per invocation; contact/context writes are rare
 * outside imports.
 */
async function isSyncSuppressed(db: Firestore): Promise<boolean> {
  try {
    const snap = await db.doc("directoryControl/importLock").get()
    if (!snap.exists) return false
    const d = snap.data() ?? {}
    if (d.active !== true) return false
    const until = d.until && typeof (d.until as { toDate?: unknown }).toDate === "function"
      ? (d.until as { toDate(): Date }).toDate()
      : null
    return !until || until.getTime() > Date.now()
  } catch {
    return false
  }
}

/** Best-effort bump of the directoryMeta change marker (for client cache invalidation). */
async function markDirectoryChanged(db: Firestore): Promise<void> {
  try {
    await db.doc("directoryMeta/status").set({
      schemaVersion: DIRECTORY_SCHEMA_VERSION,
      lastChangeAt: FieldValue.serverTimestamp(),
    }, { merge: true })
  } catch { /* non-fatal */ }
}

/**
 * Incrementally maintains the compact catalog after the full shard backfill is
 * installed. The index remains authoritative if this best-effort projection
 * cannot be updated; clients then keep their previous revision or fall back.
 */
async function syncDirectorySearchCatalog(
  db: Firestore,
  upserts: DirectoryIndexEntry[],
  deletedIds: string[],
): Promise<void> {
  const affectedIds = [...new Set([...upserts.map((entry) => entry.id), ...deletedIds])]
  if (affectedIds.length === 0) return
  const shardIds = [...new Set(affectedIds.map((id) => directorySearchShardId(id)))]
  const metaRef = db.doc("directoryMeta/status")
  const shardRefs = shardIds.map((id) => db.collection("directorySearchShards").doc(id))

  try {
    await db.runTransaction(async (transaction) => {
      const [metaSnap, ...shardSnaps] = await transaction.getAll(metaRef, ...shardRefs)
      const meta = metaSnap.data() ?? {}
      if (meta.searchShardCount !== DIRECTORY_SEARCH_SHARD_COUNT || typeof meta.searchEntryCount !== "number") return
      if (shardSnaps.some((snapshot) => !snapshot.exists)) {
        throw new Error("directory search shard set is incomplete")
      }

      const previousRevision = typeof meta.searchRevision === "number" ? meta.searchRevision : Date.now()
      const nextRevision = previousRevision + 1
      let entryCountDelta = 0
      for (let index = 0; index < shardRefs.length; index += 1) {
        const shardId = shardIds[index]
        const snapshot = shardSnaps[index]
        const existing = Array.isArray(snapshot.data()?.entries)
          ? (snapshot.data()?.entries as Array<{ id?: unknown }>).filter((entry) => typeof entry?.id === "string")
          : []
        const removed = new Set(deletedIds.filter((id) => directorySearchShardId(id) === shardId))
        const replacements = new Map(
          upserts
            .filter((entry) => directorySearchShardId(entry.id) === shardId)
            .map((entry) => [entry.id, buildSearchDoc(entry)]),
        )
        const entries = existing
          .filter((entry) => !removed.has(String(entry.id)) && !replacements.has(String(entry.id)))
          .concat([...replacements.values()])
          .sort((a, b) => String(a.id).localeCompare(String(b.id)))
        if (Buffer.byteLength(JSON.stringify(entries), "utf8") > 800_000) {
          throw new Error(`directory search shard ${shardId} exceeded the 800 KB safety ceiling`)
        }
        entryCountDelta += entries.length - existing.length
        transaction.set(shardRefs[index], {
          schemaVersion: DIRECTORY_SCHEMA_VERSION,
          shardId,
          revision: nextRevision,
          entryCount: entries.length,
          entries,
          updatedAt: FieldValue.serverTimestamp(),
        })
      }
      transaction.set(metaRef, {
        schemaVersion: DIRECTORY_SCHEMA_VERSION,
        lastChangeAt: FieldValue.serverTimestamp(),
        searchRevision: nextRevision,
        searchSchemaVersion: DIRECTORY_SCHEMA_VERSION,
        searchShardCount: DIRECTORY_SEARCH_SHARD_COUNT,
        searchEntryCount: Math.max(0, Number(meta.searchEntryCount ?? 0) + entryCountDelta),
        searchBuiltAt: FieldValue.serverTimestamp(),
      }, { merge: true })
    })
  } catch (error) {
    functionsV1.logger.error("[directorySearch] incremental shard update failed", error)
    throw error
  }
}

/**
 * Stable-id-aware person→company resolver for the incremental path.
 * Prefers sourceCompanyId (survives company renames), then exact company name.
 * Returns the composite company id, or null.
 */
async function resolveCompanyIdForContact(db: Firestore, contact: CoreContact): Promise<string | null> {
  // 1. Stable link via sourceCompanyId → company context sharing that sourceRecordId.
  const sourceCompanyId = typeof contact.sourceCompanyId === "string" ? contact.sourceCompanyId.trim() : ""
  if (sourceCompanyId) {
    const snap = await db.collection("contexts").where("sourceRecordId", "==", sourceCompanyId).limit(5).get()
    for (const doc of snap.docs) {
      if (classifyContext({ id: doc.id, ...(doc.data() as object) } as CoreContext) === "company") {
        return directoryId("company", doc.id)
      }
    }
  }
  // 2. Exact company name match.
  const name = typeof contact.company === "string" ? contact.company.trim() : ""
  if (name) {
    const snap = await db.collection("contexts").where("name", "==", name).limit(5).get()
    for (const doc of snap.docs) {
      if (classifyContext({ id: doc.id, ...(doc.data() as object) } as CoreContext) === "company") {
        return directoryId("company", doc.id)
      }
    }
  }
  return null
}

/** Rebuild+write a single person index entry from its current source data. */
async function reindexContact(db: Firestore, id: string, data: Record<string, unknown>): Promise<DirectoryIndexEntry> {
  const contact = { id, ...data } as CoreContact
  const companyEntityId = await resolveCompanyIdForContact(db, contact)
  const entry = buildContactIndexEntry(contact, {
    sourceUpdatedAt: sourceUpdatedAtOf(data),
    resolveCompanyIdForPerson: (_p: DirectoryPerson) => companyEntityId,
  })
  await db.collection("directoryIndex").doc(directoryId("person", id)).set(toIndexDoc(entry))
  return entry
}

/**
 * When a company context is created or renamed, re-relate people that reference
 * it — by sourceCompanyId (stable) or by company name (old and new). Re-indexes
 * each affected person so their companyEntityId resolves. Bounded to avoid
 * runaway fan-out on very large companies.
 */
async function reRelatePeopleForCompany(
  db: Firestore,
  companyCtxId: string,
  companyData: Record<string, unknown>,
  previousName: string | null,
): Promise<number> {
  const refs = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>()
  const add = (snap: FirebaseFirestore.QuerySnapshot) => snap.docs.forEach((d) => refs.set(d.id, d))

  const sourceRecordId = typeof companyData.sourceRecordId === "string" ? companyData.sourceRecordId.trim() : ""
  const currentName = typeof companyData.name === "string" ? companyData.name.trim() : ""
  const names = [currentName, previousName].filter((n): n is string => !!n && n.length > 0)

  const queries: Promise<FirebaseFirestore.QuerySnapshot>[] = []
  if (sourceRecordId) queries.push(db.collection("contacts").where("sourceCompanyId", "==", sourceRecordId).limit(500).get())
  for (const n of [...new Set(names)]) {
    queries.push(db.collection("contacts").where("company", "==", n).limit(500).get())
  }
  ;(await Promise.all(queries)).forEach(add)

  if (refs.size === 0) return 0
  let count = 0
  // Reindex in bounded batches of parallel writes.
  const docs = [...refs.values()]
  for (let i = 0; i < docs.length; i += 50) {
    const entries = await Promise.all(docs.slice(i, i + 50).map((d) => reindexContact(db, d.id, d.data())))
    await syncDirectorySearchCatalog(db, entries, [])
    count += Math.min(50, docs.length - i)
  }
  functionsV1.logger.info(`[directorySync] company ${companyCtxId} re-related ${count} people (names=${names.join("|")})`)
  return count
}

/**
 * /contacts → /directoryIndex (always type "person", stable composite id).
 * create/update → upsert person__{id}; delete → remove it. Idempotent.
 */
export const syncDirectoryOnContactWrite = functionsV1.firestore
  .document("contacts/{contactId}")
  .onWrite(async (change, context) => {
    const id: string = context.params.contactId
    const db = getFirestore()
    const ref = db.collection("directoryIndex").doc(directoryId("person", id))

    if (!change.after.exists) {
      await ref.delete()
      await syncDirectorySearchCatalog(db, [], [directoryId("person", id)])
      await markDirectoryChanged(db)
      functionsV1.logger.info(`[directorySync] contact ${id} deleted → removed person__${id}`)
      return
    }

    if (await isSyncSuppressed(db)) {
      functionsV1.logger.info(`[directorySync] contact ${id} skipped (import lock active)`)
      return
    }

    const data = change.after.data() ?? {}
    const entry = await reindexContact(db, id, data)
    await syncDirectorySearchCatalog(db, [entry], [])
    await markDirectoryChanged(db)
    functionsV1.logger.info(`[directorySync] contact ${id} → person__${id}`)
  })

/**
 * /contexts → /directoryIndex (type company|job|other, chosen by classifyContext,
 * honoring an explicit directoryType field first).
 *
 * Keeps EXACTLY ONE entry per source id: deletes the two non-matching type
 * composite ids and upserts the matching one, so type changes self-heal without
 * needing the before-state. On delete, all three context composite ids are
 * removed. On company create/rename, re-relates affected people.
 */
export const syncDirectoryOnContextWrite = functionsV1.firestore
  .document("contexts/{contextId}")
  .onWrite(async (change, context) => {
    const id: string = context.params.contextId
    const db = getFirestore()
    const col = db.collection("directoryIndex")
    const allIds = contextCompositeIds(id) // [company__id, job__id, other__id]

    if (!change.after.exists) {
      const batch = db.batch()
      for (const cid of allIds) batch.delete(col.doc(cid))
      await batch.commit()
      await syncDirectorySearchCatalog(db, [], allIds)
      await markDirectoryChanged(db)
      functionsV1.logger.info(`[directorySync] context ${id} deleted → removed ${allIds.join(", ")}`)
      return
    }

    if (await isSyncSuppressed(db)) {
      functionsV1.logger.info(`[directorySync] context ${id} skipped (import lock active)`)
      return
    }

    const data = change.after.data() ?? {}
    const before = change.before.exists ? (change.before.data() ?? {}) : null

    // Accumulate the previous name as a searchable alias on rename.
    const currentName = typeof data.name === "string" ? data.name.trim() : ""
    const previousName = before && typeof before.name === "string" ? before.name.trim() : null
    const renamed = !!previousName && normalizeName(previousName) !== normalizeName(currentName)

    // Preserve aliases already accumulated on the existing index entry.
    let extraAliases: string[] = []
    const priorEntrySnap = await col.doc(directoryId("company", id)).get()
    if (priorEntrySnap.exists) {
      const prior = priorEntrySnap.data() ?? {}
      if (Array.isArray(prior.aliases)) extraAliases = prior.aliases.filter((a): a is string => typeof a === "string")
    }
    if (renamed && previousName) extraAliases = [...new Set([...extraAliases, previousName])]

    const entry = buildContextIndexEntry({ id, ...(data as object) } as CoreContext, {
      sourceUpdatedAt: sourceUpdatedAtOf(data),
      extraAliases: entry_isCompany(data) ? extraAliases : undefined,
    })

    const batch = db.batch()
    for (const cid of allIds) {
      if (cid !== entry.id) batch.delete(col.doc(cid)) // clear stale/other-type entries
    }
    // The derived askContext MUST be part of this write: `set()` replaces the
    // document, so omitting it would wipe the projection on every context edit.
    const askContext = buildAskContext(id, data as object, (value) =>
      createHash("sha256").update(value).digest("hex"),
    )
    batch.set(col.doc(entry.id), {
      ...toIndexDoc(entry),
      askContext: { ...askContext, updatedAt: data.updatedAt ?? null },
      source: { collection: "contexts", id, updatedAt: data.updatedAt ?? null },
    })
    await batch.commit()
    await syncDirectorySearchCatalog(db, [entry], allIds.filter((candidate) => candidate !== entry.id))

    // Company created or renamed → re-relate people referencing it.
    if (entry.type === "company") {
      const isNew = !before
      if (isNew || renamed) {
        await reRelatePeopleForCompany(db, id, data, renamed ? previousName : null)
      }
    }

    await markDirectoryChanged(db)
    functionsV1.logger.info(`[directorySync] context ${id} → ${entry.id} (type=${entry.type})`)
  })

/** True when the raw context data classifies as a company (for alias handling). */
function entry_isCompany(data: Record<string, unknown>): boolean {
  return classifyContext({ id: "x", ...(data as object) } as CoreContext) === "company"
}
