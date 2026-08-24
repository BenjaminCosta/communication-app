import {
  DirectoryAdminError,
  requireDirectoryAdmin,
  toDirectoryAdminErrorResponse,
} from "@/lib/directory-admin-guard"
import {
  DirectoryServerWriteError,
  mergeDirectoryContacts,
} from "@/lib/directory-server-writes"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/directory/merge
 * Auth: Bearer <Firebase ID token>, caller must have /users/{uid}.isAdmin === true
 * Body: { survivorContactId: string, duplicateContactId: string }
 *
 * People only in V1. See lib/directory-server-writes.ts for what gets
 * re-pointed (job/company membership, relations, notes/files, message tags)
 * before the duplicate is deleted.
 */
export async function POST(request: Request): Promise<Response> {
  let body: { survivorContactId?: unknown; duplicateContactId?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 })
  }

  const survivorContactId = typeof body.survivorContactId === "string" ? body.survivorContactId.trim() : ""
  const duplicateContactId = typeof body.duplicateContactId === "string" ? body.duplicateContactId.trim() : ""
  if (!survivorContactId || !duplicateContactId) {
    return Response.json({ error: "survivorContactId and duplicateContactId are required." }, { status: 400 })
  }

  try {
    await requireDirectoryAdmin(request)
    const result = await mergeDirectoryContacts(survivorContactId, duplicateContactId)
    return Response.json(result)
  } catch (error) {
    if (error instanceof DirectoryAdminError) return toDirectoryAdminErrorResponse(error)
    if (error instanceof DirectoryServerWriteError) {
      return Response.json({ error: error.message }, { status: error.status })
    }
    return Response.json({ error: "We couldn't complete this merge. Try again." }, { status: 500 })
  }
}
