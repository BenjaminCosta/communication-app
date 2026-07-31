/**
 * Local mock store for Quest Coral (Phase 1 — no Firestore yet).
 *
 * Same shape as features/applications/candidate-links.ts (Map + localStorage
 * + a custom event so every hook instance in the tab stays in sync), but
 * seeded with fictional demo data on first load instead of starting empty —
 * this module has no real "invite" moment, so an empty dashboard would just
 * look broken on first run.
 */

import {
  MOCK_PROJECTS,
  MOCK_UPDATES,
  blankProject,
  type Project,
  type ProjectUpdate,
} from "@/lib/quest-coral-core"

const STORAGE_KEY = "svc-quest-coral-local-v1"
const CHANGE_EVENT = "svc-quest-coral-local-change"

interface QuestCoralSnapshot {
  projects: Project[]
  updates: ProjectUpdate[]
}

const projects = new Map<string, Project>()
const updates = new Map<string, ProjectUpdate>()
let hydrated = false

function isBrowser() {
  return typeof window !== "undefined"
}

function seedDefaults() {
  MOCK_PROJECTS.forEach((project) => projects.set(project.id, project))
  MOCK_UPDATES.forEach((update) => updates.set(update.id, update))
}

function readSnapshot(): QuestCoralSnapshot | null {
  if (!isBrowser()) return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<QuestCoralSnapshot>
    if (!Array.isArray(parsed.projects) || !Array.isArray(parsed.updates)) return null
    return { projects: parsed.projects, updates: parsed.updates }
  } catch {
    return null
  }
}

function persist() {
  if (!isBrowser()) return
  const snapshot: QuestCoralSnapshot = {
    projects: Array.from(projects.values()),
    updates: Array.from(updates.values()),
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
    window.dispatchEvent(new Event(CHANGE_EVENT))
  } catch {
    // Stays usable for this tab even when storage is disabled.
  }
}

function hydrate(force = false) {
  if (hydrated && !force) return
  hydrated = true
  projects.clear()
  updates.clear()
  const snapshot = readSnapshot()
  if (!snapshot) {
    seedDefaults()
    persist()
    return
  }
  snapshot.projects.forEach((project) => {
    if (project && typeof project.id === "string") projects.set(project.id, project)
  })
  snapshot.updates.forEach((update) => {
    if (update && typeof update.id === "string") updates.set(update.id, update)
  })
}

function sortedProjects(): Project[] {
  hydrate()
  return Array.from(projects.values()).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

function sortedUpdates(): ProjectUpdate[] {
  hydrate()
  return Array.from(updates.values()).sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}

export function subscribeQuestCoral(onChange: (next: QuestCoralSnapshot) => void): () => void {
  onChange({ projects: sortedProjects(), updates: sortedUpdates() })
  if (!isBrowser()) return () => {}

  const refresh = () => {
    hydrate(true)
    onChange({ projects: sortedProjects(), updates: sortedUpdates() })
  }
  window.addEventListener(CHANGE_EVENT, refresh)
  window.addEventListener("storage", refresh)
  return () => {
    window.removeEventListener(CHANGE_EVENT, refresh)
    window.removeEventListener("storage", refresh)
  }
}

export function projectById(projectId: string | null | undefined): Project | null {
  if (!projectId) return null
  hydrate()
  return projects.get(projectId) ?? null
}

export function createMockProject(ownerId: string, ownerName: string, patch: Partial<Project>): Project {
  hydrate()
  const id = `proj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  const project: Project = { ...blankProject(id, ownerId, ownerName), ...patch, id }
  projects.set(id, project)
  persist()
  return project
}

export function updateMockProject(
  projectId: string,
  patch: (project: Project) => Project,
): Project | null {
  const current = projectById(projectId)
  if (!current) return null
  const next = { ...patch(current), updatedAt: new Date().toISOString() }
  hydrate()
  projects.set(projectId, next)
  persist()
  return next
}

export function addMockUpdate(update: ProjectUpdate): ProjectUpdate {
  hydrate()
  updates.set(update.id, update)
  persist()
  return update
}

export function generateUpdateId(): string {
  return `upd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

/**
 * Deliberately does NOT cascade-delete that project's updates: the Firestore
 * rules only let each update's own author delete it (see firestore.rules),
 * so a project owner can't necessarily clear a teammate's update there. Both
 * backends leave orphaned updates behind on purpose, so mock and live agree.
 */
export function deleteMockProject(projectId: string): boolean {
  hydrate()
  const existed = projects.delete(projectId)
  if (existed) persist()
  return existed
}

export function deleteMockUpdate(updateId: string): boolean {
  hydrate()
  const existed = updates.delete(updateId)
  if (existed) persist()
  return existed
}
