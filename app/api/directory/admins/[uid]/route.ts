import { requireDirectoryAdmin, toDirectoryAdminErrorResponse } from "@/lib/directory-admin-guard"
import { DirectoryAdminManagementError, setDirectoryAdminAccess } from "@/lib/directory-admin-management"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteParams = { params: Promise<{ uid: string }> }

/**
 * PATCH /api/directory/admins/:uid
 * Auth: Bearer <a current Directory admin's Firebase ID token>
 * Body: { "hasAccess": boolean }
 * Grants or revokes directoryAdminAccess for another user. Any current
 * Directory admin can call this for any user, including themselves — see
 * lib/directory-admin-management.ts's own doc comment for why this stays a
 * single flag rather than a tiered model (mirrors Courtney Roberts Center).
 */
export async function PATCH(request: Request, { params }: RouteParams): Promise<Response> {
  try {
    await requireDirectoryAdmin(request)
  } catch (error) {
    return toDirectoryAdminErrorResponse(error)
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
    const user = await setDirectoryAdminAccess(uid, hasAccess)
    return Response.json({ user }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    if (error instanceof DirectoryAdminManagementError) {
      return Response.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } })
    }
    return Response.json({ error: "Unable to update access." }, { status: 500, headers: { "Cache-Control": "no-store" } })
  }
}
