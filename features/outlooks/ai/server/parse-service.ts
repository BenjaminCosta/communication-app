import { canCallProvider, getOutlookAiConfig, OUTLOOK_AI_LIMITS } from "@/lib/ai/config"
import { AiError } from "@/lib/ai/errors"
import { createStructuredJson } from "@/lib/ai/openai/client"
import {
  parseOutlookResultSchema,
  type ParseOutlookContext,
  type ParseOutlookResponse,
} from "@/features/outlooks/ai/outlook-parser-contract"
import {
  buildParseUserPrompt,
  OUTLOOK_PARSE_SYSTEM_PROMPT,
  OUTLOOK_SUGGESTIONS_JSON_SCHEMA,
} from "@/features/outlooks/ai/server/prompt"
import { mockParseOutlookText } from "@/features/outlooks/ai/server/mock-parser"
import type { OutlookAiOperation } from "@/lib/ai/server/safe-log"

/**
 * Turn a note/transcript into validated task suggestions.
 *
 * Chooses mock vs live from server config. In both modes the result is run
 * through `parseOutlookResultSchema` before returning, so the route (and the
 * client) can trust the shape regardless of provider behaviour. This service
 * never writes Firestore — it only produces a draft for the user to review.
 */
export async function parseOutlookText(
  text: string,
  context: ParseOutlookContext,
  trace?: { operation: OutlookAiOperation; requestId: string },
): Promise<ParseOutlookResponse> {
  const config = getOutlookAiConfig()

  if (!canCallProvider(config)) {
    const result = parseOutlookResultSchema.parse(mockParseOutlookText(text, context))
    return { ...capSuggestions(result), mode: "mock" }
  }

  const raw = await createStructuredJson(
    {
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      timeoutMs: OUTLOOK_AI_LIMITS.providerTimeoutMs,
      trace,
    },
    {
      model: config.parseModel,
      system: OUTLOOK_PARSE_SYSTEM_PROMPT,
      user: buildParseUserPrompt(text, context),
      schema: OUTLOOK_SUGGESTIONS_JSON_SCHEMA,
      // This is bounded information extraction, not an open-ended reasoning
      // task. Minimal effort leaves more of the completion budget for the
      // strict JSON result and materially lowers first-token latency.
      reasoningEffort: config.parseModel.startsWith("gpt-5") ? "minimal" : undefined,
      verbosity: config.parseModel.startsWith("gpt-5") ? "low" : undefined,
    },
  )

  const parsed = parseOutlookResultSchema.safeParse(raw)
  if (!parsed.success) {
    throw new AiError("invalid-output", "The parser returned data that failed validation.")
  }
  return { ...capSuggestions(parsed.data), mode: "live" }
}

function capSuggestions<T extends { suggestions: unknown[] }>(result: T): T {
  return { ...result, suggestions: result.suggestions.slice(0, OUTLOOK_AI_LIMITS.maxSuggestions) }
}
