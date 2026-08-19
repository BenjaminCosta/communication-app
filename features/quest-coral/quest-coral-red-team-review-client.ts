"use client"

import { auth } from "@/lib/firebase"
import type { ProjectUpdate, ProjectUpdateAttachment, ProjectUpdateImage } from "@/lib/quest-coral-core"

export class QuestCoralRedTeamReviewClientError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = "QuestCoralRedTeamReviewClientError"
  }
}

interface PublishQuestCoralRedTeamReviewInput {
  redTeamReviewId: string
  projectId: string
  body: string
  authorName: string
  image?: ProjectUpdateImage
  attachment?: ProjectUpdateAttachment
}

export interface PublishQuestCoralRedTeamReviewReplyInput {
  replyId: string
  replyToMessageId: string
  body: string
  authorName: string
  requestedRecipientIds: string[]
  contactIds: string[]
  calendarDates?: string[]
  image?: {
    url: string
    path?: string
    name?: string
    contentType?: string
    size?: number
    width?: number
    height?: number
    blurHash?: string
  }
  attachment?: {
    url: string
    path?: string
    name?: string
    contentType?: string
    size?: number
  }
}

function isRedTeamReviewUpdate(value: unknown): value is ProjectUpdate {
  if (!value || typeof value !== "object") return false
  const update = value as Partial<ProjectUpdate>
  return update.type === "red_team_review"
    && typeof update.id === "string"
    && typeof update.projectId === "string"
    && typeof update.authorId === "string"
    && typeof update.authorName === "string"
    && typeof update.body === "string"
    && update.isBlocker === false
    && typeof update.createdAt === "string"
}

async function readError(response: Response): Promise<never> {
  let message = "Your Red Team Review could not be shared. Please try again."
  let code = "request-failed"
  try {
    const body = (await response.json()) as { error?: unknown; code?: unknown }
    if (typeof body.error === "string" && body.error) message = body.error
    if (typeof body.code === "string" && body.code) code = body.code
  } catch {
    // Keep the safe fallback for malformed responses.
  }
  throw new QuestCoralRedTeamReviewClientError(code, message)
}

/** Calls the authenticated server command that commits Red Team Review + Comms together. */
export async function publishQuestCoralRedTeamReview(input: PublishQuestCoralRedTeamReviewInput): Promise<ProjectUpdate> {
  const user = auth.currentUser
  if (!user) throw new QuestCoralRedTeamReviewClientError("unauthenticated", "Please sign in again.")
  const response = await fetch("/api/quest-coral/red-team-review", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await user.getIdToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  })
  if (!response.ok) await readError(response)
  const payload = (await response.json()) as { update?: unknown }
  if (!isRedTeamReviewUpdate(payload.update)) {
    throw new QuestCoralRedTeamReviewClientError("invalid-response", "Your Red Team Review was saved, but its confirmation could not be read.")
  }
  return payload.update
}

/**
 * Posts a normal Communications reply and its Quest Coral thread record in
 * one authenticated server transaction. The server derives the project and
 * Red Team Review from the parent message; clients cannot attach a reply to
 * an unrelated project or choose a narrower historical audience.
 */
export async function publishQuestCoralRedTeamReviewReply(input: PublishQuestCoralRedTeamReviewReplyInput): Promise<void> {
  const user = auth.currentUser
  if (!user) throw new QuestCoralRedTeamReviewClientError("unauthenticated", "Please sign in again.")
  const response = await fetch("/api/quest-coral/red-team-review-replies", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await user.getIdToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  })
  if (!response.ok) await readError(response)
}

/** Expands existing Red Team Review visibility after someone is added to a project. */
export async function synchronizeQuestCoralRedTeamReviewAudience(projectId: string): Promise<void> {
  const user = auth.currentUser
  if (!user) throw new QuestCoralRedTeamReviewClientError("unauthenticated", "Please sign in again.")
  const response = await fetch("/api/quest-coral/red-team-review-audience", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await user.getIdToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ projectId }),
  })
  if (!response.ok) await readError(response)
}
