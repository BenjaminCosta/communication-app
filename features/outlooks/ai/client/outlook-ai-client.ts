"use client"

import { auth } from "@/lib/firebase"
import type {
  ParseOutlookContext,
  ParseOutlookResponse,
  TranscribeOutlookResponse,
} from "@/features/outlooks/ai/outlook-parser-contract"

/**
 * Browser-side callers for the secure Outlook AI routes.
 *
 * Every request carries the current Firebase ID token as a bearer credential —
 * the provider key stays on the server. These wrappers own auth + error shaping
 * only; all validation of shapes happens on the server and again via the shared
 * zod schemas.
 */

async function authHeader(): Promise<string> {
  const user = auth.currentUser
  if (!user) throw new OutlookAiClientError("unauthenticated", "Please sign in again to use AI.")
  const token = await user.getIdToken()
  return `Bearer ${token}`
}

export class OutlookAiClientError extends Error {
  readonly code: string
  readonly retryAfterSeconds?: number

  constructor(code: string, message: string, retryAfterSeconds?: number) {
    super(message)
    this.name = "OutlookAiClientError"
    this.code = code
    this.retryAfterSeconds = retryAfterSeconds
  }
}

async function readError(response: Response, fallback: string): Promise<never> {
  let message = fallback
  let code = "request-failed"
  let retryAfterSeconds: number | undefined
  try {
    const body = (await response.json()) as {
      error?: unknown
      code?: unknown
      retryAfterSeconds?: unknown
    }
    if (typeof body.error === "string" && body.error) message = body.error
    if (typeof body.code === "string" && body.code) code = body.code
    if (typeof body.retryAfterSeconds === "number" && body.retryAfterSeconds > 0) {
      retryAfterSeconds = body.retryAfterSeconds
    }
  } catch {
    /* keep fallback */
  }
  throw new OutlookAiClientError(code, message, retryAfterSeconds)
}

export function createOutlookAiIdempotencyKey(): string {
  const browserCrypto = globalThis.crypto
  if (typeof browserCrypto.randomUUID === "function") {
    return browserCrypto.randomUUID().replaceAll("-", "").slice(0, 20)
  }
  const bytes = new Uint8Array(12)
  browserCrypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
}

function extensionForAudio(type: string): string {
  const mediaType = type.split(";", 1)[0].toLowerCase()
  if (mediaType === "audio/mp4" || mediaType === "audio/m4a" || mediaType === "audio/x-m4a") return "m4a"
  if (mediaType === "audio/ogg") return "ogg"
  if (mediaType === "audio/mpeg") return "mp3"
  if (mediaType === "audio/wav" || mediaType === "audio/x-wav") return "wav"
  return "webm"
}

export async function requestOutlookTranscription(
  audio: Blob,
  options: { language?: string; fileName?: string; idempotencyKey?: string; durationMs?: number } = {},
): Promise<TranscribeOutlookResponse> {
  const form = new FormData()
  form.append("audio", audio, options.fileName ?? `outlook-note.${extensionForAudio(audio.type)}`)
  if (options.language) form.append("language", options.language)
  if (options.durationMs != null) form.append("durationMs", String(Math.round(options.durationMs)))

  const response = await fetch("/api/outlooks/transcribe", {
    method: "POST",
    headers: {
      Authorization: await authHeader(),
      "X-Idempotency-Key": options.idempotencyKey ?? createOutlookAiIdempotencyKey(),
    },
    body: form,
  })
  if (!response.ok) await readError(response, "Transcription failed. You can type the note instead.")
  return (await response.json()) as TranscribeOutlookResponse
}

export async function requestOutlookParse(
  text: string,
  context: ParseOutlookContext,
  options: { idempotencyKey?: string } = {},
): Promise<ParseOutlookResponse> {
  const response = await fetch("/api/outlooks/parse", {
    method: "POST",
    headers: {
      Authorization: await authHeader(),
      "Content-Type": "application/json",
      "X-Idempotency-Key": options.idempotencyKey ?? createOutlookAiIdempotencyKey(),
    },
    body: JSON.stringify({ text, context }),
  })
  if (!response.ok) await readError(response, "Could not read tasks from that note. Try rewording it.")
  return (await response.json()) as ParseOutlookResponse
}
