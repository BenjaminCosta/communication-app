import { createCandidateSession, ApplicationSessionError } from "@/lib/applications-server"

// firebase-admin needs the Node runtime, not Edge.
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/applications/session
 * Body: { token: string }
 * Returns: { customToken, applicationId, purpose, step }
 *
 * The candidate's browser calls this on opening a link, then signs in with the
 * returned custom token. No auth is required to call it — the token IS the
 * credential — so it validates strictly and fails closed.
 */
export async function POST(request: Request): Promise<Response> {
  let token = ""
  try {
    const body = (await request.json()) as { token?: unknown }
    token = typeof body.token === "string" ? body.token : ""
  } catch {
    return Response.json({ error: "A link token is required.", code: "invalid-request" }, { status: 400 })
  }

  try {
    const session = await createCandidateSession(token)
    return Response.json(session)
  } catch (error) {
    if (error instanceof ApplicationSessionError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.httpStatus })
    }
    // Admin not configured, network, etc. — don't leak internals.
    return Response.json(
      { error: "The link could not be opened right now.", code: "session-failed" },
      { status: 500 },
    )
  }
}
