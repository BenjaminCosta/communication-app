import { ByeByeDprError, getReport, updateReportDraft, verifyByeByeDprUserRequest } from "@/lib/bye-bye-dpr-server"
import { updateReportDraftRequestSchema } from "@/features/bye-bye-dpr/contracts/report-contract"
import { toByeByeDprErrorResponse } from "@/lib/bye-bye-dpr-route-helpers"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteParams = { params: Promise<{ reportId: string }> }

/**
 * GET /api/bye-bye-dpr/reports/:reportId
 * Auth: Bearer <report author Firebase ID token>
 */
export async function GET(request: Request, { params }: RouteParams): Promise<Response> {
  try {
    const { reportId } = await params
    const principal = await verifyByeByeDprUserRequest(request)
    const report = await getReport(principal, reportId)
    return Response.json({ report }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    return toByeByeDprErrorResponse(error)
  }
}

/**
 * PATCH /api/bye-bye-dpr/reports/:reportId
 * Auth: Bearer <report author Firebase ID token>
 * Body: { rawText?, structuredData?, structuredDataSource? }
 * Draft only — a submitted report is immutable to this endpoint (enforced
 * both here and in firestore.rules).
 */
export async function PATCH(request: Request, { params }: RouteParams): Promise<Response> {
  try {
    const { reportId } = await params
    const principal = await verifyByeByeDprUserRequest(request)
    let body: unknown
    try {
      body = await request.json()
    } catch {
      throw new ByeByeDprError("invalid-request", "Invalid request body.", 400)
    }
    const parsed = updateReportDraftRequestSchema.safeParse(body)
    if (!parsed.success) throw new ByeByeDprError("invalid-request", "Check the report details and try again.", 400)

    const report = await updateReportDraft(principal, reportId, parsed.data)
    return Response.json({ report }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    return toByeByeDprErrorResponse(error)
  }
}
