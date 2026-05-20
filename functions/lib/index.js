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
exports.autoLinkOnRegister = void 0;
const app_1 = require("firebase-admin/app");
const firestore_1 = require("firebase-admin/firestore");
const functionsV1 = __importStar(require("firebase-functions/v1"));
(0, app_1.initializeApp)();
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
//# sourceMappingURL=index.js.map