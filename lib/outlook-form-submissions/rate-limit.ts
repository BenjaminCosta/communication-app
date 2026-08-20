import { createHash } from "node:crypto"
import type { Firestore } from "firebase-admin/firestore"
import { getFirebaseAdminApp } from "@/lib/ai/server/firebase-admin"

/**
 * Blunt hour-window throttle for the public, unauthenticated submit route —
 * cheap insurance against a runaway bot, not a precision rate limiter. Same
 * Admin-SDK-only ledger posture as outlookAiUsage/questCoralAiUsage in
 * firestore.rules (allow read, write: if false).
 */

export const OUTLOOK_FORM_RATE_LIMIT_COLLECTION = "outlookFormRateLimit"
const WINDOW_MS = 60 * 60 * 1000
const MAX_SUBMISSIONS_PER_WINDOW = 20

export function hashOutlookFormRateLimitKey(ip: string): string {
  return createHash("sha256").update(ip).digest("hex")
}

/** Pure state transition — no Firestore — so the threshold/reset logic is unit-testable with a fake clock. */
export function nextRateLimitState(
  existing: { count: number; windowStartMs: number } | null,
  nowMs: number,
): { allowed: boolean; state: { count: number; windowStartMs: number } } {
  if (!existing || nowMs - existing.windowStartMs >= WINDOW_MS) {
    return { allowed: true, state: { count: 1, windowStartMs: nowMs } }
  }
  if (existing.count >= MAX_SUBMISSIONS_PER_WINDOW) {
    return { allowed: false, state: existing }
  }
  return { allowed: true, state: { count: existing.count + 1, windowStartMs: existing.windowStartMs } }
}

async function getAdminDb(): Promise<Firestore> {
  const { getFirestore } = await import("firebase-admin/firestore")
  return getFirestore(await getFirebaseAdminApp())
}

/** Returns true when this IP may submit right now, and records the attempt either way. */
export async function checkAndRecordOutlookFormSubmission(ip: string): Promise<boolean> {
  const db = await getAdminDb()
  const ref = db.collection(OUTLOOK_FORM_RATE_LIMIT_COLLECTION).doc(hashOutlookFormRateLimitKey(ip))
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref)
    const data = snapshot.data()
    const existing =
      typeof data?.count === "number" && typeof data?.windowStartMs === "number"
        ? { count: data.count, windowStartMs: data.windowStartMs }
        : null
    const { allowed, state } = nextRateLimitState(existing, Date.now())
    transaction.set(ref, { ...state, updatedAt: Date.now() }, { merge: true })
    return allowed
  })
}
