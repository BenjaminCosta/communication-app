import { requireCourtneyRobertsCenterAdmin, toCourtneyRobertsCenterAccessErrorResponse } from "@/lib/courtney-roberts-center/access"
import { listCourtneyRobertsCenterConversations } from "@/lib/courtney-roberts-center/read-api"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/courtney-roberts-center/conversations
 * Auth: Bearer <approved admin's Firebase ID token>
 * Query: ?limit=&cursor=
 * Lists durable WhatsApp conversation threads, most recently active first.
 * No UI consumes this yet — this is the read surface a future admin screen
 * will call.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    await requireCourtneyRobertsCenterAdmin(request)
  } catch (error) {
    return toCourtneyRobertsCenterAccessErrorResponse(error)
  }

  const { searchParams } = new URL(request.url)
  const limit = Number(searchParams.get("limit"))
  const cursor = searchParams.get("cursor") ?? undefined

  try {
    const result = await listCourtneyRobertsCenterConversations({
      ...(Number.isFinite(limit) && limit > 0 ? { limit } : {}),
      ...(cursor ? { cursor } : {}),
    })
    return Response.json(result, { headers: { "Cache-Control": "no-store" } })
  } catch {
    return Response.json({ error: "Unable to load conversations." }, { status: 500, headers: { "Cache-Control": "no-store" } })
  }
}
