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
exports.onMessageUpdated = exports.onMessageCreated = void 0;
exports.sendNotificationsToUsers = sendNotificationsToUsers;
const firestore_1 = require("firebase-admin/firestore");
const messaging_1 = require("firebase-admin/messaging");
const functionsV1 = __importStar(require("firebase-functions/v1"));
const batches_1 = require("../shared/batches");
const USER_READ_CONCURRENCY = 50;
const FIRESTORE_BATCH_SIZE = 450;
/**
 * Sends push notifications to message recipients, respecting preferences and
 * removing invalid tokens. Multicast calls are capped at FCM's 500-token limit.
 */
async function sendNotificationsToUsers(db, recipientIds, senderId, messageId, body) {
    const toNotify = [...new Set(recipientIds.filter((uid) => uid && uid !== senderId))];
    if (toNotify.length === 0)
        return;
    const [senderSnap, userSnaps] = await Promise.all([
        db.collection("users").doc(senderId).get(),
        (0, batches_1.mapWithConcurrency)(toNotify, USER_READ_CONCURRENCY, (uid) => db.collection("users").doc(uid).get()),
    ]);
    const senderName = senderSnap.data()?.name ?? "Someone";
    const tokens = new Set();
    const tokenToUids = new Map();
    userSnaps.forEach((snapshot, index) => {
        const userData = snapshot.data();
        if (!userData || (userData.notificationPreference ?? "instant") === "muted")
            return;
        const userTokens = Array.isArray(userData.fcmTokens) ? userData.fcmTokens : [];
        for (const token of userTokens) {
            if (!token)
                continue;
            tokens.add(token);
            const tokenUids = tokenToUids.get(token) ?? new Set();
            tokenUids.add(toNotify[index]);
            tokenToUids.set(token, tokenUids);
        }
    });
    if (tokens.size === 0)
        return;
    let successCount = 0;
    let failureCount = 0;
    const staleTokens = [];
    for (const tokenBatch of (0, batches_1.chunkValues)([...tokens], 500)) {
        const result = await (0, messaging_1.getMessaging)().sendEachForMulticast({
            tokens: tokenBatch,
            notification: { title: senderName, body },
            webpush: {
                notification: {
                    icon: "https://svc-comms.web.app/icon-192x192.png",
                    badge: "https://svc-comms.web.app/icon-192x192.png",
                },
                fcmOptions: { link: "/" },
            },
            data: { messageId },
        });
        successCount += result.successCount;
        failureCount += result.failureCount;
        result.responses.forEach((response, index) => {
            if (!response.success &&
                (response.error?.code === "messaging/invalid-registration-token" ||
                    response.error?.code === "messaging/registration-token-not-registered")) {
                staleTokens.push(tokenBatch[index]);
            }
        });
    }
    functionsV1.logger.info(`[FCM] msg=${messageId} sent=${successCount} failed=${failureCount}`);
    if (staleTokens.length > 0) {
        const staleTokensByUid = new Map();
        for (const token of staleTokens) {
            for (const uid of tokenToUids.get(token) ?? []) {
                const userTokens = staleTokensByUid.get(uid) ?? new Set();
                userTokens.add(token);
                staleTokensByUid.set(uid, userTokens);
            }
        }
        for (const userBatch of (0, batches_1.chunkValues)([...staleTokensByUid.entries()], FIRESTORE_BATCH_SIZE)) {
            const batch = db.batch();
            for (const [uid, userTokens] of userBatch) {
                batch.update(db.collection("users").doc(uid), {
                    fcmTokens: firestore_1.FieldValue.arrayRemove(...userTokens),
                });
            }
            await batch.commit();
        }
        functionsV1.logger.info(`[FCM] Removed ${staleTokens.length} stale token(s)`);
    }
}
exports.onMessageCreated = functionsV1.firestore
    .document("messages/{messageId}")
    .onCreate(async (snapshot, context) => {
    const data = snapshot.data();
    const senderId = data.senderId ?? data.authorId ?? "";
    const visibleToUserIds = Array.isArray(data.visibleToUserIds) ? data.visibleToUserIds : [];
    if (!senderId || visibleToUserIds.length === 0)
        return;
    await sendNotificationsToUsers((0, firestore_1.getFirestore)(), visibleToUserIds, senderId, context.params.messageId, "New message");
});
exports.onMessageUpdated = functionsV1.firestore
    .document("messages/{messageId}")
    .onUpdate(async (change, context) => {
    const before = Array.isArray(change.before.data().visibleToUserIds)
        ? change.before.data().visibleToUserIds
        : [];
    const after = Array.isArray(change.after.data().visibleToUserIds)
        ? change.after.data().visibleToUserIds
        : [];
    const beforeLinkRunId = change.before.data().importedContactLinkRunId;
    const afterLinkRunId = change.after.data().importedContactLinkRunId;
    if (typeof afterLinkRunId === "string" && afterLinkRunId && afterLinkRunId !== beforeLinkRunId) {
        functionsV1.logger.info(`[onMessageUpdated] msg=${context.params.messageId} skipped imported-contact-link notification`);
        return;
    }
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
//# sourceMappingURL=notifications.js.map