import { getFirebaseAdminApp } from "@/lib/ai/server/firebase-admin"

/**
 * A dedicated allowlist, separate from the general `/users.isAdmin` flag the
 * app's own Admin screen already uses. That flag can grow over time for
 * unrelated app-administration reasons; WhatsApp conversation transcripts are
 * more sensitive, so this module gates on an explicit, independently
 * configured email list instead — fails closed (nobody is approved) until
 * `COURTNEY_ROBERTS_CENTER_ADMIN_EMAILS` is set.
 */
export function parseAdminEmails(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  )
}

/** Test seam: exercises the parsing/matching logic without depending on process.env. */
export const parseCourtneyRobertsCenterAdminEmailsForTests = parseAdminEmails

export function isApprovedCourtneyRobertsCenterAdminEmail(email: string | null | undefined, allowlist: Set<string>): boolean {
  if (!email) return false
  return allowlist.has(email.trim().toLowerCase())
}

/** Test seam for {@link isApprovedCourtneyRobertsCenterAdminEmail}. */
export const isApprovedCourtneyRobertsCenterAdminEmailForTests = isApprovedCourtneyRobertsCenterAdminEmail

export function isApprovedCourtneyRobertsCenterAdmin(email: string | null | undefined): boolean {
  return isApprovedCourtneyRobertsCenterAdminEmail(email, parseAdminEmails(process.env.COURTNEY_ROBERTS_CENTER_ADMIN_EMAILS))
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
 * Verifies the caller's Firebase ID token and checks it against the approved
 * admin allowlist. Always cryptographically verifies — no dev/mock fallback,
 * matching `verifyStaffRequest()`/`verifyByeByeDprUserRequest()`'s
 * fail-closed posture, appropriate here since this module reads real WhatsApp
 * conversation content rather than gating an AI feature.
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

  const email = decoded.email ?? null
  if (!isApprovedCourtneyRobertsCenterAdmin(email)) {
    throw new CourtneyRobertsCenterAccessError(403, "You are not approved to view Courtney Roberts Center.")
  }
  return { uid: decoded.uid, email: email as string }
}

export function toCourtneyRobertsCenterAccessErrorResponse(error: unknown): Response {
  if (error instanceof CourtneyRobertsCenterAccessError) {
    return Response.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } })
  }
  return Response.json({ error: "Please sign in again." }, { status: 401, headers: { "Cache-Control": "no-store" } })
}
