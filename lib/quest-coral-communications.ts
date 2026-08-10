import type { Project, ProjectPerson } from "@/lib/quest-coral-core"

/** Provenance stored on Communications contexts created from Quest Coral. */
export const QUEST_CORAL_COMMUNICATIONS_SOURCE = "quest-coral"

/**
 * A Quest Coral project has exactly one Communications context. The stable id
 * lets project creation, the feedback publisher and the backfill converge on
 * the same record without name-based matching or duplicate contexts.
 */
export function questCoralCommunicationsContextId(projectId: string): string {
  const normalized = projectId.trim()
  if (!normalized) throw new Error("Quest Coral project id is required to create a Communications context.")
  return `quest-coral-${normalized}`
}

/** One feedback maps to one deterministic Communications message. */
export function questCoralFeedbackMessageId(feedbackId: string): string {
  const normalized = feedbackId.trim()
  if (!normalized) throw new Error("Quest Coral feedback id is required to create a Communications message.")
  return `quest-coral-feedback-${normalized}`
}

/** One reply in a Feedback thread maps to one deterministic Communications message. */
export function questCoralFeedbackReplyMessageId(replyId: string): string {
  const normalized = replyId.trim()
  if (!normalized) throw new Error("Quest Coral feedback reply id is required to create a Communications message.")
  return `quest-coral-feedback-reply-${normalized}`
}

export function questCoralCommunicationsContextDescription(description: string): string {
  const normalized = description.trim()
  return normalized
    ? `Quest Coral project: ${normalized}`
    : "This context is linked to a Quest Coral project."
}

export function questCoralFeedbackMessageText(projectName: string, feedbackBody: string): string {
  const name = projectName.trim() || "Untitled project"
  return `Feedback on ${name}\n\n${feedbackBody.trim()}`
}

type ProjectAudience = Pick<Project, "ownerId"> & { people: Array<Pick<ProjectPerson, "id">> }

/** Owner and involved people are candidates; only real registered users may receive a message. */
export function questCoralFeedbackAudienceCandidates(project: ProjectAudience): string[] {
  const candidates = [project.ownerId, ...project.people.map((person) => person.id)]
  return [...new Set(candidates.map((id) => id.trim()).filter(Boolean))]
}

/**
 * Communications visibility remains explicit: keep only registered project
 * participants. The author is included too when registered, so a person's
 * own feedback remains visible as an explicit recipient in Communications.
 */
export function registeredQuestCoralFeedbackRecipients(
  candidateIds: string[],
  registeredUserIds: Iterable<string>,
): string[] {
  const registered = new Set([...registeredUserIds].map((id) => id.trim()).filter(Boolean))
  return [...new Set(candidateIds.map((id) => id.trim()).filter(Boolean))]
    .filter((id) => registered.has(id))
}

function distinctIds(values: Iterable<string>): string[] {
  return [...new Set([...values].map((id) => id.trim()).filter(Boolean))]
}

/**
 * Project membership can grant a newly involved person visibility into prior
 * Feedback mirrors. This merge is deliberately additive: removing someone
 * from People involved never silently removes them from a message that was
 * already sent to them.
 */
export function mergeQuestCoralFeedbackVisibility(input: {
  existingRecipientIds: string[]
  existingPeopleIds: string[]
  existingParticipantIds: string[]
  existingVisibleToUserIds: string[]
  currentRecipientIds: string[]
  authorId: string
}): {
  recipientIds: string[]
  peopleIds: string[]
  participants: string[]
  visibleToUserIds: string[]
} {
  const recipientIds = distinctIds([...input.existingRecipientIds, ...input.currentRecipientIds])
  const peopleIds = distinctIds([...input.existingPeopleIds, ...recipientIds])
  const visibleToUserIds = distinctIds([
    ...input.existingVisibleToUserIds,
    ...input.existingParticipantIds,
    input.authorId,
    ...recipientIds,
  ])
  const participants = distinctIds([...input.existingParticipantIds, ...visibleToUserIds])
  return { recipientIds, peopleIds, participants, visibleToUserIds }
}
