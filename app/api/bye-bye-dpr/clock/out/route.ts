import { ByeByeDprError, clockOut, verifyByeByeDprUserRequest } from "@/lib/bye-bye-dpr-server"
import { clockOutRequestSchema } from "@/features/bye-bye-dpr/contracts/clock-contract"
import { toByeByeDprErrorResponse } from "@/lib/bye-bye-dpr-route-helpers"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/bye-bye-dpr/clock/out
 * Auth: Bearer <Firebase ID token>
 * Body: { clockRecordId, location?, idempotencyKey }
 * Closes the caller's own active clock record; automatically posts a
 * Communications activity message.
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
    const parsed = clockOutRequestSchema.safeParse(body)
    if (!parsed.success) throw new ByeByeDprError("invalid-request", "Check the clock-out details and try again.", 400)

    const clockRecord = await clockOut(principal, parsed.data)
    return Response.json({ clockRecord }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    return toByeByeDprErrorResponse(error)
  }
}
