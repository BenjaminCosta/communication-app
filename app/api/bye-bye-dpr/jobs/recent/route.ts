import { getRecentJobs, verifyByeByeDprUserRequest } from "@/lib/bye-bye-dpr-server"
import { toByeByeDprErrorResponse } from "@/lib/bye-bye-dpr-route-helpers"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/bye-bye-dpr/jobs/recent
 * Auth: Bearer <Firebase ID token>
 * Up to 5 jobs the caller most recently clocked into, newest first.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const principal = await verifyByeByeDprUserRequest(request)
    const jobs = await getRecentJobs(principal)
    return Response.json({ jobs }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    return toByeByeDprErrorResponse(error)
  }
}
