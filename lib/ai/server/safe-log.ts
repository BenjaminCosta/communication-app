import { createHash } from "node:crypto"

export type OutlookAiOperation = "generation" | "transcription"

export interface SafeOutlookAiLog {
  event: "accepted" | "succeeded" | "failed" | "provider-retry" | "rejected"
  operation: OutlookAiOperation
  requestId: string
  userHash?: string
  status?: number
  errorCode?: string
  latencyMs?: number
  textChars?: number
  audioBytes?: number
  audioDurationMs?: number
  providerRequestId?: string
  attempt?: number
}

/** Hash identifiers before logs so Firebase UIDs never leave the auth boundary. */
export function safeIdentifier(value: string): string {
  return createHash("sha256").update(value).digest("base64url").slice(0, 16)
}

/**
 * Metadata-only structured logging. The type deliberately has no text,
 * transcript, filename, request body, token, or API-key field.
 */
export function logOutlookAi(metadata: SafeOutlookAiLog): void {
  console.info("[outlook-ai]", JSON.stringify(metadata))
}

