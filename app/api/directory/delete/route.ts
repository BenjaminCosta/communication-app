import {
  DirectoryAdminError,
  requireDirectoryAdmin,
  toDirectoryAdminErrorResponse,
} from "@/lib/directory-admin-guard"
import {
  computeDirectoryDeleteImpact,
  deleteDirectoryEntity,
  DirectoryServerWriteError,
} from "@/lib/directory-server-writes"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/directory/delete
 * Auth: Bearer <Firebase ID token>, caller must have /users/{uid}.isAdmin === true
 * Body: { directoryId: string, dryRun?: boolean }
 *
 * dryRun: true returns the reference-count preview only (for the confirm UI);
 * omitted/false performs the delete after computing the same counts.
 */
export async function POST(request: Request): Promise<Response> {
  let body: { directoryId?: unknown; dryRun?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 })
  }

  const directoryId = typeof body.directoryId === "string" ? body.directoryId.trim() : ""
  if (!directoryId) {
    return Response.json({ error: "directoryId is required." }, { status: 400 })
  }

  try {
    await requireDirectoryAdmin(request)
    const impact = body.dryRun === true
      ? await computeDirectoryDeleteImpact(directoryId)
      : await deleteDirectoryEntity(directoryId)
    return Response.json({ ok: true, impact })
  } catch (error) {
    if (error instanceof DirectoryAdminError) return toDirectoryAdminErrorResponse(error)
    if (error instanceof DirectoryServerWriteError) {
      return Response.json({ error: error.message }, { status: error.status })
    }
    return Response.json({ error: "We couldn't complete this delete. Try again." }, { status: 500 })
  }
}
