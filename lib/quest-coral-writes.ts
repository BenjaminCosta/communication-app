"use client"

/**
 * SVC Quest Coral — reads and writes against Firestore (client side).
 *
 * The dashboard and Project Context hook call into this file when
 * `QUEST_CORAL_BACKEND_ENABLED` is true. When it is false, the module uses
 * `features/quest-coral/quest-coral-store.ts` and its local mock instead.
 *
 * Same "one hook, two backends" split as Applications
 * (lib/applications-writes.ts), and the same iOS/PWA cache-reconcile helper
 * (lib/firestore-reconcile.ts) other listeners in this app already rely on.
 */

import {
  collection,
  deleteField,
  deleteDoc,
  doc,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type Unsubscribe,
} from "firebase/firestore"
import { db } from "@/lib/firebase"
import { subscribeWithServerReconcile } from "@/lib/firestore-reconcile"
import {
  QUEST_CORAL_PROJECTS_COLLECTION,
  QUEST_CORAL_PROJECT_CONTEXTS_COLLECTION,
  QUEST_CORAL_FEEDBACK_REPLIES_COLLECTION,
  QUEST_CORAL_PROJECT_UNREAD_STATES_COLLECTION,
  QUEST_CORAL_UPDATES_COLLECTION,
  mapProjectContextDoc,
  mapFeedbackReplyDoc,
  mapProjectDoc,
  mapProjectUnreadStateDoc,
  mapUpdateDoc,
  projectContextToFirestore,
  projectToFirestore,
  updateToFirestore,
} from "@/lib/quest-coral-store"
import {
  publishQuestCoralFeedback,
  synchronizeQuestCoralFeedbackAudience,
} from "@/features/quest-coral/quest-coral-feedback-client"
import {
  QUEST_CORAL_COMMUNICATIONS_SOURCE,
  questCoralCommunicationsContextDescription,
  questCoralCommunicationsContextId,
} from "@/lib/quest-coral-communications"
import {
  blankProject,
  questCoralProjectUnreadStateId,
  type Project,
  type ProjectContext,
  type FeedbackReply,
  type ProjectUnreadState,
  type ProjectUpdate,
} from "@/lib/quest-coral-core"

const PROJECTS_PAGE_SIZE = 500
const UPDATES_PAGE_SIZE = 500
const FEEDBACK_REPLIES_PAGE_SIZE = 1_000
const PROJECT_CONTEXTS_PAGE_SIZE = 500

function normalizedUnreadCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}

/** Shared by patchQuestCoralProject and the project-side half of createQuestCoralUpdate. */
function statusProgressFields(
  patch: Partial<Pick<Project, "status" | "progress" | "nextStep" | "nextStepDue">>,
): DocumentData {
  const data: DocumentData = {}
  if (patch.status !== undefined) data.status = patch.status
  if (patch.progress !== undefined) data.progress = patch.progress
  if (patch.nextStep !== undefined) data.nextStep = patch.nextStep
  if (patch.nextStepDue !== undefined) data.nextStepDue = patch.nextStepDue
  return data
}

// ── Reads ───────────────────────────────────────────────────────────────

export function subscribeQuestCoralProjects(
  onChange: (projects: Project[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  const projectsQuery = query(
    collection(db, QUEST_CORAL_PROJECTS_COLLECTION),
    orderBy("updatedAt", "desc"),
    limit(PROJECTS_PAGE_SIZE),
  )
  return subscribeWithServerReconcile(
    projectsQuery,
    (snapshot) => onChange(snapshot.docs.map((entry) => mapProjectDoc(entry.id, entry.data()))),
    (error) => onError?.(error),
  )
}

export function subscribeQuestCoralUpdates(
  onChange: (updates: ProjectUpdate[]) => void,
  onError?: (error: Error) => void,
  onServerReconciled?: () => void,
): Unsubscribe {
  const updatesQuery = query(
    collection(db, QUEST_CORAL_UPDATES_COLLECTION),
    orderBy("createdAt", "desc"),
    limit(UPDATES_PAGE_SIZE),
  )
  let hasReconciledWithServer = false
  return subscribeWithServerReconcile(
    updatesQuery,
    (snapshot) => {
      onChange(snapshot.docs.map((entry) => mapUpdateDoc(entry.id, entry.data())))
      if (!snapshot.metadata.fromCache && !hasReconciledWithServer) {
        hasReconciledWithServer = true
        onServerReconciled?.()
      }
    },
    (error) => onError?.(error),
  )
}

/**
 * Replies are a separate thread collection so they never inflate project
 * activity or unread counts. They are still live in Project Detail.
 */
export function subscribeQuestCoralFeedbackReplies(
  onChange: (replies: FeedbackReply[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  const repliesQuery = query(
    collection(db, QUEST_CORAL_FEEDBACK_REPLIES_COLLECTION),
    orderBy("createdAt", "desc"),
    limit(FEEDBACK_REPLIES_PAGE_SIZE),
  )
  return subscribeWithServerReconcile(
    repliesQuery,
    (snapshot) => onChange(snapshot.docs.map((entry) => mapFeedbackReplyDoc(entry.id, entry.data()))),
    (error) => onError?.(error),
  )
}

/**
 * Context briefs are small (one per project) and need to be available to the
 * portfolio Ask AI surface as well as to the project detail screen.
 */
export function subscribeQuestCoralProjectContexts(
  onChange: (contexts: ProjectContext[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  const contextsQuery = query(
    collection(db, QUEST_CORAL_PROJECT_CONTEXTS_COLLECTION),
    orderBy("updatedAt", "desc"),
    limit(PROJECT_CONTEXTS_PAGE_SIZE),
  )
  return subscribeWithServerReconcile(
    contextsQuery,
    (snapshot) => onChange(snapshot.docs.map((entry) => mapProjectContextDoc(entry.id, entry.data()))),
    (error) => onError?.(error),
  )
}

/** A focused subscription keeps the Project Detail context card current. */
export function subscribeQuestCoralProjectContext(
  projectId: string,
  onChange: (context: ProjectContext | null) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  const contextQuery = query(
    collection(db, QUEST_CORAL_PROJECT_CONTEXTS_COLLECTION),
    where("projectId", "==", projectId),
    limit(1),
  )
  return subscribeWithServerReconcile(
    contextQuery,
    (snapshot) => {
      const entry = snapshot.docs[0]
      onChange(entry ? mapProjectContextDoc(entry.id, entry.data()) : null)
    },
    (error) => onError?.(error),
  )
}

/** Watches only the authenticated user's private read markers. */
export function subscribeQuestCoralProjectUnreadStates(
  userId: string,
  onChange: (states: ProjectUnreadState[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  const statesQuery = query(
    collection(db, QUEST_CORAL_PROJECT_UNREAD_STATES_COLLECTION),
    where("userId", "==", userId),
  )
  return subscribeWithServerReconcile(
    statesQuery,
    (snapshot) => onChange(snapshot.docs.map((entry) => mapProjectUnreadStateDoc(entry.id, entry.data()))),
    (error) => onError?.(error),
  )
}

// ── Writes ──────────────────────────────────────────────────────────────

export async function createQuestCoralProject(
  ownerId: string,
  ownerName: string,
  patch: Partial<Project>,
): Promise<Project> {
  const { id: _placeholder, ...base } = blankProject("pending", ownerId, ownerName)
  const draft: Omit<Project, "id"> = { ...base, ...patch }
  const projectRef = doc(collection(db, QUEST_CORAL_PROJECTS_COLLECTION))
  const project = { ...draft, id: projectRef.id }
  const contextRef = doc(db, "contexts", questCoralCommunicationsContextId(project.id))
  const batch = writeBatch(db)
  // The project and its Communications context share one client batch. The
  // regular Firestore rules still attribute both records to the project owner.
  batch.set(projectRef, {
    ...projectToFirestore(draft),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  batch.set(contextRef, {
    name: draft.name,
    description: questCoralCommunicationsContextDescription(draft.description),
    fields: [],
    createdBy: ownerId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    sourceModule: QUEST_CORAL_COMMUNICATIONS_SOURCE,
    questCoralProjectId: project.id,
  })
  await batch.commit()
  return project
}

/** Only the owner may call this — enforced by firestore.rules, not re-checked here. */
export async function deleteQuestCoralProject(projectId: string): Promise<void> {
  await deleteDoc(doc(db, QUEST_CORAL_PROJECTS_COLLECTION, projectId))
}

/** Partial update — only the fields present in `patch` are written. */
export async function patchQuestCoralProject(projectId: string, patch: Partial<Project>): Promise<void> {
  const data: DocumentData = { ...statusProgressFields(patch), updatedAt: serverTimestamp() }
  if (patch.name !== undefined) data.name = patch.name
  if (patch.description !== undefined) data.description = patch.description
  if (patch.missionFitScore !== undefined) data.missionFitScore = patch.missionFitScore
  if (patch.people !== undefined) data.people = patch.people
  if (patch.timeline !== undefined) data.timeline = patch.timeline
  if (patch.isFavorited !== undefined) data.isFavorited = patch.isFavorited
  const projectRef = doc(db, QUEST_CORAL_PROJECTS_COLLECTION, projectId)
  if (patch.name === undefined && patch.description === undefined) {
    await updateDoc(projectRef, data)
    if (patch.people !== undefined) await synchronizeQuestCoralFeedbackAudience(projectId)
    return
  }
  const contextRef = doc(db, "contexts", questCoralCommunicationsContextId(projectId))
  await runTransaction(db, async (transaction) => {
    const contextSnapshot = await transaction.get(contextRef)
    transaction.update(projectRef, data)
    const context = contextSnapshot.data()
    if (
      contextSnapshot.exists()
      && context?.sourceModule === QUEST_CORAL_COMMUNICATIONS_SOURCE
      && context?.questCoralProjectId === projectId
    ) {
      const contextData: DocumentData = { updatedAt: serverTimestamp() }
      if (patch.name !== undefined) contextData.name = patch.name
      if (patch.description !== undefined) {
        contextData.description = questCoralCommunicationsContextDescription(patch.description)
      }
      transaction.update(contextRef, contextData)
    }
  })
  if (patch.people !== undefined) await synchronizeQuestCoralFeedbackAudience(projectId)
}

/**
 * Posts a new update and folds its status/progress/next-step into the parent
 * project in one batch — same pairing as the mock store's
 * `addMockUpdate` + `updateMockProject` combo, just atomic here.
 */
export async function createQuestCoralUpdate(
  update: Omit<ProjectUpdate, "id" | "createdAt">,
  projectPatch: Partial<Pick<Project, "status" | "progress" | "nextStep" | "nextStepDue">>,
): Promise<ProjectUpdate> {
  if (update.type === "feedback") {
    const feedbackRef = doc(collection(db, QUEST_CORAL_UPDATES_COLLECTION))
    return publishQuestCoralFeedback({
      feedbackId: feedbackRef.id,
      projectId: update.projectId,
      body: update.body,
      authorName: update.authorName,
      image: update.imageUrl ? {
        url: update.imageUrl,
        path: update.imagePath,
        name: update.imageName,
        contentType: update.imageContentType,
        size: update.imageSize,
      } : undefined,
      attachment: update.fileUrl ? {
        url: update.fileUrl,
        path: update.filePath,
        name: update.fileName,
        contentType: update.fileContentType,
        size: update.fileSize,
      } : undefined,
    })
  }
  const fullUpdate: Omit<ProjectUpdate, "id"> = { ...update, createdAt: new Date().toISOString() }
  const batch = writeBatch(db)

  const updateRef = doc(collection(db, QUEST_CORAL_UPDATES_COLLECTION))
  // Same server-truth override as createQuestCoralProject — the returned
  // `fullUpdate` keeps the client timestamp for the immediate optimistic
  // value, the listener reconciles it with the server one moments later.
  batch.set(updateRef, { ...updateToFirestore(fullUpdate), createdAt: serverTimestamp() })

  const projectData: DocumentData = { ...statusProgressFields(projectPatch), updatedAt: serverTimestamp() }
  batch.update(doc(db, QUEST_CORAL_PROJECTS_COLLECTION, update.projectId), projectData)

  await batch.commit()
  return { ...fullUpdate, id: updateRef.id }
}

/**
 * Materializes a count already derived from the append-only activity feed.
 * The transaction refuses to overwrite a newer read marker from another tab
 * or device, which makes listener replays idempotent and prevents negatives.
 */
export async function synchronizeQuestCoralProjectUnreadCount(
  userId: string,
  projectId: string,
  unreadCount: number,
  observedLastReadAt: string | null,
): Promise<void> {
  const stateRef = doc(
    db,
    QUEST_CORAL_PROJECT_UNREAD_STATES_COLLECTION,
    questCoralProjectUnreadStateId(userId, projectId),
  )
  const nextUnreadCount = normalizedUnreadCount(unreadCount)
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(stateRef)
    if (!snapshot.exists()) {
      // No opening of Project Detail has established a read marker yet. Keep
      // it null so activities remain unread until the user actually opens it.
      if (observedLastReadAt !== null) return
      transaction.set(stateRef, {
        userId,
        projectId,
        unreadCount: nextUnreadCount,
        lastReadAt: null,
        updatedAt: serverTimestamp(),
      })
      return
    }

    const current = mapProjectUnreadStateDoc(snapshot.id, snapshot.data())
    if (current.lastReadAt !== observedLastReadAt || current.unreadCount === nextUnreadCount) return
    transaction.update(stateRef, { unreadCount: nextUnreadCount, updatedAt: serverTimestamp() })
  })
}

/** Marks one project read for the current user only; it never mutates activity. */
export async function markQuestCoralProjectRead(userId: string, projectId: string): Promise<ProjectUnreadState> {
  const stateRef = doc(
    db,
    QUEST_CORAL_PROJECT_UNREAD_STATES_COLLECTION,
    questCoralProjectUnreadStateId(userId, projectId),
  )
  const localReadAt = new Date().toISOString()
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(stateRef)
    const data: DocumentData = {
      userId,
      projectId,
      unreadCount: 0,
      lastReadAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }
    if (snapshot.exists()) transaction.update(stateRef, data)
    else transaction.set(stateRef, data)
  })
  return { userId, projectId, unreadCount: 0, lastReadAt: localReadAt, updatedAt: localReadAt }
}

/** Only the original author may call this — enforced by firestore.rules. */
export async function deleteQuestCoralUpdate(updateId: string): Promise<void> {
  await deleteDoc(doc(db, QUEST_CORAL_UPDATES_COLLECTION, updateId))
}

/**
 * Replaces the Markdown brief for one project without changing the project or
 * its activity feed. Manual saves clear seed provenance, so a later idempotent
 * seed never overwrites a human-authored context.
 */
export async function saveQuestCoralProjectContext(context: ProjectContext): Promise<ProjectContext> {
  const now = new Date().toISOString()
  const next: ProjectContext = { ...context, updatedAt: now }
  await setDoc(
    doc(db, QUEST_CORAL_PROJECT_CONTEXTS_COLLECTION, context.projectId),
    {
      ...projectContextToFirestore(next),
      updatedAt: serverTimestamp(),
      // These fields belong exclusively to the seed. Removing them makes a
      // human edit authoritative even if source documents change later.
      seedKey: deleteField(),
      contentHash: deleteField(),
      seededAt: deleteField(),
      contextSourcePath: deleteField(),
      contextSourceDate: deleteField(),
    },
    { merge: true },
  )
  return next
}
