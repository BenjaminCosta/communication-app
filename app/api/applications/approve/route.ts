import {
  approveApplicationAndUnlockAgreement,
  ApplicationSessionError,
  verifyStaffRequest,
} from "@/lib/applications-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/applications/approve
 * Auth: Bearer <staff Firebase ID token>
 * Body: { applicationId, reviewerName? }
 *
 * The browser cannot write agreement status by design. This endpoint verifies
 * a staff token, then atomically approves the candidate and unlocks signing.
 */
export async function POST(request: Request): Promise<Response> {
  let body: { applicationId?: unknown; reviewerName?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return Response.json({ error: "Invalid request.", code: "invalid-request" }, { status: 400 })
  }

  try {
    const reviewer = await verifyStaffRequest(request, typeof body.reviewerName === "string" ? body.reviewerName : "")
    const result = await approveApplicationAndUnlockAgreement(
      typeof body.applicationId === "string" ? body.applicationId : "",
      reviewer,
    )
    return Response.json(result)
  } catch (error) {
    if (error instanceof ApplicationSessionError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.httpStatus })
    }
    return Response.json(
      { error: "We couldn't approve this application right now.", code: "approve-failed" },
      { status: 500 },
    )
  }
}
