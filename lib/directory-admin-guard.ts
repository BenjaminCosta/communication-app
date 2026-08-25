import { getFirebaseAdminApp } from "@/lib/ai/server/firebase-admin"

/**
 * Directory's Merge/Delete/admin-access-management flows gate on a dedicated
 * `/users/{uid}` field, `directoryAdminAccess` — OR the app's existing global
 * `isAdmin` flag, kept for continuity (see below). This is a reversal of this
 * file's original posture, which reused `isAdmin` alone on the argument that
 * Directory admin actions weren't a "distinct enough sensitivity" to warrant
 * a second flag. That stopped holding once Directory needed its own
 * self-service delegation screen (mirroring Courtney Roberts Center's
 * `courtneyRobertsCenterAccess` / `admin-management.ts`): delegating access
 * "to Directory" through the shared `isAdmin` flag would silently also hand
 * out Activity Monitor access — a much larger blast radius than the action
 * suggests. A dedicated field scopes the grant to what it actually claims to
 * grant.
 *
 * `isAdmin === true` still passes this gate, unioned in rather than replaced,
 * purely for continuity: every admin who already relied on `isAdmin` for
 * Directory merge/delete keeps working the moment this ships, with nothing
 * to re-grant on day one. New grants should go through `directoryAdminAccess`
 * (via the access-management screen, `lib/directory-admin-management.ts`);
 * `isAdmin` stays as the legacy path, not the recommended one.
 *
 * Enforcement lives here, not in Firestore rules: merge/delete both require
 * server-side re-pointing of docs a browser client can't write directly
 * (/messages, /directoryRelations), so the Admin SDK route is the only place
 * this can be authorized anyway. Same reasoning extends to admin-access
 * management itself: granting/revoking another user's `directoryAdminAccess`
 * happens via Admin SDK from an API route (see
 * app/api/directory/admins/[uid]/route.ts), never a direct client write —
 * `/users/{uid}` Firestore rules stay self-write-only, unchanged, exactly
 * like Courtney Roberts Center's own admin-management never needed a rule
 * change either.
 */

/** The `/users/{uid}` field Directory's own admin-access delegation screen manages. */
export const DIRECTORY_ADMIN_ACCESS_FIELD = "directoryAdminAccess"

/**
 * Looks up whether this uid currently has Directory admin access — either
 * the dedicated field or the legacy global flag — straight from Firestore.
 * Standalone/reusable (mirrors `hasCourtneyRobertsCenterAccess`); the hot
 * path in `requireDirectoryAdmin` below does its own single read instead of
 * calling this, so it doesn't pay for two round-trips just to also fetch a
 * display name.
 */
export async function hasDirectoryAdminAccess(uid: string): Promise<boolean> {
  const { getFirestore } = await import("firebase-admin/firestore")
  const db = getFirestore(await getFirebaseAdminApp())
  const snapshot = await db.collection("users").doc(uid).get()
  const data = snapshot.data()
  return data?.[DIRECTORY_ADMIN_ACCESS_FIELD] === true || data?.isAdmin === true
}

export class DirectoryAdminError extends Error {
  readonly status: 401 | 403
  constructor(status: 401 | 403, message: string) {
    super(message)
    this.name = "DirectoryAdminError"
    this.status = status
  }
}

export type DirectoryAdmin = { uid: string; name: string }

function extractBearer(request: Request): string {
  const header = request.headers.get("authorization") ?? request.headers.get("Authorization") ?? ""
  const match = header.match(/^Bearer\s+(.+)$/i)
  if (!match) throw new DirectoryAdminError(401, "Please sign in again.")
  return match[1].trim()
}

/**
 * Verifies the caller's Firebase ID token, then requires
 * `/users/{uid}.directoryAdminAccess === true` OR the legacy
 * `/users/{uid}.isAdmin === true` (see the file-level comment for why both).
 * Always cryptographically verifies the token — no dev/mock fallback
 * (matches verifyStaffRequest()/requireCourtneyRobertsCenterAdmin()).
 */
export async function requireDirectoryAdmin(request: Request): Promise<DirectoryAdmin> {
  const token = extractBearer(request)

  const { getAuth } = await import("firebase-admin/auth")
  let decoded: { uid: string; email?: string }
  try {
    decoded = await getAuth(await getFirebaseAdminApp()).verifyIdToken(token)
  } catch {
    throw new DirectoryAdminError(401, "Your session expired. Please sign in again.")
  }

  const { getFirestore } = await import("firebase-admin/firestore")
  const db = getFirestore(await getFirebaseAdminApp())
  const snapshot = await db.collection("users").doc(decoded.uid).get()
  const data = snapshot.data()
  if (data?.[DIRECTORY_ADMIN_ACCESS_FIELD] !== true && data?.isAdmin !== true) {
    throw new DirectoryAdminError(403, "You need admin access to do this.")
  }

  const name = typeof data?.name === "string" ? data.name.trim() : ""
  return { uid: decoded.uid, name: name || decoded.email || decoded.uid }
}

export function toDirectoryAdminErrorResponse(error: unknown): Response {
  if (error instanceof DirectoryAdminError) {
    return Response.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } })
  }
  return Response.json({ error: "Please sign in again." }, { status: 401, headers: { "Cache-Control": "no-store" } })
}
