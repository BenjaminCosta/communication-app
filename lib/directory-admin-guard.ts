import { getFirebaseAdminApp } from "@/lib/ai/server/firebase-admin"

/**
 * Directory's Merge/Delete flows reuse the app's existing `isAdmin` flag on
 * `/users/{uid}` — the same one that gates the Activity Monitor screen —
 * rather than adding a second admin flag. Unlike Courtney Roberts Center's
 * dedicated access field, there's no distinct sensitivity here that would
 * justify a separate flag: this is general "trusted staff can do sensitive,
 * shared-data operations" territory, the same bucket Activity Monitor is in.
 *
 * Enforcement lives here, not in Firestore rules: merge/delete both require
 * server-side re-pointing of docs a browser client can't write directly
 * (/messages, /directoryRelations), so the Admin SDK route is the only place
 * this can be authorized anyway.
 */

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
 * Verifies the caller's Firebase ID token, then requires `/users/{uid}.isAdmin
 * === true`. Always cryptographically verifies the token — no dev/mock
 * fallback (matches verifyStaffRequest()/requireCourtneyRobertsCenterAdmin()).
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
  if (data?.isAdmin !== true) {
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
