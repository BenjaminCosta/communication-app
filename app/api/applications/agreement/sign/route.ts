import { signAgreement, verifyCandidateRequest, ApplicationSessionError } from "@/lib/applications-server"

// firebase-admin + pdf-lib need the Node runtime.
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/applications/agreement/sign
 * Auth: Bearer <candidate ID token> (carries the applicationId claim).
 * Body: { signatureDataUrl, typedName, consent }
 *
 * Seals the agreement PDF and flips the status server-side. The candidate can
 * never write `agreement.status` directly — the rules forbid it — so signing
 * has to go through here.
 */
export async function POST(request: Request): Promise<Response> {
  let principal
  try {
    principal = await verifyCandidateRequest(request)
  } catch (error) {
    if (error instanceof ApplicationSessionError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.httpStatus })
    }
    return Response.json({ error: "Please reopen the link.", code: "unauthenticated" }, { status: 401 })
  }

  let body: { signatureDataUrl?: unknown; typedName?: unknown; consent?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return Response.json({ error: "Invalid request.", code: "invalid-request" }, { status: 400 })
  }

  try {
    const result = await signAgreement({
      applicationId: principal.applicationId,
      linkHash: principal.linkHash,
      signatureDataUrl: typeof body.signatureDataUrl === "string" ? body.signatureDataUrl : "",
      typedName: typeof body.typedName === "string" ? body.typedName : "",
      consent: body.consent === true,
    })
    return Response.json(result)
  } catch (error) {
    if (error instanceof ApplicationSessionError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.httpStatus })
    }
    return Response.json(
      { error: "We couldn't record your signature right now.", code: "sign-failed" },
      { status: 500 },
    )
  }
}
