// Types
export type MessageType = "progress" | "problem" | "feedback" | "decision" | "none"

export interface Contact {
  id: string
  name: string
  initials: string
  color: string
}

export interface Project {
  id: string
  name: string
  color: string
}

export interface Message {
  id: string
  contactId: string
  projectId: string | null
  text: string
  type: MessageType
  timestamp: Date
  isMe: boolean
}

// Mockup Contacts
export const CONTACTS: Contact[] = [
  { id: "c1", name: "Mike K.", initials: "MK", color: "bg-emerald-600" },
  { id: "c2", name: "Tom R.", initials: "TR", color: "bg-red-600" },
  { id: "c3", name: "Dan L.", initials: "DL", color: "bg-amber-600" },
  { id: "c4", name: "Ray J.", initials: "RJ", color: "bg-cyan-600" },
  { id: "c5", name: "Lisa M.", initials: "LM", color: "bg-purple-600" },
  { id: "c6", name: "Sarah W.", initials: "SW", color: "bg-pink-600" },
  { id: "c7", name: "James B.", initials: "JB", color: "bg-indigo-600" },
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

// Current user
export const CURRENT_USER: Contact = {
  id: "me",
  name: "You",
  initials: "JO",
  color: "bg-primary",
}

// Initial messages
export const INITIAL_MESSAGES: Message[] = [
  {
    id: "m1",
    contactId: "c1",
    projectId: "p1",
    text: "Foundation pour done on Cool Breeze, ahead of schedule.",
    type: "progress",
    timestamp: new Date(Date.now() - 3600000 * 2),
    isMe: false,
  },
  {
    id: "m2",
    contactId: "c2",
    projectId: "p2",
    text: "Electrical blocked — county permit not issued yet.",
    type: "problem",
    timestamp: new Date(Date.now() - 3600000 * 1.5),
    isMe: false,
  },
  {
    id: "m3",
    contactId: "me",
    projectId: "p2",
    text: "Push to next week, notify the owner today.",
    type: "decision",
    timestamp: new Date(Date.now() - 3600000 * 1.4),
    isMe: true,
  },
  {
    id: "m4",
    contactId: "c3",
    projectId: null,
    text: "Check with the architect before we decide on the tiles.",
    type: "none",
    timestamp: new Date(Date.now() - 3600000 * 0.5),
    isMe: false,
  },
  {
    id: "m5",
    contactId: "c4",
    projectId: null,
    text: "Can we reschedule Friday's site walk?",
    type: "none",
    timestamp: new Date(Date.now() - 3600000 * 0.3),
    isMe: false,
  },
]

// Helper functions
export function getContact(id: string): Contact {
  if (id === "me") return CURRENT_USER
  return CONTACTS.find((c) => c.id === id) || CURRENT_USER
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
