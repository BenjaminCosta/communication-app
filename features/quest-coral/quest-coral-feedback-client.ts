"use client"

import { auth } from "@/lib/firebase"
import type { ProjectUpdate } from "@/lib/quest-coral-core"

export class QuestCoralFeedbackClientError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = "QuestCoralFeedbackClientError"
  }
}

interface PublishQuestCoralFeedbackInput {
  feedbackId: string
  projectId: string
  body: string
  authorName: string
}

export interface PublishQuestCoralFeedbackReplyInput {
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

function isFeedbackUpdate(value: unknown): value is ProjectUpdate {
  if (!value || typeof value !== "object") return false
  const update = value as Partial<ProjectUpdate>
  return update.type === "feedback"
    && typeof update.id === "string"
    && typeof update.projectId === "string"
    && typeof update.authorId === "string"
    && typeof update.authorName === "string"
    && typeof update.body === "string"
    && update.isBlocker === false
    && typeof update.createdAt === "string"
}

async function readError(response: Response): Promise<never> {
  let message = "Your feedback could not be shared. Please try again."
  let code = "request-failed"
  try {
    const body = (await response.json()) as { error?: unknown; code?: unknown }
    if (typeof body.error === "string" && body.error) message = body.error
    if (typeof body.code === "string" && body.code) code = body.code
  } catch {
    // Keep the safe fallback for malformed responses.
  }
  throw new QuestCoralFeedbackClientError(code, message)
}

/** Calls the authenticated server command that commits Feedback + Comms together. */
export async function publishQuestCoralFeedback(input: PublishQuestCoralFeedbackInput): Promise<ProjectUpdate> {
  const user = auth.currentUser
  if (!user) throw new QuestCoralFeedbackClientError("unauthenticated", "Please sign in again.")
  const response = await fetch("/api/quest-coral/feedback", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await user.getIdToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  })
  if (!response.ok) await readError(response)
  const payload = (await response.json()) as { update?: unknown }
  if (!isFeedbackUpdate(payload.update)) {
    throw new QuestCoralFeedbackClientError("invalid-response", "Your feedback was saved, but its confirmation could not be read.")
  }
  return payload.update
}

/**
 * Posts a normal Communications reply and its Quest Coral thread record in
 * one authenticated server transaction. The server derives the project and
 * feedback from the parent message; clients cannot attach a reply to an
 * unrelated project or choose a narrower historical audience.
 */
export async function publishQuestCoralFeedbackReply(input: PublishQuestCoralFeedbackReplyInput): Promise<void> {
  const user = auth.currentUser
  if (!user) throw new QuestCoralFeedbackClientError("unauthenticated", "Please sign in again.")
  const response = await fetch("/api/quest-coral/feedback-replies", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await user.getIdToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  })
  if (!response.ok) await readError(response)
}

/** Expands existing Feedback visibility after someone is added to a project. */
export async function synchronizeQuestCoralFeedbackAudience(projectId: string): Promise<void> {
  const user = auth.currentUser
  if (!user) throw new QuestCoralFeedbackClientError("unauthenticated", "Please sign in again.")
  const response = await fetch("/api/quest-coral/feedback-audience", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await user.getIdToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ projectId }),
  })
  if (!response.ok) await readError(response)
}
