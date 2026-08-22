import { requireCourtneyRobertsCenterAdmin, toCourtneyRobertsCenterAccessErrorResponse } from "@/lib/courtney-roberts-center/access"
import { deleteOutlookFormSubmission, getOutlookFormSubmission } from "@/lib/outlook-form-submissions/store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteParams = { params: Promise<{ submissionId: string }> }

/**
 * GET /api/courtney-roberts-center/outlook-forms/:submissionId
 * Auth: Bearer <approved admin's Firebase ID token>
 */
export async function GET(request: Request, { params }: RouteParams): Promise<Response> {
  try {
    await requireCourtneyRobertsCenterAdmin(request)
  } catch (error) {
    return toCourtneyRobertsCenterAccessErrorResponse(error)
  }

  const { submissionId } = await params
  try {
    const submission = await getOutlookFormSubmission(submissionId)
    if (!submission) return Response.json({ error: "Submission not found." }, { status: 404, headers: { "Cache-Control": "no-store" } })
    return Response.json({ submission }, { headers: { "Cache-Control": "no-store" } })
  } catch {
    return Response.json({ error: "Unable to load this submission." }, { status: 500, headers: { "Cache-Control": "no-store" } })
  }
}

/**
 * DELETE /api/courtney-roberts-center/outlook-forms/:submissionId
 * Auth: Bearer <approved admin's Firebase ID token>
 */
export async function DELETE(request: Request, { params }: RouteParams): Promise<Response> {
  try {
    await requireCourtneyRobertsCenterAdmin(request)
  } catch (error) {
    return toCourtneyRobertsCenterAccessErrorResponse(error)
  }

  const { submissionId } = await params
  try {
    const deleted = await deleteOutlookFormSubmission(submissionId)
    if (!deleted) return Response.json({ error: "Submission not found." }, { status: 404, headers: { "Cache-Control": "no-store" } })
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } })
  } catch {
    return Response.json({ error: "Unable to delete this submission." }, { status: 500, headers: { "Cache-Control": "no-store" } })
  }
}
