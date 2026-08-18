import { requireCourtneyRobertsCenterAdmin, toCourtneyRobertsCenterAccessErrorResponse } from "@/lib/courtney-roberts-center/access"
import { CourtneyRobertsCenterManualReplyError, resumeCourtneyRobertsCenterAiForConversation } from "@/lib/courtney-roberts-center/manual-reply"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/courtney-roberts-center/conversations/{conversationId}/resume
 * Auth: Bearer <a current Courtney Roberts Center admin's Firebase ID token>
 * Clears the human takeover — the webhook goes back to generating automatic
 * AI replies for this conversation.
 */
export async function POST(request: Request, context: { params: Promise<{ conversationId: string }> }): Promise<Response> {
  try {
    await requireCourtneyRobertsCenterAdmin(request)
  } catch (error) {
    return toCourtneyRobertsCenterAccessErrorResponse(error)
  }

  const { conversationId } = await context.params
  try {
    await resumeCourtneyRobertsCenterAiForConversation(conversationId)
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    if (error instanceof CourtneyRobertsCenterManualReplyError) {
      return Response.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } })
    }
    console.error("Unable to resume Courtney Roberts Center AI for a conversation.")
    return Response.json({ error: "Unable to resume AI for this conversation." }, { status: 500, headers: { "Cache-Control": "no-store" } })
  }
}
