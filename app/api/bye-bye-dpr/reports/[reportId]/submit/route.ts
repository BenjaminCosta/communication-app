import { ByeByeDprError, submitReport, verifyByeByeDprUserRequest } from "@/lib/bye-bye-dpr-server"
import { submitReportRequestSchema } from "@/features/bye-bye-dpr/contracts/report-contract"
import { toByeByeDprErrorResponse } from "@/lib/bye-bye-dpr-route-helpers"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteParams = { params: Promise<{ reportId: string }> }

/**
 * POST /api/bye-bye-dpr/reports/:reportId/submit
 * Auth: Bearer <report author Firebase ID token>
 * Body: { idempotencyKey }
 * Generates the PDF, uploads it to Storage, and automatically posts the
 * submission to Communications. Idempotent: resubmitting an already-
 * submitted report is a safe no-op; retried PDF generation / Comms posting
 * never duplicates either.
 */
export async function POST(request: Request, { params }: RouteParams): Promise<Response> {
  try {
    const { reportId } = await params
    const principal = await verifyByeByeDprUserRequest(request)
    let body: unknown
    try {
      body = await request.json()
    } catch {
      throw new ByeByeDprError("invalid-request", "Invalid request body.", 400)
    }
    const parsed = submitReportRequestSchema.safeParse(body)
    if (!parsed.success) throw new ByeByeDprError("invalid-request", "A valid retry key is required.", 400)

    const report = await submitReport(principal, reportId, parsed.data)
    return Response.json({ report }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    return toByeByeDprErrorResponse(error)
  }
}
