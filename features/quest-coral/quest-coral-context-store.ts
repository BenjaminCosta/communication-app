/**
 * Local mock store for Quest Coral's project context (Markdown brief).
 *
 * Same Map + localStorage + custom-event shape as quest-coral-store.ts, but
 * kept in its own key/event: project context is orthogonal to the
 * projects/updates collections (one document per project, not part of the
 * activity feed). This adapter is selected only when the local demo backend
 * is enabled; the Firestore adapter lives in lib/quest-coral-writes.ts.
 */

import { MOCK_PROJECT_CONTEXTS, type ProjectContext, type ProjectContextSource } from "@/lib/quest-coral-core"

const STORAGE_KEY = "svc-quest-coral-context-v1"
const CHANGE_EVENT = "svc-quest-coral-context-change"

const contexts = new Map<string, ProjectContext>()
let hydrated = false

function isBrowser() {
  return typeof window !== "undefined"
}

function seedDefaults() {
  MOCK_PROJECT_CONTEXTS.forEach((context) => contexts.set(context.projectId, context))
}

function readSnapshot(): ProjectContext[] | null {
  if (!isBrowser()) return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    return parsed as ProjectContext[]
  } catch {
    return null
  }
}

function persist() {
  if (!isBrowser()) return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(contexts.values())))
    window.dispatchEvent(new Event(CHANGE_EVENT))
  } catch {
    // Stays usable for this tab even when storage is disabled.
  }
}

function hydrate(force = false) {
  if (hydrated && !force) return
  hydrated = true
  contexts.clear()
  const snapshot = readSnapshot()
  if (!snapshot) {
    seedDefaults()
    persist()
    return
  }
  snapshot.forEach((context) => {
    if (context && typeof context.projectId === "string") contexts.set(context.projectId, context)
  })
}

function allContexts(): ProjectContext[] {
  hydrate()
  return Array.from(contexts.values())
}

export function subscribeQuestCoralContexts(onChange: (next: ProjectContext[]) => void): () => void {
  onChange(allContexts())
  if (!isBrowser()) return () => {}

  const refresh = () => {
    hydrate(true)
    onChange(allContexts())
  }
  window.addEventListener(CHANGE_EVENT, refresh)
  window.addEventListener("storage", refresh)
  return () => {
    window.removeEventListener(CHANGE_EVENT, refresh)
    window.removeEventListener("storage", refresh)
  }
}

export function contextForProject(projectId: string | null | undefined): ProjectContext | null {
  if (!projectId) return null
  hydrate()
  return contexts.get(projectId) ?? null
}

export function saveMockContext(
  projectId: string,
  input: { markdown: string; updatedBy: string; source: ProjectContextSource; fileName?: string | null },
): ProjectContext {
  hydrate()
  const next: ProjectContext = {
    projectId,
    markdown: input.markdown,
    updatedAt: new Date().toISOString(),
    updatedBy: input.updatedBy,
    source: input.source,
    fileName: input.source === "upload" ? input.fileName ?? null : null,
  }
  contexts.set(projectId, next)
  persist()
  return next
}
