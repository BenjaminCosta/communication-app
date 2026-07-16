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
exports.autoLinkOnUserEmailUpdate = exports.autoLinkOnRegister = void 0;
const firestore_1 = require("firebase-admin/firestore");
const functionsV1 = __importStar(require("firebase-functions/v1"));
function normalizeEmail(email) {
    return typeof email === "string" ? email.trim().toLowerCase() : "";
}
function uniqueStrings(values) {
    return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))];
}
async function commitBatches(db, updates) {
    for (let index = 0; index < updates.length; index += 450) {
        const batch = db.batch();
        updates.slice(index, index + 450).forEach((update) => update(batch));
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
    snapshots.forEach((snapshot) => {
        snapshot.docs.forEach((document) => refs.set(document.ref.path, document.ref));
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
        const contactSnapshot = await contactRef.get();
        if (!contactSnapshot.exists)
            continue;
        const contact = contactSnapshot.data() ?? {};
        const linkedUserId = typeof contact.linkedUserId === "string" ? contact.linkedUserId : "";
        if (linkedUserId && linkedUserId !== uid) {
            skippedContacts += 1;
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
        linkedContacts += 1;
        const messagesSnapshot = await db
            .collection("messages")
            .where("contactIds", "array-contains", contactRef.id)
            .get();
        messagesSnapshot.docs.forEach((messageDocument) => {
            const message = messageDocument.data();
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
            if (sameStringSet(currentVisible, visibleToUserIds) &&
                sameStringSet(currentRecipients, recipientIds) &&
                sameStringSet(currentPeople, peopleIds) &&
                sameStringSet(currentParticipants, participants))
                return;
            messageUpdates.push((batch) => batch.update(messageDocument.ref, {
                visibleToUserIds,
                recipientIds,
                peopleIds,
                participants,
                importedContactLinkRunId: linkRunId,
                updatedAt: firestore_1.FieldValue.serverTimestamp(),
            }));
            updatedMessages += 1;
        });
    }
    await commitBatches(db, contactUpdates);
    await commitBatches(db, messageUpdates);
    functionsV1.logger.info(`linkImportedContactsForUser: email=${emailNormalized} uid=${uid} linkedContacts=${linkedContacts} skippedContacts=${skippedContacts} updatedMessages=${updatedMessages}`);
}
function normalizeDocId(value) {
    return typeof value === "string" ? value.trim() : "";
}
function sameStringSet(leftValues, rightValues) {
    const left = uniqueStrings(leftValues);
    const right = uniqueStrings(rightValues);
    if (left.length !== right.length)
        return false;
    const rightSet = new Set(right);
    return left.every((value) => rightSet.has(value));
}
exports.autoLinkOnRegister = functionsV1.firestore
    .document("users/{uid}")
    .onCreate(async (snapshot, context) => {
    const uid = context.params.uid;
    const newUser = snapshot.data();
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
//# sourceMappingURL=contact-linking.js.map