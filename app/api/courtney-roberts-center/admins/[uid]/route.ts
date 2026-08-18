import { requireCourtneyRobertsCenterAdmin, toCourtneyRobertsCenterAccessErrorResponse } from "@/lib/courtney-roberts-center/access"
import { CourtneyRobertsCenterAdminManagementError, setCourtneyRobertsCenterAccess } from "@/lib/courtney-roberts-center/admin-management"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteParams = { params: Promise<{ uid: string }> }

/**
 * PATCH /api/courtney-roberts-center/admins/:uid
 * Auth: Bearer <a current Courtney Roberts Center admin's Firebase ID token>
 * Body: { "hasAccess": boolean }
 * Grants or revokes access for another user. Any current admin can call
 * this for any user, including themselves — see admin-management.ts's own
 * doc comment for why this stays a single flag rather than a tiered model.
 */
export async function PATCH(request: Request, { params }: RouteParams): Promise<Response> {
  try {
    await requireCourtneyRobertsCenterAdmin(request)
  } catch (error) {
    return toCourtneyRobertsCenterAccessErrorResponse(error)
  }

  const { uid } = await params
  let hasAccess: unknown
  try {
    hasAccess = ((await request.json()) as { hasAccess?: unknown }).hasAccess
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400, headers: { "Cache-Control": "no-store" } })
  }
  if (typeof hasAccess !== "boolean") {
    return Response.json({ error: "hasAccess must be a boolean." }, { status: 400, headers: { "Cache-Control": "no-store" } })
  }

  try {
    const user = await setCourtneyRobertsCenterAccess(uid, hasAccess)
    return Response.json({ user }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    if (error instanceof CourtneyRobertsCenterAdminManagementError) {
      return Response.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } })
    }
    return Response.json({ error: "Unable to update access." }, { status: 500, headers: { "Cache-Control": "no-store" } })
  }
}
