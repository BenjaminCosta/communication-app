import { OUTLOOK_AI_LIMITS } from "@/lib/ai/config"
import { AiError } from "@/lib/ai/errors"
import { isAiError } from "@/lib/ai/errors"
import { authenticateOutlookRequest } from "@/lib/ai/server/auth-guard"
import { toOutlookAiErrorResponse } from "@/lib/ai/server/route-helpers"
import {
  acquireOutlookAiRequest,
  completeOutlookAiRequest,
  failOutlookAiRequest,
  hashOutlookAiRequest,
  readOutlookAiIdempotencyKey,
  type AcquiredOutlookAiRequest,
} from "@/lib/ai/server/request-guard"
import { logOutlookAi, safeIdentifier } from "@/lib/ai/server/safe-log"
import { validateOutlookAudio } from "@/features/outlooks/ai/server/audio-validation"
import { transcribeOutlookAudio } from "@/features/outlooks/ai/server/transcription-service"

// firebase-admin + provider calls need the Node runtime, not Edge.
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/outlooks/transcribe
 * Body: multipart/form-data with an `audio` file (+ optional `language`).
 * Returns editable transcript text only. Audio is never persisted.
 */
export async function POST(request: Request): Promise<Response> {
  const startedAt = Date.now()
  let uid: string | null = null
  let requestId = "unassigned"
  let acquired: AcquiredOutlookAiRequest | null = null
  let providerSucceeded = false
  let audioMetadata: { bytes: number; durationMs: number; durationSource: "metadata" | "recorder" } | null = null
  try {
    const user = await authenticateOutlookRequest(request)
    uid = user.uid
    requestId = readOutlookAiIdempotencyKey(request)

    const contentType = request.headers.get("content-type") ?? ""
    if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
      throw new AiError("invalid-request", "Please send a voice recording.")
    }
    const contentLength = Number(request.headers.get("content-length"))
    if (Number.isFinite(contentLength) && contentLength > OUTLOOK_AI_LIMITS.maxAudioBytes + 256 * 1024) {
      throw new AiError("payload-too-large", "The recording file is too large.")
    }

    let form: FormData
    try {
      form = await request.formData()
    } catch {
      throw new AiError("invalid-request", "The voice recording could not be read.")
    }

    const audio = form.get("audio")
    if (!(audio instanceof File)) {
      throw new AiError("invalid-request", "A voice recording is required.")
    }
    if (audio.size === 0) {
      throw new AiError("invalid-request", "The recording was empty.")
    }
    if (audio.size > OUTLOOK_AI_LIMITS.maxAudioBytes) {
      throw new AiError("payload-too-large", "The recording file is too large.")
    }

    const rawLanguage = form.get("language")
    const language = typeof rawLanguage === "string" && rawLanguage ? rawLanguage.trim() : undefined
    if (language && !/^[A-Za-z]{2,3}(?:-[A-Za-z]{2,4})?$/.test(language)) {
      throw new AiError("invalid-request", "The recording language is not valid.")
    }
    const rawDurationMs = form.get("durationMs")
    if (rawDurationMs != null && (typeof rawDurationMs !== "string" || !/^\d{1,9}$/.test(rawDurationMs))) {
      throw new AiError("invalid-request", "The recording duration was invalid. Please record it again.")
    }
    const reportedDurationMs = typeof rawDurationMs === "string" ? Number(rawDurationMs) : undefined
    const validatedAudio = await validateOutlookAudio(audio, reportedDurationMs)
    audioMetadata = {
      bytes: audio.size,
      durationMs: validatedAudio.durationMs,
      durationSource: validatedAudio.durationSource,
    }
    const bytes = new Uint8Array(await audio.arrayBuffer())
    const requestHash = hashOutlookAiRequest(
      `${hashOutlookAiRequest(bytes)}:${validatedAudio.mediaType}:${language ?? "auto"}`,
    )
    if (user.verified) {
      acquired = await acquireOutlookAiRequest({
        uid: user.uid,
        operation: "transcription",
        requestHash,
        idempotencyKey: requestId,
      })
      logOutlookAi({
        event: "accepted",
        operation: "transcription",
        requestId,
        userHash: acquired.userHash,
        audioBytes: audio.size,
        audioDurationMs: validatedAudio.durationMs,
        audioDurationSource: validatedAudio.durationSource,
      })
    }

    const result = await transcribeOutlookAudio({
      file: audio,
      fileName: audio.name || "outlook-note.webm",
      language,
    }, { operation: "transcription", requestId })
    providerSucceeded = true
    if (acquired) await completeOutlookAiRequest(user.uid, acquired)
    logOutlookAi({
      event: "succeeded",
      operation: "transcription",
      requestId,
      userHash: safeIdentifier(user.uid),
      latencyMs: Date.now() - startedAt,
      audioBytes: audio.size,
      audioDurationMs: validatedAudio.durationMs,
      audioDurationSource: validatedAudio.durationSource,
    })
    return Response.json(result, {
      headers: responseHeaders(requestId, acquired?.lease.remaining),
    })
  } catch (error) {
    if (uid && acquired && !providerSucceeded) {
      try {
        await failOutlookAiRequest(uid, acquired)
      } catch {
        // Keep the short lease until expiry if Firestore cannot release it.
      }
    }
    logOutlookAi({
      event: acquired ? "failed" : "rejected",
      operation: "transcription",
      requestId,
      ...(uid ? { userHash: safeIdentifier(uid) } : {}),
      errorCode: isAiError(error) ? error.code : "unexpected",
      latencyMs: Date.now() - startedAt,
      ...(audioMetadata
        ? {
            audioBytes: audioMetadata.bytes,
            audioDurationMs: audioMetadata.durationMs,
            audioDurationSource: audioMetadata.durationSource,
          }
        : {}),
    })
    return toOutlookAiErrorResponse(error)
  }
}

function responseHeaders(requestId: string, remaining?: number): Headers {
  const headers = new Headers({ "Cache-Control": "no-store", "X-Request-Id": requestId })
  if (remaining != null) headers.set("X-RateLimit-Remaining", String(remaining))
  return headers
}
