import { BYE_BYE_DPR_AI_LIMITS } from "@/lib/ai/config-public"
import { ByeByeDprError, uploadReportAudio, verifyByeByeDprUserRequest } from "@/lib/bye-bye-dpr-server"
import { toByeByeDprErrorResponse } from "@/lib/bye-bye-dpr-route-helpers"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const ACCEPTED_AUDIO_TYPES = new Set([
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "audio/m4a",
  "audio/x-m4a",
])

type RouteParams = { params: Promise<{ reportId: string }> }

/**
 * POST /api/bye-bye-dpr/reports/:reportId/audio
 * Auth: Bearer <report author Firebase ID token>
 * Body: multipart/form-data with an `audio` file.
 * Uploads the raw recording to Storage — separate from transcription, which
 * is its own endpoint and its own AI budget.
 */
export async function POST(request: Request, { params }: RouteParams): Promise<Response> {
  try {
    const { reportId } = await params
    const principal = await verifyByeByeDprUserRequest(request)

    const contentType = request.headers.get("content-type") ?? ""
    if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
      throw new ByeByeDprError("invalid-request", "Please send an audio recording.", 400)
    }

    let form: FormData
    try {
      form = await request.formData()
    } catch {
      throw new ByeByeDprError("invalid-request", "The audio recording could not be read.", 400)
    }

    const audio = form.get("audio")
    if (!(audio instanceof File)) throw new ByeByeDprError("invalid-request", "An audio recording is required.", 400)
    if (audio.size === 0) throw new ByeByeDprError("invalid-request", "The recording was empty.", 400)
    if (audio.size > BYE_BYE_DPR_AI_LIMITS.maxAudioBytes) {
      throw new ByeByeDprError("payload-too-large", "The recording file is too large.", 413)
    }
    const mediaType = audio.type.split(";", 1)[0].trim().toLowerCase()
    if (!ACCEPTED_AUDIO_TYPES.has(mediaType)) {
      throw new ByeByeDprError("invalid-request", "Use a WebM, MP4, OGG, MP3, M4A, or WAV recording.", 400)
    }

    const bytes = new Uint8Array(await audio.arrayBuffer())
    const result = await uploadReportAudio(principal, reportId, {
      bytes,
      contentType: mediaType,
      fileName: audio.name || "report-audio",
    })
    return Response.json(result, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    return toByeByeDprErrorResponse(error)
  }
}
