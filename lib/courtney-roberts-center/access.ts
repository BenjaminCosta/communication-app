import { getFirebaseAdminApp } from "@/lib/ai/server/firebase-admin"

/** The Firestore field on `/users/{uid}` this module gates on. Deliberately
 * separate from the general `isAdmin` flag the app's own Admin screen uses —
 * that flag can grow over time for unrelated app-administration reasons,
 * and WhatsApp conversation transcripts are a distinct, more sensitive
 * concern with its own admin list, managed from inside this module (see
 * `admin-management.ts`) rather than a static env var. */
export const COURTNEY_ROBERTS_CENTER_ACCESS_FIELD = "courtneyRobertsCenterAccess"

/**
 * Looks up whether this uid currently has access, straight from Firestore —
 * the single source of truth both this gate and the manage-access screen
 * read from, so they can never drift out of sync with each other.
 */
export async function hasCourtneyRobertsCenterAccess(uid: string): Promise<boolean> {
  const { getFirestore } = await import("firebase-admin/firestore")
  const db = getFirestore(await getFirebaseAdminApp())
  const snapshot = await db.collection("users").doc(uid).get()
  return snapshot.data()?.[COURTNEY_ROBERTS_CENTER_ACCESS_FIELD] === true
}

export class CourtneyRobertsCenterAccessError extends Error {
  readonly status: 401 | 403
  constructor(status: 401 | 403, message: string) {
    super(message)
    this.name = "CourtneyRobertsCenterAccessError"
    this.status = status
  }
}

function extractBearer(request: Request): string {
  const header = request.headers.get("authorization") ?? request.headers.get("Authorization") ?? ""
  const match = header.match(/^Bearer\s+(.+)$/i)
  if (!match) throw new CourtneyRobertsCenterAccessError(401, "Please sign in again.")
  return match[1].trim()
}

export type CourtneyRobertsCenterAdmin = { uid: string; email: string }

/**
 * Verifies the caller's Firebase ID token and checks their access against
 * Firestore. Always cryptographically verifies the token — no dev/mock
 * fallback, matching `verifyStaffRequest()`/`verifyByeByeDprUserRequest()`'s
 * fail-closed posture, appropriate here since this module reads real WhatsApp
 * conversation content rather than gating an AI feature. What's deliberately
 * *not* as strict as it could be: authorization is a single boolean any
 * current admin can grant to anyone from inside the module (see
 * `admin-management.ts`) — prioritized to stay simple and genuinely
 * self-service over a tiered permission model.
 */
export async function requireCourtneyRobertsCenterAdmin(request: Request): Promise<CourtneyRobertsCenterAdmin> {
  const token = extractBearer(request)

  const { getAuth } = await import("firebase-admin/auth")
  let decoded: { uid: string; email?: string }
  try {
    decoded = await getAuth(await getFirebaseAdminApp()).verifyIdToken(token)
  } catch {
    throw new CourtneyRobertsCenterAccessError(401, "Your session expired. Please sign in again.")
  }

  if (!(await hasCourtneyRobertsCenterAccess(decoded.uid))) {
    throw new CourtneyRobertsCenterAccessError(403, "You are not approved to view Courtney Roberts Center.")
  }
  return { uid: decoded.uid, email: decoded.email ?? "" }
}

export function toCourtneyRobertsCenterAccessErrorResponse(error: unknown): Response {
  if (error instanceof CourtneyRobertsCenterAccessError) {
    return Response.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } })
  }
  return Response.json({ error: "Please sign in again." }, { status: 401, headers: { "Cache-Control": "no-store" } })
}
