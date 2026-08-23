import { z } from "zod"
import { requireCourtneyRobertsCenterAdmin, toCourtneyRobertsCenterAccessErrorResponse } from "@/lib/courtney-roberts-center/access"
import { markOutlookFormSubmissionConverted } from "@/lib/outlook-form-submissions/store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteParams = { params: Promise<{ submissionId: string }> }

const bodySchema = z.object({
  jobContextId: z.string().trim().min(1).max(200),
  windowStart: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
  versionId: z.string().trim().min(1).max(50),
})

/**
 * POST /api/courtney-roberts-center/outlook-forms/:submissionId/convert
 * Auth: Bearer <approved admin's Firebase ID token>
 *
 * Bookkeeping only — records which real Outlook this submission became.
 * The real Outlook write (contexts/{jobContextId}/outlooks/{windowStart})
 * already happened client-side, as the calling admin's own authenticated
 * session, before this is ever called (see features/outlooks/generate-real-outlook.ts).
 * This route never touches that collection.
 */
export async function POST(request: Request, { params }: RouteParams): Promise<Response> {
  let admin
  try {
    admin = await requireCourtneyRobertsCenterAdmin(request)
  } catch (error) {
    return toCourtneyRobertsCenterAccessErrorResponse(error)
  }

  const { submissionId } = await params
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400, headers: { "Cache-Control": "no-store" } })
  }

  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: "Invalid conversion target." }, { status: 400, headers: { "Cache-Control": "no-store" } })
  }

  try {
    const submission = await markOutlookFormSubmissionConverted(submissionId, { uid: admin.uid, name: admin.email }, parsed.data)
    if (!submission) return Response.json({ error: "Submission not found." }, { status: 404, headers: { "Cache-Control": "no-store" } })
    return Response.json({ submission }, { headers: { "Cache-Control": "no-store" } })
  } catch {
    return Response.json({ error: "Unable to record this conversion." }, { status: 500, headers: { "Cache-Control": "no-store" } })
  }
}
