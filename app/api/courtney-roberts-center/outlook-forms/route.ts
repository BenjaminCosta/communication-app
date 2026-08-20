import { requireCourtneyRobertsCenterAdmin, toCourtneyRobertsCenterAccessErrorResponse } from "@/lib/courtney-roberts-center/access"
import { listOutlookFormSubmissions } from "@/lib/outlook-form-submissions/store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/courtney-roberts-center/outlook-forms
 * Auth: Bearer <approved admin's Firebase ID token>
 * Query: ?limit=&cursor=
 * Lists 3-Week Outlook form submissions, most recently submitted first.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    await requireCourtneyRobertsCenterAdmin(request)
  } catch (error) {
    return toCourtneyRobertsCenterAccessErrorResponse(error)
  }

  const { searchParams } = new URL(request.url)
  const limit = Number(searchParams.get("limit"))
  const cursor = searchParams.get("cursor") ?? undefined

  try {
    const result = await listOutlookFormSubmissions({
      ...(Number.isFinite(limit) && limit > 0 ? { limit } : {}),
      ...(cursor ? { cursor } : {}),
    })
    return Response.json(result, { headers: { "Cache-Control": "no-store" } })
  } catch {
    return Response.json({ error: "Unable to load outlook form submissions." }, { status: 500, headers: { "Cache-Control": "no-store" } })
  }
}
