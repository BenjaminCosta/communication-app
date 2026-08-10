import { AiError, isAiError } from "@/lib/ai/errors"
import {
  acquireByeByeDprAiRequest,
  completeByeByeDprAiRequest,
  failByeByeDprAiRequest,
  type AcquiredByeByeDprAiRequest,
} from "@/lib/ai/server/bye-bye-dpr-request-guard"
import { hashOutlookAiRequest, readOutlookAiIdempotencyKey } from "@/lib/ai/server/request-guard"
import { logByeByeDprAi, safeIdentifier } from "@/lib/ai/server/safe-log"
import { structureReportDraft, verifyByeByeDprUserRequest } from "@/lib/bye-bye-dpr-server"
import { structureReportDraftRequestSchema } from "@/features/bye-bye-dpr/contracts/report-contract"
import { toByeByeDprErrorResponse } from "@/lib/bye-bye-dpr-route-helpers"

// firebase-admin + provider calls need the Node runtime, not Edge.
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteParams = { params: Promise<{ reportId: string }> }

/**
 * POST /api/bye-bye-dpr/reports/:reportId/structure
 * Auth: Bearer <report author Firebase ID token>
 * Body: { text, source: "voice" | "typed" }
 * Turns free text (typed or transcribed) into the 5 structured daily-report
 * fields, persisted as the current draft.
 */
export async function POST(request: Request, { params }: RouteParams): Promise<Response> {
  const startedAt = Date.now()
  let uid: string | null = null
  let requestId = "unassigned"
  let acquired: AcquiredByeByeDprAiRequest | null = null
  let providerSucceeded = false
  try {
    const { reportId } = await params
    const principal = await verifyByeByeDprUserRequest(request)
    uid = principal.uid
    requestId = readOutlookAiIdempotencyKey(request)

    const contentType = request.headers.get("content-type") ?? ""
    if (!contentType.toLowerCase().startsWith("application/json")) {
      throw new AiError("invalid-request", "Please send the report text.")
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      throw new AiError("invalid-request", "The report text could not be read.")
    }

    const parsed = structureReportDraftRequestSchema.safeParse(body)
    if (!parsed.success) throw new AiError("invalid-request", "Check the report text and try again.")

    const requestHash = hashOutlookAiRequest(JSON.stringify(parsed.data))
    acquired = await acquireByeByeDprAiRequest({
      uid: principal.uid,
      operation: "generation",
      requestHash,
      idempotencyKey: requestId,
    })
    logByeByeDprAi({
      event: "accepted",
      operation: "generation",
      requestId,
      userHash: acquired.userHash,
      textChars: parsed.data.text.length,
    })

    const result = await structureReportDraft(principal, reportId, parsed.data)
    providerSucceeded = true
    await completeByeByeDprAiRequest(principal.uid, acquired)
    logByeByeDprAi({
      event: "succeeded",
      operation: "generation",
      requestId,
      userHash: safeIdentifier(principal.uid),
      latencyMs: Date.now() - startedAt,
      textChars: parsed.data.text.length,
    })
    return Response.json(result, { headers: responseHeaders(requestId, acquired.lease.remaining) })
  } catch (error) {
    if (uid && acquired && !providerSucceeded) {
      try {
        await failByeByeDprAiRequest(uid, acquired)
      } catch {
        // Keep the short lease until expiry if Firestore cannot release it.
      }
    }
    logByeByeDprAi({
      event: acquired ? "failed" : "rejected",
      operation: "generation",
      requestId,
      ...(uid ? { userHash: safeIdentifier(uid) } : {}),
      errorCode: isAiError(error) ? error.code : "unexpected",
      latencyMs: Date.now() - startedAt,
    })
    return toByeByeDprErrorResponse(error)
  }
}

function responseHeaders(requestId: string, remaining?: number): Headers {
  const headers = new Headers({ "Cache-Control": "no-store", "X-Request-Id": requestId })
  if (remaining != null) headers.set("X-RateLimit-Remaining", String(remaining))
  return headers
}
