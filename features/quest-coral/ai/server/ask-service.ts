import { canCallProvider, getQuestCoralAiConfig, QUEST_CORAL_AI_LIMITS } from "@/lib/ai/config"
import { AiError } from "@/lib/ai/errors"
import { createStructuredJson } from "@/lib/ai/openai/client"
import {
  questCoralAskResultSchema,
  type QuestCoralAskRequest,
  type QuestCoralAskResponse,
} from "@/features/quest-coral/ai/quest-coral-ask-contract"
import {
  buildQuestCoralAskUserPrompt,
  QUEST_CORAL_ASK_JSON_SCHEMA,
  QUEST_CORAL_ASK_SYSTEM_PROMPT,
} from "@/features/quest-coral/ai/server/prompt"
import { mockAnswerQuestCoralQuestion } from "@/features/quest-coral/ai/server/mock-ask"
import type { OutlookAiOperation } from "@/lib/ai/server/safe-log"

/**
 * Answer a Quest Coral question, grounded only in the project(s) the client
 * sent along. Chooses mock vs live from server config — mirrors
 * `features/outlooks/ai/server/parse-service.ts`'s single-shot shape rather
 * than Directory's tool-calling/retrieval pattern, since there is nothing to
 * retrieve here: the bounded project + updates context is already in hand.
 */
export async function answerQuestCoralQuestion(
  request: QuestCoralAskRequest,
  trace?: { operation: OutlookAiOperation; requestId: string },
): Promise<QuestCoralAskResponse> {
  const config = getQuestCoralAiConfig()

  if (!canCallProvider(config)) {
    const result = questCoralAskResultSchema.parse(mockAnswerQuestCoralQuestion(request))
    return { ...result, mode: "mock" }
  }

  const raw = await createStructuredJson(
    {
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      timeoutMs: QUEST_CORAL_AI_LIMITS.providerTimeoutMs,
      trace,
    },
    {
      model: config.askModel,
      system: QUEST_CORAL_ASK_SYSTEM_PROMPT,
      user: buildQuestCoralAskUserPrompt(request),
      schema: QUEST_CORAL_ASK_JSON_SCHEMA,
      maxOutputTokens: QUEST_CORAL_AI_LIMITS.maxAnswerTokens,
      reasoningEffort: config.askModel.startsWith("gpt-5") ? "minimal" : undefined,
      verbosity: config.askModel.startsWith("gpt-5") ? "low" : undefined,
    },
  )

  const parsed = questCoralAskResultSchema.safeParse(raw)
  if (!parsed.success) {
    throw new AiError("invalid-output", "The assistant returned data that failed validation.")
  }
  return { ...parsed.data, mode: "live" }
}
