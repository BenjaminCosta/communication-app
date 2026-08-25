import { requireDirectoryAdmin, toDirectoryAdminErrorResponse } from "@/lib/directory-admin-guard"
import { listDirectoryAdminAccessUsers } from "@/lib/directory-admin-management"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/directory/admins
 * Auth: Bearer <a current Directory admin's Firebase ID token>
 * Lists every registered app user and whether they currently have Directory
 * admin access, for the manage-access screen.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    await requireDirectoryAdmin(request)
  } catch (error) {
    return toDirectoryAdminErrorResponse(error)
  }

  try {
    const users = await listDirectoryAdminAccessUsers()
    return Response.json({ users }, { headers: { "Cache-Control": "no-store" } })
  } catch {
    return Response.json({ error: "Unable to load users." }, { status: 500, headers: { "Cache-Control": "no-store" } })
  }
}
