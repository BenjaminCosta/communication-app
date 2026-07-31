import { createHash } from "node:crypto"

/**
 * Operations across the AI features. `generation`/`transcription` belong to the
 * Outlook flow; `ask`/`transcription` to the Ask SVC Directory flow. The union
 * is shared so the request guard and logs can be reused by both.
 */
export type OutlookAiOperation = "generation" | "transcription" | "ask"

export interface SafeOutlookAiLog {
  event: "accepted" | "succeeded" | "failed" | "provider-retry" | "rejected"
  operation: OutlookAiOperation
  requestId: string
  userHash?: string
  status?: number
  errorCode?: string
  latencyMs?: number
  textChars?: number
  recordCount?: number
  audioBytes?: number
  audioDurationMs?: number
  audioDurationSource?: "metadata" | "recorder"
  providerRequestId?: string
  attempt?: number
}

/** Hash identifiers before logs so Firebase UIDs never leave the auth boundary. */
export function safeIdentifier(value: string): string {
  return createHash("sha256").update(value).digest("base64url").slice(0, 16)
}

/**
 * Metadata-only structured logging. The type deliberately has no text,
 * transcript, question, record content, filename, request body, token, or
 * API-key field.
 */
export function logOutlookAi(metadata: SafeOutlookAiLog): void {
  console.info("[outlook-ai]", JSON.stringify(metadata))
}

/** Same allowlisted metadata shape, tagged for the Ask SVC Directory flow. */
export function logDirectoryAi(metadata: SafeOutlookAiLog): void {
  console.info("[directory-ai]", JSON.stringify(metadata))
}

/** Same allowlisted metadata shape, tagged for Quest Coral's Ask AI flow. */
export function logQuestCoralAi(metadata: SafeOutlookAiLog): void {
  console.info("[quest-coral-ai]", JSON.stringify(metadata))
}
