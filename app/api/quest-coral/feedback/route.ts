import { z } from "zod"
import {
  authenticateQuestCoralFeedbackRequest,
  publishQuestCoralFeedback,
  QuestCoralFeedbackPublicationError,
} from "@/lib/quest-coral-communications-server"

// Firebase Admin needs the full Node.js runtime.
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const feedbackRequestSchema = z.object({
  feedbackId: z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9_-]+$/),
  projectId: z.string().trim().min(1).max(256),
  body: z.string().trim().min(1).max(1000),
  authorName: z.string().trim().max(120).optional(),
})

/**
 * POST /api/quest-coral/feedback
 *
 * The only write path for a live Quest Coral Feedback. It creates the
 * immutable activity and its explicitly-addressed Communications message in
 * one Admin transaction.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const contentType = request.headers.get("content-type") ?? ""
    if (!contentType.toLowerCase().startsWith("application/json")) {
      throw new QuestCoralFeedbackPublicationError("invalid-request", "Please send valid feedback.", 400)
    }
    const contentLength = Number(request.headers.get("content-length"))
    if (Number.isFinite(contentLength) && contentLength > 32 * 1024) {
      throw new QuestCoralFeedbackPublicationError("invalid-request", "This feedback is too large.", 400)
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      throw new QuestCoralFeedbackPublicationError("invalid-request", "The feedback could not be read. Please try again.", 400)
    }
    const parsed = feedbackRequestSchema.safeParse(body)
    if (!parsed.success) {
      throw new QuestCoralFeedbackPublicationError("invalid-request", "Check the feedback and try again.", 400)
    }

    const user = await authenticateQuestCoralFeedbackRequest(request)
    const result = await publishQuestCoralFeedback({
      ...parsed.data,
      authorId: user.uid,
      authorName: user.name ?? parsed.data.authorName,
    })
    return Response.json(result, {
      status: result.replayed ? 200 : 201,
      headers: { "Cache-Control": "no-store" },
    })
  } catch (error) {
    if (error instanceof QuestCoralFeedbackPublicationError) {
      return Response.json(
        { error: error.message, code: error.code },
        { status: error.status, headers: { "Cache-Control": "no-store" } },
      )
    }
    return Response.json(
      { error: "Your feedback could not be shared. Please try again.", code: "unexpected" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    )
  }
}
