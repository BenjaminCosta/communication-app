import { requireDirectoryAdmin, toDirectoryAdminErrorResponse } from "@/lib/directory-admin-guard"
import { listDirectoryAdminAccessUsers } from "@/lib/directory-admin-management"
import { listFlaggedDirectoryEntities } from "@/lib/directory-review-queue"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/directory/access
 * Auth: Bearer <a current Directory admin's Firebase ID token>
 * Returns { users, flagged } together — the admin roster and the
 * flagged-for-review queue, the two lists directory-access-screen.tsx always
 * needs at once. These used to be two separate routes (GET
 * /api/directory/admins + GET /api/directory/flagged), each independently
 * calling requireDirectoryAdmin() — re-verifying the same caller's ID token
 * and re-reading the same /users/{uid} doc twice, in parallel, on every
 * single screen open, since each route.ts is its own serverless function
 * with nothing shared between them. One route, one auth check.
 * GET /api/directory/flagged stays on its own for directory-screen.tsx's
 * topbar badge count, which only ever needs the flagged list.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    await requireDirectoryAdmin(request)
  } catch (error) {
    return toDirectoryAdminErrorResponse(error)
  }

  try {
    const [users, flagged] = await Promise.all([listDirectoryAdminAccessUsers(), listFlaggedDirectoryEntities()])
    return Response.json({ users, flagged }, { headers: { "Cache-Control": "no-store" } })
  } catch {
    return Response.json({ error: "Unable to load Directory access data." }, { status: 500, headers: { "Cache-Control": "no-store" } })
  }
}
