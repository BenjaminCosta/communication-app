import { AiError } from "@/lib/ai/errors"
import { logOutlookAi, type OutlookAiOperation } from "@/lib/ai/server/safe-log"

/**
 * Minimal, dependency-free OpenAI REST client used only by server code.
 *
 * We intentionally avoid the `openai` SDK: the live paths are small, and using
 * `fetch` keeps the dependency surface at zero while the feature is dark. When
 * the API key is added later, these functions run as-is — nothing else changes.
 *
 * Every function is stateless and takes an explicit auth/config object, so there
 * is no module-level singleton holding the key.
 */

export interface OpenAiClientConfig {
  apiKey: string
  baseUrl: string
  timeoutMs: number
  trace?: { operation: OutlookAiOperation; requestId: string }
  maxRateLimitRetries?: number
  retryBaseDelayMs?: number
}

async function openAiFetch(
  config: OpenAiClientConfig,
  path: string,
  init: RequestInit,
): Promise<Response> {
  const maxRetries = config.maxRateLimitRetries ?? 2
  const baseDelayMs = config.retryBaseDelayMs ?? 500

  for (let attempt = 0; ; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs)
    try {
      const response = await fetch(`${config.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          ...(init.headers ?? {}),
        },
      })
      if (response.status !== 429) return response

      const providerRequestId = response.headers.get("x-request-id") ?? undefined
      if (await isInsufficientCredit(response)) {
        throw new AiError(
          "provider-credit",
          "AI is temporarily unavailable because the project usage limit was reached.",
        )
      }
      if (attempt >= maxRetries) {
        throw new AiError("provider-rate-limited", "AI is busy right now. Please try again shortly.", {
          retryAfterSeconds: retryAfterSeconds(response) ?? 2,
        })
      }

      const delayMs = retryDelayMs(response, baseDelayMs, attempt)
      if (config.trace) {
        logOutlookAi({
          event: "provider-retry",
          operation: config.trace.operation,
          requestId: config.trace.requestId,
          status: 429,
          providerRequestId,
          attempt: attempt + 1,
        })
      }
      await delay(delayMs)
    } catch (error) {
      if (error instanceof AiError) throw error
      if (error instanceof Error && error.name === "AbortError") {
        throw new AiError("provider-timeout", "AI took too long to respond. Please try again.")
      }
      throw new AiError("provider-error", "AI could not be reached. Please try again.")
    } finally {
      clearTimeout(timeout)
    }
  }
}

async function isInsufficientCredit(response: Response): Promise<boolean> {
  try {
    const body = (await response.clone().json()) as { error?: { code?: unknown; type?: unknown } }
    const code = typeof body.error?.code === "string" ? body.error.code : ""
    const type = typeof body.error?.type === "string" ? body.error.type : ""
    return code === "insufficient_quota" || code === "billing_hard_limit_reached" || type === "insufficient_quota"
  } catch {
    return false
  }
}

function retryAfterSeconds(response: Response): number | null {
  const raw = response.headers.get("retry-after")
  if (!raw) return null
  const seconds = Number(raw)
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null
}

function retryDelayMs(response: Response, baseDelayMs: number, attempt: number): number {
  const headerMs = (retryAfterSeconds(response) ?? 0) * 1000
  const exponentialMs = baseDelayMs * 2 ** attempt
  const jitterMs = Math.floor(Math.random() * Math.max(50, baseDelayMs / 2))
  return Math.min(5_000, Math.max(headerMs, exponentialMs + jitterMs))
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function providerFailure(response: Response, action: "transcription" | "generation"): AiError {
  if (response.status === 401 || response.status === 403) {
    return new AiError("not-configured", "AI provider access needs administrator attention.")
  }
  if (response.status === 413) {
    return new AiError("payload-too-large", "That request is too large for AI processing.")
  }
  return new AiError(
    "provider-error",
    action === "transcription"
      ? "The voice note could not be transcribed. Please try again."
      : "The outlook could not be generated. Please try again.",
  )
}

/** Transcribe an audio blob with an OpenAI transcription model. */
export async function transcribeAudio(
  config: OpenAiClientConfig,
  input: { model: string; file: Blob; fileName: string; language?: string },
): Promise<string> {
  const form = new FormData()
  form.append("model", input.model)
  form.append("file", input.file, input.fileName)
  form.append("response_format", "json")
  if (input.language) form.append("language", input.language)

  const response = await openAiFetch(config, "/audio/transcriptions", { method: "POST", body: form })
  if (!response.ok) {
    throw providerFailure(response, "transcription")
  }
  const data = (await response.json()) as { text?: unknown }
  if (typeof data.text !== "string") {
    throw new AiError("invalid-output", "Transcription response was malformed.")
  }
  return data.text
}

export interface StructuredJsonSchema {
  name: string
  schema: Record<string, unknown>
}

export type OpenAiReasoningEffort = "minimal" | "low" | "medium" | "high"
export type OpenAiVerbosity = "low" | "medium" | "high"

/**
 * Ask a chat model for strict, schema-validated JSON. Returns the raw parsed
 * object; the caller is responsible for validating it against its own zod schema
 * (defense in depth — we never trust model output shape).
 *
 * Note: gpt-5 family models use `max_completion_tokens` and reject a custom
 * `temperature`, so both are handled accordingly here.
 */
export async function createStructuredJson(
  config: OpenAiClientConfig,
  input: {
    model: string
    system: string
    user: string
    schema: StructuredJsonSchema
    maxOutputTokens?: number
    reasoningEffort?: OpenAiReasoningEffort
    verbosity?: OpenAiVerbosity
  },
): Promise<unknown> {
  const response = await openAiFetch(config, "/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: input.model,
      messages: [
        { role: "system", content: input.system },
        { role: "user", content: input.user },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: input.schema.name, schema: input.schema.schema, strict: true },
      },
      ...(input.reasoningEffort ? { reasoning_effort: input.reasoningEffort } : {}),
      ...(input.verbosity ? { verbosity: input.verbosity } : {}),
      max_completion_tokens: input.maxOutputTokens ?? 2000,
    }),
  })

  if (!response.ok) {
    throw providerFailure(response, "generation")
  }
  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: unknown } }>
  }
  const content = data.choices?.[0]?.message?.content
  if (typeof content !== "string") {
    throw new AiError("invalid-output", "Parser response was empty.")
  }
  try {
    return JSON.parse(content) as unknown
  } catch {
    throw new AiError("invalid-output", "Parser did not return valid JSON.")
  }
}

export interface OpenAiToolSpec {
  type: "function"
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

export interface OpenAiToolCall {
  id: string
  name: string
  /** Raw JSON string from the model — always validated by the caller. */
  arguments: string
}

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool"
  content?: string | null
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>
  tool_call_id?: string
}

/**
 * Run a bounded tool-calling conversation that ends in strict JSON.
 *
 * `response_format` is set on every turn, so the model either requests tools or
 * returns the final structured answer — the common case (context already
 * prefetched) costs a single call. Tool rounds are hard-capped; on the last
 * round the tools are withheld so the model must answer with what it has.
 *
 * The caller owns tool execution via `onToolCalls` and is responsible for
 * validating every argument — model output is never trusted here.
 */
export async function runToolConversation(
  config: OpenAiClientConfig,
  input: {
    model: string
    system: string
    user: string
    tools: OpenAiToolSpec[]
    schema: StructuredJsonSchema
    maxToolRounds: number
    maxOutputTokens?: number
    reasoningEffort?: OpenAiReasoningEffort
    verbosity?: OpenAiVerbosity
    onToolCalls: (calls: OpenAiToolCall[]) => Promise<Array<{ id: string; content: string }>>
  },
): Promise<{ result: unknown; toolRounds: number; toolNames: string[] }> {
  const messages: ChatMessage[] = [
    { role: "system", content: input.system },
    { role: "user", content: input.user },
  ]
  const toolNames: string[] = []
  let toolRounds = 0

  for (let round = 0; round <= input.maxToolRounds; round += 1) {
    const isFinalRound = round === input.maxToolRounds
    const response = await openAiFetch(config, "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: input.model,
        messages,
        response_format: {
          type: "json_schema",
          json_schema: { name: input.schema.name, schema: input.schema.schema, strict: true },
        },
        // Withhold tools on the final round so the model must commit to an answer.
        ...(isFinalRound ? {} : { tools: input.tools, tool_choice: "auto" }),
        ...(input.reasoningEffort ? { reasoning_effort: input.reasoningEffort } : {}),
        ...(input.verbosity ? { verbosity: input.verbosity } : {}),
        max_completion_tokens: input.maxOutputTokens ?? 2000,
      }),
    })
    if (!response.ok) throw providerFailure(response, "generation")

    const data = (await response.json()) as {
      choices?: Array<{ message?: ChatMessage }>
    }
    const message = data.choices?.[0]?.message
    const calls = message?.tool_calls ?? []

    if (calls.length > 0 && !isFinalRound) {
      toolRounds += 1
      messages.push({ role: "assistant", content: message?.content ?? null, tool_calls: calls })
      const requested: OpenAiToolCall[] = calls.map((call) => ({
        id: call.id,
        name: call.function.name,
        arguments: call.function.arguments,
      }))
      toolNames.push(...requested.map((call) => call.name))
      const results = await input.onToolCalls(requested)
      for (const result of results) {
        messages.push({ role: "tool", tool_call_id: result.id, content: result.content })
      }
      continue
    }

    if (typeof message?.content === "string" && message.content.trim()) {
      try {
        return { result: JSON.parse(message.content) as unknown, toolRounds, toolNames }
      } catch {
        throw new AiError("invalid-output", "The assistant did not return valid JSON.")
      }
    }
  }

  throw new AiError("invalid-output", "The assistant did not produce an answer.")
}
