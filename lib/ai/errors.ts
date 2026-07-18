/**
 * Typed errors for the Outlook AI flow so API routes can map failures to stable
 * HTTP responses without leaking provider internals or sensitive content.
 */

export type AiErrorCode =
  | "unauthenticated"
  | "invalid-request"
  | "invalid-audio"
  | "payload-too-large"
  | "rate-limited"
  | "request-in-progress"
  | "duplicate-request"
  | "not-configured"
  | "provider-error"
  | "provider-rate-limited"
  | "provider-credit"
  | "provider-timeout"
  | "invalid-output"

const STATUS_BY_CODE: Record<AiErrorCode, number> = {
  unauthenticated: 401,
  "invalid-request": 400,
  "invalid-audio": 400,
  "payload-too-large": 413,
  "rate-limited": 429,
  "request-in-progress": 409,
  "duplicate-request": 409,
  "not-configured": 503,
  "provider-error": 502,
  "provider-rate-limited": 503,
  "provider-credit": 503,
  "provider-timeout": 504,
  "invalid-output": 502,
}

export class AiError extends Error {
  readonly code: AiErrorCode
  readonly status: number
  readonly retryAfterSeconds?: number

  constructor(code: AiErrorCode, message: string, options: { retryAfterSeconds?: number } = {}) {
    super(message)
    this.name = "AiError"
    this.code = code
    this.status = STATUS_BY_CODE[code]
    this.retryAfterSeconds = options.retryAfterSeconds
  }
}

export function isAiError(value: unknown): value is AiError {
  return value instanceof AiError
}
