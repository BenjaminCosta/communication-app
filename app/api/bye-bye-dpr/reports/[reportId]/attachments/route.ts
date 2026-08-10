import { ByeByeDprError, uploadReportAttachment, verifyByeByeDprUserRequest } from "@/lib/bye-bye-dpr-server"
import { toByeByeDprErrorResponse } from "@/lib/bye-bye-dpr-route-helpers"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024 // matches storage.rules

const ACCEPTED_ATTACHMENT_TYPES = [
  /^image\//,
  /^application\/pdf$/,
  /^application\/msword$/,
  /^application\/vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet|presentationml\.presentation)$/,
  /^application\/vnd\.ms-excel$/,
  /^application\/vnd\.ms-powerpoint$/,
]

function isAcceptedAttachmentType(contentType: string): boolean {
  return ACCEPTED_ATTACHMENT_TYPES.some((pattern) => pattern.test(contentType))
}

type RouteParams = { params: Promise<{ reportId: string }> }

/**
 * POST /api/bye-bye-dpr/reports/:reportId/attachments
 * Auth: Bearer <report author Firebase ID token>
 * Body: multipart/form-data with a `file` field (photo or document).
 */
export async function POST(request: Request, { params }: RouteParams): Promise<Response> {
  try {
    const { reportId } = await params
    const principal = await verifyByeByeDprUserRequest(request)

    const contentType = request.headers.get("content-type") ?? ""
    if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
      throw new ByeByeDprError("invalid-request", "Please send a file.", 400)
    }

    let form: FormData
    try {
      form = await request.formData()
    } catch {
      throw new ByeByeDprError("invalid-request", "The file could not be read.", 400)
    }

    const file = form.get("file")
    if (!(file instanceof File)) throw new ByeByeDprError("invalid-request", "A file is required.", 400)
    if (file.size === 0) throw new ByeByeDprError("invalid-request", "The file was empty.", 400)
    if (file.size > MAX_ATTACHMENT_BYTES) throw new ByeByeDprError("payload-too-large", "The file is too large.", 413)
    const mimeType = file.type || "application/octet-stream"
    if (!isAcceptedAttachmentType(mimeType)) {
      throw new ByeByeDprError("invalid-request", "That file type isn't supported.", 400)
    }

    const bytes = new Uint8Array(await file.arrayBuffer())
    const attachment = await uploadReportAttachment(principal, reportId, {
      bytes,
      contentType: mimeType,
      fileName: file.name || "attachment",
    })
    return Response.json({ attachment }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    return toByeByeDprErrorResponse(error)
  }
}
