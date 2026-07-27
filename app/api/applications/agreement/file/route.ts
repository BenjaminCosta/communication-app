import {
  ApplicationSessionError,
  readSignedAgreementPdf,
  verifyStaffRequest,
} from "@/lib/applications-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/applications/agreement/file
 *
 * Resolves the sealed agreement on the server and returns it through the app
 * origin. The dashboard then uses the same response for preview and download,
 * rather than relying on a cross-origin Firebase Storage fetch in the browser.
 */
export async function POST(request: Request): Promise<Response> {
  let body: { applicationId?: unknown; reviewerName?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return Response.json({ error: "Invalid request.", code: "invalid-request" }, { status: 400 })
  }

  try {
    await verifyStaffRequest(request, typeof body.reviewerName === "string" ? body.reviewerName : "")
    const { bytes, fileName, previewPage } = await readSignedAgreementPdf(
      typeof body.applicationId === "string" ? body.applicationId : "",
    )
    return new Response(Buffer.from(bytes), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="${fileName}"`,
        "cache-control": "private, no-store, max-age=0",
        "x-svc-pdf-preview-page": String(previewPage),
      },
    })
  } catch (error) {
    if (error instanceof ApplicationSessionError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.httpStatus })
    }
    return Response.json(
      { error: "We couldn't load the signed agreement right now.", code: "agreement-file-failed" },
      { status: 500 },
    )
  }
}
