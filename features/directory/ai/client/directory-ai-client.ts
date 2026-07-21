"use client"

import { auth } from "@/lib/firebase"
import {
  createOutlookAiIdempotencyKey as createAiIdempotencyKey,
  OutlookAiClientError as DirectoryAiClientError,
} from "@/features/outlooks/ai/client/outlook-ai-client"
import type {
  DirectoryAskContext,
  DirectoryAskDisambiguation,
  DirectoryAskRefinement,
  DirectoryAskResponse,
  TranscribeDirectoryResponse,
} from "@/features/directory/ai/directory-ask-contract"

/**
 * Browser-side callers for the secure Ask SVC Directory routes.
 *
 * Every request carries the current Firebase ID token — the provider key stays
 * on the server. These wrappers own auth + error shaping only; all validation of
 * shapes happens on the server and again via the shared zod schemas. The generic
 * idempotency-key + error helpers are reused from the Outlook client.
 */

export { DirectoryAiClientError, createAiIdempotencyKey as createDirectoryAiIdempotencyKey }

async function authHeader(): Promise<string> {
  const user = auth.currentUser
  if (!user) throw new DirectoryAiClientError("unauthenticated", "Please sign in again to use AI.")
  const token = await user.getIdToken()
  return `Bearer ${token}`
}

async function readError(response: Response, fallback: string): Promise<never> {
  let message = fallback
  let code = "request-failed"
  let retryAfterSeconds: number | undefined
  try {
    const body = (await response.json()) as { error?: unknown; code?: unknown; retryAfterSeconds?: unknown }
    if (typeof body.error === "string" && body.error) message = body.error
    if (typeof body.code === "string" && body.code) code = body.code
    if (typeof body.retryAfterSeconds === "number" && body.retryAfterSeconds > 0) {
      retryAfterSeconds = body.retryAfterSeconds
    }
  } catch {
    /* keep fallback */
  }
  throw new DirectoryAiClientError(code, message, retryAfterSeconds)
}

function extensionForAudio(type: string): string {
  const mediaType = type.split(";", 1)[0].toLowerCase()
  if (mediaType === "audio/mp4" || mediaType === "audio/m4a" || mediaType === "audio/x-m4a") return "m4a"
  if (mediaType === "audio/ogg") return "ogg"
  if (mediaType === "audio/mpeg") return "mp3"
  if (mediaType === "audio/wav" || mediaType === "audio/x-wav") return "wav"
  return "webm"
}

/**
 * Retrieval happens server-side (V2), so the client sends only the question and
 * its page context — never records. `resolvedEntityIds` carries the picks the
 * user made when a name was ambiguous.
 */
export interface DirectoryAskPayload {
  question: string
  context: DirectoryAskContext
  refinement?: DirectoryAskRefinement | null
  resolvedEntityIds?: string[]
}

export async function requestDirectoryAsk(
  payload: DirectoryAskPayload,
  options: { idempotencyKey?: string } = {},
): Promise<DirectoryAskResponse | DirectoryAskDisambiguation> {
  const response = await fetch("/api/directory/ask", {
    method: "POST",
    headers: {
      Authorization: await authHeader(),
      "Content-Type": "application/json",
      "X-Idempotency-Key": options.idempotencyKey ?? createAiIdempotencyKey(),
    },
    body: JSON.stringify(payload),
  })
  if (!response.ok) await readError(response, "The assistant couldn't answer that. Try rewording it.")
  return (await response.json()) as DirectoryAskResponse | DirectoryAskDisambiguation
}

export async function requestDirectoryTranscription(
  audio: Blob,
  options: { language?: string; fileName?: string; idempotencyKey?: string; durationMs?: number } = {},
): Promise<TranscribeDirectoryResponse> {
  const form = new FormData()
  form.append("audio", audio, options.fileName ?? `directory-question.${extensionForAudio(audio.type)}`)
  if (options.language) form.append("language", options.language)
  if (options.durationMs != null) form.append("durationMs", String(Math.round(options.durationMs)))

  const response = await fetch("/api/directory/transcribe", {
    method: "POST",
    headers: {
      Authorization: await authHeader(),
      "X-Idempotency-Key": options.idempotencyKey ?? createAiIdempotencyKey(),
    },
    body: form,
  })
  if (!response.ok) await readError(response, "Transcription failed. You can type the question instead.")
  return (await response.json()) as TranscribeDirectoryResponse
}
