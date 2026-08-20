import { requireCourtneyRobertsCenterAdmin, toCourtneyRobertsCenterAccessErrorResponse } from "@/lib/courtney-roberts-center/access"
import { markOutlookFormSubmissionReviewed } from "@/lib/outlook-form-submissions/store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteParams = { params: Promise<{ submissionId: string }> }

/**
 * POST /api/courtney-roberts-center/outlook-forms/:submissionId/review
 * Auth: Bearer <approved admin's Firebase ID token>
 * Marks a submission reviewed by the calling admin.
 */
export async function POST(request: Request, { params }: RouteParams): Promise<Response> {
  let admin
  try {
    admin = await requireCourtneyRobertsCenterAdmin(request)
  } catch (error) {
    return toCourtneyRobertsCenterAccessErrorResponse(error)
  }

  const { submissionId } = await params
  try {
    const submission = await markOutlookFormSubmissionReviewed(submissionId, { uid: admin.uid, name: admin.email })
    if (!submission) return Response.json({ error: "Submission not found." }, { status: 404, headers: { "Cache-Control": "no-store" } })
    return Response.json({ submission }, { headers: { "Cache-Control": "no-store" } })
  } catch {
    return Response.json({ error: "Unable to mark this submission reviewed." }, { status: 500, headers: { "Cache-Control": "no-store" } })
  }
}
