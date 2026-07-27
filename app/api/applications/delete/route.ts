import {
  ApplicationSessionError,
  hardDeleteApplication,
  verifyStaffRequest,
} from "@/lib/applications-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/applications/delete
 * Auth: a normal staff Firebase ID token.
 * Body: { applicationId }
 *
 * Permanently removes the application, its uploads and every link/agreement
 * record tied to it. Irreversible — the browser only reaches this after an
 * explicit confirm.
 */
export async function POST(request: Request): Promise<Response> {
  let body: { applicationId?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return Response.json({ error: "Invalid request.", code: "invalid-request" }, { status: 400 })
  }

  try {
    await verifyStaffRequest(request)
    await hardDeleteApplication(typeof body.applicationId === "string" ? body.applicationId : "")
    return Response.json({ ok: true })
  } catch (error) {
    if (error instanceof ApplicationSessionError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.httpStatus })
    }
    return Response.json(
      { error: "We couldn't delete this application right now.", code: "delete-failed" },
      { status: 500 },
    )
  }
}
