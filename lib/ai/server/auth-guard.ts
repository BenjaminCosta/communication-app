import { canCallProvider, getOutlookAiConfig } from "@/lib/ai/config"
import { AiError } from "@/lib/ai/errors"
import { getFirebaseAdminApp } from "@/lib/ai/server/firebase-admin"

/**
 * Authenticate an Outlook AI request from the `Authorization: Bearer <idToken>`
 * header before any provider work happens.
 *
 * Two paths, chosen by whether Firebase Admin credentials are configured:
 *
 *  - **Secure (prod):** when `FIREBASE_SERVICE_ACCOUNT_KEY` (JSON) or
 *    `GOOGLE_APPLICATION_CREDENTIALS` (path) is set, the token is cryptographically
 *    verified with the Admin SDK. This is the path that must run in production.
 *
 *  - **Dev fallback:** when no Admin credentials exist (the mock phase), the JWT
 *    is *decoded but not verified* purely to read the uid, so the mock UX can be
 *    driven end-to-end with a genuine client token. This path is gated on the
 *    absence of credentials and returns `verified: false`. Enabling real
 *    verification later is literally just adding the credential env var.
 */

export interface AuthenticatedUser {
  uid: string
  verified: boolean
}

function hasAdminCredentials(): boolean {
  return Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_KEY || process.env.GOOGLE_APPLICATION_CREDENTIALS)
}

function extractBearer(request: Request): string {
  const header = request.headers.get("authorization") ?? request.headers.get("Authorization") ?? ""
  const match = header.match(/^Bearer\s+(.+)$/i)
  if (!match) throw new AiError("unauthenticated", "Please sign in again to use AI.")
  return match[1].trim()
}

/** Insecure decode used only when Admin credentials are absent. */
function decodeUnverified(token: string): AuthenticatedUser {
  const parts = token.split(".")
  if (parts.length !== 3) throw new AiError("unauthenticated", "Please sign in again to use AI.")
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as {
      user_id?: unknown
      sub?: unknown
    }
    const uid = typeof payload.user_id === "string" ? payload.user_id : typeof payload.sub === "string" ? payload.sub : ""
    if (!uid) throw new AiError("unauthenticated", "Please sign in again to use AI.")
    return { uid, verified: false }
  } catch (error) {
    if (error instanceof AiError) throw error
    throw new AiError("unauthenticated", "Please sign in again to use AI.")
  }
}

// Cache the Admin app across warm invocations without importing the SDK unless used.
let adminVerifierPromise: Promise<(token: string) => Promise<AuthenticatedUser>> | null = null

function getAdminVerifier(): Promise<(token: string) => Promise<AuthenticatedUser>> {
  if (adminVerifierPromise) return adminVerifierPromise
  adminVerifierPromise = (async () => {
    const { getAuth } = await import("firebase-admin/auth")
    const auth = getAuth(await getFirebaseAdminApp())
    return async (token: string) => {
      const decoded = await auth.verifyIdToken(token)
      return { uid: decoded.uid, verified: true }
    }
  })()
  return adminVerifierPromise
}

export async function authenticateOutlookRequest(request: Request): Promise<AuthenticatedUser> {
  const token = extractBearer(request)
  if (!hasAdminCredentials()) {
    // Unverified decoding exists only to exercise the offline mock UX. Once a
    // provider key makes the request billable, fail closed unless Firebase
    // Admin can cryptographically verify the caller's ID token.
    if (canCallProvider(getOutlookAiConfig())) {
      throw new AiError("not-configured", "AI authentication is not configured yet.")
    }
    return decodeUnverified(token)
  }
  try {
    const verify = await getAdminVerifier()
    return await verify(token)
  } catch {
    throw new AiError("unauthenticated", "Your session expired. Please sign in again.")
  }
}
