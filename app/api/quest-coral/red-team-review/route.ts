import { z } from "zod"
import {
  authenticateQuestCoralFeedbackRequest,
  publishQuestCoralRedTeamReview,
  QuestCoralFeedbackPublicationError,
} from "@/lib/quest-coral-communications-server"

// Firebase Admin needs the full Node.js runtime.
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const redTeamReviewRequestSchema = z.object({
  redTeamReviewId: z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9_-]+$/),
  projectId: z.string().trim().min(1).max(256),
  body: z.string().trim().min(1).max(1000),
  authorName: z.string().trim().max(120).optional(),
  image: z.object({
    url: z.string().url().max(12_000),
    path: z.string().trim().max(1_500).optional(),
    name: z.string().trim().max(500).optional(),
    contentType: z.string().trim().max(150).optional(),
    size: z.number().int().min(0).max(15 * 1024 * 1024).optional(),
  }).strict().optional(),
  attachment: z.object({
    url: z.string().url().max(12_000),
    path: z.string().trim().max(1_500).optional(),
    name: z.string().trim().max(500).optional(),
    contentType: z.string().trim().max(150).optional(),
    size: z.number().int().min(0).max(15 * 1024 * 1024).optional(),
  }).strict().optional(),
})

/**
 * POST /api/quest-coral/red-team-review
 *
 * The only write path for a live Quest Coral Red Team Review. It creates the
 * immutable activity and its explicitly-addressed Communications message in
 * one Admin transaction.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const contentType = request.headers.get("content-type") ?? ""
    if (!contentType.toLowerCase().startsWith("application/json")) {
      throw new QuestCoralFeedbackPublicationError("invalid-request", "Please send a valid Red Team Review.", 400)
    }
    const contentLength = Number(request.headers.get("content-length"))
    if (Number.isFinite(contentLength) && contentLength > 64 * 1024) {
      throw new QuestCoralFeedbackPublicationError("invalid-request", "This Red Team Review is too large.", 400)
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      throw new QuestCoralFeedbackPublicationError("invalid-request", "The Red Team Review could not be read. Please try again.", 400)
    }
    const parsed = redTeamReviewRequestSchema.safeParse(body)
    if (!parsed.success) {
      throw new QuestCoralFeedbackPublicationError("invalid-request", "Check the Red Team Review and try again.", 400)
    }

    const user = await authenticateQuestCoralFeedbackRequest(request)
    const result = await publishQuestCoralRedTeamReview({
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
      { error: "Your Red Team Review could not be shared. Please try again.", code: "unexpected" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    )
  }
}
