import { getActiveClock, verifyByeByeDprUserRequest } from "@/lib/bye-bye-dpr-server"
import { toByeByeDprErrorResponse } from "@/lib/bye-bye-dpr-route-helpers"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/bye-bye-dpr/clock/active
 * Auth: Bearer <Firebase ID token>
 * Returns the caller's active clock record, or null.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const principal = await verifyByeByeDprUserRequest(request)
    const clockRecord = await getActiveClock(principal)
    return Response.json({ clockRecord }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    return toByeByeDprErrorResponse(error)
  }
}
