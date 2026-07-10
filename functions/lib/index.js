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
exports.syncDirectoryOnContextWrite = exports.syncDirectoryOnContactWrite = exports.onDailyCalendarReminders = exports.onMessageUpdated = exports.onMessageCreated = exports.autoLinkOnUserEmailUpdate = exports.autoLinkOnRegister = void 0;
const app_1 = require("firebase-admin/app");
const firestore_1 = require("firebase-admin/firestore");
const messaging_1 = require("firebase-admin/messaging");
const functionsV1 = __importStar(require("firebase-functions/v1"));
const directory_core_1 = require("./directory-core");
// Today's date in YYYY-MM-DD (UTC)
function todayUTC() {
    return new Date().toISOString().slice(0, 10);
}
(0, app_1.initializeApp)();
function normalizeEmail(email) {
    return typeof email === "string" ? email.trim().toLowerCase() : "";
}
function uniqueStrings(values) {
    return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))];
}
async function commitBatches(db, updates) {
    for (let i = 0; i < updates.length; i += 450) {
        const batch = db.batch();
        updates.slice(i, i + 450).forEach((update) => update(batch));
        await batch.commit();
    }
}
async function findMatchingImportedContactRefs(db, emailNormalized) {
    const refs = new Map();
    const snapshots = await Promise.all([
        db.collection("contacts").where("emailNormalized", "==", emailNormalized).get(),
        db.collection("contacts").where("email", "==", emailNormalized).get(),
        db.collection("contacts").where("emailNormalizedCandidates", "array-contains", emailNormalized).get(),
    ]);
    snapshots.forEach((snap) => {
        snap.docs.forEach((doc) => refs.set(doc.ref.path, doc.ref));
    });
    return [...refs.values()];
}
async function linkImportedContactsForUser(uid, email, emailVerified) {
    const emailNormalized = normalizeEmail(email);
    if (!uid || !emailNormalized) {
        functionsV1.logger.info(`linkImportedContactsForUser: missing uid/email, skipping uid=${uid}`);
        return;
    }
    if (!emailVerified) {
        functionsV1.logger.info(`linkImportedContactsForUser: email not verified, skipping uid=${uid} email=${emailNormalized}`);
        return;
    }
    const db = (0, firestore_1.getFirestore)();
    const contactRefs = await findMatchingImportedContactRefs(db, emailNormalized);
    if (contactRefs.length === 0) {
        functionsV1.logger.info(`linkImportedContactsForUser: no imported contacts for ${emailNormalized}`);
        return;
    }
    const linkRunId = `${uid}-${Date.now()}`;
    const contactUpdates = [];
    const messageUpdates = [];
    let linkedContacts = 0;
    let skippedContacts = 0;
    let updatedMessages = 0;
    for (const contactRef of contactRefs) {
        const contactSnap = await contactRef.get();
        if (!contactSnap.exists)
            continue;
        const contact = contactSnap.data() ?? {};
        const linkedUserId = typeof contact.linkedUserId === "string" ? contact.linkedUserId : "";
        if (linkedUserId && linkedUserId !== uid) {
            skippedContacts++;
            continue;
        }
        contactUpdates.push((batch) => batch.update(contactRef, {
            email: emailNormalized,
            emailNormalized,
            linkedUserId: uid,
            linkedAt: firestore_1.FieldValue.serverTimestamp(),
            status: "registered",
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        }));
        linkedContacts++;
        const messagesSnap = await db
            .collection("messages")
            .where("contactIds", "array-contains", contactRef.id)
            .get();
        messagesSnap.docs.forEach((messageDoc) => {
            const message = messageDoc.data();
            const authorId = normalizeDocId(message.authorId) || normalizeDocId(message.senderId);
            const currentVisible = Array.isArray(message.visibleToUserIds) ? message.visibleToUserIds : [];
            const currentRecipients = Array.isArray(message.recipientIds) ? message.recipientIds : [];
            const currentPeople = Array.isArray(message.peopleIds) ? message.peopleIds : [];
            const currentParticipants = Array.isArray(message.participants) ? message.participants : [];
            const visibleToUserIds = uniqueStrings([
                ...currentVisible,
                authorId,
                ...currentRecipients,
                ...currentParticipants,
                uid,
            ]);
            const recipientIds = uniqueStrings([...currentRecipients, uid]);
            const peopleIds = uniqueStrings([...currentPeople, uid]);
            const participants = uniqueStrings([...currentParticipants, authorId, uid]);
            const visibleChanged = !sameStringSet(currentVisible, visibleToUserIds);
            const recipientsChanged = !sameStringSet(currentRecipients, recipientIds);
            const peopleChanged = !sameStringSet(currentPeople, peopleIds);
            const participantsChanged = !sameStringSet(currentParticipants, participants);
            if (!visibleChanged && !recipientsChanged && !peopleChanged && !participantsChanged)
                return;
            messageUpdates.push((batch) => batch.update(messageDoc.ref, {
                visibleToUserIds,
                recipientIds,
                peopleIds,
                participants,
                importedContactLinkRunId: linkRunId,
                updatedAt: firestore_1.FieldValue.serverTimestamp(),
            }));
            updatedMessages++;
        });
    }
    await commitBatches(db, contactUpdates);
    await commitBatches(db, messageUpdates);
    functionsV1.logger.info(`linkImportedContactsForUser: email=${emailNormalized} uid=${uid} linkedContacts=${linkedContacts} skippedContacts=${skippedContacts} updatedMessages=${updatedMessages}`);
}
function normalizeDocId(value) {
    return typeof value === "string" ? value.trim() : "";
}
function sameStringSet(a, b) {
    const left = uniqueStrings(a);
    const right = uniqueStrings(b);
    if (left.length !== right.length)
        return false;
    const rightSet = new Set(right);
    return left.every((value) => rightSet.has(value));
}
/**
 * Shared helper: sends FCM push notifications to `recipientIds` (excluding `senderId`).
 * Respects notificationPreference; cleans up stale tokens automatically.
 */
async function sendNotificationsToUsers(db, recipientIds, senderId, messageId, body) {
    const toNotify = recipientIds.filter((uid) => uid !== senderId);
    if (toNotify.length === 0)
        return;
    // Fetch sender name + all recipient docs in parallel
    const [senderSnap, ...userSnaps] = await Promise.all([
        db.collection("users").doc(senderId).get(),
        ...toNotify.map((uid) => db.collection("users").doc(uid).get()),
    ]);
    const senderName = senderSnap.data()?.name ?? "Someone";
    const tokens = [];
    const tokenToUid = new Map();
    userSnaps.forEach((snap, i) => {
        const userData = snap.data();
        if (!userData)
            return;
        const pref = userData.notificationPreference ?? "instant";
        if (pref === "muted")
            return;
        const fcmTokens = Array.isArray(userData.fcmTokens) ? userData.fcmTokens : [];
        for (const token of fcmTokens) {
            tokens.push(token);
            tokenToUid.set(token, toNotify[i]);
        }
    });
    if (tokens.length === 0)
        return;
    const result = await (0, messaging_1.getMessaging)().sendEachForMulticast({
        tokens,
        notification: {
            title: senderName,
            body,
        },
        webpush: {
            notification: {
                icon: "https://svc-comms.web.app/icon-192x192.png",
                badge: "https://svc-comms.web.app/icon-192x192.png",
            },
            fcmOptions: { link: "/" },
        },
        data: { messageId },
    });
    functionsV1.logger.info(`[FCM] msg=${messageId} sent=${result.successCount} failed=${result.failureCount}`);
    // Clean up stale / expired tokens
    const staleTokens = result.responses
        .map((r, i) => ({ r, token: tokens[i] }))
        .filter(({ r }) => !r.success &&
        (r.error?.code === "messaging/invalid-registration-token" ||
            r.error?.code === "messaging/registration-token-not-registered"))
        .map(({ token }) => token);
    if (staleTokens.length > 0) {
        const batch = db.batch();
        for (const token of staleTokens) {
            const uid = tokenToUid.get(token);
            if (uid) {
                batch.update(db.collection("users").doc(uid), {
                    fcmTokens: firestore_1.FieldValue.arrayRemove(token),
                });
            }
        }
        await batch.commit();
        functionsV1.logger.info(`[FCM] Removed ${staleTokens.length} stale token(s)`);
    }
}
/**
 * Triggered whenever a new user document is created in /users/{uid}.
 * Finds all imported contacts across all owners where:
 *   - normalized email matches the new user's email
 *   - the Firebase Auth email is verified
 *   - linkedUserId is empty or already points at this uid
 * and updates them to:
 *   - linkedUserId: uid
 *   - status: "registered"
 *   - linkedAt: server timestamp
 *   - updatedAt: server timestamp
 *
 * Uses 1st-gen API to avoid Eventarc / Cloud Run IAM complexity.
 */
exports.autoLinkOnRegister = functionsV1.firestore
    .document("users/{uid}")
    .onCreate(async (snap, context) => {
    const uid = context.params.uid;
    const newUser = snap.data();
    const email = normalizeEmail(newUser?.emailNormalized) || normalizeEmail(newUser?.email);
    if (!email) {
        functionsV1.logger.info(`autoLinkOnRegister: uid ${uid} has no email, skipping.`);
        return;
    }
    await linkImportedContactsForUser(uid, email, newUser?.emailVerified === true);
});
exports.autoLinkOnUserEmailUpdate = functionsV1.firestore
    .document("users/{uid}")
    .onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();
    const beforeEmail = normalizeEmail(before.emailNormalized) || normalizeEmail(before.email);
    const afterEmail = normalizeEmail(after.emailNormalized) || normalizeEmail(after.email);
    const beforeVerified = before.emailVerified === true;
    const afterVerified = after.emailVerified === true;
    if (!afterEmail || !afterVerified)
        return;
    if (afterEmail === beforeEmail && beforeVerified === afterVerified)
        return;
    await linkImportedContactsForUser(context.params.uid, afterEmail, afterVerified);
});
/**
 * Triggered on new message creation.
 * Notifies all users in visibleToUserIds except the sender.
 */
exports.onMessageCreated = functionsV1.firestore
    .document("messages/{messageId}")
    .onCreate(async (snap, context) => {
    const data = snap.data();
    const senderId = data.senderId ?? data.authorId ?? "";
    const visibleToUserIds = Array.isArray(data.visibleToUserIds)
        ? data.visibleToUserIds
        : [];
    if (!senderId || visibleToUserIds.length === 0)
        return;
    await sendNotificationsToUsers((0, firestore_1.getFirestore)(), visibleToUserIds, senderId, context.params.messageId, "New message");
});
/**
 * Triggered on message update.
 * Detects UIDs newly added to visibleToUserIds (e.g. via tag or direct recipient)
 * and sends them a notification. Only fires when visibleToUserIds actually changes.
 */
exports.onMessageUpdated = functionsV1.firestore
    .document("messages/{messageId}")
    .onUpdate(async (change, context) => {
    const before = Array.isArray(change.before.data().visibleToUserIds)
        ? change.before.data().visibleToUserIds
        : [];
    const after = Array.isArray(change.after.data().visibleToUserIds)
        ? change.after.data().visibleToUserIds
        : [];
    const beforeImportedContactLinkRunId = change.before.data().importedContactLinkRunId;
    const afterImportedContactLinkRunId = change.after.data().importedContactLinkRunId;
    if (typeof afterImportedContactLinkRunId === "string" &&
        afterImportedContactLinkRunId &&
        afterImportedContactLinkRunId !== beforeImportedContactLinkRunId) {
        functionsV1.logger.info(`[onMessageUpdated] msg=${context.params.messageId} skipped imported-contact-link notification`);
        return;
    }
    // Only proceed if visibleToUserIds actually grew
    const beforeSet = new Set(before);
    const newlyAdded = after.filter((uid) => !beforeSet.has(uid));
    if (newlyAdded.length === 0)
        return;
    const senderId = change.after.data().senderId ?? change.after.data().authorId ?? "";
    if (!senderId)
        return;
    functionsV1.logger.info(`[onMessageUpdated] msg=${context.params.messageId} newlyAdded=${newlyAdded.join(",")}`);
    await sendNotificationsToUsers((0, firestore_1.getFirestore)(), newlyAdded, senderId, context.params.messageId, "New message");
});
/**
 * Runs every day at 08:00 UTC.
 * Finds messages that have a calendarDate matching today and sends reminders
 * to all users in visibleToUserIds except the author.
 *
 * Uses calendarDateStrings (flat string[]) for the Firestore array-contains query.
 * Writes reminderSentDates: arrayUnion(today) to avoid sending the same reminder twice.
 */
exports.onDailyCalendarReminders = functionsV1.pubsub
    .schedule("0 8 * * *") // 08:00 UTC every day
    .timeZone("UTC")
    .onRun(async () => {
    const today = todayUTC();
    const db = (0, firestore_1.getFirestore)();
    const snap = await db
        .collection("messages")
        .where("calendarDateStrings", "array-contains", today)
        .get();
    if (snap.empty) {
        functionsV1.logger.info(`[calendarReminders] ${today}: no messages`);
        return;
    }
    let notified = 0;
    let skipped = 0;
    await Promise.all(snap.docs.map(async (msgDoc) => {
        const data = msgDoc.data();
        // Dedup: skip if we already sent a reminder for today on this message
        const alreadySent = Array.isArray(data.reminderSentDates)
            ? data.reminderSentDates
            : [];
        if (alreadySent.includes(today)) {
            skipped++;
            return;
        }
        const senderId = data.senderId ?? data.authorId ?? "";
        const visibleToUserIds = Array.isArray(data.visibleToUserIds)
            ? data.visibleToUserIds
            : [];
        if (!senderId || visibleToUserIds.length === 0)
            return;
        await sendNotificationsToUsers(db, visibleToUserIds, senderId, msgDoc.id, "You have a message scheduled for today");
        // Mark this date as notified so we never send it again for this message
        await msgDoc.ref.update({
            reminderSentDates: firestore_1.FieldValue.arrayUnion(today),
        });
        notified++;
    }));
    functionsV1.logger.info(`[calendarReminders] ${today}: notified=${notified} skipped=${skipped}`);
});
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
        await Promise.all(docs.slice(i, i + 50).map((d) => reindexContact(db, d.id, d.data())));
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
        await markDirectoryChanged(db);
        functionsV1.logger.info(`[directorySync] contact ${id} deleted → removed person__${id}`);
        return;
    }
    if (await isSyncSuppressed(db)) {
        functionsV1.logger.info(`[directorySync] contact ${id} skipped (import lock active)`);
        return;
    }
    const data = change.after.data() ?? {};
    await reindexContact(db, id, data);
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
//# sourceMappingURL=index.js.map