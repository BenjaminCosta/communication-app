import { outlookFormSubmitSchema } from "@/lib/outlook-form-submissions/schema"
import { createOutlookFormSubmission } from "@/lib/outlook-form-submissions/store"
import { checkAndRecordOutlookFormSubmission } from "@/lib/outlook-form-submissions/rate-limit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")
  return forwarded?.split(",")[0]?.trim() || "unknown"
}

/**
 * POST /api/outlook-form/submit
 * Public, no auth by design — the whole point is a super can submit without
 * WhatsApp or logging in. Kept in its own namespace (app/api/outlook-form/,
 * separate from both app/api/outlooks/ and app/api/courtney-roberts-center/)
 * so this is the one route in the feature that's trivially greppable as the
 * unauthenticated write surface.
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: "Invalid submission." }, { status: 400, headers: { "Cache-Control": "no-store" } })
  }

  const parsed = outlookFormSubmitSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: "Please check the form and try again." }, { status: 400, headers: { "Cache-Control": "no-store" } })
  }

  if (parsed.data.website) {
    return Response.json({ error: "Invalid submission." }, { status: 400, headers: { "Cache-Control": "no-store" } })
  }

  const allowed = await checkAndRecordOutlookFormSubmission(clientIp(request))
  if (!allowed) {
    return Response.json({ error: "Too many submissions. Please try again later." }, { status: 429, headers: { "Cache-Control": "no-store" } })
  }

  try {
    const { id } = await createOutlookFormSubmission(parsed.data)
    return Response.json({ submissionId: id }, { headers: { "Cache-Control": "no-store" } })
  } catch {
    return Response.json({ error: "Unable to submit this form right now." }, { status: 500, headers: { "Cache-Control": "no-store" } })
  }
}
