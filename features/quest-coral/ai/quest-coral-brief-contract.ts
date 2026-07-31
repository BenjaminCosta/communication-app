import { z } from "zod"
import { questCoralAskProjectSchema } from "@/features/quest-coral/ai/quest-coral-ask-contract"

/**
 * Shared contract for Quest Coral's "AI Project Brief".
 *
 * Same bounded-context idea as the ask contract (the project + its updates +
 * its human-authored context are already fully known to the client), but this
 * is a status summary, not a question/answer turn — there is no `question`
 * field, and the response is a `brief` rather than an `answer`.
 */

export const questCoralBriefRequestSchema = z.object({
  project: questCoralAskProjectSchema,
})

export type QuestCoralBriefRequest = z.infer<typeof questCoralBriefRequestSchema>

export const questCoralBriefResultSchema = z.object({
  brief: z.string().min(1),
})

export type QuestCoralBriefResult = z.infer<typeof questCoralBriefResultSchema>

export interface QuestCoralBriefResponse extends QuestCoralBriefResult {
  mode: "mock" | "live"
}
