import { z } from "zod"
import {
  authenticateQuestCoralFeedbackRequest,
  publishQuestCoralFeedbackReply,
  QuestCoralFeedbackPublicationError,
} from "@/lib/quest-coral-communications-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const idSchema = z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9_-]+$/)
const userIdsSchema = z.array(z.string().trim().min(1).max(256)).max(250)
const calendarDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const imageSchema = z.object({
  url: z.string().url().max(12_000),
  path: z.string().trim().max(1_500).optional(),
  name: z.string().trim().max(500).optional(),
  contentType: z.string().trim().max(150).optional(),
  size: z.number().int().min(0).max(25 * 1024 * 1024).optional(),
  width: z.number().int().positive().max(20_000).optional(),
  height: z.number().int().positive().max(20_000).optional(),
  blurHash: z.string().trim().max(200).optional(),
}).strict()
const attachmentSchema = z.object({
  url: z.string().url().max(12_000),
  path: z.string().trim().max(1_500).optional(),
  name: z.string().trim().max(500).optional(),
  contentType: z.string().trim().max(150).optional(),
  size: z.number().int().min(0).max(50 * 1024 * 1024).optional(),
}).strict()

const requestSchema = z.object({
  replyId: idSchema,
  replyToMessageId: idSchema,
  body: z.string().trim().max(5_000),
  authorName: z.string().trim().max(120).optional(),
  requestedRecipientIds: userIdsSchema,
  contactIds: z.array(z.string().trim().min(1).max(256)).max(250),
  calendarDates: z.array(calendarDateSchema).max(30).default([]),
  image: imageSchema.optional(),
  attachment: attachmentSchema.optional(),
}).superRefine((value, context) => {
  if (!value.body && !value.image && !value.attachment) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "A reply needs text or an attachment." })
  }
})

/**
 * POST /api/quest-coral/feedback-replies
 *
 * The secure bridge for a Communications reply to a mirrored Quest Coral
 * Feedback. It creates the reply message and the project-thread record in
 * one Admin transaction, with server-derived linkage and audience.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const contentType = request.headers.get("content-type") ?? ""
    if (!contentType.toLowerCase().startsWith("application/json")) {
      throw new QuestCoralFeedbackPublicationError("invalid-request", "Please send a valid feedback reply.", 400)
    }
    const contentLength = Number(request.headers.get("content-length"))
    if (Number.isFinite(contentLength) && contentLength > 96 * 1024) {
      throw new QuestCoralFeedbackPublicationError("invalid-request", "This feedback reply is too large.", 400)
    }
    let body: unknown
    try {
      body = await request.json()
    } catch {
      throw new QuestCoralFeedbackPublicationError("invalid-request", "The feedback reply could not be read. Please try again.", 400)
    }
    const parsed = requestSchema.safeParse(body)
    if (!parsed.success) {
      throw new QuestCoralFeedbackPublicationError("invalid-request", "Check the feedback reply and try again.", 400)
    }
    const user = await authenticateQuestCoralFeedbackRequest(request)
    const result = await publishQuestCoralFeedbackReply({
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
      { error: "Your feedback reply could not be shared. Please try again.", code: "unexpected" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    )
  }
}
