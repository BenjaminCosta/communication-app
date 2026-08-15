import {
  ApplicationSessionError,
  submitCandidateApplication,
  verifyCandidateRequest,
} from "@/lib/applications-server"

// The submit creates a PDF and writes the Comms announcement through Admin
// SDK, so it must never run in an Edge runtime.
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/applications/submit
 * Auth: Bearer <candidate ID token> carrying the scoped application and link
 * digest. The request body is deliberately empty: all candidate data comes
 * from the just-saved Firestore draft, never from an untrusted submit payload.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const principal = await verifyCandidateRequest(request)
    const result = await submitCandidateApplication(principal)
    return Response.json(result)
  } catch (error) {
    if (error instanceof ApplicationSessionError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.httpStatus })
    }
    return Response.json(
      { error: "We couldn't submit this application right now.", code: "application-submit-failed" },
      { status: 500 },
    )
  }
}
