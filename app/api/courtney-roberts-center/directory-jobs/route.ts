import { z } from "zod"
import { requireCourtneyRobertsCenterAdmin, toCourtneyRobertsCenterAccessErrorResponse } from "@/lib/courtney-roberts-center/access"
import { createDirectoryJobContext, searchDirectoryJobs } from "@/lib/bye-bye-dpr-directory-link"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/courtney-roberts-center/directory-jobs?q=<query>
 * Auth: Bearer <approved admin's Firebase ID token>
 *
 * Thin CRC-gated wrapper around the existing (server-only, Admin SDK)
 * searchDirectoryJobs() — lets an admin resolve an outlook form submission's
 * job to a real Directory context when the super picked "Other / not
 * listed" or the linked ByeByeDPR job has no directoryContextId. Generic,
 * not submission-scoped, so it can be reused anywhere CRC needs to resolve
 * a Directory job.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    await requireCourtneyRobertsCenterAdmin(request)
  } catch (error) {
    return toCourtneyRobertsCenterAccessErrorResponse(error)
  }

  const { searchParams } = new URL(request.url)
  const q = (searchParams.get("q") ?? "").trim()

  try {
    const results = await searchDirectoryJobs(q)
    return Response.json({ results }, { headers: { "Cache-Control": "no-store" } })
  } catch {
    return Response.json({ error: "Unable to search Directory jobs." }, { status: 500, headers: { "Cache-Control": "no-store" } })
  }
}

const createSchema = z.object({ name: z.string().trim().min(1).max(160) })

/**
 * POST /api/courtney-roberts-center/directory-jobs { name }
 * Auth: Bearer <approved admin's Firebase ID token>
 * Creates a brand-new Directory job context when a search finds nothing —
 * wraps the existing createDirectoryJobContext(), same as ByeByeDPR's own
 * worker-facing job picker does.
 */
export async function POST(request: Request): Promise<Response> {
  let admin
  try {
    admin = await requireCourtneyRobertsCenterAdmin(request)
  } catch (error) {
    return toCourtneyRobertsCenterAccessErrorResponse(error)
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400, headers: { "Cache-Control": "no-store" } })
  }
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: "A job name is required." }, { status: 400, headers: { "Cache-Control": "no-store" } })
  }

  try {
    const directoryContextId = await createDirectoryJobContext(parsed.data.name, admin.uid)
    return Response.json({ directoryContextId, name: parsed.data.name }, { headers: { "Cache-Control": "no-store" } })
  } catch {
    return Response.json({ error: "Unable to create this job." }, { status: 500, headers: { "Cache-Control": "no-store" } })
  }
}
