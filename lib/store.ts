// Types
export type MessageType = "progress" | "problem" | "feedback" | "decision" | "none"

export interface Contact {
  id: string   // Firebase UID
  name: string
  initials: string
  color: string
}

export interface Project {
  id: string
  name: string
  color: string
  members: string[] // Firebase UIDs
  ownerId: string
}

export interface Message {
  id: string
  senderId: string       // Firebase UID of sender
  participants: string[] // [senderId, ...recipientIds] — used for Firestore array-contains query
  projectId: string | null
  text: string
  type: MessageType
  timestamp: Date
  isFavorited?: boolean
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
