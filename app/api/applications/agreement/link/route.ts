import {
  ApplicationSessionError,
  resendAgreementSigningLink,
  verifyStaffRequest,
} from "@/lib/applications-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/applications/agreement/link
 * Auth: Bearer <staff Firebase ID token>
 * Body: { applicationId, reviewerName? }
 *
 * A resend is server-authoritative: it refreshes both the agreement signing
 * window and its bearer link in one transaction, with an audit event.
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
    const link = await resendAgreementSigningLink(typeof body.applicationId === "string" ? body.applicationId : "", reviewer)
    return Response.json({ link })
  } catch (error) {
    if (error instanceof ApplicationSessionError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.httpStatus })
    }
    return Response.json(
      { error: "We couldn't create the agreement link right now.", code: "agreement-link-failed" },
      { status: 500 },
    )
  }
}
