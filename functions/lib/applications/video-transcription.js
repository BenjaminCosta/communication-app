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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.transcribeApplicationVideoOnWrite = void 0;
const firestore_1 = require("firebase-admin/firestore");
const storage_1 = require("firebase-admin/storage");
const functionsV1 = __importStar(require("firebase-functions/v1"));
const node_crypto_1 = require("node:crypto");
const node_child_process_1 = require("node:child_process");
const node_fs_1 = require("node:fs");
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const node_util_1 = require("node:util");
const ffmpeg_1 = __importDefault(require("@ffmpeg-installer/ffmpeg"));
const applications_core_1 = require("../applications-core");
// ══════════════════════════════════════════════════════════════════════════
// SVC Applications — intro video transcription.
//
// /applications/{applicationId} onWrite → whenever a candidate's upload sets
// `video.transcriptionStatus` to "pending", transcribe it (gpt-4o-mini-transcribe)
// and extract a structured, reviewer-only summary (gpt-5-mini). Never blocks
// the candidate: the write that triggers this happens after they've already
// moved on.
//
// Mirrors functions/src/directory/embeddings.ts: a Firestore-triggered
// background job, OPENAI_API_KEY from Secret Manager, fails soft. The
// candidate flow never talks to OpenAI directly — this is the one place the
// key is used, and it never leaves this process.
//
// Idempotency: a Firestore transaction claims the job (pending → processing)
// before any network call, so at most one invocation ever processes a given
// upload. `video.storagePath` doubles as the "version" — the claim also
// checks it still matches what's on the document, and every write records
// `processedStoragePath` so a later re-upload is unambiguously a new job.
// ══════════════════════════════════════════════════════════════════════════
const STORAGE_BUCKET = "svc-comms.firebasestorage.app";
const DEFAULT_TRANSCRIBE_MODEL = "gpt-4o-mini-transcribe";
const DEFAULT_SUMMARY_MODEL = "gpt-5-mini";
/** OpenAI's /audio/transcriptions accepts these containers directly — anything else (or too large) gets its audio extracted first. */
const OPENAI_ACCEPTED_TYPES = {
    "audio/mpeg": ".mp3",
    "audio/mp3": ".mp3",
    "audio/mp4": ".mp4",
    "video/mp4": ".mp4",
    "audio/mpga": ".mpga",
    "audio/m4a": ".m4a",
    "audio/x-m4a": ".m4a",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/webm": ".webm",
    "video/webm": ".webm",
};
const MAX_INLINE_BYTES = 25 * 1024 * 1024;
const TRANSCRIPTION_CONTEXT_PROMPT = "This is a short introduction video from an SVC construction candidate. The candidate is expected to state their name, town, and years of construction experience. Preserve names, locations and numbers accurately. Do not invent missing information.";
const SUMMARY_SYSTEM_PROMPT = [
    "You extract structured facts from a short self-introduction transcript recorded by a construction job candidate.",
    "The candidate is only expected to say their name, their town, and their years of construction experience.",
    "Rules:",
    "- Never infer or guess information that was not explicitly said. If a field wasn't stated, its value is null and its key belongs in missingFields.",
    "- yearsOfExperience is a plain number of years. If a range was given, use the lower, clearly-stated bound. Never estimate.",
    "- summary is exactly one short, factual sentence describing what the candidate said — nothing more.",
    "- Never evaluate the candidate. Never score or comment on personality, accent, appearance, or fit for the job.",
    "- needsReview is true whenever missingFields is non-empty, or the transcript is ambiguous about any of the three fields.",
    "- This is an internal reviewer tool only. It never changes the candidate's application data.",
].join("\n");
const VIDEO_SUMMARY_JSON_SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: ["name", "town", "yearsOfExperience", "summary", "missingFields", "needsReview"],
    properties: {
        name: { type: ["string", "null"] },
        town: { type: ["string", "null"] },
        yearsOfExperience: { type: ["number", "null"] },
        summary: { type: "string" },
        missingFields: {
            type: "array",
            items: { type: "string", enum: [...applications_core_1.INTRO_VIDEO_MISSING_FIELDS] },
        },
        needsReview: { type: "boolean" },
    },
};
const execFileAsync = (0, node_util_1.promisify)(node_child_process_1.execFile);
function hashId(value) {
    return (0, node_crypto_1.createHash)("sha256").update(value).digest("base64url").slice(0, 16);
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/** Metadata-only logging — never the transcript, summary text, or candidate PII. */
function log(event, applicationId, extra = {}) {
    functionsV1.logger.info(`[applications-video] ${event}`, { applicationId: hashId(applicationId), ...extra });
}
/** Retries 429s and 5xxs with exponential backoff + jitter; gives up on other failures immediately. */
async function openAiFetchWithRetry(apiKey, baseUrl, path_, init, maxRetries = 3) {
    for (let attempt = 0;; attempt += 1) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 90_000);
        try {
            const response = await fetch(`${baseUrl}${path_}`, {
                ...init,
                signal: controller.signal,
                headers: { Authorization: `Bearer ${apiKey}`, ...(init.headers ?? {}) },
            });
            clearTimeout(timeout);
            if (response.ok)
                return response;
            const transient = response.status === 429 || response.status >= 500;
            if (!transient || attempt >= maxRetries)
                return response;
            const delayMs = Math.min(8_000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250);
            functionsV1.logger.warn("[applications-video] provider retry", { path: path_, status: response.status, attempt: attempt + 1 });
            await sleep(delayMs);
        }
        catch (error) {
            clearTimeout(timeout);
            if (attempt >= maxRetries)
                throw error;
            await sleep(Math.min(8_000, 500 * 2 ** attempt));
        }
    }
}
async function transcribeAudioFile(input) {
    const buffer = await node_fs_1.promises.readFile(input.filePath);
    const form = new FormData();
    form.append("model", input.model);
    form.append("file", new Blob([buffer], { type: input.mimeType }), input.fileName);
    form.append("response_format", "json");
    form.append("prompt", TRANSCRIPTION_CONTEXT_PROMPT);
    const response = await openAiFetchWithRetry(input.apiKey, input.baseUrl, "/audio/transcriptions", {
        method: "POST",
        body: form,
    });
    if (!response.ok)
        throw new Error(`transcription-failed-${response.status}`);
    const data = (await response.json());
    if (typeof data.text !== "string")
        throw new Error("transcription-invalid-output");
    return data.text;
}
function validateVideoSummary(value) {
    if (!value || typeof value !== "object")
        throw new Error("summary-invalid-shape");
    const record = value;
    if (typeof record.summary !== "string")
        throw new Error("summary-invalid-shape");
    const missingFields = Array.isArray(record.missingFields)
        ? record.missingFields.filter((entry) => applications_core_1.INTRO_VIDEO_MISSING_FIELDS.includes(entry))
        : [];
    return {
        name: typeof record.name === "string" ? record.name : null,
        town: typeof record.town === "string" ? record.town : null,
        yearsOfExperience: typeof record.yearsOfExperience === "number" ? record.yearsOfExperience : null,
        summary: record.summary,
        missingFields,
        needsReview: record.needsReview === true,
    };
}
async function summarizeTranscript(input) {
    const response = await openAiFetchWithRetry(input.apiKey, input.baseUrl, "/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            model: input.model,
            messages: [
                { role: "system", content: SUMMARY_SYSTEM_PROMPT },
                { role: "user", content: `Transcript:\n${input.transcript}` },
            ],
            response_format: {
                type: "json_schema",
                json_schema: { name: "intro_video_summary", schema: VIDEO_SUMMARY_JSON_SCHEMA, strict: true },
            },
            reasoning_effort: "minimal",
            verbosity: "low",
            max_completion_tokens: 500,
        }),
    });
    if (!response.ok)
        throw new Error(`summary-failed-${response.status}`);
    const data = (await response.json());
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim())
        throw new Error("summary-empty");
    return validateVideoSummary(JSON.parse(content));
}
/** Drops the video track and downsamples to a small mono speech-quality mp3 — plenty for transcription, tiny compared to the source. */
async function extractCompressedAudio(inputPath, outputPath) {
    await execFileAsync(ffmpeg_1.default.path, ["-y", "-i", inputPath, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "64k", "-f", "mp3", outputPath], { maxBuffer: 1024 * 1024 * 20 });
}
exports.transcribeApplicationVideoOnWrite = functionsV1
    // OPENAI_API_KEY comes from Secret Manager — never from a committed .env.
    .runWith({ secrets: ["OPENAI_API_KEY"], timeoutSeconds: 300, memory: "1GB" })
    .firestore.document("applications/{applicationId}")
    .onWrite(async (change, context) => {
    if (!change.after.exists)
        return;
    const applicationId = context.params.applicationId;
    const video = (change.after.data() ?? {}).video;
    if (!video || video.transcriptionStatus !== "pending")
        return;
    const storagePath = typeof video.storagePath === "string" ? video.storagePath : "";
    const mimeType = typeof video.mimeType === "string" ? video.mimeType : "";
    if (!storagePath)
        return;
    const db = (0, firestore_1.getFirestore)();
    const ref = change.after.ref;
    // One active job per video: only the transaction that observes
    // transcriptionStatus still "pending" for THIS exact storagePath may flip
    // it to "processing" — a concurrent or redelivered trigger invocation
    // will read the post-claim state and back off. Also clears any transcript
    // left over from a superseded upload so nothing stale is shown mid-run.
    const claimed = await db.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref);
        const current = (snapshot.data()?.video ?? {});
        if (current.transcriptionStatus !== "pending" || current.storagePath !== storagePath)
            return false;
        tx.set(ref, { video: { transcriptionStatus: "processing", transcript: null, summary: null, processingError: null } }, { merge: true });
        return true;
    });
    if (!claimed)
        return;
    log("claimed", applicationId);
    const apiKey = (process.env.OPENAI_API_KEY ?? "").trim();
    if (!apiKey) {
        functionsV1.logger.warn("[applications-video] no API key configured");
        await ref
            .set({
            video: {
                transcriptionStatus: "failed",
                processingError: "AI is not configured.",
                processedStoragePath: storagePath,
            },
        }, { merge: true })
            .catch(() => { });
        return;
    }
    const baseUrl = (process.env.OPENAI_BASE_URL ?? "").trim() || "https://api.openai.com/v1";
    const transcribeModel = (process.env.APPLICATIONS_AI_TRANSCRIBE_MODEL ?? "").trim() || DEFAULT_TRANSCRIBE_MODEL;
    const summaryModel = (process.env.APPLICATIONS_AI_SUMMARY_MODEL ?? "").trim() || DEFAULT_SUMMARY_MODEL;
    const workDir = await node_fs_1.promises.mkdtemp(path.join(os.tmpdir(), "intro-video-"));
    const downloadedPath = path.join(workDir, "source");
    const audioPath = path.join(workDir, "audio.mp3");
    try {
        await (0, storage_1.getStorage)().bucket(STORAGE_BUCKET).file(storagePath).download({ destination: downloadedPath });
        const { size: sizeBytes } = await node_fs_1.promises.stat(downloadedPath);
        const acceptedExtension = OPENAI_ACCEPTED_TYPES[mimeType];
        const needsConversion = sizeBytes > MAX_INLINE_BYTES || !acceptedExtension;
        let audioFilePath = downloadedPath;
        let audioFileName = `intro-video${acceptedExtension ?? ".bin"}`;
        let audioMimeType = mimeType || "application/octet-stream";
        if (needsConversion) {
            log("converting", applicationId, { sizeBytes, mimeType });
            await extractCompressedAudio(downloadedPath, audioPath);
            audioFilePath = audioPath;
            audioFileName = "intro-audio.mp3";
            audioMimeType = "audio/mpeg";
        }
        const transcript = await transcribeAudioFile({
            apiKey,
            baseUrl,
            model: transcribeModel,
            filePath: audioFilePath,
            fileName: audioFileName,
            mimeType: audioMimeType,
        });
        const summary = await summarizeTranscript({ apiKey, baseUrl, model: summaryModel, transcript });
        await ref.set({
            video: {
                transcriptionStatus: "completed",
                transcript,
                summary,
                transcriptionModel: transcribeModel,
                summaryModel,
                processedAt: firestore_1.FieldValue.serverTimestamp(),
                processingError: null,
                processedStoragePath: storagePath,
            },
        }, { merge: true });
        log("completed", applicationId, { transcriptChars: transcript.length, needsReview: summary.needsReview });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "unknown-error";
        functionsV1.logger.error("[applications-video] failed", { applicationId: hashId(applicationId), error: message });
        await ref
            .set({
            video: {
                transcriptionStatus: "failed",
                processingError: "The video could not be transcribed. Please retry.",
                processedStoragePath: storagePath,
            },
        }, { merge: true })
            .catch(() => { });
    }
    finally {
        await node_fs_1.promises.rm(workDir, { recursive: true, force: true }).catch(() => { });
    }
});
//# sourceMappingURL=video-transcription.js.map