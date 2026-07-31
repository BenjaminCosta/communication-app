/**
 * SVC Quest Coral — Firestore document shapes and mappers.
 *
 * The app works in ISO strings (see `lib/quest-coral-core`) so the domain
 * stays framework-free and testable; Firestore stores Timestamps. This
 * module is the only place that knows about both — same split as
 * `lib/applications-store.ts` for the sibling module.
 *
 * Nothing here writes — see `lib/quest-coral-writes.ts`. The dashboard and
 * Project Context hook select these mappers when
 * `QUEST_CORAL_BACKEND_ENABLED` is enabled; mock mode remains available for
 * the local demonstration data.
 */

import { Timestamp, type DocumentData } from "firebase/firestore"
import {
  PROJECT_STATUS_ORDER,
  UPDATE_TYPE_ORDER,
  clampProgress,
  type Project,
  type ProjectPerson,
  type ProjectStatus,
  type ProjectTimeline,
  type ProjectTimelinePhase,
  type ProjectContext,
  type ProjectContextSource,
  type ProjectUnreadState,
  type ProjectUpdate,
  type UpdateType,
} from "@/lib/quest-coral-core"

export const QUEST_CORAL_PROJECTS_COLLECTION = "questCoralProjects"
export const QUEST_CORAL_UPDATES_COLLECTION = "questCoralUpdates"
/** One Markdown brief per Quest Coral project; the document id is its project id. */
export const QUEST_CORAL_PROJECT_CONTEXTS_COLLECTION = "questCoralProjectContexts"
/** Private per-user reading markers for the immutable Quest Coral activity feed. */
export const QUEST_CORAL_PROJECT_UNREAD_STATES_COLLECTION = "questCoralProjectUnreadStates"

// ── Timestamp ↔ ISO ─────────────────────────────────────────────────────

export function toIso(value: unknown): string | null {
  if (value instanceof Timestamp) return value.toDate().toISOString()
  if (value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function") {
    const date = (value as { toDate: () => Date }).toDate()
    if (date instanceof Date && !Number.isNaN(date.getTime())) return date.toISOString()
  }
  if (value instanceof Date) return value.toISOString()
  if (typeof value === "string" && value) return value
  return null
}

function isoOrNow(value: unknown): string {
  return toIso(value) ?? new Date().toISOString()
}

export function toTimestamp(iso: string | null | undefined): Timestamp | null {
  if (!iso) return null
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : Timestamp.fromDate(date)
}

// ── Readers ─────────────────────────────────────────────────────────────

function mapStatus(value: unknown): ProjectStatus {
  return (PROJECT_STATUS_ORDER as string[]).includes(value as string) ? (value as ProjectStatus) : "planning"
}

function mapUpdateType(value: unknown): UpdateType {
  return (UPDATE_TYPE_ORDER as string[]).includes(value as string) ? (value as UpdateType) : "update"
}

function mapMissionFitScore(value: unknown): Project["missionFitScore"] {
  const score = typeof value === "number" ? Math.round(value) : 3
  return Math.max(1, Math.min(5, score)) as Project["missionFitScore"]
}

function mapPeople(raw: unknown): ProjectPerson[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object")
    .map((entry) => ({
      id: typeof entry.id === "string" ? entry.id : "",
      name: typeof entry.name === "string" ? entry.name : "",
      initials: typeof entry.initials === "string" ? entry.initials : "",
    }))
    .filter((person) => person.id && person.name)
}

function mapTimelinePhase(raw: unknown): ProjectTimelinePhase {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
  return {
    range: typeof source.range === "string" ? source.range : "",
    items: Array.isArray(source.items) ? source.items.filter((item): item is string => typeof item === "string") : [],
  }
}

function mapTimeline(raw: unknown): ProjectTimeline | null {
  if (!raw || typeof raw !== "object") return null
  const source = raw as Record<string, unknown>
  return {
    past: mapTimelinePhase(source.past),
    present: mapTimelinePhase(source.present),
    future: mapTimelinePhase(source.future),
  }
}

export function mapProjectDoc(id: string, data: DocumentData): Project {
  return {
    id,
    name: typeof data.name === "string" ? data.name : "",
    description: typeof data.description === "string" ? data.description : "",
    status: mapStatus(data.status),
    progress: typeof data.progress === "number" ? clampProgress(data.progress) : 0,
    missionFitScore: mapMissionFitScore(data.missionFitScore),
    ownerId: typeof data.ownerUserId === "string" ? data.ownerUserId : "",
    ownerName: typeof data.ownerName === "string" ? data.ownerName : "",
    people: mapPeople(data.people),
    nextStep: typeof data.nextStep === "string" ? data.nextStep : null,
    nextStepDue: typeof data.nextStepDue === "string" ? data.nextStepDue : null,
    timeline: mapTimeline(data.timeline),
    createdAt: isoOrNow(data.createdAt),
    updatedAt: isoOrNow(data.updatedAt),
    isFavorited: data.isFavorited === true,
  }
}

export function mapUpdateDoc(id: string, data: DocumentData): ProjectUpdate {
  return {
    id,
    projectId: typeof data.projectId === "string" ? data.projectId : "",
    type: mapUpdateType(data.type),
    authorId: typeof data.authorId === "string" ? data.authorId : "",
    authorName: typeof data.authorName === "string" ? data.authorName : "",
    body: typeof data.body === "string" ? data.body : "",
    status: typeof data.status === "string" ? mapStatus(data.status) : undefined,
    progress: typeof data.progress === "number" ? clampProgress(data.progress) : undefined,
    nextStep: typeof data.nextStep === "string" ? data.nextStep : undefined,
    nextStepDue: typeof data.nextStepDue === "string" ? data.nextStepDue : data.nextStepDue === null ? null : undefined,
    isBlocker: data.isBlocker === true,
    createdAt: isoOrNow(data.createdAt),
  }
}

function mapProjectContextSource(value: unknown): ProjectContextSource {
  return value === "upload" ? "upload" : "manual"
}

/** Maps the independently persisted Markdown brief for a project. */
export function mapProjectContextDoc(id: string, data: DocumentData): ProjectContext {
  return {
    // Context documents are keyed by project id. Keep the explicit field as a
    // compatibility guard for imported/admin-written documents.
    projectId: typeof data.projectId === "string" && data.projectId ? data.projectId : id,
    markdown: typeof data.markdown === "string" ? data.markdown : "",
    updatedAt: isoOrNow(data.updatedAt),
    updatedBy: typeof data.updatedBy === "string" && data.updatedBy ? data.updatedBy : "SVC",
    source: mapProjectContextSource(data.source),
    fileName: typeof data.fileName === "string" && data.fileName ? data.fileName : null,
  }
}

function mapUnreadCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0
  return Math.max(0, Math.floor(value))
}

/** Maps a private per-user unread state; the document id is not exposed in the domain. */
export function mapProjectUnreadStateDoc(id: string, data: DocumentData): ProjectUnreadState {
  const [fallbackUserId = "", fallbackProjectId = ""] = id.split("__", 2)
  return {
    projectId: typeof data.projectId === "string" && data.projectId ? data.projectId : fallbackProjectId,
    userId: typeof data.userId === "string" && data.userId ? data.userId : fallbackUserId,
    unreadCount: mapUnreadCount(data.unreadCount),
    lastReadAt: toIso(data.lastReadAt),
    updatedAt: isoOrNow(data.updatedAt),
  }
}

// ── Writers ─────────────────────────────────────────────────────────────

/** Fields a client is allowed to set on create/update — no `id`, matches doc id instead. */
export function projectToFirestore(project: Omit<Project, "id">): DocumentData {
  return {
    name: project.name,
    description: project.description,
    status: project.status,
    progress: project.progress,
    missionFitScore: project.missionFitScore,
    ownerUserId: project.ownerId,
    ownerName: project.ownerName,
    people: project.people,
    nextStep: project.nextStep,
    nextStepDue: project.nextStepDue,
    timeline: project.timeline,
    createdAt: toTimestamp(project.createdAt),
    updatedAt: toTimestamp(project.updatedAt),
    isFavorited: project.isFavorited ?? false,
  }
}

export function updateToFirestore(update: Omit<ProjectUpdate, "id">): DocumentData {
  return {
    projectId: update.projectId,
    type: update.type,
    authorId: update.authorId,
    authorName: update.authorName,
    body: update.body,
    status: update.status ?? null,
    progress: update.progress ?? null,
    nextStep: update.nextStep ?? null,
    nextStepDue: update.nextStepDue ?? null,
    isBlocker: update.isBlocker,
    createdAt: toTimestamp(update.createdAt),
  }
}

export function projectContextToFirestore(context: ProjectContext): DocumentData {
  return {
    projectId: context.projectId,
    markdown: context.markdown,
    updatedAt: toTimestamp(context.updatedAt),
    updatedBy: context.updatedBy,
    source: context.source,
    fileName: context.source === "upload" ? context.fileName ?? null : null,
  }
}
