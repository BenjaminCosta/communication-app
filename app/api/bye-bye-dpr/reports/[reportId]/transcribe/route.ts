import { BYE_BYE_DPR_AI_LIMITS } from "@/lib/ai/config-public"
import { AiError, isAiError } from "@/lib/ai/errors"
import {
  acquireByeByeDprAiRequest,
  completeByeByeDprAiRequest,
  failByeByeDprAiRequest,
  type AcquiredByeByeDprAiRequest,
} from "@/lib/ai/server/bye-bye-dpr-request-guard"
import { hashOutlookAiRequest, readOutlookAiIdempotencyKey } from "@/lib/ai/server/request-guard"
import { logByeByeDprAi, safeIdentifier } from "@/lib/ai/server/safe-log"
import { transcribeReportAudio, verifyByeByeDprUserRequest } from "@/lib/bye-bye-dpr-server"
import { toByeByeDprErrorResponse } from "@/lib/bye-bye-dpr-route-helpers"
import { validateOutlookAudio } from "@/features/outlooks/ai/server/audio-validation"

// firebase-admin + provider calls need the Node runtime, not Edge.
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteParams = { params: Promise<{ reportId: string }> }

/**
 * POST /api/bye-bye-dpr/reports/:reportId/transcribe
 * Auth: Bearer <report author Firebase ID token>
 * Body: multipart/form-data with an `audio` file (+ optional `language`).
 * Reuses the same rate-limit/idempotency lease machinery as the Outlook/
 * Directory AI flows (own budget/collection), and the same server-side
 * audio-duration validator (`validateOutlookAudio`, generic despite the
 * name — see features/outlooks/ai/server/audio-validation.ts).
 */
export async function POST(request: Request, { params }: RouteParams): Promise<Response> {
  const startedAt = Date.now()
  let uid: string | null = null
  let requestId = "unassigned"
  let acquired: AcquiredByeByeDprAiRequest | null = null
  let providerSucceeded = false
  try {
    const { reportId } = await params
    const principal = await verifyByeByeDprUserRequest(request)
    uid = principal.uid
    requestId = readOutlookAiIdempotencyKey(request)

    const contentType = request.headers.get("content-type") ?? ""
    if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
      throw new AiError("invalid-request", "Please send a voice recording.")
    }
    const contentLength = Number(request.headers.get("content-length"))
    if (Number.isFinite(contentLength) && contentLength > BYE_BYE_DPR_AI_LIMITS.maxAudioBytes + 256 * 1024) {
      throw new AiError("payload-too-large", "The recording file is too large.")
    }

    let form: FormData
    try {
      form = await request.formData()
    } catch {
      throw new AiError("invalid-request", "The voice recording could not be read.")
    }

    const audio = form.get("audio")
    if (!(audio instanceof File)) throw new AiError("invalid-request", "A voice recording is required.")
    if (audio.size === 0) throw new AiError("invalid-request", "The recording was empty.")
    if (audio.size > BYE_BYE_DPR_AI_LIMITS.maxAudioBytes) throw new AiError("payload-too-large", "The recording file is too large.")

    const rawLanguage = form.get("language")
    const language = typeof rawLanguage === "string" && rawLanguage ? rawLanguage.trim() : undefined
    if (language && !/^[A-Za-z]{2,3}(?:-[A-Za-z]{2,4})?$/.test(language)) {
      throw new AiError("invalid-request", "The recording language is not valid.")
    }

    const validatedAudio = await validateOutlookAudio(audio, undefined, BYE_BYE_DPR_AI_LIMITS.maxAudioSeconds)
    const bytes = new Uint8Array(await audio.arrayBuffer())
    const requestHash = hashOutlookAiRequest(`${hashOutlookAiRequest(bytes)}:${validatedAudio.mediaType}:${language ?? "auto"}`)
    acquired = await acquireByeByeDprAiRequest({
      uid: principal.uid,
      operation: "transcription",
      requestHash,
      idempotencyKey: requestId,
    })
    logByeByeDprAi({
      event: "accepted",
      operation: "transcription",
      requestId,
      userHash: acquired.userHash,
      audioBytes: audio.size,
      audioDurationMs: validatedAudio.durationMs,
      audioDurationSource: validatedAudio.durationSource,
    })

    const result = await transcribeReportAudio(principal, reportId, {
      bytes,
      contentType: validatedAudio.mediaType,
      fileName: audio.name || "report-audio",
      language,
    })
    providerSucceeded = true
    await completeByeByeDprAiRequest(principal.uid, acquired)
    logByeByeDprAi({
      event: "succeeded",
      operation: "transcription",
      requestId,
      userHash: safeIdentifier(principal.uid),
      latencyMs: Date.now() - startedAt,
    })
    return Response.json(result, { headers: responseHeaders(requestId, acquired.lease.remaining) })
  } catch (error) {
    if (uid && acquired && !providerSucceeded) {
      try {
        await failByeByeDprAiRequest(uid, acquired)
      } catch {
        // Keep the short lease until expiry if Firestore cannot release it.
      }
    }
    logByeByeDprAi({
      event: acquired ? "failed" : "rejected",
      operation: "transcription",
      requestId,
      ...(uid ? { userHash: safeIdentifier(uid) } : {}),
      errorCode: isAiError(error) ? error.code : "unexpected",
      latencyMs: Date.now() - startedAt,
    })
    return toByeByeDprErrorResponse(error)
  }
}

function responseHeaders(requestId: string, remaining?: number): Headers {
  const headers = new Headers({ "Cache-Control": "no-store", "X-Request-Id": requestId })
  if (remaining != null) headers.set("X-RateLimit-Remaining", String(remaining))
  return headers
}
