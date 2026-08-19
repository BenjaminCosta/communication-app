import { z } from "zod"
import {
  authenticateQuestCoralFeedbackRequest,
  QuestCoralFeedbackPublicationError,
  synchronizeQuestCoralRedTeamReviewAudience,
} from "@/lib/quest-coral-communications-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const requestSchema = z.object({
  projectId: z.string().trim().min(1).max(256),
})

/** Reconciles existing Communications Red Team Review mirrors and their replies for one project. */
export async function POST(request: Request): Promise<Response> {
  try {
    const contentType = request.headers.get("content-type") ?? ""
    if (!contentType.toLowerCase().startsWith("application/json")) {
      throw new QuestCoralFeedbackPublicationError("invalid-request", "Please send a valid project.", 400)
    }
    const parsed = requestSchema.safeParse(await request.json())
    if (!parsed.success) {
      throw new QuestCoralFeedbackPublicationError("invalid-request", "Please choose a valid project.", 400)
    }
    await authenticateQuestCoralFeedbackRequest(request)
    const result = await synchronizeQuestCoralRedTeamReviewAudience(parsed.data.projectId)
    return Response.json(result, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    if (error instanceof QuestCoralFeedbackPublicationError) {
      return Response.json(
        { error: error.message, code: error.code },
        { status: error.status, headers: { "Cache-Control": "no-store" } },
      )
    }
    return Response.json(
      { error: "Red Team Review visibility could not be updated. Please try again.", code: "unexpected" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    )
  }
}
