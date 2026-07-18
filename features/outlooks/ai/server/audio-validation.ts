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

export interface ValidatedOutlookAudio {
  durationMs: number
  mediaType: string
}

/** Validate declared type plus actual parseable media duration server-side. */
export async function validateOutlookAudio(file: File): Promise<ValidatedOutlookAudio> {
  const mediaType = file.type.split(";", 1)[0].trim().toLowerCase()
  if (!ACCEPTED_AUDIO_TYPES.has(mediaType)) {
    throw new AiError(
      "invalid-audio",
      "Use a WebM, MP4, OGG, MP3, M4A, or WAV voice recording.",
    )
  }

  let duration: number | undefined
  try {
    const { parseBlob } = await import("music-metadata")
    const metadata = await parseBlob(file, { duration: true, skipCovers: true })
    duration = metadata.format.duration
  } catch {
    throw new AiError("invalid-audio", "That audio file could not be read. Please record it again.")
  }

  if (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0) {
    throw new AiError("invalid-audio", "The recording duration could not be verified.")
  }
  if (duration > OUTLOOK_AI_LIMITS.maxAudioSeconds + 0.5) {
    throw new AiError(
      "payload-too-large",
      `Voice recordings must be ${Math.floor(OUTLOOK_AI_LIMITS.maxAudioSeconds / 60)} minutes or shorter.`,
    )
  }

  return { durationMs: Math.round(duration * 1000), mediaType }
}

