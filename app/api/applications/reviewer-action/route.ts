import {
  applyReviewerApplicationAction,
  ApplicationSessionError,
  type ReviewerApplicationAction,
  verifyStaffRequest,
} from "@/lib/applications-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const ACTIONS = new Set<ReviewerApplicationAction>([
  "request_info",
  "archive",
  "unarchive",
  "mark_hired",
  "start_review",
  "retry_transcription",
])

/**
 * POST /api/applications/reviewer-action
 *
 * Auth: a normal staff Firebase ID token. State-changing reviewer actions run
 * inside one Admin SDK transaction with their activity event.
 */
export async function POST(request: Request): Promise<Response> {
  let body: { applicationId?: unknown; action?: unknown; message?: unknown; reviewerName?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return Response.json({ error: "Invalid request.", code: "invalid-request" }, { status: 400 })
  }

  const action = typeof body.action === "string" && ACTIONS.has(body.action as ReviewerApplicationAction)
    ? (body.action as ReviewerApplicationAction)
    : null
  if (!action) return Response.json({ error: "Invalid application action.", code: "invalid-request" }, { status: 400 })

  try {
    const reviewer = await verifyStaffRequest(request, typeof body.reviewerName === "string" ? body.reviewerName : "")
    await applyReviewerApplicationAction(
      typeof body.applicationId === "string" ? body.applicationId : "",
      action,
      reviewer,
      typeof body.message === "string" ? body.message : "",
    )
    return Response.json({ ok: true })
  } catch (error) {
    if (error instanceof ApplicationSessionError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.httpStatus })
    }
    return Response.json(
      { error: "We couldn't update this application right now.", code: "reviewer-action-failed" },
      { status: 500 },
    )
  }
}
