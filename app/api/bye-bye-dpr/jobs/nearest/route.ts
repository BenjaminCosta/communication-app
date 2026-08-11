import { ByeByeDprError, suggestNearestJob, verifyByeByeDprUserRequest } from "@/lib/bye-bye-dpr-server"
import { nearestJobRequestSchema } from "@/features/bye-bye-dpr/contracts/job-contract"
import { toByeByeDprErrorResponse } from "@/lib/bye-bye-dpr-route-helpers"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/bye-bye-dpr/jobs/nearest
 * Auth: Bearer <Firebase ID token>
 * Body: { location: { lat, lng } }
 * Location is only ever submitted for this one-shot lookup — never tracked
 * continuously. Deterministic distance math only, never AI.
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
    const parsed = nearestJobRequestSchema.safeParse(body)
    if (!parsed.success) throw new ByeByeDprError("invalid-request", "A valid location is required.", 400)

    const match = await suggestNearestJob(principal, parsed.data.location)
    return Response.json({ match }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    return toByeByeDprErrorResponse(error)
  }
}
