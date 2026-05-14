// Types
export type MessageType = "progress" | "problem" | "feedback" | "decision" | "none"

export interface Contact {
  id: string   // Firebase UID
  name: string
  initials: string
  color: string
  lastSeen?: Date | null
}

export interface Project {
  id: string
  name: string
  color: string
  members: string[] // Firebase UIDs
  ownerId: string
  isFavorited?: boolean
}

export interface Message {
  id: string
  senderId: string       // Firebase UID of sender
  authorId?: string
  participants: string[] // [senderId, ...recipientIds] — used for Firestore array-contains query
  recipientIds?: string[]
  projectId: string | null
  projectIds?: string[]
  text: string
  content?: string
  type: MessageType
  timestamp: Date
  createdAt?: Date
  updatedAt?: Date
  isFavorited?: boolean
  imageUrl?: string
  imagePath?: string
  imageName?: string
  imageContentType?: string
}

export interface MessageDraft {
  text: string
  contactIds: string[]
  projectIds: string[]
  type: MessageType
  imageFile?: File | null
}

export const MESSAGE_TYPE_CONFIG: Record<MessageType, { bg: string; text: string; border: string; label: string }> = {
  progress: { bg: "bg-progress/10",  text: "text-progress",  border: "border-progress/20",  label: "Progress" },
  problem:  { bg: "bg-problem/10",   text: "text-problem",   border: "border-problem/20",   label: "Problem" },
  feedback: { bg: "bg-feedback/10",  text: "text-feedback",  border: "border-feedback/20",  label: "Feedback" },
  decision: { bg: "bg-decision/10",  text: "text-decision",  border: "border-decision/20",  label: "Decision" },
  none:     { bg: "bg-white/5",      text: "text-muted-foreground", border: "border-border", label: "No Type" },
}

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

export function getMessageProjectIds(message: Pick<Message, "projectId" | "projectIds">): string[] {
  const ids = new Set<string>()
  if (Array.isArray(message.projectIds)) {
    message.projectIds.filter(Boolean).forEach((id) => ids.add(id))
  }
  if (message.projectId) ids.add(message.projectId)
  return [...ids]
}

export function messageHasProject(message: Pick<Message, "projectId" | "projectIds">, projectId: string): boolean {
  return getMessageProjectIds(message).includes(projectId)
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
