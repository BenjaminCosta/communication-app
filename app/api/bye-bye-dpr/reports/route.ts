import { ByeByeDprError, createReportDraft, verifyByeByeDprUserRequest } from "@/lib/bye-bye-dpr-server"
import { createReportDraftRequestSchema } from "@/features/bye-bye-dpr/contracts/report-contract"
import { toByeByeDprErrorResponse } from "@/lib/bye-bye-dpr-route-helpers"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/bye-bye-dpr/reports
 * Auth: Bearer <Firebase ID token>
 * Body: { jobId }
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const principal = await verifyByeByeDprUserRequest(request)
    let body: unknown
    try {
      body = await request.json()
    } catch {
      throw new ByeByeDprError("invalid-request", "Invalid request body.", 400)
    }
    const parsed = createReportDraftRequestSchema.safeParse(body)
    if (!parsed.success) throw new ByeByeDprError("invalid-request", "Check the report details and try again.", 400)

    const report = await createReportDraft(principal, parsed.data)
    return Response.json({ report }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    return toByeByeDprErrorResponse(error)
  }
}
