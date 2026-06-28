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
exports.onDailyCalendarReminders = exports.onMessageUpdated = exports.onMessageCreated = exports.autoLinkOnUserEmailUpdate = exports.autoLinkOnRegister = void 0;
const app_1 = require("firebase-admin/app");
const firestore_1 = require("firebase-admin/firestore");
const messaging_1 = require("firebase-admin/messaging");
const functionsV1 = __importStar(require("firebase-functions/v1"));
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
//# sourceMappingURL=index.js.map