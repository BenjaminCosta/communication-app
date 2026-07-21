import { DIRECTORY_AI_LIMITS } from "@/lib/ai/config-public"
import {
  acquireOutlookAiRequest,
  completeOutlookAiRequest,
  failOutlookAiRequest,
  type AcquiredOutlookAiRequest,
} from "@/lib/ai/server/request-guard"
import type { AiGuardLimits } from "@/lib/ai/server/request-guard-core"
import type { OutlookAiOperation } from "@/lib/ai/server/safe-log"

/**
 * Ask SVC Directory request guard.
 *
 * Reuses the shared, transactional rate-limit / single-active-request /
 * idempotency core, but on a **separate** budget: its own Firestore collection
 * (`directoryAiUsage`) and its own rolling limits. Writes happen only via the
 * Admin SDK, which bypasses security rules, so no Firestore rule change is
 * needed. Directory questions map to the `ask` operation; voice questions to
 * `transcription`.
 */

const DIRECTORY_USAGE_COLLECTION = "directoryAiUsage"

/** Adapt the client-safe Directory limits to the guard's bucket names. */
const DIRECTORY_GUARD_LIMITS: AiGuardLimits = {
  requestWindowMs: DIRECTORY_AI_LIMITS.requestWindowMs,
  generationRequestsPerWindow: DIRECTORY_AI_LIMITS.askRequestsPerWindow,
  transcriptionRequestsPerWindow: DIRECTORY_AI_LIMITS.transcriptionRequestsPerWindow,
}

export type { AcquiredOutlookAiRequest as AcquiredDirectoryAiRequest }

export function acquireDirectoryAiRequest(input: {
  uid: string
  operation: Extract<OutlookAiOperation, "ask" | "transcription">
  requestHash: string
  idempotencyKey: string
}): Promise<AcquiredOutlookAiRequest> {
  return acquireOutlookAiRequest({
    ...input,
    collection: DIRECTORY_USAGE_COLLECTION,
    limits: DIRECTORY_GUARD_LIMITS,
  })
}

export function completeDirectoryAiRequest(
  uid: string,
  acquired: AcquiredOutlookAiRequest,
): Promise<void> {
  return completeOutlookAiRequest(uid, acquired, DIRECTORY_USAGE_COLLECTION)
}

export function failDirectoryAiRequest(
  uid: string,
  acquired: AcquiredOutlookAiRequest,
): Promise<void> {
  return failOutlookAiRequest(uid, acquired, DIRECTORY_USAGE_COLLECTION)
}
