import { ByeByeDprError, verifyByeByeDprUserRequest } from "@/lib/bye-bye-dpr-server"
import { OutlookCommsError, publishOutlookVersionToComms } from "@/lib/outlook-comms-server"
import { toByeByeDprErrorResponse } from "@/lib/bye-bye-dpr-route-helpers"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function readRequest(body: unknown): { jobContextId: string; windowStart: string; versionId: string } {
  if (!body || typeof body !== "object") throw new OutlookCommsError("invalid-request", "Invalid request body.")
  const data = body as Record<string, unknown>
  const value = (key: string) => typeof data[key] === "string" ? data[key].trim() : ""
  const jobContextId = value("jobContextId")
  const windowStart = value("windowStart")
  const versionId = value("versionId")
  if (!jobContextId || !windowStart || !versionId || jobContextId.length > 180 || windowStart.length > 180 || versionId.length > 180) {
    throw new OutlookCommsError("invalid-request", "Check the Outlook details and try again.")
  }
  return { jobContextId, windowStart, versionId }
}

/** POST /api/outlooks/publish-comms — creates the deterministic PDF card for one Outlook version. */
export async function POST(request: Request): Promise<Response> {
  try {
    const principal = await verifyByeByeDprUserRequest(request)
    let body: unknown
    try {
      body = await request.json()
    } catch {
      throw new OutlookCommsError("invalid-request", "Invalid request body.")
    }
    const input = readRequest(body)
    const result = await publishOutlookVersionToComms({ authorUid: principal.uid, ...input })
    return Response.json(result, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    if (error instanceof OutlookCommsError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.httpStatus })
    }
    if (error instanceof ByeByeDprError) return toByeByeDprErrorResponse(error)
    return Response.json({ error: "Could not publish the Outlook to Communications.", code: "internal" }, { status: 500 })
  }
}
