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
exports.onMessageUpdated = exports.onMessageCreated = exports.autoLinkOnRegister = void 0;
const app_1 = require("firebase-admin/app");
const firestore_1 = require("firebase-admin/firestore");
const messaging_1 = require("firebase-admin/messaging");
const functionsV1 = __importStar(require("firebase-functions/v1"));
(0, app_1.initializeApp)();
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
 *   - email matches the new user's email
 *   - status === "not_registered"
 * and updates them to:
 *   - linkedUserId: uid
 *   - status: "registered"
 *   - updatedAt: server timestamp
 *
 * Uses 1st-gen API to avoid Eventarc / Cloud Run IAM complexity.
 */
exports.autoLinkOnRegister = functionsV1.firestore
    .document("users/{uid}")
    .onCreate(async (snap, context) => {
    const uid = context.params.uid;
    const newUser = snap.data();
    if (!newUser?.email) {
        functionsV1.logger.info(`autoLinkOnRegister: uid ${uid} has no email, skipping.`);
        return;
    }
    const email = newUser.email.toLowerCase().trim();
    const db = (0, firestore_1.getFirestore)();
    const querySnap = await db
        .collectionGroup("contacts")
        .where("email", "==", email)
        .where("status", "==", "not_registered")
        .get();
    if (querySnap.empty) {
        functionsV1.logger.info(`autoLinkOnRegister: no unlinked contacts for ${email}`);
        return;
    }
    const batch = db.batch();
    querySnap.docs.forEach((doc) => {
        batch.update(doc.ref, {
            linkedUserId: uid,
            status: "registered",
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        });
    });
    await batch.commit();
    functionsV1.logger.info(`autoLinkOnRegister: linked ${querySnap.size} contact(s) for ${email} → uid ${uid}`);
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
//# sourceMappingURL=index.js.map