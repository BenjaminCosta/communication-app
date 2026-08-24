import { requireCourtneyRobertsCenterAdmin, toCourtneyRobertsCenterAccessErrorResponse } from "@/lib/courtney-roberts-center/access"
import { CourtneyRobertsCenterManualReplyError, sendCourtneyRobertsCenterManualReply } from "@/lib/courtney-roberts-center/manual-reply"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/courtney-roberts-center/conversations/{conversationId}/reply
 * Auth: Bearer <a current Courtney Roberts Center admin's Firebase ID token>
 * Body: { "text": "...", "clientMessageId": "..." }
 *
 * Sends one plain-text WhatsApp message as Courtney Roberts and pauses the
 * AI for this conversation (see manual-reply.ts). `clientMessageId` should
 * be a fresh random value per send — reusing it makes a retry idempotent
 * instead of a second WhatsApp message.
 */
export async function POST(request: Request, context: { params: Promise<{ conversationId: string }> }): Promise<Response> {
  let admin
  try {
    admin = await requireCourtneyRobertsCenterAdmin(request)
  } catch (error) {
    return toCourtneyRobertsCenterAccessErrorResponse(error)
  }

  const { conversationId } = await context.params
  let body: { text?: unknown; clientMessageId?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400, headers: { "Cache-Control": "no-store" } })
  }

  try {
    const message = await sendCourtneyRobertsCenterManualReply({
      conversationId,
      text: typeof body.text === "string" ? body.text : "",
      clientMessageId: typeof body.clientMessageId === "string" ? body.clientMessageId : "",
      sentByName: admin.name || admin.email,
    })
    return Response.json({ message }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    if (error instanceof CourtneyRobertsCenterManualReplyError) {
      return Response.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } })
    }
    console.error("Unable to send a Courtney Roberts Center manual reply.")
    return Response.json({ error: "Unable to send this message." }, { status: 500, headers: { "Cache-Control": "no-store" } })
  }
}
