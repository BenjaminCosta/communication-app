import { requireCourtneyRobertsCenterAdmin, toCourtneyRobertsCenterAccessErrorResponse } from "@/lib/courtney-roberts-center/access"
import { CourtneyRobertsCenterLinkError, linkCourtneyRobertsCenterConversationIdentity } from "@/lib/courtney-roberts-center/link-identity"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/courtney-roberts-center/conversations/{conversationId}/link
 * Auth: Bearer <approved admin's Firebase ID token>
 * Body: { "email": "person@supervisioncompany.com" }
 *
 * Links this conversation's WhatsApp number to the SVC account owning that
 * email — the manual counterpart to the sender-driven claim flow, for the
 * cases self-service cannot fix.
 */
export async function POST(request: Request, context: { params: Promise<{ conversationId: string }> }): Promise<Response> {
  let admin
  try {
    admin = await requireCourtneyRobertsCenterAdmin(request)
  } catch (error) {
    return toCourtneyRobertsCenterAccessErrorResponse(error)
  }

  const { conversationId } = await context.params
  let email: unknown
  try {
    email = ((await request.json()) as { email?: unknown }).email
  } catch {
    return Response.json({ error: "Enter a single valid SVC email address." }, { status: 400, headers: { "Cache-Control": "no-store" } })
  }

  try {
    const result = await linkCourtneyRobertsCenterConversationIdentity({
      conversationId,
      email: typeof email === "string" ? email : "",
      linkedByEmail: admin.email,
    })
    return Response.json(result, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    if (error instanceof CourtneyRobertsCenterLinkError) {
      return Response.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } })
    }
    console.error("Unable to link a Courtney Roberts Center conversation identity.")
    return Response.json({ error: "Unable to link this conversation." }, { status: 500, headers: { "Cache-Control": "no-store" } })
  }
}
