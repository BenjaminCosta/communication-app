import "server-only"

import { isAiError } from "@/lib/ai/errors"
import { ByeByeDprError } from "@/lib/bye-bye-dpr-server"

/**
 * Maps ByeByeDprError / AiError to a safe JSON error response — same shape
 * as `toOutlookAiErrorResponse()` in lib/ai/server/route-helpers.ts, so
 * ByeByeDPR routes look consistent with the rest of the app's API surface.
 */
export function toByeByeDprErrorResponse(error: unknown): Response {
  const headers = new Headers({ "Cache-Control": "no-store" })

  if (error instanceof ByeByeDprError) {
    return Response.json({ error: error.message, code: error.code }, { status: error.httpStatus, headers })
  }
  if (isAiError(error)) {
    if (error.retryAfterSeconds != null) {
      headers.set("Retry-After", String(Math.max(1, Math.ceil(error.retryAfterSeconds))))
    }
    return Response.json(
      {
        error: error.message,
        code: error.code,
        ...(error.retryAfterSeconds != null ? { retryAfterSeconds: Math.max(1, Math.ceil(error.retryAfterSeconds)) } : {}),
      },
      { status: error.status, headers },
    )
  }
  return Response.json({ error: "Something went wrong handling this request.", code: "unexpected" }, { status: 500, headers })
}
