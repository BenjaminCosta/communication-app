import { canCallProvider, getQuestCoralAiConfig, QUEST_CORAL_AI_LIMITS } from "@/lib/ai/config"
import { AiError } from "@/lib/ai/errors"
import { createStructuredJson } from "@/lib/ai/openai/client"
import {
  questCoralBriefResultSchema,
  type QuestCoralBriefRequest,
  type QuestCoralBriefResponse,
} from "@/features/quest-coral/ai/quest-coral-brief-contract"
import {
  buildQuestCoralBriefUserPrompt,
  QUEST_CORAL_BRIEF_JSON_SCHEMA,
  QUEST_CORAL_BRIEF_SYSTEM_PROMPT,
} from "@/features/quest-coral/ai/server/prompt"
import { mockGenerateQuestCoralBrief } from "@/features/quest-coral/ai/server/mock-ask"
import type { OutlookAiOperation } from "@/lib/ai/server/safe-log"

/**
 * Generate the "AI Project Brief" — a short status summary for one project,
 * grounded only in the project + updates + context the client sent. Same
 * single-shot mock-vs-live shape as `ask-service.ts`.
 */
export async function generateQuestCoralBrief(
  request: QuestCoralBriefRequest,
  trace?: { operation: OutlookAiOperation; requestId: string },
): Promise<QuestCoralBriefResponse> {
  const config = getQuestCoralAiConfig()

  if (!canCallProvider(config)) {
    const result = questCoralBriefResultSchema.parse(mockGenerateQuestCoralBrief(request.project))
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
      system: QUEST_CORAL_BRIEF_SYSTEM_PROMPT,
      user: buildQuestCoralBriefUserPrompt(request.project),
      schema: QUEST_CORAL_BRIEF_JSON_SCHEMA,
      maxOutputTokens: QUEST_CORAL_AI_LIMITS.maxAnswerTokens,
      reasoningEffort: config.askModel.startsWith("gpt-5") ? "minimal" : undefined,
      verbosity: config.askModel.startsWith("gpt-5") ? "low" : undefined,
    },
  )

  const parsed = questCoralBriefResultSchema.safeParse(raw)
  if (!parsed.success) {
    throw new AiError("invalid-output", "The assistant returned data that failed validation.")
  }
  return { ...parsed.data, mode: "live" }
}
