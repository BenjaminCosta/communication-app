"use client"

import { auth } from "@/lib/firebase"
import {
  createOutlookAiIdempotencyKey as createAiIdempotencyKey,
  OutlookAiClientError as QuestCoralAiClientError,
} from "@/features/outlooks/ai/client/outlook-ai-client"
import type { QuestCoralAskRequest, QuestCoralAskResponse } from "@/features/quest-coral/ai/quest-coral-ask-contract"
import type { QuestCoralBriefRequest, QuestCoralBriefResponse } from "@/features/quest-coral/ai/quest-coral-brief-contract"

/**
 * Browser-side caller for the secure Quest Coral ask route.
 *
 * Carries the current Firebase ID token — the provider key stays on the
 * server. This wrapper owns auth + error shaping only; all validation of the
 * request/response shape happens on the server via the shared zod schemas.
 * The generic idempotency-key + error helpers are reused from the Outlook
 * client, same as Directory's own client wrapper does.
 */

export { QuestCoralAiClientError, createAiIdempotencyKey as createQuestCoralAiIdempotencyKey }

async function authHeader(): Promise<string> {
  const user = auth.currentUser
  if (!user) throw new QuestCoralAiClientError("unauthenticated", "Please sign in again to use AI.")
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
  throw new QuestCoralAiClientError(code, message, retryAfterSeconds)
}

export async function requestQuestCoralAsk(
  payload: QuestCoralAskRequest,
  options: { idempotencyKey?: string } = {},
): Promise<QuestCoralAskResponse> {
  const response = await fetch("/api/quest-coral/ask", {
    method: "POST",
    headers: {
      Authorization: await authHeader(),
      "Content-Type": "application/json",
      "X-Idempotency-Key": options.idempotencyKey ?? createAiIdempotencyKey(),
    },
    body: JSON.stringify(payload),
  })
  if (!response.ok) await readError(response, "The assistant couldn't answer that. Try rewording it.")
  return (await response.json()) as QuestCoralAskResponse
}

export async function requestQuestCoralBrief(
  payload: QuestCoralBriefRequest,
  options: { idempotencyKey?: string } = {},
): Promise<QuestCoralBriefResponse> {
  const response = await fetch("/api/quest-coral/brief", {
    method: "POST",
    headers: {
      Authorization: await authHeader(),
      "Content-Type": "application/json",
      "X-Idempotency-Key": options.idempotencyKey ?? createAiIdempotencyKey(),
    },
    body: JSON.stringify(payload),
  })
  if (!response.ok) await readError(response, "The project brief couldn't be generated. Please try again.")
  return (await response.json()) as QuestCoralBriefResponse
}
