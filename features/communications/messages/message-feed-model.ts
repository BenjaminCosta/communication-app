import type { Message, MessageType } from "@/lib/store"

type MessageDocument = Record<string, unknown>

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
    : []
}
function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function messageDate(value: unknown): Date {
  if (value instanceof Date) return value
  if (
    value &&
    typeof value === "object" &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    return (value as { toDate: () => Date }).toDate()
  }
  if (typeof value === "number" || typeof value === "string") return new Date(value)
  return new Date()
}

/** Maps both current and legacy Firestore message shapes to the UI contract. */
export function mapMessageDocument(id: string, data: MessageDocument): Message {
  const senderId = optionalString(data.senderId) ?? optionalString(data.authorId) ?? ""
  const projectIds = Array.isArray(data.projectIds)
    ? stringArray(data.projectIds)
    : [optionalString(data.projectId) ?? optionalString(data.project_id)].filter(
        (value): value is string => Boolean(value),
      )
  const timestamp = messageDate(data.timestamp ?? data.createdAt)
  const recipientIds = stringArray(data.recipientIds)

  return {
    id,
    senderId,
    authorId: optionalString(data.authorId) ?? senderId,
    participants: Array.isArray(data.participants) ? stringArray(data.participants) : [senderId].filter(Boolean),
    visibleToUserIds: Array.isArray(data.visibleToUserIds) ? stringArray(data.visibleToUserIds) : undefined,
    recipientIds,
    peopleIds: Array.isArray(data.peopleIds) ? stringArray(data.peopleIds) : recipientIds,
    projectId: optionalString(data.projectId) ?? optionalString(data.project_id) ?? projectIds[0] ?? null,
    projectIds,
    project_id: optionalString(data.project_id) ?? null,
    tagIds: Array.isArray(data.tagIds) ? stringArray(data.tagIds) : undefined,
    text: optionalString(data.text) ?? optionalString(data.content) ?? "",
    content: optionalString(data.content) ?? optionalString(data.text) ?? "",
    type: (optionalString(data.type) ?? "none") as MessageType,
    timestamp,
    createdAt: messageDate(data.createdAt ?? data.timestamp),
    updatedAt: messageDate(data.updatedAt ?? data.timestamp),
    isFavorited: data.isFavorited === true,
    contactIds: stringArray(data.contactIds),
    contextIds: stringArray(data.contextIds),
    imageUrl: optionalString(data.imageUrl),
    imagePath: optionalString(data.imagePath),
    imageName: optionalString(data.imageName),
    imageContentType: optionalString(data.imageContentType),
    imageSize: typeof data.imageSize === "number" ? data.imageSize : undefined,
    imageWidth: typeof data.imageWidth === "number" ? data.imageWidth : undefined,
    imageHeight: typeof data.imageHeight === "number" ? data.imageHeight : undefined,
    imageBlurHash: optionalString(data.imageBlurHash),
    imageUploadedAt: data.imageUploadedAt ? messageDate(data.imageUploadedAt) : undefined,
    calendarDates: Array.isArray(data.calendarDates)
      ? data.calendarDates
          .filter((entry): entry is MessageDocument => Boolean(entry && typeof entry === "object"))
          .map((entry) => ({
            id: String(entry.id ?? ""),
            date: String(entry.date ?? ""),
            createdAt: messageDate(entry.createdAt),
            createdBy: String(entry.createdBy ?? ""),
          }))
          .filter((entry) => Boolean(entry.date))
      : undefined,
    replyToId: optionalString(data.replyToId),
    replyPreview: data.replyPreview && typeof data.replyPreview === "object"
      ? {
          messageId: String((data.replyPreview as MessageDocument).messageId ?? ""),
          authorId: String((data.replyPreview as MessageDocument).authorId ?? ""),
          authorName: String((data.replyPreview as MessageDocument).authorName ?? ""),
          text: String((data.replyPreview as MessageDocument).text ?? ""),
        }
      : undefined,
  }
}

export interface MessageFeedSources {
  participantMessages: Message[]
  projectMessages: Message[]
  visibleMessages: Message[]
}

/** Preserves legacy merge precedence and applies the current ACL safety gate. */
export function mergeMessageFeed(sources: MessageFeedSources, userId?: string): Message[] {
  const byId = new Map<string, Message>()
  sources.participantMessages.forEach((message) => byId.set(message.id, message))
  sources.projectMessages.forEach((message) => byId.set(message.id, message))
  sources.visibleMessages.forEach((message) => byId.set(message.id, message))

  return [...byId.values()]
    .filter((message) => {
      if (userId && Array.isArray(message.visibleToUserIds)) {
        return message.visibleToUserIds.includes(userId)
      }
      return true
    })
    .sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime())
}
