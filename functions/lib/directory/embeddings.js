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
exports.embedDirectoryAskContextOnWrite = void 0;
exports.embedNoteText = embedNoteText;
const firestore_1 = require("firebase-admin/firestore");
const functionsV1 = __importStar(require("firebase-functions/v1"));
/**
 * Directory askContext embeddings.
 *
 * Ask SVC Directory uses semantic retrieval as a bounded reranker over the
 * derived `askContext.aiText` (the sanitized canonical description + operational
 * notes). Embeddings are computed HERE — when the projection changes — never at
 * question time, so answering stays cheap and fast. Only AI-eligible records
 * (≥80 chars of deduplicated useful text) are ever embedded.
 *
 * Safety properties:
 *  - content-hashed: re-saving a note with unchanged text does not re-embed
 *    (and therefore cannot loop, since the trigger's own write changes only
 *    embedding fields);
 *  - honors the existing /directoryControl/importLock so bulk imports don't
 *    fan out thousands of paid calls;
 *  - fails soft: a provider error leaves the note without an embedding, and the
 *    ask tool falls back to lexical search.
 */
const DEFAULT_EMBED_MODEL = "text-embedding-3-small";
const MAX_EMBED_CHARS = 2000;
const EMBED_TIMEOUT_MS = 15_000;
async function isSyncSuppressed(db) {
    try {
        const snap = await db.doc("directoryControl/importLock").get();
        if (!snap.exists)
            return false;
        const data = snap.data() ?? {};
        if (data.active !== true)
            return false;
        const until = data.until && typeof data.until.toDate === "function"
            ? data.until.toDate()
            : null;
        return !until || until.getTime() > Date.now();
    }
    catch {
        return false;
    }
}
/** Embed one string. Returns null on any failure so the caller degrades safely. */
async function embedNoteText(text) {
    const apiKey = (process.env.OPENAI_API_KEY ?? "").trim();
    if (!apiKey)
        return null;
    const model = (process.env.DIRECTORY_AI_EMBED_MODEL ?? "").trim() || DEFAULT_EMBED_MODEL;
    const baseUrl = (process.env.OPENAI_BASE_URL ?? "").trim() || "https://api.openai.com/v1";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), EMBED_TIMEOUT_MS);
    try {
        const response = await fetch(`${baseUrl}/embeddings`, {
            method: "POST",
            signal: controller.signal,
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({ model, input: text.slice(0, MAX_EMBED_CHARS) }),
        });
        if (!response.ok)
            return null;
        const data = (await response.json());
        const embedding = data.data?.[0]?.embedding;
        if (!Array.isArray(embedding) || embedding.some((value) => typeof value !== "number"))
            return null;
        return embedding;
    }
    catch {
        return null;
    }
    finally {
        clearTimeout(timeout);
    }
}
/**
 * /directoryIndex/{indexId} onWrite → keep the askContext embedding in sync.
 *
 * Loop-safe: this trigger writes ONLY embedding fields, which never change
 * `aiTextHash`, so the `embeddingHash === aiTextHash` guard short-circuits the
 * write it causes. Non-eligible documents exit before any network call, so the
 * vast majority of index writes cost one cheap comparison.
 */
exports.embedDirectoryAskContextOnWrite = functionsV1
    // OPENAI_API_KEY comes from Secret Manager — never from a committed .env.
    .runWith({ secrets: ["OPENAI_API_KEY"], timeoutSeconds: 60, memory: "256MB" })
    .firestore.document("directoryIndex/{indexId}")
    .onWrite(async (change, context) => {
    const indexId = context.params.indexId;
    if (!change.after.exists)
        return;
    const data = change.after.data() ?? {};
    const askContext = data.askContext;
    if (!askContext || askContext.aiEligible !== true)
        return;
    const aiText = typeof askContext.aiText === "string" ? askContext.aiText.trim() : "";
    const aiTextHash = typeof askContext.aiTextHash === "string" ? askContext.aiTextHash : "";
    if (!aiText || !aiTextHash)
        return;
    // Already embedded for this exact text → nothing to do (breaks the loop).
    if (askContext.embeddingHash === aiTextHash)
        return;
    const db = (0, firestore_1.getFirestore)();
    if (await isSyncSuppressed(db)) {
        functionsV1.logger.info(`[directoryEmbeddings] ${indexId} skipped (import lock active)`);
        return;
    }
    const embedding = await embedNoteText(aiText);
    if (!embedding) {
        functionsV1.logger.warn(`[directoryEmbeddings] ${indexId} not embedded (provider unavailable)`);
        return;
    }
    await change.after.ref.set({
        askContext: {
            embedding: firestore_1.FieldValue.vector(embedding),
            embeddingHash: aiTextHash,
            embeddingModel: (process.env.DIRECTORY_AI_EMBED_MODEL ?? "").trim() || DEFAULT_EMBED_MODEL,
            embeddedAt: firestore_1.FieldValue.serverTimestamp(),
        },
    }, { merge: true });
    functionsV1.logger.info(`[directoryEmbeddings] ${indexId} embedded (${embedding.length} dims)`);
});
//# sourceMappingURL=embeddings.js.map