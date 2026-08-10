import { BYE_BYE_DPR_AI_LIMITS } from "@/lib/ai/config-public"
import {
  acquireOutlookAiRequest,
  completeOutlookAiRequest,
  failOutlookAiRequest,
  type AcquiredOutlookAiRequest,
} from "@/lib/ai/server/request-guard"
import type { AiGuardLimits } from "@/lib/ai/server/request-guard-core"
import type { OutlookAiOperation } from "@/lib/ai/server/safe-log"

/**
 * ByeByeDPR AI request guard (report transcription + free-text → structured
 * fields).
 *
 * Reuses the shared, transactional rate-limit / single-active-request /
 * idempotency core, but on a **separate** budget: its own Firestore
 * collection (`byeByeDprAiUsage`) and its own rolling limits — same pattern
 * as `directory-request-guard.ts` / `quest-coral-request-guard.ts`. Writes
 * happen only via the Admin SDK, which bypasses security rules.
 */

const BYE_BYE_DPR_USAGE_COLLECTION = "byeByeDprAiUsage"

const BYE_BYE_DPR_GUARD_LIMITS: AiGuardLimits = {
  requestWindowMs: BYE_BYE_DPR_AI_LIMITS.requestWindowMs,
  generationRequestsPerWindow: BYE_BYE_DPR_AI_LIMITS.generationRequestsPerWindow,
  transcriptionRequestsPerWindow: BYE_BYE_DPR_AI_LIMITS.transcriptionRequestsPerWindow,
}

export type { AcquiredOutlookAiRequest as AcquiredByeByeDprAiRequest }

export function acquireByeByeDprAiRequest(input: {
  uid: string
  operation: Extract<OutlookAiOperation, "generation" | "transcription">
  requestHash: string
  idempotencyKey: string
}): Promise<AcquiredOutlookAiRequest> {
  return acquireOutlookAiRequest({
    ...input,
    collection: BYE_BYE_DPR_USAGE_COLLECTION,
    limits: BYE_BYE_DPR_GUARD_LIMITS,
  })
}

export function completeByeByeDprAiRequest(uid: string, acquired: AcquiredOutlookAiRequest): Promise<void> {
  return completeOutlookAiRequest(uid, acquired, BYE_BYE_DPR_USAGE_COLLECTION)
}

export function failByeByeDprAiRequest(uid: string, acquired: AcquiredOutlookAiRequest): Promise<void> {
  return failOutlookAiRequest(uid, acquired, BYE_BYE_DPR_USAGE_COLLECTION)
}
