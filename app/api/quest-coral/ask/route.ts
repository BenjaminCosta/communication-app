import { QUEST_CORAL_AI_LIMITS } from "@/lib/ai/config"
import { AiError, isAiError } from "@/lib/ai/errors"
import { authenticateOutlookRequest } from "@/lib/ai/server/auth-guard"
import { toOutlookAiErrorResponse } from "@/lib/ai/server/route-helpers"
import {
  acquireQuestCoralAiRequest,
  completeQuestCoralAiRequest,
  failQuestCoralAiRequest,
  type AcquiredQuestCoralAiRequest,
} from "@/lib/ai/server/quest-coral-request-guard"
import { hashOutlookAiRequest, readOutlookAiIdempotencyKey } from "@/lib/ai/server/request-guard"
import { logQuestCoralAi, safeIdentifier } from "@/lib/ai/server/safe-log"
import { questCoralAskRequestSchema } from "@/features/quest-coral/ai/quest-coral-ask-contract"
import { answerQuestCoralQuestion } from "@/features/quest-coral/ai/server/ask-service"

// firebase-admin + provider calls need the Node runtime, not Edge.
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/quest-coral/ask
 * Body: { question, scope, projects }
 * Returns a concise answer grounded only in the project(s) the client sent.
 * Read-only — never writes Quest Coral data.
 */
export async function POST(request: Request): Promise<Response> {
  const startedAt = Date.now()
  let uid: string | null = null
  let requestId = "unassigned"
  let acquired: AcquiredQuestCoralAiRequest | null = null
  let providerSucceeded = false
  try {
    const user = await authenticateOutlookRequest(request)
    uid = user.uid
    requestId = readOutlookAiIdempotencyKey(request)

    const contentType = request.headers.get("content-type") ?? ""
    if (!contentType.toLowerCase().startsWith("application/json")) {
      throw new AiError("invalid-request", "Please send a valid question.")
    }
    const contentLength = Number(request.headers.get("content-length"))
    if (Number.isFinite(contentLength) && contentLength > 256 * 1024) {
      throw new AiError("payload-too-large", "The question request is too large.")
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      throw new AiError("invalid-request", "The question could not be read. Please try again.")
    }

    const parsed = questCoralAskRequestSchema.safeParse(body)
    if (!parsed.success) {
      throw new AiError("invalid-request", "Check the question and try again.")
    }
    if (parsed.data.question.length > QUEST_CORAL_AI_LIMITS.maxQuestionChars) {
      throw new AiError("payload-too-large", `Questions must be under ${QUEST_CORAL_AI_LIMITS.maxQuestionChars} characters.`)
    }

    const requestHash = hashOutlookAiRequest(JSON.stringify(parsed.data))
    if (user.verified) {
      acquired = await acquireQuestCoralAiRequest({
        uid: user.uid,
        operation: "ask",
        requestHash,
        idempotencyKey: requestId,
      })
      logQuestCoralAi({
        event: "accepted",
        operation: "ask",
        requestId,
        userHash: acquired.userHash,
        textChars: parsed.data.question.length,
      })
    }

    const result = await answerQuestCoralQuestion(parsed.data, { operation: "ask", requestId })
    providerSucceeded = true
    if (acquired) await completeQuestCoralAiRequest(user.uid, acquired)
    logQuestCoralAi({
      event: "succeeded",
      operation: "ask",
      requestId,
      userHash: safeIdentifier(user.uid),
      latencyMs: Date.now() - startedAt,
      textChars: parsed.data.question.length,
      recordCount: parsed.data.projects.length,
    })
    return Response.json(result, { headers: responseHeaders(requestId, acquired?.lease.remaining) })
  } catch (error) {
    if (uid && acquired && !providerSucceeded) {
      try {
        await failQuestCoralAiRequest(uid, acquired)
      } catch {
        // Keep the short lease until expiry if Firestore cannot release it.
      }
    }
    logQuestCoralAi({
      event: acquired ? "failed" : "rejected",
      operation: "ask",
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
