import { OUTLOOK_AI_LIMITS } from "@/lib/ai/config"
import { AiError } from "@/lib/ai/errors"
import { isAiError } from "@/lib/ai/errors"
import { authenticateOutlookRequest } from "@/lib/ai/server/auth-guard"
import { toOutlookAiErrorResponse } from "@/lib/ai/server/route-helpers"
import {
  acquireOutlookAiRequest,
  completeOutlookAiRequest,
  failOutlookAiRequest,
  hashOutlookAiRequest,
  readOutlookAiIdempotencyKey,
  type AcquiredOutlookAiRequest,
} from "@/lib/ai/server/request-guard"
import { logOutlookAi, safeIdentifier } from "@/lib/ai/server/safe-log"
import { parseOutlookRequestSchema } from "@/features/outlooks/ai/outlook-parser-contract"
import { parseOutlookText } from "@/features/outlooks/ai/server/parse-service"

// firebase-admin + provider calls need the Node runtime, not Edge.
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/outlooks/parse
 * Body: { text, context }
 * Returns validated task *suggestions* only. Never writes Firestore.
 */
export async function POST(request: Request): Promise<Response> {
  const startedAt = Date.now()
  let uid: string | null = null
  let requestId = "unassigned"
  let acquired: AcquiredOutlookAiRequest | null = null
  let providerSucceeded = false
  try {
    const user = await authenticateOutlookRequest(request)
    uid = user.uid
    requestId = readOutlookAiIdempotencyKey(request)

    const contentType = request.headers.get("content-type") ?? ""
    if (!contentType.toLowerCase().startsWith("application/json")) {
      throw new AiError("invalid-request", "Please send a valid task note.")
    }
    const contentLength = Number(request.headers.get("content-length"))
    if (Number.isFinite(contentLength) && contentLength > 128 * 1024) {
      throw new AiError("payload-too-large", "The task request is too large.")
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      throw new AiError("invalid-request", "The task note could not be read. Please try again.")
    }

    const parsed = parseOutlookRequestSchema.safeParse(body)
    if (!parsed.success) {
      throw new AiError("invalid-request", "Check the task note and try again.")
    }
    if (parsed.data.text.length > OUTLOOK_AI_LIMITS.maxTextChars) {
      throw new AiError("payload-too-large", `Notes must be under ${OUTLOOK_AI_LIMITS.maxTextChars} characters.`)
    }

    const requestHash = hashOutlookAiRequest(JSON.stringify(parsed.data))
    if (user.verified) {
      acquired = await acquireOutlookAiRequest({
        uid: user.uid,
        operation: "generation",
        requestHash,
        idempotencyKey: requestId,
      })
      logOutlookAi({
        event: "accepted",
        operation: "generation",
        requestId,
        userHash: acquired.userHash,
        textChars: parsed.data.text.length,
      })
    }

    const result = await parseOutlookText(parsed.data.text, parsed.data.context, {
      operation: "generation",
      requestId,
    })
    providerSucceeded = true
    if (acquired) await completeOutlookAiRequest(user.uid, acquired)
    logOutlookAi({
      event: "succeeded",
      operation: "generation",
      requestId,
      userHash: safeIdentifier(user.uid),
      latencyMs: Date.now() - startedAt,
      textChars: parsed.data.text.length,
    })
    return Response.json(result, {
      headers: responseHeaders(requestId, acquired?.lease.remaining),
    })
  } catch (error) {
    if (uid && acquired && !providerSucceeded) {
      try {
        await failOutlookAiRequest(uid, acquired)
      } catch {
        // Keep the short lease until expiry if Firestore cannot release it.
      }
    }
    logOutlookAi({
      event: acquired ? "failed" : "rejected",
      operation: "generation",
      requestId,
      ...(uid ? { userHash: safeIdentifier(uid) } : {}),
      errorCode: isAiError(error) ? error.code : "unexpected",
      latencyMs: Date.now() - startedAt,
    })
    return toOutlookAiErrorResponse(error)
  }
}

function responseHeaders(requestId: string, remaining?: number): Headers {
  const headers = new Headers({ "Cache-Control": "no-store", "X-Request-Id": requestId })
  if (remaining != null) headers.set("X-RateLimit-Remaining", String(remaining))
  return headers
}
