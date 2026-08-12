import { WHATSAPP_SECRETARY_AI_LIMITS } from "@/lib/ai/config-public"
import {
  acquireOutlookAiRequest,
  completeOutlookAiRequest,
  failOutlookAiRequest,
  type AcquiredOutlookAiRequest,
} from "@/lib/ai/server/request-guard"
import type { AiGuardLimits } from "@/lib/ai/server/request-guard-core"

/**
 * WhatsApp Secretary request guard.
 *
 * Reuses the shared, transactional rate-limit / single-active-request /
 * idempotency core, but on a **separate** budget: its own Firestore
 * collection (`whatsappSecretaryAiUsage`) and its own rolling limits, mirroring
 * `lib/ai/server/directory-request-guard.ts`. Writes happen only via the
 * Admin SDK, which bypasses security rules, so no Firestore rule change is
 * needed.
 *
 * Keyed by the resolved WhatsApp sender's Firebase identity
 * (`actorUserId ?? actorPersonId`), never the raw phone number — the caller
 * is responsible for resolving that key and never calls this guard at all for
 * an unrecognized/public sender (see `lib/whatsapp-access-policy.ts`).
 */

const WHATSAPP_SECRETARY_USAGE_COLLECTION = "whatsappSecretaryAiUsage"

const WHATSAPP_SECRETARY_GUARD_LIMITS: AiGuardLimits = {
  requestWindowMs: WHATSAPP_SECRETARY_AI_LIMITS.requestWindowMs,
  generationRequestsPerWindow: WHATSAPP_SECRETARY_AI_LIMITS.askRequestsPerWindow,
  // The Secretary has no transcription operation of its own in this phase.
  transcriptionRequestsPerWindow: 0,
}

export type { AcquiredOutlookAiRequest as AcquiredWhatsAppSecretaryAiRequest }

export function acquireWhatsAppSecretaryAiRequest(input: {
  uid: string
  requestHash: string
  idempotencyKey: string
}): Promise<AcquiredOutlookAiRequest> {
  return acquireOutlookAiRequest({
    ...input,
    operation: "ask",
    collection: WHATSAPP_SECRETARY_USAGE_COLLECTION,
    limits: WHATSAPP_SECRETARY_GUARD_LIMITS,
  })
}

export function completeWhatsAppSecretaryAiRequest(
  uid: string,
  acquired: AcquiredOutlookAiRequest,
): Promise<void> {
  return completeOutlookAiRequest(uid, acquired, WHATSAPP_SECRETARY_USAGE_COLLECTION)
}

export function failWhatsAppSecretaryAiRequest(
  uid: string,
  acquired: AcquiredOutlookAiRequest,
): Promise<void> {
  return failOutlookAiRequest(uid, acquired, WHATSAPP_SECRETARY_USAGE_COLLECTION)
}
