import { z } from "zod"
import { QUEST_CORAL_AI_LIMITS } from "@/lib/ai/config-public"

/**
 * Shared contract for Quest Coral's "Ask AI" (per-project and portfolio-wide).
 *
 * Unlike Ask SVC Directory, there is no server-side retrieval step: a project
 * and its updates are small, bounded data the client already holds in full
 * (it rendered the same project detail screen from it), so the request simply
 * carries that data along. The model answers using ONLY what is provided —
 * it never invents projects, people, dates or numbers. Both client and server
 * import these zod schemas so the request/response shape and runtime
 * validation live in exactly one place.
 */

export const questCoralAskUpdateSchema = z.object({
  type: z.enum(["update", "feedback", "blocker", "red_team_review"]),
  body: z.string().min(1).max(QUEST_CORAL_AI_LIMITS.maxFieldChars),
  authorName: z.string().max(200),
  createdAt: z.string().max(40),
  isBlocker: z.boolean().default(false),
})

export type QuestCoralAskUpdate = z.infer<typeof questCoralAskUpdateSchema>

/** A bounded conversation reply attached to a Feedback activity. */
export const questCoralAskFeedbackReplySchema = z.object({
  feedbackId: z.string().min(1).max(200),
  body: z.string().max(QUEST_CORAL_AI_LIMITS.maxFieldChars),
  authorName: z.string().max(200),
  createdAt: z.string().max(40),
})

export type QuestCoralAskFeedbackReply = z.infer<typeof questCoralAskFeedbackReplySchema>

/** One project's bounded context: its own fields plus its own updates feed. */
export const questCoralAskProjectSchema = z.object({
  id: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  description: z.string().max(QUEST_CORAL_AI_LIMITS.maxFieldChars).nullish(),
  status: z.enum(["planning", "on_track", "at_risk", "completed"]),
  progress: z.number().min(0).max(100),
  missionFitScore: z.number().min(1).max(5),
  ownerName: z.string().max(200),
  peopleNames: z.array(z.string().max(200)).max(30).default([]),
  nextStep: z.string().max(300).nullish(),
  nextStepDue: z.string().max(40).nullish(),
  /** Human-authored Markdown brief; independent from the activity feed. */
  contextMarkdown: z.string().max(QUEST_CORAL_AI_LIMITS.maxContextChars).nullish(),
  updates: z.array(questCoralAskUpdateSchema).max(QUEST_CORAL_AI_LIMITS.maxUpdates).default([]),
  /** Thread replies are conversation, not activity, but may clarify Feedback. */
  feedbackReplies: z.array(questCoralAskFeedbackReplySchema).max(20).default([]),
})

export type QuestCoralAskProject = z.infer<typeof questCoralAskProjectSchema>

/**
 * Request body accepted by `POST /api/quest-coral/ask`.
 *
 * `scope: "project"` carries exactly one project (the one currently open);
 * `scope: "portfolio"` carries the caller's visible project list for a
 * cross-project question ("what needs attention today?").
 */
export const questCoralAskRequestSchema = z.object({
  question: z.string().min(1).max(QUEST_CORAL_AI_LIMITS.maxQuestionChars),
  scope: z.enum(["project", "portfolio"]),
  projects: z.array(questCoralAskProjectSchema).min(1).max(QUEST_CORAL_AI_LIMITS.maxPortfolioProjects),
}).superRefine((value, context) => {
  const totalContextChars = value.projects.reduce((total, project) => total + (project.contextMarkdown?.length ?? 0), 0)
  if (totalContextChars > QUEST_CORAL_AI_LIMITS.maxPortfolioContextChars) {
    context.addIssue({
      code: z.ZodIssueCode.too_big,
      maximum: QUEST_CORAL_AI_LIMITS.maxPortfolioContextChars,
      type: "string",
      inclusive: true,
      path: ["projects"],
      message: "The combined project context is too large.",
    })
  }
})

export type QuestCoralAskRequest = z.infer<typeof questCoralAskRequestSchema>

/** Model-authored answer payload, validated before it ever reaches the client. */
export const questCoralAskResultSchema = z.object({
  answer: z.string().min(1),
})

export type QuestCoralAskResult = z.infer<typeof questCoralAskResultSchema>

/** Full response body of the ask route. */
export interface QuestCoralAskResponse extends QuestCoralAskResult {
  mode: "mock" | "live"
}
