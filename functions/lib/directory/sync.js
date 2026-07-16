"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncDirectoryOnContextWrite = exports.syncDirectoryOnContactWrite = void 0;
const firestore_1 = require("firebase-admin/firestore");
const functionsV1 = __importStar(require("firebase-functions/v1"));
const directory_core_1 = require("../directory-core");
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
function sanitizeUndefined(value) {
    if (Array.isArray(value))
        return value.map(sanitizeUndefined).filter((v) => v !== undefined);
    if (value &&
        typeof value === "object" &&
        !(value instanceof Date) &&
        value.constructor === Object) {
        return Object.fromEntries(Object.entries(value)
            .map(([k, v]) => [k, sanitizeUndefined(v)])
            .filter(([, v]) => v !== undefined));
    }
    return value === undefined ? null : value;
}
/** Read a source doc's updatedAt (Timestamp → Date), if present. */
function sourceUpdatedAtOf(data) {
    const u = data.updatedAt;
    if (u && typeof u.toDate === "function")
        return u.toDate();
    return null;
}
/**
 * Stamp server indexedAt/updatedAt + schemaVersion and strip undefined before
 * writing an index doc. The built entry already carries sourceUpdatedAt.
 */
function toIndexDoc(entry) {
    return sanitizeUndefined({
        ...entry,
        indexedAt: firestore_1.FieldValue.serverTimestamp(),
        updatedAt: firestore_1.FieldValue.serverTimestamp(),
        schemaVersion: directory_core_1.DIRECTORY_SCHEMA_VERSION,
    });
}
/**
 * Import suppression: while /directoryControl/importLock is active, incremental
 * sync skips the expensive index writes so a bulk import doesn't trigger
 * thousands of per-doc syncs. After the import, a controlled rebuild reindexes
 * everything. One cheap read per invocation; contact/context writes are rare
 * outside imports.
 */
async function isSyncSuppressed(db) {
    try {
        const snap = await db.doc("directoryControl/importLock").get();
        if (!snap.exists)
            return false;
        const d = snap.data() ?? {};
        if (d.active !== true)
            return false;
        const until = d.until && typeof d.until.toDate === "function"
            ? d.until.toDate()
            : null;
        return !until || until.getTime() > Date.now();
    }
    catch {
        return false;
    }
}
/** Best-effort bump of the directoryMeta change marker (for client cache invalidation). */
async function markDirectoryChanged(db) {
    try {
        await db.doc("directoryMeta/status").set({
            schemaVersion: directory_core_1.DIRECTORY_SCHEMA_VERSION,
            lastChangeAt: firestore_1.FieldValue.serverTimestamp(),
        }, { merge: true });
    }
    catch { /* non-fatal */ }
}
/**
 * Incrementally maintains the compact catalog after the full shard backfill is
 * installed. The index remains authoritative if this best-effort projection
 * cannot be updated; clients then keep their previous revision or fall back.
 */
async function syncDirectorySearchCatalog(db, upserts, deletedIds) {
    const affectedIds = [...new Set([...upserts.map((entry) => entry.id), ...deletedIds])];
    if (affectedIds.length === 0)
        return;
    const shardIds = [...new Set(affectedIds.map((id) => (0, directory_core_1.directorySearchShardId)(id)))];
    const metaRef = db.doc("directoryMeta/status");
    const shardRefs = shardIds.map((id) => db.collection("directorySearchShards").doc(id));
    try {
        await db.runTransaction(async (transaction) => {
            const [metaSnap, ...shardSnaps] = await transaction.getAll(metaRef, ...shardRefs);
            const meta = metaSnap.data() ?? {};
            if (meta.searchShardCount !== directory_core_1.DIRECTORY_SEARCH_SHARD_COUNT || typeof meta.searchEntryCount !== "number")
                return;
            if (shardSnaps.some((snapshot) => !snapshot.exists)) {
                throw new Error("directory search shard set is incomplete");
            }
            const previousRevision = typeof meta.searchRevision === "number" ? meta.searchRevision : Date.now();
            const nextRevision = previousRevision + 1;
            let entryCountDelta = 0;
            for (let index = 0; index < shardRefs.length; index += 1) {
                const shardId = shardIds[index];
                const snapshot = shardSnaps[index];
                const existing = Array.isArray(snapshot.data()?.entries)
                    ? (snapshot.data()?.entries).filter((entry) => typeof entry?.id === "string")
                    : [];
                const removed = new Set(deletedIds.filter((id) => (0, directory_core_1.directorySearchShardId)(id) === shardId));
                const replacements = new Map(upserts
                    .filter((entry) => (0, directory_core_1.directorySearchShardId)(entry.id) === shardId)
                    .map((entry) => [entry.id, (0, directory_core_1.buildSearchDoc)(entry)]));
                const entries = existing
                    .filter((entry) => !removed.has(String(entry.id)) && !replacements.has(String(entry.id)))
                    .concat([...replacements.values()])
                    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
                if (Buffer.byteLength(JSON.stringify(entries), "utf8") > 800_000) {
                    throw new Error(`directory search shard ${shardId} exceeded the 800 KB safety ceiling`);
                }
                entryCountDelta += entries.length - existing.length;
                transaction.set(shardRefs[index], {
                    schemaVersion: directory_core_1.DIRECTORY_SCHEMA_VERSION,
                    shardId,
                    revision: nextRevision,
                    entryCount: entries.length,
                    entries,
                    updatedAt: firestore_1.FieldValue.serverTimestamp(),
                });
            }
            transaction.set(metaRef, {
                schemaVersion: directory_core_1.DIRECTORY_SCHEMA_VERSION,
                lastChangeAt: firestore_1.FieldValue.serverTimestamp(),
                searchRevision: nextRevision,
                searchSchemaVersion: directory_core_1.DIRECTORY_SCHEMA_VERSION,
                searchShardCount: directory_core_1.DIRECTORY_SEARCH_SHARD_COUNT,
                searchEntryCount: Math.max(0, Number(meta.searchEntryCount ?? 0) + entryCountDelta),
                searchBuiltAt: firestore_1.FieldValue.serverTimestamp(),
            }, { merge: true });
        });
    }
    catch (error) {
        functionsV1.logger.error("[directorySearch] incremental shard update failed", error);
        throw error;
    }
}
/**
 * Stable-id-aware person→company resolver for the incremental path.
 * Prefers sourceCompanyId (survives company renames), then exact company name.
 * Returns the composite company id, or null.
 */
async function resolveCompanyIdForContact(db, contact) {
    // 1. Stable link via sourceCompanyId → company context sharing that sourceRecordId.
    const sourceCompanyId = typeof contact.sourceCompanyId === "string" ? contact.sourceCompanyId.trim() : "";
    if (sourceCompanyId) {
        const snap = await db.collection("contexts").where("sourceRecordId", "==", sourceCompanyId).limit(5).get();
        for (const doc of snap.docs) {
            if ((0, directory_core_1.classifyContext)({ id: doc.id, ...doc.data() }) === "company") {
                return (0, directory_core_1.directoryId)("company", doc.id);
            }
        }
    }
    // 2. Exact company name match.
    const name = typeof contact.company === "string" ? contact.company.trim() : "";
    if (name) {
        const snap = await db.collection("contexts").where("name", "==", name).limit(5).get();
        for (const doc of snap.docs) {
            if ((0, directory_core_1.classifyContext)({ id: doc.id, ...doc.data() }) === "company") {
                return (0, directory_core_1.directoryId)("company", doc.id);
            }
        }
    }
    return null;
}
/** Rebuild+write a single person index entry from its current source data. */
async function reindexContact(db, id, data) {
    const contact = { id, ...data };
    const companyEntityId = await resolveCompanyIdForContact(db, contact);
    const entry = (0, directory_core_1.buildContactIndexEntry)(contact, {
        sourceUpdatedAt: sourceUpdatedAtOf(data),
        resolveCompanyIdForPerson: (_p) => companyEntityId,
    });
    await db.collection("directoryIndex").doc((0, directory_core_1.directoryId)("person", id)).set(toIndexDoc(entry));
    return entry;
}
/**
 * When a company context is created or renamed, re-relate people that reference
 * it — by sourceCompanyId (stable) or by company name (old and new). Re-indexes
 * each affected person so their companyEntityId resolves. Bounded to avoid
 * runaway fan-out on very large companies.
 */
async function reRelatePeopleForCompany(db, companyCtxId, companyData, previousName) {
    const refs = new Map();
    const add = (snap) => snap.docs.forEach((d) => refs.set(d.id, d));
    const sourceRecordId = typeof companyData.sourceRecordId === "string" ? companyData.sourceRecordId.trim() : "";
    const currentName = typeof companyData.name === "string" ? companyData.name.trim() : "";
    const names = [currentName, previousName].filter((n) => !!n && n.length > 0);
    const queries = [];
    if (sourceRecordId)
        queries.push(db.collection("contacts").where("sourceCompanyId", "==", sourceRecordId).limit(500).get());
    for (const n of [...new Set(names)]) {
        queries.push(db.collection("contacts").where("company", "==", n).limit(500).get());
    }
    ;
    (await Promise.all(queries)).forEach(add);
    if (refs.size === 0)
        return 0;
    let count = 0;
    // Reindex in bounded batches of parallel writes.
    const docs = [...refs.values()];
    for (let i = 0; i < docs.length; i += 50) {
        const entries = await Promise.all(docs.slice(i, i + 50).map((d) => reindexContact(db, d.id, d.data())));
        await syncDirectorySearchCatalog(db, entries, []);
        count += Math.min(50, docs.length - i);
    }
    functionsV1.logger.info(`[directorySync] company ${companyCtxId} re-related ${count} people (names=${names.join("|")})`);
    return count;
}
/**
 * /contacts → /directoryIndex (always type "person", stable composite id).
 * create/update → upsert person__{id}; delete → remove it. Idempotent.
 */
exports.syncDirectoryOnContactWrite = functionsV1.firestore
    .document("contacts/{contactId}")
    .onWrite(async (change, context) => {
    const id = context.params.contactId;
    const db = (0, firestore_1.getFirestore)();
    const ref = db.collection("directoryIndex").doc((0, directory_core_1.directoryId)("person", id));
    if (!change.after.exists) {
        await ref.delete();
        await syncDirectorySearchCatalog(db, [], [(0, directory_core_1.directoryId)("person", id)]);
        await markDirectoryChanged(db);
        functionsV1.logger.info(`[directorySync] contact ${id} deleted → removed person__${id}`);
        return;
    }
    if (await isSyncSuppressed(db)) {
        functionsV1.logger.info(`[directorySync] contact ${id} skipped (import lock active)`);
        return;
    }
    const data = change.after.data() ?? {};
    const entry = await reindexContact(db, id, data);
    await syncDirectorySearchCatalog(db, [entry], []);
    await markDirectoryChanged(db);
    functionsV1.logger.info(`[directorySync] contact ${id} → person__${id}`);
});
/**
 * /contexts → /directoryIndex (type company|job|other, chosen by classifyContext,
 * honoring an explicit directoryType field first).
 *
 * Keeps EXACTLY ONE entry per source id: deletes the two non-matching type
 * composite ids and upserts the matching one, so type changes self-heal without
 * needing the before-state. On delete, all three context composite ids are
 * removed. On company create/rename, re-relates affected people.
 */
exports.syncDirectoryOnContextWrite = functionsV1.firestore
    .document("contexts/{contextId}")
    .onWrite(async (change, context) => {
    const id = context.params.contextId;
    const db = (0, firestore_1.getFirestore)();
    const col = db.collection("directoryIndex");
    const allIds = (0, directory_core_1.contextCompositeIds)(id); // [company__id, job__id, other__id]
    if (!change.after.exists) {
        const batch = db.batch();
        for (const cid of allIds)
            batch.delete(col.doc(cid));
        await batch.commit();
        await syncDirectorySearchCatalog(db, [], allIds);
        await markDirectoryChanged(db);
        functionsV1.logger.info(`[directorySync] context ${id} deleted → removed ${allIds.join(", ")}`);
        return;
    }
    if (await isSyncSuppressed(db)) {
        functionsV1.logger.info(`[directorySync] context ${id} skipped (import lock active)`);
        return;
    }
    const data = change.after.data() ?? {};
    const before = change.before.exists ? (change.before.data() ?? {}) : null;
    // Accumulate the previous name as a searchable alias on rename.
    const currentName = typeof data.name === "string" ? data.name.trim() : "";
    const previousName = before && typeof before.name === "string" ? before.name.trim() : null;
    const renamed = !!previousName && (0, directory_core_1.normalizeName)(previousName) !== (0, directory_core_1.normalizeName)(currentName);
    // Preserve aliases already accumulated on the existing index entry.
    let extraAliases = [];
    const priorEntrySnap = await col.doc((0, directory_core_1.directoryId)("company", id)).get();
    if (priorEntrySnap.exists) {
        const prior = priorEntrySnap.data() ?? {};
        if (Array.isArray(prior.aliases))
            extraAliases = prior.aliases.filter((a) => typeof a === "string");
    }
    if (renamed && previousName)
        extraAliases = [...new Set([...extraAliases, previousName])];
    const entry = (0, directory_core_1.buildContextIndexEntry)({ id, ...data }, {
        sourceUpdatedAt: sourceUpdatedAtOf(data),
        extraAliases: entry_isCompany(data) ? extraAliases : undefined,
    });
    const batch = db.batch();
    for (const cid of allIds) {
        if (cid !== entry.id)
            batch.delete(col.doc(cid)); // clear stale/other-type entries
    }
    batch.set(col.doc(entry.id), toIndexDoc(entry));
    await batch.commit();
    await syncDirectorySearchCatalog(db, [entry], allIds.filter((candidate) => candidate !== entry.id));
    // Company created or renamed → re-relate people referencing it.
    if (entry.type === "company") {
        const isNew = !before;
        if (isNew || renamed) {
            await reRelatePeopleForCompany(db, id, data, renamed ? previousName : null);
        }
    }
    await markDirectoryChanged(db);
    functionsV1.logger.info(`[directorySync] context ${id} → ${entry.id} (type=${entry.type})`);
});
/** True when the raw context data classifies as a company (for alias handling). */
function entry_isCompany(data) {
    return (0, directory_core_1.classifyContext)({ id: "x", ...data }) === "company";
}
//# sourceMappingURL=sync.js.map