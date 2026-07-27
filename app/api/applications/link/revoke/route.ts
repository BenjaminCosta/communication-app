import {
  ApplicationSessionError,
  revokeReviewerApplicationLink,
  verifyStaffRequest,
} from "@/lib/applications-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** POST /api/applications/link/revoke — revokes a secure candidate link server-side. */
export async function POST(request: Request): Promise<Response> {
  let body: { token?: unknown; reviewerName?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return Response.json({ error: "Invalid request.", code: "invalid-request" }, { status: 400 })
  }

  try {
    const reviewer = await verifyStaffRequest(request, typeof body.reviewerName === "string" ? body.reviewerName : "")
    await revokeReviewerApplicationLink(typeof body.token === "string" ? body.token : "", reviewer)
    return Response.json({ ok: true })
  } catch (error) {
    if (error instanceof ApplicationSessionError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.httpStatus })
    }
    return Response.json({ error: "We couldn't revoke the secure link right now.", code: "link-revoke-failed" }, { status: 500 })
  }
}
