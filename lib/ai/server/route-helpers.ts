import { AiError, isAiError } from "@/lib/ai/errors"

/**
 * Map any thrown value to a safe JSON error response. Never echoes provider
 * internals or request content — only a stable `{ error, code }` pair.
 */
export function toOutlookAiErrorResponse(error: unknown): Response {
  const aiError = isAiError(error)
    ? error
    : new AiError("provider-error", "Something went wrong handling this request.")
  const headers = new Headers({ "Cache-Control": "no-store" })
  if (aiError.retryAfterSeconds != null) {
    headers.set("Retry-After", String(Math.max(1, Math.ceil(aiError.retryAfterSeconds))))
  }
  return Response.json(
    {
      error: aiError.message,
      code: aiError.code,
      ...(aiError.retryAfterSeconds != null
        ? { retryAfterSeconds: Math.max(1, Math.ceil(aiError.retryAfterSeconds)) }
        : {}),
    },
    { status: aiError.status, headers },
  )
}
