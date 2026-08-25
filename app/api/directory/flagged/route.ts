import { requireDirectoryAdmin, toDirectoryAdminErrorResponse } from "@/lib/directory-admin-guard"
import { listFlaggedDirectoryEntities } from "@/lib/directory-review-queue"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/directory/flagged
 * Auth: Bearer <a current Directory admin's Firebase ID token>
 * Lists every person/company/job currently flagged for review. Flagging
 * itself is open to any signed-in user (see lib/directory-writes.ts), but
 * this aggregate moderation-queue view is admin-gated — same guard as
 * merge/delete/admin-access management.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    await requireDirectoryAdmin(request)
  } catch (error) {
    return toDirectoryAdminErrorResponse(error)
  }

  try {
    const entities = await listFlaggedDirectoryEntities()
    return Response.json({ entities }, { headers: { "Cache-Control": "no-store" } })
  } catch {
    return Response.json({ error: "Unable to load flagged records." }, { status: 500, headers: { "Cache-Control": "no-store" } })
  }
}
