import {
  ApplicationSessionError,
  issueReviewerApplicationLink,
  verifyStaffRequest,
} from "@/lib/applications-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/applications/link
 * Auth: a normal staff Firebase ID token.
 * Body: { applicationId, purpose: "application" | "step", step?, invite?, reviewerName? }
 *
 * General application links and missing-item links are created through Admin
 * SDK rather than directly from the browser. It keeps bearer-token issuance
 * authoritative and prevents a candidate token from tripping Firestore's
 * staff-only link rule with an opaque 403.
 */
export async function POST(request: Request): Promise<Response> {
  let body: {
    applicationId?: unknown
    purpose?: unknown
    step?: unknown
    invite?: unknown
    reviewerName?: unknown
  }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return Response.json({ error: "Invalid request.", code: "invalid-request" }, { status: 400 })
  }

  try {
    const reviewer = await verifyStaffRequest(request, typeof body.reviewerName === "string" ? body.reviewerName : "")
    const purpose = body.purpose === "application" || body.purpose === "step" ? body.purpose : null
    if (!purpose) {
      return Response.json({ error: "Invalid link type.", code: "invalid-request" }, { status: 400 })
    }
    const link = await issueReviewerApplicationLink(
      {
        applicationId: typeof body.applicationId === "string" ? body.applicationId : "",
        purpose,
        step: body.step === "general" || body.step === "video" || body.step === "documents" ? body.step : null,
        invite: body.invite,
      },
      reviewer,
    )
    return Response.json({ link })
  } catch (error) {
    if (error instanceof ApplicationSessionError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.httpStatus })
    }
    return Response.json(
      { error: "We couldn't create the secure link right now.", code: "link-create-failed" },
      { status: 500 },
    )
  }
}
