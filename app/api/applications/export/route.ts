import {
  ApplicationSessionError,
  exportApplicationProfilePdf,
  verifyStaffRequest,
} from "@/lib/applications-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/applications/export
 *
 * Generates a one-time, reviewer-authorized PDF response. The candidate's
 * original uploads never become public URLs in the exported document.
 */
export async function POST(request: Request): Promise<Response> {
  let body: { applicationId?: unknown; reviewerName?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return Response.json({ error: "Invalid request.", code: "invalid-request" }, { status: 400 })
  }

  try {
    const reviewer = await verifyStaffRequest(request, typeof body.reviewerName === "string" ? body.reviewerName : "")
    const { bytes, fileName } = await exportApplicationProfilePdf(
      typeof body.applicationId === "string" ? body.applicationId : "",
      reviewer,
    )
    return new Response(Buffer.from(bytes), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${fileName}"`,
        "cache-control": "private, no-store, max-age=0",
      },
    })
  } catch (error) {
    if (error instanceof ApplicationSessionError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.httpStatus })
    }
    return Response.json(
      { error: "We couldn't prepare this application PDF right now.", code: "application-export-failed" },
      { status: 500 },
    )
  }
}
