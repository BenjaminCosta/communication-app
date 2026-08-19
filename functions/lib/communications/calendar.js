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
exports.onDailyCalendarReminders = void 0;
const firestore_1 = require("firebase-admin/firestore");
const functionsV1 = __importStar(require("firebase-functions/v1"));
const batches_1 = require("../shared/batches");
const notifications_1 = require("./notifications");
const datetime_1 = require("../datetime");
exports.onDailyCalendarReminders = functionsV1.pubsub
    .schedule("0 8 * * *")
    .timeZone("America/New_York")
    .onRun(async () => {
    const today = (0, datetime_1.todayIsoInAppZone)();
    const db = (0, firestore_1.getFirestore)();
    const snapshot = await db
        .collection("messages")
        .where("calendarDateStrings", "array-contains", today)
        .get();
    if (snapshot.empty) {
        functionsV1.logger.info(`[calendarReminders] ${today}: no messages`);
        return;
    }
    let notified = 0;
    let skipped = 0;
    await (0, batches_1.mapWithConcurrency)(snapshot.docs, 20, async (messageDocument) => {
        const data = messageDocument.data();
        const alreadySent = Array.isArray(data.reminderSentDates) ? data.reminderSentDates : [];
        if (alreadySent.includes(today)) {
            skipped += 1;
            return;
        }
        const senderId = data.senderId ?? data.authorId ?? "";
        const visibleToUserIds = Array.isArray(data.visibleToUserIds) ? data.visibleToUserIds : [];
        if (!senderId || visibleToUserIds.length === 0)
            return;
        await (0, notifications_1.sendNotificationsToUsers)(db, visibleToUserIds, senderId, messageDocument.id, "You have a message scheduled for today");
        await messageDocument.ref.update({ reminderSentDates: firestore_1.FieldValue.arrayUnion(today) });
        notified += 1;
    });
    functionsV1.logger.info(`[calendarReminders] ${today}: notified=${notified} skipped=${skipped}`);
});
//# sourceMappingURL=calendar.js.map