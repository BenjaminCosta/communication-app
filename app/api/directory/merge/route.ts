import {
  DirectoryAdminError,
  requireDirectoryAdmin,
  toDirectoryAdminErrorResponse,
} from "@/lib/directory-admin-guard"
import {
  DirectoryServerWriteError,
  mergeDirectoryEntities,
  type DirectoryMergeEntityType,
} from "@/lib/directory-server-writes"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const ENTITY_TYPES: DirectoryMergeEntityType[] = ["person", "company", "job"]

/**
 * POST /api/directory/merge
 * Auth: Bearer <Firebase ID token>, caller must have /users/{uid}.isAdmin === true
 * Body: { entityType: "person" | "company" | "job", survivorId: string, duplicateId: string }
 *
 * See lib/directory-server-writes.ts for what gets re-pointed (job/company
 * membership, company links, relations, notes/files, message tags) before
 * the duplicate is deleted.
 */
export async function POST(request: Request): Promise<Response> {
  let body: { entityType?: unknown; survivorId?: unknown; duplicateId?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 })
  }

  const entityType = typeof body.entityType === "string" ? body.entityType : ""
  const survivorId = typeof body.survivorId === "string" ? body.survivorId.trim() : ""
  const duplicateId = typeof body.duplicateId === "string" ? body.duplicateId.trim() : ""
  if (!ENTITY_TYPES.includes(entityType as DirectoryMergeEntityType)) {
    return Response.json({ error: "entityType must be person, company, or job." }, { status: 400 })
  }
  if (!survivorId || !duplicateId) {
    return Response.json({ error: "survivorId and duplicateId are required." }, { status: 400 })
  }

  try {
    await requireDirectoryAdmin(request)
    const result = await mergeDirectoryEntities(entityType as DirectoryMergeEntityType, survivorId, duplicateId)
    return Response.json(result)
  } catch (error) {
    if (error instanceof DirectoryAdminError) return toDirectoryAdminErrorResponse(error)
    if (error instanceof DirectoryServerWriteError) {
      return Response.json({ error: error.message }, { status: error.status })
    }
    return Response.json({ error: "We couldn't complete this merge. Try again." }, { status: 500 })
  }
}
