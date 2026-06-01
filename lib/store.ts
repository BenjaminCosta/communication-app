// Types
export type MessageType = "progress" | "problem" | "feedback" | "decision" | "none"

/**
 * TagCategory is a string — supports both system categories (hardcoded constants below)
 * and user-created custom categories (stored as Firestore /categories doc IDs).
 * Legacy values (priority, department, sales) are kept for backward-compat but hidden from UI.
 */
export type TagCategory = string

export interface CategoryConfig {
  label: string
  order: number
  isTimeBased?: boolean
  hint?: string
}

/** Known system categories — fixed, non-deletable */
export const CATEGORY_CONFIG: Record<string, CategoryConfig> = {
  systemType: { label: "Type",       order: 0 },
  project:    { label: "Project",    order: 1,  hint: "Team or client project" },
  status:     { label: "Status",     order: 2,  hint: "Progress, decision, feedback, problem" },
  timedate:   { label: "Date / Time",order: 3,  hint: "Deadline or milestone", isTimeBased: true },
  report:     { label: "Report",     order: 4,  hint: "Reporting or analytics tag" },
  task:       { label: "Task",       order: 5,  hint: "Actionable item or to-do" },
  custom:     { label: "Custom",     order: 6,  hint: "User-defined tag" },
  // Legacy — hidden from picker but kept for backward compat
  priority:   { label: "Priority",   order: 100 },
  department: { label: "Department", order: 101 },
  sales:      { label: "Sales",      order: 102 },
}

/** A category item — either a system category or a user-created one */
export interface CategoryItem {
  id: string        // system key (e.g. "project") or Firestore doc ID for user-created
  name: string
  isSystem: boolean
  isTimeBased?: boolean
}

/** The 5 fixed system categories shown in the UI (excludes systemType which is internal) */
export const SYSTEM_CATEGORIES: CategoryItem[] = [
  { id: "project",  name: "Project",    isSystem: true },
  { id: "status",   name: "Status",     isSystem: true },
  { id: "timedate", name: "Date / Time",isSystem: true, isTimeBased: true },
  { id: "report",   name: "Report",     isSystem: true },
  { id: "task",     name: "Task",       isSystem: true },
]

/** Returns the display label for any category id (system or user-created) */
export function getCategoryLabel(categoryId: string, customCategories: CategoryItem[] = []): string {
  if (CATEGORY_CONFIG[categoryId]) return CATEGORY_CONFIG[categoryId].label
  const custom = customCategories.find(c => c.id === categoryId)
  if (custom) return custom.name
  return "Custom"
}

/** Returns true if this category triggers the date picker */
export function isCategoryTimeBased(categoryId: string, customCategories: CategoryItem[] = []): boolean {
  if (categoryId === "timedate") return true
  const custom = customCategories.find(c => c.id === categoryId)
  return custom?.isTimeBased ?? false
}

/** Categories the user can pick from when creating / editing a tag */
export const USER_SELECTABLE_CATEGORIES: TagCategory[] = [
  "project",
  "status",
  "timedate",
  "report",
  "task",
  "custom",
]

/** Sorted display order for the tag list (excludes systemType) */
export const CATEGORY_ORDER: TagCategory[] = [
  "project",
  "status",
  "timedate",
  "report",
  "task",
  "custom",
  // Legacy — appear at end if tags exist with these categories
  "priority",
  "department",
  "sales",
]

export interface Contact {
  id: string   // Firebase UID
  name: string
  email?: string
  initials: string
  color: string
  lastSeen?: Date | null
  isAdmin?: boolean
}

export type ImportedContactSource = "google" | "manual"
export type ImportedContactStatus = "not_registered" | "registered"

export type ImportedContactVisibility = "private" | "global"

export interface ImportedContact {
  id: string                          // Firestore auto-ID
  ownerUserId: string                 // Firebase UID of the user who imported this contact
  name: string
  email?: string
  phone?: string
  source: ImportedContactSource
  tags: string[]                      // Freeform string labels, e.g. "client", "vendor"
  linkedUserId?: string | null        // Firebase UID once the contact registers
  status: ImportedContactStatus
  visibility?: ImportedContactVisibility  // "private" (default) | "global"
  createdAt: Date
  updatedAt: Date
}

export interface Project {
  id: string
  name: string
  color: string
  members: string[] // Firebase UIDs
  ownerId: string
  isFavorited?: boolean
  tagCategory?: TagCategory
  usageCount?: number
  lastUsedAt?: Date | null
}

export interface Tag {
  id: string
  name: string
  category: TagCategory
  color: string
  projectId?: string
  systemType?: Exclude<MessageType, "none">
  members?: string[]
  ownerId?: string
  isFavorited?: boolean
  usageCount?: number
  lastUsedAt?: Date | null
}

/**
 * A date entry attached to a message for calendar display.
 * A message can have multiple dates (e.g. repeating deadlines).
 * Removing all dates removes the message from the calendar.
 *
 * Future fields (not activated in V1):
 *   reminderAt?: Date          — push notification trigger
 *   notificationEnabled?: boolean
 */
export interface CalendarDate {
  id: string
  date: string        // "YYYY-MM-DD"
  createdAt: Date
  createdBy: string   // Firebase UID
}

export interface Message {
  id: string
  senderId: string        // Firebase UID of sender
  authorId?: string
  participants: string[]  // legacy: used for array-contains query (may be corrupted)
  visibleToUserIds?: string[] // new: computed visibility — author + recipients + tag members
  recipientIds?: string[]
  peopleIds?: string[]
  projectId: string | null
  projectIds?: string[]
  project_id?: string | null
  tagIds?: string[]
  text: string
  content?: string
  type: MessageType
  timestamp: Date
  createdAt?: Date
  updatedAt?: Date
  isFavorited?: boolean
  contactIds?: string[]  // imported contact doc IDs from /contacts collection
  imageUrl?: string
  imagePath?: string
  imageName?: string
  imageContentType?: string
  imageSize?: number
  imageWidth?: number
  imageHeight?: number
  imageUploadedAt?: Date
  calendarDates?: CalendarDate[]  // dates this message appears on in Calendar
}

export interface MessageDraft {
  text: string
  contactIds: string[]        // registered user Firebase UIDs
  peopleIds?: string[]
  importedContactIds?: string[] // imported contact doc IDs from /contacts collection
  projectIds: string[]
  tagIds?: string[]
  type: MessageType
  imageFile?: File | null
  calendarDates?: string[]    // "YYYY-MM-DD" strings; page.tsx wraps to CalendarDate[]
}

export const MESSAGE_TYPE_CONFIG: Record<MessageType, { bg: string; text: string; border: string; label: string }> = {
  progress: { bg: "bg-progress/10",  text: "text-progress",  border: "border-progress/20",  label: "Progress" },
  problem:  { bg: "bg-problem/10",   text: "text-problem",   border: "border-problem/20",   label: "Problem" },
  feedback: { bg: "bg-feedback/10",  text: "text-feedback",  border: "border-feedback/20",  label: "Feedback" },
  decision: { bg: "bg-decision/10",  text: "text-decision",  border: "border-decision/20",  label: "Decision" },
  none:     { bg: "bg-feedback/10",  text: "text-feedback",  border: "border-feedback/20",  label: "Unassigned" },
}

export const SYSTEM_TAG_PREFIX = "type:"
export const PROJECT_TAG_PREFIX = "project:"

export const NO_TYPE_TAG_ID = `${SYSTEM_TAG_PREFIX}none`

export const SYSTEM_TAGS: Tag[] = [
  { id: NO_TYPE_TAG_ID, name: "Unassigned", category: "systemType", color: "bg-feedback" },
  ...(["progress", "problem", "feedback", "decision"] as const).map((type) => ({
    id: `${SYSTEM_TAG_PREFIX}${type}`,
    name: MESSAGE_TYPE_CONFIG[type].label,
    category: "systemType" as const,
    color: MESSAGE_TYPE_CONFIG[type].text,
    systemType: type,
  })),
]

// Project colors palette (cycles when creating new projects)
export const PROJECT_COLORS = [
  "bg-progress",
  "bg-problem",
  "bg-decision",
  "bg-feedback",
  "bg-emerald-600",
  "bg-cyan-600",
  "bg-purple-600",
  "bg-pink-600",
  "bg-indigo-600",
]

// User color palette — assigned at registration
export const USER_COLORS = [
  "bg-emerald-600",
  "bg-red-600",
  "bg-amber-600",
  "bg-cyan-600",
  "bg-purple-600",
  "bg-pink-600",
  "bg-indigo-600",
  "bg-teal-600",
  "bg-orange-600",
  "bg-sky-600",
]

// Helper functions
export function getContactFromList(id: string, contacts: Contact[]): Contact | undefined {
  return contacts.find((c) => c.id === id)
}

export function getProject(id: string | null, projects: Project[]): Project | null {
  if (!id) return null
  return projects.find((p) => p.id === id) || null
}

export function systemTypeTagId(type: MessageType): string {
  return `${SYSTEM_TAG_PREFIX}${type}`
}

export function projectTagId(projectId: string): string {
  return `${PROJECT_TAG_PREFIX}${projectId}`
}

export function parseSystemTypeTagId(tagId: string): Exclude<MessageType, "none"> | null {
  if (!tagId.startsWith(SYSTEM_TAG_PREFIX)) return null
  const value = tagId.slice(SYSTEM_TAG_PREFIX.length) as MessageType
  return value !== "none" && value in MESSAGE_TYPE_CONFIG ? value as Exclude<MessageType, "none"> : null
}

export function parseProjectTagId(tagId: string): string | null {
  return tagId.startsWith(PROJECT_TAG_PREFIX) ? tagId.slice(PROJECT_TAG_PREFIX.length) : null
}

export function projectToTag(project: Project): Tag {
  return {
    id: projectTagId(project.id),
    name: project.name,
    category: project.tagCategory ?? "project",
    color: project.color,
    projectId: project.id,
    members: project.members,
    ownerId: project.ownerId,
    isFavorited: project.isFavorited,
    usageCount: project.usageCount,
    lastUsedAt: project.lastUsedAt ?? null,
  }
}

export function getMessageProjectIds(message: Pick<Message, "projectId" | "projectIds" | "project_id">): string[] {
  const ids = new Set<string>()
  if (Array.isArray(message.projectIds)) {
    message.projectIds.filter(Boolean).forEach((id) => ids.add(id))
  }
  if (message.projectId) ids.add(message.projectId)
  if (message.project_id) ids.add(message.project_id)
  return [...ids]
}

export function messageHasProject(message: Pick<Message, "projectId" | "projectIds">, projectId: string): boolean {
  return getMessageProjectIds(message).includes(projectId)
}

export function getMessageTagIds(
  message: Pick<Message, "tagIds" | "type" | "projectId" | "projectIds" | "project_id">
): string[] {
  const ids = new Set<string>()
  let hasUnassignedTag = false
  if (Array.isArray(message.tagIds)) {
    message.tagIds.filter(Boolean).forEach((id) => {
      if (id === NO_TYPE_TAG_ID) {
        hasUnassignedTag = true
      } else {
        ids.add(id)
      }
    })
  }
  if (message.type && message.type !== "none") {
    ids.add(systemTypeTagId(message.type))
  }
  getMessageProjectIds(message).forEach((id) => ids.add(projectTagId(id)))
  if (ids.size === 0 && ((message.type ?? "none") === "none" || hasUnassignedTag)) {
    ids.add(NO_TYPE_TAG_ID)
  }
  return [...ids]
}

export function getMessagePeopleIds(
  message: Pick<Message, "peopleIds" | "recipientIds" | "participants" | "senderId" | "authorId"> &
    Partial<Pick<Message, "tagIds" | "type" | "projectId" | "projectIds" | "project_id">>
): string[] {
  const ids = new Set<string>()
  if (Array.isArray(message.peopleIds)) {
    message.peopleIds.filter(Boolean).forEach((id) => ids.add(id))
  }
  if (Array.isArray(message.recipientIds)) {
    message.recipientIds.filter(Boolean).forEach((id) => ids.add(id))
  }

  if (message.senderId) ids.delete(message.senderId)
  if (message.authorId) ids.delete(message.authorId)
  return [...ids]
}

export function getMessagePeopleFilterIds(
  message: Pick<Message, "peopleIds" | "recipientIds" | "participants" | "senderId" | "authorId"> &
    Partial<Pick<Message, "tagIds" | "type" | "projectId" | "projectIds" | "project_id">>
): string[] {
  return [...new Set([message.senderId, message.authorId, ...getMessagePeopleIds(message)].filter(Boolean) as string[])]
}

export function messageHasTags(
  message: Pick<Message, "tagIds" | "type" | "projectId" | "projectIds" | "project_id">,
  tagIds: string[]
): boolean {
  if (tagIds.length === 0) return true
  const messageTagIds = new Set(getMessageTagIds(message))
  return tagIds.every((tagId) => messageTagIds.has(tagId))
}

export function messageHasPeople(
  message: Pick<Message, "peopleIds" | "recipientIds" | "participants" | "senderId" | "authorId"> &
    Partial<Pick<Message, "tagIds" | "type" | "projectId" | "projectIds" | "project_id">>,
  peopleIds: string[]
): boolean {
  if (peopleIds.length === 0) return true
  const messagePeopleIds = new Set(getMessagePeopleFilterIds(message))
  return peopleIds.some((personId) => messagePeopleIds.has(personId))
}

export function messageHasAnyTags(message: Pick<Message, "tagIds" | "type" | "projectId" | "projectIds" | "project_id">): boolean {
  return getMessageTagIds(message).length > 0
}

export function messageHasAnyPeople(message: Pick<Message, "peopleIds" | "recipientIds" | "participants" | "senderId" | "authorId">): boolean {
  return getMessagePeopleIds(message).length > 0
}

export function getLegacyTypeFromTagIds(tagIds: string[], fallback: MessageType = "none"): MessageType {
  const systemType = tagIds.map(parseSystemTypeTagId).find(Boolean)
  return systemType ?? fallback
}

export function getLegacyProjectIdsFromTagIds(tagIds: string[], fallback: string[] = []): string[] {
  const parsed = tagIds.map(parseProjectTagId).filter(Boolean) as string[]
  return [...new Set(parsed.length > 0 ? parsed : fallback)]
}

export function getAvailableTags(projects: Project[]): Tag[] {
  return [...SYSTEM_TAGS, ...projects.map(projectToTag)]
}

export function sortTagsByActivity(tags: Tag[], messages: Message[]): Tag[] {
  const stats = new Map<string, { count: number; last: number }>()
  messages.forEach((message) => {
    const time = (message.updatedAt ?? message.createdAt ?? message.timestamp).getTime()
    getMessageTagIds(message).forEach((tagId) => {
      const current = stats.get(tagId) ?? { count: 0, last: 0 }
      stats.set(tagId, { count: current.count + 1, last: Math.max(current.last, time) })
    })
  })

  return [...tags].sort((a, b) => {
    const aStats = stats.get(a.id)
    const bStats = stats.get(b.id)
    const aScore = (aStats?.count ?? a.usageCount ?? 0) * 10000000000000 + (aStats?.last ?? a.lastUsedAt?.getTime() ?? 0)
    const bScore = (bStats?.count ?? b.usageCount ?? 0) * 10000000000000 + (bStats?.last ?? b.lastUsedAt?.getTime() ?? 0)
    if (aScore !== bScore) return bScore - aScore
    if (!!a.isFavorited !== !!b.isFavorited) return a.isFavorited ? -1 : 1
    if (a.category !== b.category) return a.category === "systemType" ? -1 : b.category === "systemType" ? 1 : 0
    return a.name.localeCompare(b.name)
  })
}

/**
 * Compute visibleToUserIds from first-principles.
 * Rule: author + direct recipients + members of all project-tags associated.
 * If nothing → [authorId] only (private/unassigned message).
 */
export function computeVisibleToUserIds(
  authorId: string,
  recipientIds: string[],
  tagIds: string[],
  projects: Project[]
): string[] {
  const visible = new Set<string>([authorId].filter(Boolean))
  recipientIds.filter(Boolean).forEach((id) => visible.add(id))
  tagIds.forEach((tagId) => {
    const projectId = parseProjectTagId(tagId)
    if (projectId) {
      const project = projects.find((p) => p.id === projectId)
      project?.members.filter(Boolean).forEach((id) => visible.add(id))
    }
  })
  return [...visible]
}

export function generateProjectId(): string {
  return `p${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

export function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
  })
}

export function generateId(): string {
  return `m${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function deriveNameFromEmail(email: string): string {
  const local = email.split("@")[0]
  return local
    .split(/[._\-+]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
}

export function deriveInitials(name: string): string {
  const parts = name.trim().split(" ").filter(Boolean)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  }
  return name.slice(0, 2).toUpperCase()
}
