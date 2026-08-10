import { ByeByeDprError, createJob, listJobs, verifyByeByeDprUserRequest } from "@/lib/bye-bye-dpr-server"
import { createJobRequestSchema } from "@/features/bye-bye-dpr/contracts/job-contract"
import { toByeByeDprErrorResponse } from "@/lib/bye-bye-dpr-route-helpers"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/bye-bye-dpr/jobs?activeOnly=false
 * Auth: Bearer <Firebase ID token>
 * Lists every job — flat, single-org model, no company scoping.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    await verifyByeByeDprUserRequest(request)
    const url = new URL(request.url)
    const activeOnly = url.searchParams.get("activeOnly") !== "false"
    const jobs = await listJobs({ activeOnly })
    return Response.json({ jobs }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    return toByeByeDprErrorResponse(error)
  }
}

/**
 * POST /api/bye-bye-dpr/jobs
 * Auth: Bearer <Firebase ID token>
 * Body: { name, address?, latitude?, longitude?, directoryContextId?, notifyUserIds? }
 * Not part of the module's own listed service functions, but required so
 * the `jobs` collection has something to populate it. Any signed-in user
 * can add a job — no roles in the flat model.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const principal = await verifyByeByeDprUserRequest(request)
    let body: unknown
    try {
      body = await request.json()
    } catch {
      throw new ByeByeDprError("invalid-request", "Invalid request body.", 400)
    }
    const parsed = createJobRequestSchema.safeParse(body)
    if (!parsed.success) throw new ByeByeDprError("invalid-request", "Check the job details and try again.", 400)

    const job = await createJob(principal, parsed.data)
    return Response.json({ job }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    return toByeByeDprErrorResponse(error)
  }
}
