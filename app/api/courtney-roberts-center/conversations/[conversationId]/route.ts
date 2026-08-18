import { requireCourtneyRobertsCenterAdmin, toCourtneyRobertsCenterAccessErrorResponse } from "@/lib/courtney-roberts-center/access"
import { getCourtneyRobertsCenterConversationThread } from "@/lib/courtney-roberts-center/read-api"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteParams = { params: Promise<{ conversationId: string }> }

/**
 * GET /api/courtney-roberts-center/conversations/:conversationId
 * Auth: Bearer <approved admin's Firebase ID token>
 * Query: ?limit=&cursor=
 * Opens one full thread, oldest message first — the shape a WhatsApp-style
 * screen renders directly. No UI consumes this yet.
 */
export async function GET(request: Request, { params }: RouteParams): Promise<Response> {
  try {
    await requireCourtneyRobertsCenterAdmin(request)
  } catch (error) {
    return toCourtneyRobertsCenterAccessErrorResponse(error)
  }

  const { conversationId } = await params
  const { searchParams } = new URL(request.url)
  const limit = Number(searchParams.get("limit"))
  const cursor = searchParams.get("cursor") ?? undefined

  try {
    const result = await getCourtneyRobertsCenterConversationThread(conversationId, {
      ...(Number.isFinite(limit) && limit > 0 ? { limit } : {}),
      ...(cursor ? { cursor } : {}),
    })
    if (!result) return Response.json({ error: "Conversation not found." }, { status: 404, headers: { "Cache-Control": "no-store" } })
    return Response.json(result, { headers: { "Cache-Control": "no-store" } })
  } catch {
    return Response.json({ error: "Unable to load the conversation." }, { status: 500, headers: { "Cache-Control": "no-store" } })
  }
}
