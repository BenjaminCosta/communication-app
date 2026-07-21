import { OUTLOOK_AI_LIMITS } from "@/lib/ai/config"
import { AiError } from "@/lib/ai/errors"

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

// Mobile MediaRecorder output is often streamed/fragmented, so WebM, OGG, and
// MP4 blobs may be valid for transcription without a container-level duration.
const RECORDER_DURATION_FALLBACK_TYPES = new Set([
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
])
const DURATION_TOLERANCE_MS = 1_000

export interface ValidatedOutlookAudio {
  durationMs: number
  mediaType: string
  durationSource: "metadata" | "recorder"
}

/** Validate declared type plus media duration server-side, with a Safari MP4 fallback. */
export async function validateOutlookAudio(
  file: File,
  reportedDurationMs?: number,
  maxSeconds: number = OUTLOOK_AI_LIMITS.maxAudioSeconds,
): Promise<ValidatedOutlookAudio> {
  const mediaType = file.type.split(";", 1)[0].trim().toLowerCase()
  if (!ACCEPTED_AUDIO_TYPES.has(mediaType)) {
    throw new AiError(
      "invalid-audio",
      "Use a WebM, MP4, OGG, MP3, M4A, or WAV voice recording.",
    )
  }

  const recorderDurationMs = validateReportedDuration(reportedDurationMs, maxSeconds)

  let duration: number | undefined
  let metadataReadable = true
  try {
    const { parseBlob } = await import("music-metadata")
    const metadata = await parseBlob(file, { duration: true, skipCovers: true })
    duration = metadata.format.duration
  } catch {
    metadataReadable = false
  }

  if (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0) {
    const hasRecorderSignature = RECORDER_DURATION_FALLBACK_TYPES.has(mediaType)
      ? await fileMatchesRecorderType(file, mediaType)
      : false
    if (hasRecorderSignature && recorderDurationMs != null) {
      return { durationMs: recorderDurationMs, mediaType, durationSource: "recorder" }
    }
    throw new AiError(
      "invalid-audio",
      metadataReadable
        ? "The recording duration could not be verified. Please record it again."
        : "That audio file could not be read. Please record it again.",
    )
  }
  if (duration > maxSeconds + 0.5) {
    throw new AiError("payload-too-large", tooLongMessage(maxSeconds))
  }

  return { durationMs: Math.round(duration * 1000), mediaType, durationSource: "metadata" }
}

function tooLongMessage(maxSeconds: number): string {
  return maxSeconds >= 120
    ? `Voice recordings must be ${Math.floor(maxSeconds / 60)} minutes or shorter.`
    : `Voice recordings must be ${maxSeconds} seconds or shorter.`
}

function validateReportedDuration(reportedDurationMs: number | undefined, maxSeconds: number): number | undefined {
  if (reportedDurationMs == null) return undefined
  if (!Number.isFinite(reportedDurationMs) || reportedDurationMs <= 0) {
    throw new AiError("invalid-request", "The recording duration was invalid. Please record it again.")
  }

  const roundedDurationMs = Math.round(reportedDurationMs)
  if (roundedDurationMs > maxSeconds * 1000 + DURATION_TOLERANCE_MS) {
    throw new AiError("payload-too-large", tooLongMessage(maxSeconds))
  }
  return roundedDurationMs
}

async function fileMatchesRecorderType(file: File, mediaType: string): Promise<boolean> {
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer())
  if (mediaType === "audio/webm") {
    return header.length >= 4 &&
      header[0] === 0x1a &&
      header[1] === 0x45 &&
      header[2] === 0xdf &&
      header[3] === 0xa3
  }
  if (mediaType === "audio/ogg") {
    return header.length >= 4 &&
      header[0] === 0x4f && // O
      header[1] === 0x67 && // g
      header[2] === 0x67 && // g
      header[3] === 0x53 // S
  }
  return header.length >= 12 &&
    header[4] === 0x66 && // f
    header[5] === 0x74 && // t
    header[6] === 0x79 && // y
    header[7] === 0x70 // p
}
