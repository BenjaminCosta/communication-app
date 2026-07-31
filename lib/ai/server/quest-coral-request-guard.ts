import { QUEST_CORAL_AI_LIMITS } from "@/lib/ai/config-public"
import {
  acquireOutlookAiRequest,
  completeOutlookAiRequest,
  failOutlookAiRequest,
  type AcquiredOutlookAiRequest,
} from "@/lib/ai/server/request-guard"
import type { AiGuardLimits } from "@/lib/ai/server/request-guard-core"
import type { OutlookAiOperation } from "@/lib/ai/server/safe-log"

/**
 * Quest Coral "Ask AI" / "AI Project Brief" request guard.
 *
 * Reuses the shared, transactional rate-limit / single-active-request /
 * idempotency core, but on a **separate** budget: its own Firestore collection
 * (`questCoralAiUsage`) and its own rolling limits. Writes happen only via the
 * Admin SDK, which bypasses security rules — the explicit deny rule for this
 * collection is defense in depth, not a functional requirement. Ask (project
 * or portfolio question) and Brief (project summary generation) both map onto
 * the shared non-transcription bucket — `acquireOutlookAiGuardState` only
 * distinguishes transcription from everything else — so they draw from one
 * combined rolling budget per user, just tagged differently for logging.
 */

const QUEST_CORAL_USAGE_COLLECTION = "questCoralAiUsage"

const QUEST_CORAL_GUARD_LIMITS: AiGuardLimits = {
  requestWindowMs: QUEST_CORAL_AI_LIMITS.requestWindowMs,
  generationRequestsPerWindow: QUEST_CORAL_AI_LIMITS.askRequestsPerWindow,
  // Quest Coral has no transcription path; the bucket is unused but required
  // by the shared limits shape, so give it the same budget as generation.
  transcriptionRequestsPerWindow: QUEST_CORAL_AI_LIMITS.askRequestsPerWindow,
}

export type { AcquiredOutlookAiRequest as AcquiredQuestCoralAiRequest }

export function acquireQuestCoralAiRequest(input: {
  uid: string
  operation: Extract<OutlookAiOperation, "ask" | "generation">
  requestHash: string
  idempotencyKey: string
}): Promise<AcquiredOutlookAiRequest> {
  return acquireOutlookAiRequest({
    ...input,
    collection: QUEST_CORAL_USAGE_COLLECTION,
    limits: QUEST_CORAL_GUARD_LIMITS,
  })
}

export function completeQuestCoralAiRequest(
  uid: string,
  acquired: AcquiredOutlookAiRequest,
): Promise<void> {
  return completeOutlookAiRequest(uid, acquired, QUEST_CORAL_USAGE_COLLECTION)
}

export function failQuestCoralAiRequest(
  uid: string,
  acquired: AcquiredOutlookAiRequest,
): Promise<void> {
  return failOutlookAiRequest(uid, acquired, QUEST_CORAL_USAGE_COLLECTION)
}
