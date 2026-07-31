/**
 * Local counterpart of the private Firestore unread-state collection.
 *
 * Quest Coral keeps a mock mode for demos. Mirroring the same last-read and
 * materialized-count behavior here prevents that mode from silently behaving
 * differently while the real implementation remains Firestore-backed.
 */

import { questCoralProjectUnreadStateId, type ProjectUnreadState } from "@/lib/quest-coral-core"

const STORAGE_KEY = "svc-quest-coral-unread-v1"
const CHANGE_EVENT = "svc-quest-coral-unread-change"

const states = new Map<string, ProjectUnreadState>()
let hydrated = false

function isBrowser() {
  return typeof window !== "undefined"
}

function readStates(): ProjectUnreadState[] {
  if (!isBrowser()) return []
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]") as unknown
    return Array.isArray(parsed)
      ? parsed.filter((state): state is ProjectUnreadState =>
          !!state
          && typeof state === "object"
          && typeof state.projectId === "string"
          && typeof state.userId === "string"
          && typeof state.unreadCount === "number",
        )
      : []
  } catch {
    return []
  }
}

function hydrate(force = false) {
  if (hydrated && !force) return
  hydrated = true
  states.clear()
  readStates().forEach((state) => states.set(questCoralProjectUnreadStateId(state.userId, state.projectId), state))
}

function persist() {
  if (!isBrowser()) return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(states.values())))
    window.dispatchEvent(new Event(CHANGE_EVENT))
  } catch {
    // The state remains usable for this tab when storage is unavailable.
  }
}

function normalizedUnreadCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}

function statesForUser(userId: string): ProjectUnreadState[] {
  hydrate()
  return Array.from(states.values()).filter((state) => state.userId === userId)
}

export function subscribeMockQuestCoralProjectUnreadStates(
  userId: string,
  onChange: (next: ProjectUnreadState[]) => void,
): () => void {
  onChange(statesForUser(userId))
  if (!isBrowser()) return () => {}
  const refresh = () => {
    hydrate(true)
    onChange(statesForUser(userId))
  }
  window.addEventListener(CHANGE_EVENT, refresh)
  window.addEventListener("storage", refresh)
  return () => {
    window.removeEventListener(CHANGE_EVENT, refresh)
    window.removeEventListener("storage", refresh)
  }
}

export async function synchronizeMockQuestCoralProjectUnreadCount(
  userId: string,
  projectId: string,
  unreadCount: number,
  observedLastReadAt: string | null,
): Promise<void> {
  hydrate()
  const id = questCoralProjectUnreadStateId(userId, projectId)
  const current = states.get(id)
  if (current && current.lastReadAt !== observedLastReadAt) return
  if (current && current.unreadCount === normalizedUnreadCount(unreadCount)) return
  const now = new Date().toISOString()
  states.set(id, {
    userId,
    projectId,
    unreadCount: normalizedUnreadCount(unreadCount),
    lastReadAt: current?.lastReadAt ?? null,
    updatedAt: now,
  })
  persist()
}

export async function markMockQuestCoralProjectRead(userId: string, projectId: string): Promise<ProjectUnreadState> {
  hydrate()
  const now = new Date().toISOString()
  const state: ProjectUnreadState = { userId, projectId, unreadCount: 0, lastReadAt: now, updatedAt: now }
  states.set(questCoralProjectUnreadStateId(userId, projectId), state)
  persist()
  return state
}
