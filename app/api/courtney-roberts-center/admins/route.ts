import { requireCourtneyRobertsCenterAdmin, toCourtneyRobertsCenterAccessErrorResponse } from "@/lib/courtney-roberts-center/access"
import { listCourtneyRobertsCenterAccessUsers } from "@/lib/courtney-roberts-center/admin-management"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/courtney-roberts-center/admins
 * Auth: Bearer <a current Courtney Roberts Center admin's Firebase ID token>
 * Lists every registered app user and whether they currently have access,
 * for the manage-access screen.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    await requireCourtneyRobertsCenterAdmin(request)
  } catch (error) {
    return toCourtneyRobertsCenterAccessErrorResponse(error)
  }

  try {
    const users = await listCourtneyRobertsCenterAccessUsers()
    return Response.json({ users }, { headers: { "Cache-Control": "no-store" } })
  } catch {
    return Response.json({ error: "Unable to load users." }, { status: 500, headers: { "Cache-Control": "no-store" } })
  }
}
