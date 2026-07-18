import { createHash, randomUUID } from "node:crypto"
import { AiError } from "@/lib/ai/errors"
import { getFirebaseAdminApp } from "@/lib/ai/server/firebase-admin"
import {
  acquireOutlookAiGuardState,
  completeOutlookAiGuardState,
  failOutlookAiGuardState,
  normalizeOutlookAiGuardState,
  type OutlookAiGuardLease,
} from "@/lib/ai/server/request-guard-core"
import { safeIdentifier, type OutlookAiOperation } from "@/lib/ai/server/safe-log"

const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9_-]{12,32}$/

export interface AcquiredOutlookAiRequest {
  lease: OutlookAiGuardLease
  requestId: string
  userHash: string
}

export function readOutlookAiIdempotencyKey(request: Request): string {
  const key = (request.headers.get("x-idempotency-key") ?? "").trim()
  if (!IDEMPOTENCY_PATTERN.test(key)) {
    throw new AiError("invalid-request", "A valid retry key is required. Refresh and try again.")
  }
  return key
}

export function hashOutlookAiRequest(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("base64url")
}

export async function acquireOutlookAiRequest(input: {
  uid: string
  operation: OutlookAiOperation
  requestHash: string
  idempotencyKey: string
}): Promise<AcquiredOutlookAiRequest> {
  const { getFirestore } = await import("firebase-admin/firestore")
  const db = getFirestore(await getFirebaseAdminApp())
  const userHash = safeIdentifier(input.uid)
  const ref = db.collection("outlookAiUsage").doc(hashOutlookAiRequest(input.uid))
  const keyHash = hashOutlookAiRequest(input.idempotencyKey)
  const leaseId = randomUUID()
  const nowMs = Date.now()
  let acquired: OutlookAiGuardLease | null = null

  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref)
    const current = normalizeOutlookAiGuardState(snapshot.data())
    const decision = acquireOutlookAiGuardState(current, {
      operation: input.operation,
      requestHash: input.requestHash,
      keyHash,
      leaseId,
      nowMs,
    })
    acquired = decision.lease
    transaction.set(ref, { ...decision.state, updatedAtMs: nowMs })
  })

  if (!acquired) throw new AiError("provider-error", "The AI request could not be started.")
  return { lease: acquired, requestId: input.idempotencyKey, userHash }
}

export async function completeOutlookAiRequest(
  uid: string,
  acquired: AcquiredOutlookAiRequest,
): Promise<void> {
  await updateLease(uid, acquired.lease, "complete")
}

export async function failOutlookAiRequest(
  uid: string,
  acquired: AcquiredOutlookAiRequest,
): Promise<void> {
  await updateLease(uid, acquired.lease, "fail")
}

async function updateLease(
  uid: string,
  lease: OutlookAiGuardLease,
  outcome: "complete" | "fail",
): Promise<void> {
  const { getFirestore } = await import("firebase-admin/firestore")
  const db = getFirestore(await getFirebaseAdminApp())
  const ref = db.collection("outlookAiUsage").doc(hashOutlookAiRequest(uid))
  const nowMs = Date.now()

  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref)
    if (!snapshot.exists) return
    const current = normalizeOutlookAiGuardState(snapshot.data())
    const next =
      outcome === "complete"
        ? completeOutlookAiGuardState(current, lease, nowMs)
        : failOutlookAiGuardState(current, lease)
    transaction.set(ref, { ...next, updatedAtMs: nowMs })
  })
}

