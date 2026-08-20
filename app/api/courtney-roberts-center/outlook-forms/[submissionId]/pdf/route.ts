import { requireCourtneyRobertsCenterAdmin, toCourtneyRobertsCenterAccessErrorResponse } from "@/lib/courtney-roberts-center/access"
import { getOutlookFormSubmission } from "@/lib/outlook-form-submissions/store"
import { createOutlookFormSubmissionPdf } from "@/lib/outlook-form-submissions/pdf"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteParams = { params: Promise<{ submissionId: string }> }

function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "outlook-form"
}

/**
 * GET /api/courtney-roberts-center/outlook-forms/:submissionId/pdf
 * Auth: Bearer <approved admin's Firebase ID token>
 * Generates the PDF on demand — never stored, just a convenience export (the
 * Firestore doc stays the source of truth).
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

    const bytes = await createOutlookFormSubmissionPdf({
      generatedAtIso: new Date().toISOString(),
      jobName: submission.jobName,
      submittedByName: submission.submittedByName,
      submittedByPhone: submission.submittedByPhone,
      submittedByCompany: submission.submittedByCompany,
      submittedByRole: submission.submittedByRole,
      submittedAtIso: new Date(submission.submittedAtMs).toISOString(),
      window: submission.window,
      tasks: submission.tasks.map((task) => ({
        title: task.title,
        trade: task.trade,
        companyName: task.companyName,
        startDate: task.startDate,
        durationDays: task.durationDays,
        description: task.description,
      })),
      generalNotes: submission.generalNotes,
      status: submission.status,
    })

    const fileName = `${slugify(submission.jobName)}-3-week-outlook-${submission.window.start || "form"}.pdf`
    return new Response(Buffer.from(bytes), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="${fileName}"`,
        "cache-control": "private, no-store, max-age=0",
      },
    })
  } catch {
    return Response.json({ error: "Unable to generate this PDF." }, { status: 500, headers: { "Cache-Control": "no-store" } })
  }
}
