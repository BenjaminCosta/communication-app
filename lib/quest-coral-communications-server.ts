import "server-only"

import type { DocumentData, Firestore, Transaction } from "firebase-admin/firestore"
import { getFirebaseAdminApp } from "@/lib/ai/server/firebase-admin"
import {
  QUEST_CORAL_COMMUNICATIONS_SOURCE,
  questCoralCommunicationsContextDescription,
  questCoralCommunicationsContextId,
  questCoralFeedbackAudienceCandidates,
  questCoralFeedbackMessageId,
  questCoralFeedbackReplyMessageId,
  questCoralFeedbackMessageText,
  questCoralRedTeamReviewMessageId,
  questCoralRedTeamReviewReplyMessageId,
  questCoralRedTeamReviewMessageText,
  RED_TEAM_REVIEW_COMMS_PROJECT_ID,
  RED_TEAM_REVIEW_COMMS_PROJECT_TAG_ID,
  mergeQuestCoralFeedbackVisibility,
  registeredQuestCoralFeedbackRecipients,
} from "@/lib/quest-coral-communications"

const PROJECTS_COLLECTION = "questCoralProjects"
const UPDATES_COLLECTION = "questCoralUpdates"
const FEEDBACK_REPLIES_COLLECTION = "questCoralFeedbackReplies"
const RED_TEAM_REVIEW_REPLIES_COLLECTION = "questCoralRedTeamReviewReplies"
const CONTEXTS_COLLECTION = "contexts"
const MESSAGES_COLLECTION = "messages"
const USERS_COLLECTION = "users"
const FEEDBACK_TAG_ID = "type:feedback"

export class QuestCoralFeedbackPublicationError extends Error {
  constructor(
    readonly code: "unauthenticated" | "invalid-request" | "not-found" | "conflict" | "not-configured",
    message: string,
    readonly status: 400 | 401 | 404 | 409 | 503,
  ) {
    super(message)
    this.name = "QuestCoralFeedbackPublicationError"
  }
}

export interface QuestCoralFeedbackPublicationInput {
  feedbackId: string
  projectId: string
  body: string
  authorId: string
  authorName?: string
  image?: {
    url: string
    path?: string
    name?: string
    contentType?: string
    size?: number
  }
  attachment?: {
    url: string
    path?: string
    name?: string
    contentType?: string
    size?: number
  }
}

export interface PublishedQuestCoralFeedback {
  update: {
    id: string
    projectId: string
    type: "feedback"
    authorId: string
    authorName: string
    body: string
    isBlocker: false
    createdAt: string
    imageUrl?: string
    imagePath?: string
    imageName?: string
    imageContentType?: string
    imageSize?: number
    fileUrl?: string
    filePath?: string
    fileName?: string
    fileContentType?: string
    fileSize?: number
  }
  communicationMessageId: string
  replayed: boolean
}

export interface QuestCoralFeedbackReplyPublicationInput {
  replyId: string
  replyToMessageId: string
  body: string
  authorId: string
  authorName?: string
  requestedRecipientIds: string[]
  contactIds: string[]
  calendarDates: string[]
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

export interface PublishedQuestCoralFeedbackReply {
  replyId: string
  communicationMessageId: string
  projectId: string
  feedbackId: string
  replayed: boolean
}

export interface QuestCoralRedTeamReviewPublicationInput {
  redTeamReviewId: string
  projectId: string
  body: string
  authorId: string
  authorName?: string
  image?: {
    url: string
    path?: string
    name?: string
    contentType?: string
    size?: number
  }
  attachment?: {
    url: string
    path?: string
    name?: string
    contentType?: string
    size?: number
  }
}

export interface PublishedQuestCoralRedTeamReview {
  update: {
    id: string
    projectId: string
    type: "red_team_review"
    authorId: string
    authorName: string
    body: string
    isBlocker: false
    createdAt: string
    imageUrl?: string
    imagePath?: string
    imageName?: string
    imageContentType?: string
    imageSize?: number
    fileUrl?: string
    filePath?: string
    fileName?: string
    fileContentType?: string
    fileSize?: number
  }
  communicationMessageId: string
  replayed: boolean
}

export interface QuestCoralRedTeamReviewReplyPublicationInput {
  replyId: string
  replyToMessageId: string
  body: string
  authorId: string
  authorName?: string
  requestedRecipientIds: string[]
  contactIds: string[]
  calendarDates: string[]
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

export interface PublishedQuestCoralRedTeamReviewReply {
  replyId: string
  communicationMessageId: string
  projectId: string
  redTeamReviewId: string
  replayed: boolean
}

async function adminFirestore(): Promise<Firestore> {
  const { getFirestore } = await import("firebase-admin/firestore")
  return getFirestore(await getFirebaseAdminApp())
}

function asNonEmptyString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function createdAtIso(value: unknown, fallback: string): string {
  if (value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function") {
    const date = value.toDate()
    if (date instanceof Date && Number.isFinite(date.getTime())) return date.toISOString()
  }
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString()
  return fallback
}

function feedbackMatches(data: Record<string, unknown>, input: QuestCoralFeedbackPublicationInput): boolean {
  return data.projectId === input.projectId
    && data.type === "feedback"
    && data.authorId === input.authorId
    && data.body === input.body
    && data.isBlocker === false
    && asNonEmptyString(data.imageUrl) === (input.image?.url ?? "")
    && asNonEmptyString(data.fileUrl) === (input.attachment?.url ?? "")
}

function feedbackMediaFromData(data: Record<string, unknown>) {
  return {
    imageUrl: asNonEmptyString(data.imageUrl) || undefined,
    imagePath: asNonEmptyString(data.imagePath) || undefined,
    imageName: asNonEmptyString(data.imageName) || undefined,
    imageContentType: asNonEmptyString(data.imageContentType) || undefined,
    imageSize: typeof data.imageSize === "number" ? data.imageSize : undefined,
    fileUrl: asNonEmptyString(data.fileUrl) || undefined,
    filePath: asNonEmptyString(data.filePath) || undefined,
    fileName: asNonEmptyString(data.fileName) || undefined,
    fileContentType: asNonEmptyString(data.fileContentType) || undefined,
    fileSize: typeof data.fileSize === "number" ? data.fileSize : undefined,
  }
}

function feedbackReplyMatches(data: Record<string, unknown>, input: QuestCoralFeedbackReplyPublicationInput): boolean {
  return data.authorId === input.authorId
    && data.body === input.body
    && data.replyToCommunicationMessageId === input.replyToMessageId
}

function redTeamReviewMatches(data: Record<string, unknown>, input: QuestCoralRedTeamReviewPublicationInput): boolean {
  return data.projectId === input.projectId
    && data.type === "red_team_review"
    && data.authorId === input.authorId
    && data.body === input.body
    && data.isBlocker === false
    && asNonEmptyString(data.imageUrl) === (input.image?.url ?? "")
    && asNonEmptyString(data.fileUrl) === (input.attachment?.url ?? "")
}

function redTeamReviewReplyMatches(data: Record<string, unknown>, input: QuestCoralRedTeamReviewReplyPublicationInput): boolean {
  return data.authorId === input.authorId
    && data.body === input.body
    && data.replyToCommunicationMessageId === input.replyToMessageId
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : []
}

function sameIdSet(left: string[], right: string[]): boolean {
  const normalize = (values: string[]) => [...new Set(values.map((id) => id.trim()).filter(Boolean))].sort()
  const first = normalize(left)
  const second = normalize(right)
  return first.length === second.length && first.every((id, index) => id === second[index])
}

function projectAudience(projectData: Record<string, unknown>): { ownerId: string; people: Array<{ id: string }> } {
  const ownerId = asNonEmptyString(projectData.ownerUserId)
  const people = Array.isArray(projectData.people)
    ? projectData.people
      .filter((person): person is Record<string, unknown> => Boolean(person && typeof person === "object"))
      .map((person) => ({ id: asNonEmptyString(person.id) }))
    : []
  return { ownerId, people }
}

async function verifyRegisteredPeople(
  db: Firestore,
  transaction: Transaction,
  candidateIds: string[],
): Promise<Map<string, Record<string, unknown>>> {
  const uniqueIds = [...new Set(candidateIds.filter(Boolean))]
  if (uniqueIds.length === 0) return new Map()
  const snapshots = await transaction.getAll(...uniqueIds.map((id) => db.collection(USERS_COLLECTION).doc(id)))
  return new Map(
    snapshots
      .filter((snapshot) => snapshot.exists)
      .map((snapshot) => [snapshot.id, (snapshot.data() ?? {}) as Record<string, unknown>]),
  )
}

/**
 * Creates a Feedback activity and its Communications mirror in one Firestore
 * transaction. The feedback id and message id are stable, so a retried request
 * returns the original pair instead of producing a duplicate announcement.
 */
export async function publishQuestCoralFeedback(
  input: QuestCoralFeedbackPublicationInput,
): Promise<PublishedQuestCoralFeedback> {
  const db = await adminFirestore()
  const { FieldValue } = await import("firebase-admin/firestore")
  const now = new Date().toISOString()
  const projectRef = db.collection(PROJECTS_COLLECTION).doc(input.projectId)
  const updateRef = db.collection(UPDATES_COLLECTION).doc(input.feedbackId)
  const contextId = questCoralCommunicationsContextId(input.projectId)
  const contextRef = db.collection(CONTEXTS_COLLECTION).doc(contextId)
  const messageId = questCoralFeedbackMessageId(input.feedbackId)
  const messageRef = db.collection(MESSAGES_COLLECTION).doc(messageId)

  return db.runTransaction(async (transaction) => {
    const [projectSnapshot, updateSnapshot, contextSnapshot, messageSnapshot] = await Promise.all([
      transaction.get(projectRef),
      transaction.get(updateRef),
      transaction.get(contextRef),
      transaction.get(messageRef),
    ])
    if (!projectSnapshot.exists) {
      throw new QuestCoralFeedbackPublicationError("not-found", "This project no longer exists.", 404)
    }

    if (updateSnapshot.exists) {
      const updateData = (updateSnapshot.data() ?? {}) as Record<string, unknown>
      const messageData = (messageSnapshot.data() ?? {}) as Record<string, unknown>
      if (!feedbackMatches(updateData, input) || !messageSnapshot.exists || messageData.sourceQuestCoralFeedbackId !== input.feedbackId) {
        throw new QuestCoralFeedbackPublicationError("conflict", "This feedback could not be safely retried.", 409)
      }
      return {
        update: {
          id: input.feedbackId,
          projectId: input.projectId,
          type: "feedback" as const,
          authorId: input.authorId,
          authorName: asNonEmptyString(updateData.authorName) || "Someone",
          body: input.body,
          isBlocker: false as const,
          createdAt: createdAtIso(updateData.createdAt, now),
          ...feedbackMediaFromData(updateData),
        },
        communicationMessageId: messageId,
        replayed: true,
      }
    }

    if (messageSnapshot.exists) {
      throw new QuestCoralFeedbackPublicationError("conflict", "This feedback message id is already in use.", 409)
    }
    if (contextSnapshot.exists) {
      const contextData = (contextSnapshot.data() ?? {}) as Record<string, unknown>
      if (
        contextData.sourceModule !== QUEST_CORAL_COMMUNICATIONS_SOURCE
        || contextData.questCoralProjectId !== input.projectId
      ) {
        throw new QuestCoralFeedbackPublicationError("conflict", "The linked Communications context belongs to another source.", 409)
      }
    }

    const projectData = (projectSnapshot.data() ?? {}) as Record<string, unknown>
    const projectName = asNonEmptyString(projectData.name) || "Untitled project"
    const projectDescription = asNonEmptyString(projectData.description)
    const { ownerId: projectOwnerId, people: projectPeople } = projectAudience(projectData)
    const audienceCandidates = [...new Set([
      ...questCoralFeedbackAudienceCandidates({ ownerId: projectOwnerId, people: projectPeople }),
      input.authorId,
    ])]
    const registeredPeople = await verifyRegisteredPeople(db, transaction, [...new Set([...audienceCandidates, input.authorId])])
    const authorName = asNonEmptyString(registeredPeople.get(input.authorId)?.name)
      || asNonEmptyString(input.authorName)
      || "Someone"
    const recipientIds = registeredQuestCoralFeedbackRecipients(
      audienceCandidates,
      registeredPeople.keys(),
    )
    const visibleToUserIds = [...new Set([input.authorId, ...recipientIds])]
    const imageFields = input.image ? {
      imageUrl: input.image.url,
      ...(input.image.path ? { imagePath: input.image.path } : {}),
      ...(input.image.name ? { imageName: input.image.name } : {}),
      ...(input.image.contentType ? { imageContentType: input.image.contentType } : {}),
      ...(input.image.size !== undefined ? { imageSize: input.image.size } : {}),
      imageUploadedAt: FieldValue.serverTimestamp(),
    } : {}
    const attachmentFields = input.attachment ? {
      fileUrl: input.attachment.url,
      ...(input.attachment.path ? { filePath: input.attachment.path } : {}),
      ...(input.attachment.name ? { fileName: input.attachment.name } : {}),
      ...(input.attachment.contentType ? { fileContentType: input.attachment.contentType } : {}),
      ...(input.attachment.size !== undefined ? { fileSize: input.attachment.size } : {}),
    } : {}

    transaction.create(updateRef, {
      projectId: input.projectId,
      type: "feedback",
      authorId: input.authorId,
      authorName,
      body: input.body,
      status: null,
      progress: null,
      nextStep: null,
      nextStepDue: null,
      isBlocker: false,
      createdAt: FieldValue.serverTimestamp(),
      ...imageFields,
      ...attachmentFields,
    })
    transaction.update(projectRef, { updatedAt: FieldValue.serverTimestamp() })
    if (!contextSnapshot.exists) {
      transaction.create(contextRef, {
        name: projectName,
        description: questCoralCommunicationsContextDescription(projectDescription),
        fields: [],
        createdBy: projectOwnerId || input.authorId,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        sourceModule: QUEST_CORAL_COMMUNICATIONS_SOURCE,
        questCoralProjectId: input.projectId,
      })
    }
    transaction.create(messageRef, {
      authorId: input.authorId,
      senderId: input.authorId,
      recipientIds,
      peopleIds: recipientIds,
      participants: visibleToUserIds,
      visibleToUserIds,
      projectIds: [],
      projectId: null,
      tagIds: [FEEDBACK_TAG_ID],
      content: questCoralFeedbackMessageText(projectName, input.body),
      text: questCoralFeedbackMessageText(projectName, input.body),
      type: "feedback",
      contactIds: [],
      contextIds: [contextId],
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      timestamp: FieldValue.serverTimestamp(),
      isFavorited: false,
      sourceModule: QUEST_CORAL_COMMUNICATIONS_SOURCE,
      sourceQuestCoralProjectId: input.projectId,
      sourceQuestCoralFeedbackId: input.feedbackId,
      ...imageFields,
      ...attachmentFields,
    })

    return {
      update: {
        id: input.feedbackId,
        projectId: input.projectId,
        type: "feedback" as const,
        authorId: input.authorId,
        authorName,
        body: input.body,
        isBlocker: false as const,
        createdAt: now,
        ...feedbackMediaFromData({ ...imageFields, ...attachmentFields }),
      },
      communicationMessageId: messageId,
      replayed: false,
    }
  })
}

/**
 * Creates a Red Team Review activity and its Communications mirror in one
 * Firestore transaction — same shape as `publishQuestCoralFeedback`, just a
 * different update type, tag and deterministic id namespace.
 */
export async function publishQuestCoralRedTeamReview(
  input: QuestCoralRedTeamReviewPublicationInput,
): Promise<PublishedQuestCoralRedTeamReview> {
  const db = await adminFirestore()
  const { FieldValue } = await import("firebase-admin/firestore")
  const now = new Date().toISOString()
  const projectRef = db.collection(PROJECTS_COLLECTION).doc(input.projectId)
  const updateRef = db.collection(UPDATES_COLLECTION).doc(input.redTeamReviewId)
  const contextId = questCoralCommunicationsContextId(input.projectId)
  const contextRef = db.collection(CONTEXTS_COLLECTION).doc(contextId)
  const messageId = questCoralRedTeamReviewMessageId(input.redTeamReviewId)
  const messageRef = db.collection(MESSAGES_COLLECTION).doc(messageId)

  return db.runTransaction(async (transaction) => {
    const [projectSnapshot, updateSnapshot, contextSnapshot, messageSnapshot] = await Promise.all([
      transaction.get(projectRef),
      transaction.get(updateRef),
      transaction.get(contextRef),
      transaction.get(messageRef),
    ])
    if (!projectSnapshot.exists) {
      throw new QuestCoralFeedbackPublicationError("not-found", "This project no longer exists.", 404)
    }

    if (updateSnapshot.exists) {
      const updateData = (updateSnapshot.data() ?? {}) as Record<string, unknown>
      const messageData = (messageSnapshot.data() ?? {}) as Record<string, unknown>
      if (!redTeamReviewMatches(updateData, input) || !messageSnapshot.exists || messageData.sourceQuestCoralRedTeamReviewId !== input.redTeamReviewId) {
        throw new QuestCoralFeedbackPublicationError("conflict", "This Red Team Review could not be safely retried.", 409)
      }
      return {
        update: {
          id: input.redTeamReviewId,
          projectId: input.projectId,
          type: "red_team_review" as const,
          authorId: input.authorId,
          authorName: asNonEmptyString(updateData.authorName) || "Someone",
          body: input.body,
          isBlocker: false as const,
          createdAt: createdAtIso(updateData.createdAt, now),
          ...feedbackMediaFromData(updateData),
        },
        communicationMessageId: messageId,
        replayed: true,
      }
    }

    if (messageSnapshot.exists) {
      throw new QuestCoralFeedbackPublicationError("conflict", "This Red Team Review message id is already in use.", 409)
    }
    if (contextSnapshot.exists) {
      const contextData = (contextSnapshot.data() ?? {}) as Record<string, unknown>
      if (
        contextData.sourceModule !== QUEST_CORAL_COMMUNICATIONS_SOURCE
        || contextData.questCoralProjectId !== input.projectId
      ) {
        throw new QuestCoralFeedbackPublicationError("conflict", "The linked Communications context belongs to another source.", 409)
      }
    }

    const projectData = (projectSnapshot.data() ?? {}) as Record<string, unknown>
    const projectName = asNonEmptyString(projectData.name) || "Untitled project"
    const projectDescription = asNonEmptyString(projectData.description)
    const { ownerId: projectOwnerId, people: projectPeople } = projectAudience(projectData)
    const audienceCandidates = [...new Set([
      ...questCoralFeedbackAudienceCandidates({ ownerId: projectOwnerId, people: projectPeople }),
      input.authorId,
    ])]
    const registeredPeople = await verifyRegisteredPeople(db, transaction, [...new Set([...audienceCandidates, input.authorId])])
    const authorName = asNonEmptyString(registeredPeople.get(input.authorId)?.name)
      || asNonEmptyString(input.authorName)
      || "Someone"
    const recipientIds = registeredQuestCoralFeedbackRecipients(
      audienceCandidates,
      registeredPeople.keys(),
    )
    const visibleToUserIds = [...new Set([input.authorId, ...recipientIds])]
    const imageFields = input.image ? {
      imageUrl: input.image.url,
      ...(input.image.path ? { imagePath: input.image.path } : {}),
      ...(input.image.name ? { imageName: input.image.name } : {}),
      ...(input.image.contentType ? { imageContentType: input.image.contentType } : {}),
      ...(input.image.size !== undefined ? { imageSize: input.image.size } : {}),
      imageUploadedAt: FieldValue.serverTimestamp(),
    } : {}
    const attachmentFields = input.attachment ? {
      fileUrl: input.attachment.url,
      ...(input.attachment.path ? { filePath: input.attachment.path } : {}),
      ...(input.attachment.name ? { fileName: input.attachment.name } : {}),
      ...(input.attachment.contentType ? { fileContentType: input.attachment.contentType } : {}),
      ...(input.attachment.size !== undefined ? { fileSize: input.attachment.size } : {}),
    } : {}

    transaction.create(updateRef, {
      projectId: input.projectId,
      type: "red_team_review",
      authorId: input.authorId,
      authorName,
      body: input.body,
      status: null,
      progress: null,
      nextStep: null,
      nextStepDue: null,
      isBlocker: false,
      createdAt: FieldValue.serverTimestamp(),
      ...imageFields,
      ...attachmentFields,
    })
    transaction.update(projectRef, { updatedAt: FieldValue.serverTimestamp() })
    if (!contextSnapshot.exists) {
      transaction.create(contextRef, {
        name: projectName,
        description: questCoralCommunicationsContextDescription(projectDescription),
        fields: [],
        createdBy: projectOwnerId || input.authorId,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        sourceModule: QUEST_CORAL_COMMUNICATIONS_SOURCE,
        questCoralProjectId: input.projectId,
      })
    }
    transaction.create(messageRef, {
      authorId: input.authorId,
      senderId: input.authorId,
      recipientIds,
      peopleIds: recipientIds,
      participants: visibleToUserIds,
      visibleToUserIds,
      projectIds: [RED_TEAM_REVIEW_COMMS_PROJECT_ID],
      projectId: RED_TEAM_REVIEW_COMMS_PROJECT_ID,
      // Only the user's own "Red Team Review" Communications project tag —
      // no systemType tag, so a Red Team Review message shows exactly one
      // "Red Team Review" chip instead of two.
      tagIds: [RED_TEAM_REVIEW_COMMS_PROJECT_TAG_ID],
      content: questCoralRedTeamReviewMessageText(projectName, input.body),
      text: questCoralRedTeamReviewMessageText(projectName, input.body),
      type: "none",
      contactIds: [],
      contextIds: [contextId],
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      timestamp: FieldValue.serverTimestamp(),
      isFavorited: false,
      sourceModule: QUEST_CORAL_COMMUNICATIONS_SOURCE,
      sourceQuestCoralProjectId: input.projectId,
      sourceQuestCoralRedTeamReviewId: input.redTeamReviewId,
      ...imageFields,
      ...attachmentFields,
    })

    return {
      update: {
        id: input.redTeamReviewId,
        projectId: input.projectId,
        type: "red_team_review" as const,
        authorId: input.authorId,
        authorName,
        body: input.body,
        isBlocker: false as const,
        createdAt: now,
        ...feedbackMediaFromData({ ...imageFields, ...attachmentFields }),
      },
      communicationMessageId: messageId,
      replayed: false,
    }
  })
}

/**
 * Creates one Communications reply and its Quest Coral thread record in the
 * same transaction. The parent message is the authority for the feedback and
 * project relationship, so a client cannot attach a reply to another project
 * by sending a forged id or choose a smaller audience than the conversation.
 */
export async function publishQuestCoralFeedbackReply(
  input: QuestCoralFeedbackReplyPublicationInput,
): Promise<PublishedQuestCoralFeedbackReply> {
  const db = await adminFirestore()
  const { FieldValue, Timestamp } = await import("firebase-admin/firestore")
  const replyRef = db.collection(FEEDBACK_REPLIES_COLLECTION).doc(input.replyId)
  const messageId = questCoralFeedbackReplyMessageId(input.replyId)
  const replyMessageRef = db.collection(MESSAGES_COLLECTION).doc(messageId)
  const parentMessageRef = db.collection(MESSAGES_COLLECTION).doc(input.replyToMessageId)

  return db.runTransaction(async (transaction) => {
    const [replySnapshot, replyMessageSnapshot, parentMessageSnapshot] = await Promise.all([
      transaction.get(replyRef),
      transaction.get(replyMessageRef),
      transaction.get(parentMessageRef),
    ])
    if (!parentMessageSnapshot.exists) {
      throw new QuestCoralFeedbackPublicationError("not-found", "The feedback you are replying to is no longer available.", 404)
    }

    const parentData = (parentMessageSnapshot.data() ?? {}) as Record<string, unknown>
    const projectId = asNonEmptyString(parentData.sourceQuestCoralProjectId)
    const feedbackId = asNonEmptyString(parentData.sourceQuestCoralFeedbackId)
    if (
      parentData.sourceModule !== QUEST_CORAL_COMMUNICATIONS_SOURCE
      || !projectId
      || !feedbackId
    ) {
      throw new QuestCoralFeedbackPublicationError("invalid-request", "Replies can only be linked to Quest Coral Feedback.", 400)
    }

    const projectRef = db.collection(PROJECTS_COLLECTION).doc(projectId)
    const feedbackRef = db.collection(UPDATES_COLLECTION).doc(feedbackId)
    const [projectSnapshot, feedbackSnapshot] = await Promise.all([
      transaction.get(projectRef),
      transaction.get(feedbackRef),
    ])
    if (!projectSnapshot.exists || !feedbackSnapshot.exists || feedbackSnapshot.data()?.type !== "feedback") {
      throw new QuestCoralFeedbackPublicationError("not-found", "The linked Quest Coral Feedback is no longer available.", 404)
    }

    if (replySnapshot.exists) {
      const replyData = (replySnapshot.data() ?? {}) as Record<string, unknown>
      const messageData = (replyMessageSnapshot.data() ?? {}) as Record<string, unknown>
      if (
        !feedbackReplyMatches(replyData, input)
        || replyData.projectId !== projectId
        || replyData.feedbackId !== feedbackId
        || !replyMessageSnapshot.exists
        || messageData.sourceModule !== QUEST_CORAL_COMMUNICATIONS_SOURCE
        || messageData.sourceQuestCoralFeedbackId !== feedbackId
        || messageData.sourceQuestCoralFeedbackReplyId !== input.replyId
      ) {
        throw new QuestCoralFeedbackPublicationError("conflict", "This feedback reply could not be safely retried.", 409)
      }
      return { replyId: input.replyId, communicationMessageId: messageId, projectId, feedbackId, replayed: true }
    }
    if (replyMessageSnapshot.exists) {
      throw new QuestCoralFeedbackPublicationError("conflict", "This feedback reply message id is already in use.", 409)
    }

    const projectData = (projectSnapshot.data() ?? {}) as Record<string, unknown>
    const { ownerId: projectOwnerId, people: projectPeople } = projectAudience(projectData)
    const parentAuthorId = asNonEmptyString(parentData.authorId) || asNonEmptyString(parentData.senderId)
    const audienceCandidates = [...new Set([
      ...questCoralFeedbackAudienceCandidates({ ownerId: projectOwnerId, people: projectPeople }),
      ...stringArray(parentData.recipientIds),
      ...stringArray(parentData.peopleIds),
      ...stringArray(parentData.participants),
      ...stringArray(parentData.visibleToUserIds),
      ...input.requestedRecipientIds,
      parentAuthorId,
      input.authorId,
    ])]
    const registeredPeople = await verifyRegisteredPeople(db, transaction, audienceCandidates)
    const currentRecipientIds = registeredQuestCoralFeedbackRecipients(audienceCandidates, registeredPeople.keys())
    const audience = mergeQuestCoralFeedbackVisibility({
      existingRecipientIds: stringArray(parentData.recipientIds),
      existingPeopleIds: stringArray(parentData.peopleIds),
      existingParticipantIds: stringArray(parentData.participants),
      existingVisibleToUserIds: stringArray(parentData.visibleToUserIds),
      currentRecipientIds,
      authorId: input.authorId,
    })
    const authorName = asNonEmptyString(registeredPeople.get(input.authorId)?.name)
      || asNonEmptyString(input.authorName)
      || "Someone"
    const parentAuthorName = asNonEmptyString(registeredPeople.get(parentAuthorId)?.name)
      || asNonEmptyString(parentData.authorName)
      || "Someone"
    const parentText = asNonEmptyString(parentData.text) || asNonEmptyString(parentData.content)
    const contextId = questCoralCommunicationsContextId(projectId)
    const calendarDates = input.calendarDates.map((date, index) => ({
      id: `qc-reply-${input.replyId}-${index}`,
      date,
      createdAt: Timestamp.now(),
      createdBy: input.authorId,
    }))
    const imageFields = input.image ? {
      imageUrl: input.image.url,
      ...(input.image.path ? { imagePath: input.image.path } : {}),
      ...(input.image.name ? { imageName: input.image.name } : {}),
      ...(input.image.contentType ? { imageContentType: input.image.contentType } : {}),
      ...(input.image.size !== undefined ? { imageSize: input.image.size } : {}),
      ...(input.image.width !== undefined ? { imageWidth: input.image.width } : {}),
      ...(input.image.height !== undefined ? { imageHeight: input.image.height } : {}),
      ...(input.image.blurHash ? { imageBlurHash: input.image.blurHash } : {}),
      imageUploadedAt: FieldValue.serverTimestamp(),
    } : {}
    const attachmentFields = input.attachment ? {
      fileUrl: input.attachment.url,
      ...(input.attachment.path ? { filePath: input.attachment.path } : {}),
      ...(input.attachment.name ? { fileName: input.attachment.name } : {}),
      ...(input.attachment.contentType ? { fileContentType: input.attachment.contentType } : {}),
      ...(input.attachment.size !== undefined ? { fileSize: input.attachment.size } : {}),
    } : {}

    transaction.create(replyRef, {
      projectId,
      feedbackId,
      authorId: input.authorId,
      authorName,
      body: input.body,
      communicationMessageId: messageId,
      replyToCommunicationMessageId: input.replyToMessageId,
      createdAt: FieldValue.serverTimestamp(),
      ...imageFields,
      ...attachmentFields,
    })
    transaction.create(replyMessageRef, {
      authorId: input.authorId,
      senderId: input.authorId,
      ...audience,
      projectIds: [],
      projectId: null,
      tagIds: [FEEDBACK_TAG_ID],
      content: input.body,
      text: input.body,
      type: "feedback",
      contactIds: input.contactIds,
      contextIds: [contextId],
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      timestamp: FieldValue.serverTimestamp(),
      isFavorited: false,
      replyToId: input.replyToMessageId,
      replyPreview: {
        messageId: input.replyToMessageId,
        authorId: parentAuthorId,
        authorName: parentAuthorName,
        text: parentText.slice(0, 120),
      },
      ...(calendarDates.length > 0 ? {
        calendarDates,
        calendarDateStrings: input.calendarDates,
      } : {}),
      ...imageFields,
      ...attachmentFields,
      sourceModule: QUEST_CORAL_COMMUNICATIONS_SOURCE,
      sourceQuestCoralProjectId: projectId,
      sourceQuestCoralFeedbackId: feedbackId,
      sourceQuestCoralFeedbackReplyId: input.replyId,
    })
    transaction.update(projectRef, { updatedAt: FieldValue.serverTimestamp() })

    return { replyId: input.replyId, communicationMessageId: messageId, projectId, feedbackId, replayed: false }
  })
}

/**
 * Creates one Communications reply and its Quest Coral thread record in the
 * same transaction — same shape as `publishQuestCoralFeedbackReply`, just
 * anchored to a Red Team Review parent message instead of a Feedback one.
 */
export async function publishQuestCoralRedTeamReviewReply(
  input: QuestCoralRedTeamReviewReplyPublicationInput,
): Promise<PublishedQuestCoralRedTeamReviewReply> {
  const db = await adminFirestore()
  const { FieldValue, Timestamp } = await import("firebase-admin/firestore")
  const replyRef = db.collection(RED_TEAM_REVIEW_REPLIES_COLLECTION).doc(input.replyId)
  const messageId = questCoralRedTeamReviewReplyMessageId(input.replyId)
  const replyMessageRef = db.collection(MESSAGES_COLLECTION).doc(messageId)
  const parentMessageRef = db.collection(MESSAGES_COLLECTION).doc(input.replyToMessageId)

  return db.runTransaction(async (transaction) => {
    const [replySnapshot, replyMessageSnapshot, parentMessageSnapshot] = await Promise.all([
      transaction.get(replyRef),
      transaction.get(replyMessageRef),
      transaction.get(parentMessageRef),
    ])
    if (!parentMessageSnapshot.exists) {
      throw new QuestCoralFeedbackPublicationError("not-found", "The Red Team Review you are replying to is no longer available.", 404)
    }

    const parentData = (parentMessageSnapshot.data() ?? {}) as Record<string, unknown>
    const projectId = asNonEmptyString(parentData.sourceQuestCoralProjectId)
    const redTeamReviewId = asNonEmptyString(parentData.sourceQuestCoralRedTeamReviewId)
    if (
      parentData.sourceModule !== QUEST_CORAL_COMMUNICATIONS_SOURCE
      || !projectId
      || !redTeamReviewId
    ) {
      throw new QuestCoralFeedbackPublicationError("invalid-request", "Replies can only be linked to a Quest Coral Red Team Review.", 400)
    }

    const projectRef = db.collection(PROJECTS_COLLECTION).doc(projectId)
    const reviewRef = db.collection(UPDATES_COLLECTION).doc(redTeamReviewId)
    const [projectSnapshot, reviewSnapshot] = await Promise.all([
      transaction.get(projectRef),
      transaction.get(reviewRef),
    ])
    if (!projectSnapshot.exists || !reviewSnapshot.exists || reviewSnapshot.data()?.type !== "red_team_review") {
      throw new QuestCoralFeedbackPublicationError("not-found", "The linked Quest Coral Red Team Review is no longer available.", 404)
    }

    if (replySnapshot.exists) {
      const replyData = (replySnapshot.data() ?? {}) as Record<string, unknown>
      const messageData = (replyMessageSnapshot.data() ?? {}) as Record<string, unknown>
      if (
        !redTeamReviewReplyMatches(replyData, input)
        || replyData.projectId !== projectId
        || replyData.redTeamReviewId !== redTeamReviewId
        || !replyMessageSnapshot.exists
        || messageData.sourceModule !== QUEST_CORAL_COMMUNICATIONS_SOURCE
        || messageData.sourceQuestCoralRedTeamReviewId !== redTeamReviewId
        || messageData.sourceQuestCoralRedTeamReviewReplyId !== input.replyId
      ) {
        throw new QuestCoralFeedbackPublicationError("conflict", "This Red Team Review reply could not be safely retried.", 409)
      }
      return { replyId: input.replyId, communicationMessageId: messageId, projectId, redTeamReviewId, replayed: true }
    }
    if (replyMessageSnapshot.exists) {
      throw new QuestCoralFeedbackPublicationError("conflict", "This Red Team Review reply message id is already in use.", 409)
    }

    const projectData = (projectSnapshot.data() ?? {}) as Record<string, unknown>
    const { ownerId: projectOwnerId, people: projectPeople } = projectAudience(projectData)
    const parentAuthorId = asNonEmptyString(parentData.authorId) || asNonEmptyString(parentData.senderId)
    const audienceCandidates = [...new Set([
      ...questCoralFeedbackAudienceCandidates({ ownerId: projectOwnerId, people: projectPeople }),
      ...stringArray(parentData.recipientIds),
      ...stringArray(parentData.peopleIds),
      ...stringArray(parentData.participants),
      ...stringArray(parentData.visibleToUserIds),
      ...input.requestedRecipientIds,
      parentAuthorId,
      input.authorId,
    ])]
    const registeredPeople = await verifyRegisteredPeople(db, transaction, audienceCandidates)
    const currentRecipientIds = registeredQuestCoralFeedbackRecipients(audienceCandidates, registeredPeople.keys())
    const audience = mergeQuestCoralFeedbackVisibility({
      existingRecipientIds: stringArray(parentData.recipientIds),
      existingPeopleIds: stringArray(parentData.peopleIds),
      existingParticipantIds: stringArray(parentData.participants),
      existingVisibleToUserIds: stringArray(parentData.visibleToUserIds),
      currentRecipientIds,
      authorId: input.authorId,
    })
    const authorName = asNonEmptyString(registeredPeople.get(input.authorId)?.name)
      || asNonEmptyString(input.authorName)
      || "Someone"
    const parentAuthorName = asNonEmptyString(registeredPeople.get(parentAuthorId)?.name)
      || asNonEmptyString(parentData.authorName)
      || "Someone"
    const parentText = asNonEmptyString(parentData.text) || asNonEmptyString(parentData.content)
    const contextId = questCoralCommunicationsContextId(projectId)
    const calendarDates = input.calendarDates.map((date, index) => ({
      id: `qc-rtr-reply-${input.replyId}-${index}`,
      date,
      createdAt: Timestamp.now(),
      createdBy: input.authorId,
    }))
    const imageFields = input.image ? {
      imageUrl: input.image.url,
      ...(input.image.path ? { imagePath: input.image.path } : {}),
      ...(input.image.name ? { imageName: input.image.name } : {}),
      ...(input.image.contentType ? { imageContentType: input.image.contentType } : {}),
      ...(input.image.size !== undefined ? { imageSize: input.image.size } : {}),
      ...(input.image.width !== undefined ? { imageWidth: input.image.width } : {}),
      ...(input.image.height !== undefined ? { imageHeight: input.image.height } : {}),
      ...(input.image.blurHash ? { imageBlurHash: input.image.blurHash } : {}),
      imageUploadedAt: FieldValue.serverTimestamp(),
    } : {}
    const attachmentFields = input.attachment ? {
      fileUrl: input.attachment.url,
      ...(input.attachment.path ? { filePath: input.attachment.path } : {}),
      ...(input.attachment.name ? { fileName: input.attachment.name } : {}),
      ...(input.attachment.contentType ? { fileContentType: input.attachment.contentType } : {}),
      ...(input.attachment.size !== undefined ? { fileSize: input.attachment.size } : {}),
    } : {}

    transaction.create(replyRef, {
      projectId,
      redTeamReviewId,
      authorId: input.authorId,
      authorName,
      body: input.body,
      communicationMessageId: messageId,
      replyToCommunicationMessageId: input.replyToMessageId,
      createdAt: FieldValue.serverTimestamp(),
      ...imageFields,
      ...attachmentFields,
    })
    transaction.create(replyMessageRef, {
      authorId: input.authorId,
      senderId: input.authorId,
      ...audience,
      projectIds: [RED_TEAM_REVIEW_COMMS_PROJECT_ID],
      projectId: RED_TEAM_REVIEW_COMMS_PROJECT_ID,
      // Only the user's own "Red Team Review" Communications project tag —
      // see publishQuestCoralRedTeamReview for why there's no systemType tag.
      tagIds: [RED_TEAM_REVIEW_COMMS_PROJECT_TAG_ID],
      content: input.body,
      text: input.body,
      type: "none",
      contactIds: input.contactIds,
      contextIds: [contextId],
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      timestamp: FieldValue.serverTimestamp(),
      isFavorited: false,
      replyToId: input.replyToMessageId,
      replyPreview: {
        messageId: input.replyToMessageId,
        authorId: parentAuthorId,
        authorName: parentAuthorName,
        text: parentText.slice(0, 120),
      },
      ...(calendarDates.length > 0 ? {
        calendarDates,
        calendarDateStrings: input.calendarDates,
      } : {}),
      ...imageFields,
      ...attachmentFields,
      sourceModule: QUEST_CORAL_COMMUNICATIONS_SOURCE,
      sourceQuestCoralProjectId: projectId,
      sourceQuestCoralRedTeamReviewId: redTeamReviewId,
      sourceQuestCoralRedTeamReviewReplyId: input.replyId,
    })
    transaction.update(projectRef, { updatedAt: FieldValue.serverTimestamp() })

    return { replyId: input.replyId, communicationMessageId: messageId, projectId, redTeamReviewId, replayed: false }
  })
}

/**
 * Adds current registered project people to every mirrored Feedback and its
 * reply thread. Existing message recipients are preserved; this only grants
 * visibility to people newly included in the project.
 */
export async function synchronizeQuestCoralFeedbackAudience(projectId: string): Promise<{
  updatedMessages: number
  unchangedMessages: number
  missingMirrors: number
}> {
  const db = await adminFirestore()
  const { FieldValue } = await import("firebase-admin/firestore")
  const projectSnapshot = await db.collection(PROJECTS_COLLECTION).doc(projectId).get()
  if (!projectSnapshot.exists) {
    throw new QuestCoralFeedbackPublicationError("not-found", "This project no longer exists.", 404)
  }
  const projectData = (projectSnapshot.data() ?? {}) as Record<string, unknown>
  const feedbackSnapshot = await db.collection(UPDATES_COLLECTION).where("projectId", "==", projectId).get()
  const feedbacks = feedbackSnapshot.docs.filter((feedback) => feedback.data().type === "feedback")
  const repliesSnapshot = await db.collection(FEEDBACK_REPLIES_COLLECTION).where("projectId", "==", projectId).get()
  const replies = repliesSnapshot.docs.filter((reply) => asNonEmptyString(reply.data().feedbackId))
  if (feedbacks.length === 0 && replies.length === 0) {
    return { updatedMessages: 0, unchangedMessages: 0, missingMirrors: 0 }
  }

  const baseCandidates = questCoralFeedbackAudienceCandidates(projectAudience(projectData))
  const authorIds = [
    ...feedbacks.map((feedback) => asNonEmptyString(feedback.data().authorId)),
    ...replies.map((reply) => asNonEmptyString(reply.data().authorId)),
  ].filter(Boolean)
  const registeredPeople = await db.getAll(
    ...[...new Set([...baseCandidates, ...authorIds])].map((id) => db.collection(USERS_COLLECTION).doc(id)),
  )
  const registeredIds = new Set(registeredPeople.filter((person) => person.exists).map((person) => person.id))
  const mirrorEntries = [
    ...feedbacks.map((feedback) => ({
      feedbackId: feedback.id,
      authorId: asNonEmptyString(feedback.data().authorId),
      messageId: questCoralFeedbackMessageId(feedback.id),
      replyId: null as string | null,
    })),
    ...replies.map((reply) => ({
      feedbackId: asNonEmptyString(reply.data().feedbackId),
      authorId: asNonEmptyString(reply.data().authorId),
      messageId: asNonEmptyString(reply.data().communicationMessageId) || questCoralFeedbackReplyMessageId(reply.id),
      replyId: reply.id,
    })),
  ]
  const messageSnapshots = await db.getAll(
    ...mirrorEntries.map((entry) => db.collection(MESSAGES_COLLECTION).doc(entry.messageId)),
  )

  const patches: Array<{ id: string; patch: DocumentData }> = []
  let unchangedMessages = 0
  let missingMirrors = 0
  for (let index = 0; index < mirrorEntries.length; index += 1) {
    const entry = mirrorEntries[index]!
    const message = messageSnapshots[index]
    const messageData = (message.data() ?? {}) as Record<string, unknown>
    if (
      !message.exists
      || messageData.sourceModule !== QUEST_CORAL_COMMUNICATIONS_SOURCE
      || messageData.sourceQuestCoralFeedbackId !== entry.feedbackId
      || (entry.replyId !== null && messageData.sourceQuestCoralFeedbackReplyId !== entry.replyId)
    ) {
      missingMirrors += 1
      continue
    }
    const currentRecipientIds = registeredQuestCoralFeedbackRecipients(
      [...new Set([...baseCandidates, entry.authorId])],
      registeredIds,
    )
    const audience = mergeQuestCoralFeedbackVisibility({
      existingRecipientIds: stringArray(messageData.recipientIds),
      existingPeopleIds: stringArray(messageData.peopleIds),
      existingParticipantIds: stringArray(messageData.participants),
      existingVisibleToUserIds: stringArray(messageData.visibleToUserIds),
      currentRecipientIds,
      authorId: entry.authorId,
    })
    const needsUpdate = !sameIdSet(stringArray(messageData.recipientIds), audience.recipientIds)
      || !sameIdSet(stringArray(messageData.peopleIds), audience.peopleIds)
      || !sameIdSet(stringArray(messageData.participants), audience.participants)
      || !sameIdSet(stringArray(messageData.visibleToUserIds), audience.visibleToUserIds)
    if (!needsUpdate) {
      unchangedMessages += 1
      continue
    }
    patches.push({ id: message.id, patch: { ...audience, updatedAt: FieldValue.serverTimestamp() } })
  }
  for (let start = 0; start < patches.length; start += 400) {
    const batch = db.batch()
    for (const entry of patches.slice(start, start + 400)) {
      batch.update(db.collection(MESSAGES_COLLECTION).doc(entry.id), entry.patch)
    }
    await batch.commit()
  }
  return { updatedMessages: patches.length, unchangedMessages, missingMirrors }
}

/**
 * Adds current registered project people to every mirrored Red Team Review
 * and its reply thread — same shape as `synchronizeQuestCoralFeedbackAudience`,
 * just scoped to the Red Team Review update type and its own replies collection.
 */
export async function synchronizeQuestCoralRedTeamReviewAudience(projectId: string): Promise<{
  updatedMessages: number
  unchangedMessages: number
  missingMirrors: number
}> {
  const db = await adminFirestore()
  const { FieldValue } = await import("firebase-admin/firestore")
  const projectSnapshot = await db.collection(PROJECTS_COLLECTION).doc(projectId).get()
  if (!projectSnapshot.exists) {
    throw new QuestCoralFeedbackPublicationError("not-found", "This project no longer exists.", 404)
  }
  const projectData = (projectSnapshot.data() ?? {}) as Record<string, unknown>
  const reviewSnapshot = await db.collection(UPDATES_COLLECTION).where("projectId", "==", projectId).get()
  const reviews = reviewSnapshot.docs.filter((review) => review.data().type === "red_team_review")
  const repliesSnapshot = await db.collection(RED_TEAM_REVIEW_REPLIES_COLLECTION).where("projectId", "==", projectId).get()
  const replies = repliesSnapshot.docs.filter((reply) => asNonEmptyString(reply.data().redTeamReviewId))
  if (reviews.length === 0 && replies.length === 0) {
    return { updatedMessages: 0, unchangedMessages: 0, missingMirrors: 0 }
  }

  const baseCandidates = questCoralFeedbackAudienceCandidates(projectAudience(projectData))
  const authorIds = [
    ...reviews.map((review) => asNonEmptyString(review.data().authorId)),
    ...replies.map((reply) => asNonEmptyString(reply.data().authorId)),
  ].filter(Boolean)
  const registeredPeople = await db.getAll(
    ...[...new Set([...baseCandidates, ...authorIds])].map((id) => db.collection(USERS_COLLECTION).doc(id)),
  )
  const registeredIds = new Set(registeredPeople.filter((person) => person.exists).map((person) => person.id))
  const mirrorEntries = [
    ...reviews.map((review) => ({
      redTeamReviewId: review.id,
      authorId: asNonEmptyString(review.data().authorId),
      messageId: questCoralRedTeamReviewMessageId(review.id),
      replyId: null as string | null,
    })),
    ...replies.map((reply) => ({
      redTeamReviewId: asNonEmptyString(reply.data().redTeamReviewId),
      authorId: asNonEmptyString(reply.data().authorId),
      messageId: asNonEmptyString(reply.data().communicationMessageId) || questCoralRedTeamReviewReplyMessageId(reply.id),
      replyId: reply.id,
    })),
  ]
  const messageSnapshots = await db.getAll(
    ...mirrorEntries.map((entry) => db.collection(MESSAGES_COLLECTION).doc(entry.messageId)),
  )

  const patches: Array<{ id: string; patch: DocumentData }> = []
  let unchangedMessages = 0
  let missingMirrors = 0
  for (let index = 0; index < mirrorEntries.length; index += 1) {
    const entry = mirrorEntries[index]!
    const message = messageSnapshots[index]
    const messageData = (message.data() ?? {}) as Record<string, unknown>
    if (
      !message.exists
      || messageData.sourceModule !== QUEST_CORAL_COMMUNICATIONS_SOURCE
      || messageData.sourceQuestCoralRedTeamReviewId !== entry.redTeamReviewId
      || (entry.replyId !== null && messageData.sourceQuestCoralRedTeamReviewReplyId !== entry.replyId)
    ) {
      missingMirrors += 1
      continue
    }
    const currentRecipientIds = registeredQuestCoralFeedbackRecipients(
      [...new Set([...baseCandidates, entry.authorId])],
      registeredIds,
    )
    const audience = mergeQuestCoralFeedbackVisibility({
      existingRecipientIds: stringArray(messageData.recipientIds),
      existingPeopleIds: stringArray(messageData.peopleIds),
      existingParticipantIds: stringArray(messageData.participants),
      existingVisibleToUserIds: stringArray(messageData.visibleToUserIds),
      currentRecipientIds,
      authorId: entry.authorId,
    })
    const needsUpdate = !sameIdSet(stringArray(messageData.recipientIds), audience.recipientIds)
      || !sameIdSet(stringArray(messageData.peopleIds), audience.peopleIds)
      || !sameIdSet(stringArray(messageData.participants), audience.participants)
      || !sameIdSet(stringArray(messageData.visibleToUserIds), audience.visibleToUserIds)
    if (!needsUpdate) {
      unchangedMessages += 1
      continue
    }
    patches.push({ id: message.id, patch: { ...audience, updatedAt: FieldValue.serverTimestamp() } })
  }
  for (let start = 0; start < patches.length; start += 400) {
    const batch = db.batch()
    for (const entry of patches.slice(start, start + 400)) {
      batch.update(db.collection(MESSAGES_COLLECTION).doc(entry.id), entry.patch)
    }
    await batch.commit()
  }
  return { updatedMessages: patches.length, unchangedMessages, missingMirrors }
}

/** Server-side authentication for a write endpoint; unlike mock AI, it never decodes an unverified token. */
export async function authenticateQuestCoralFeedbackRequest(request: Request): Promise<{ uid: string; name?: string }> {
  const header = request.headers.get("authorization") ?? request.headers.get("Authorization") ?? ""
  const match = header.match(/^Bearer\s+(.+)$/i)
  if (!match) throw new QuestCoralFeedbackPublicationError("unauthenticated", "Please sign in again.", 401)
  try {
    const { getAuth } = await import("firebase-admin/auth")
    const decoded = await getAuth(await getFirebaseAdminApp()).verifyIdToken(match[1].trim())
    return { uid: decoded.uid, ...(typeof decoded.name === "string" ? { name: decoded.name } : {}) }
  } catch {
    throw new QuestCoralFeedbackPublicationError("unauthenticated", "Please sign in again.", 401)
  }
}
