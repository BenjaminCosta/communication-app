import { ByeByeDprError, correctClockOut, verifyByeByeDprUserRequest } from "@/lib/bye-bye-dpr-server"
import { correctClockOutRequestSchema } from "@/features/bye-bye-dpr/contracts/clock-contract"
import { toByeByeDprErrorResponse } from "@/lib/bye-bye-dpr-route-helpers"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/bye-bye-dpr/clock/correct
 * Auth: Bearer <Firebase ID token>
 * Body: { clockRecordId, correctedClockOutAt (ISO datetime) }
 * "Forgot to clock out": lets the user fix their own clock-out time with no
 * supervisor approval, but always stamps audit metadata.
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
    const parsed = correctClockOutRequestSchema.safeParse(body)
    if (!parsed.success) throw new ByeByeDprError("invalid-request", "Check the corrected time and try again.", 400)

    const correctedClockOutAt = new Date(parsed.data.correctedClockOutAt)
    if (Number.isNaN(correctedClockOutAt.getTime())) {
      throw new ByeByeDprError("invalid-request", "Check the corrected time and try again.", 400)
    }

    const clockRecord = await correctClockOut(principal, { clockRecordId: parsed.data.clockRecordId, correctedClockOutAt })
    return Response.json({ clockRecord }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    return toByeByeDprErrorResponse(error)
  }
}
