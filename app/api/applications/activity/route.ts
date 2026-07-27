import {
  ApplicationSessionError,
  recordReviewerApplicationActivity,
  verifyStaffRequest,
} from "@/lib/applications-server"
import type { ActivityKind } from "@/lib/applications-core"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const ACTIVITY_KINDS = new Set<ActivityKind>(["info_received", "message_copied", "message_shared", "note"])

/** POST /api/applications/activity — reviewer audit events, server-authoritative. */
export async function POST(request: Request): Promise<Response> {
  let body: { applicationId?: unknown; kind?: unknown; message?: unknown; reviewerName?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return Response.json({ error: "Invalid request.", code: "invalid-request" }, { status: 400 })
  }

  const kind = typeof body.kind === "string" && ACTIVITY_KINDS.has(body.kind as ActivityKind)
    ? (body.kind as ActivityKind)
    : null
  if (!kind) return Response.json({ error: "Invalid activity.", code: "invalid-request" }, { status: 400 })

  try {
    const reviewer = await verifyStaffRequest(request, typeof body.reviewerName === "string" ? body.reviewerName : "")
    await recordReviewerApplicationActivity(
      typeof body.applicationId === "string" ? body.applicationId : "",
      kind,
      typeof body.message === "string" ? body.message : "",
      reviewer,
    )
    return Response.json({ ok: true })
  } catch (error) {
    if (error instanceof ApplicationSessionError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.httpStatus })
    }
    return Response.json({ error: "We couldn't record this activity right now.", code: "activity-failed" }, { status: 500 })
  }
}
