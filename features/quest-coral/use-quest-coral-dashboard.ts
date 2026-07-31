"use client"

/**
 * State for the Quest Coral dashboard.
 *
 * Two backends behind one surface, same split as useApplicationsDashboard:
 * local mock data (default) and Firestore (`NEXT_PUBLIC_QUEST_CORAL_BACKEND=true`).
 * The screens never learn which one is live. `createProject`/`addUpdate` are
 * async on both paths so the call sites don't need to branch either — the
 * mock path just resolves immediately.
 *
 * The backend flag defaults to false for safe local/demo behavior. When it is
 * enabled, Firestore projects, updates and Project Context briefs replace the
 * mock stores without changing the screens.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  clampProgress,
  countUnreadProjectActivities,
  computeProjectCoverage,
  effectiveProjectStatus,
  initialsFromName,
  openBlockerCount,
  type MissionFitScore,
  type Project,
  type ProjectContext,
  type ProjectPerson,
  type ProjectStatus,
  type ProjectUnreadState,
  type ProjectUpdate,
  type UpdateType,
} from "@/lib/quest-coral-core"
import { QUEST_CORAL_BACKEND_ENABLED } from "@/lib/quest-coral-flags"
import {
  addMockUpdate,
  createMockProject,
  deleteMockProject,
  deleteMockUpdate,
  generateUpdateId,
  projectById,
  subscribeQuestCoral,
  updateMockProject,
} from "@/features/quest-coral/quest-coral-store"
import { subscribeQuestCoralContexts } from "@/features/quest-coral/quest-coral-context-store"
import {
  markMockQuestCoralProjectRead,
  subscribeMockQuestCoralProjectUnreadStates,
  synchronizeMockQuestCoralProjectUnreadCount,
} from "@/features/quest-coral/quest-coral-unread-store"
import {
  createQuestCoralProject,
  createQuestCoralUpdate,
  deleteQuestCoralProject,
  deleteQuestCoralUpdate,
  patchQuestCoralProject,
  markQuestCoralProjectRead,
  subscribeQuestCoralProjects,
  subscribeQuestCoralProjectContexts,
  subscribeQuestCoralProjectUnreadStates,
  subscribeQuestCoralUpdates,
  synchronizeQuestCoralProjectUnreadCount,
} from "@/lib/quest-coral-writes"

export interface QuestCoralFilters {
  status: ProjectStatus | "all"
  query: string
}

export function emptyQuestCoralFilters(): QuestCoralFilters {
  return { status: "all", query: "" }
}

export interface NewProjectInput {
  name: string
  description: string
  missionFitScore: MissionFitScore
  /** Real contacts/teammates picked via PeopleSearchPicker — the owner is added separately. */
  additionalPeople: ProjectPerson[]
  nextStep: string | null
  nextStepDue: string | null
  /** Free-text "what's happening right now" — optional, becomes the timeline's present phase. */
  timelineNote?: string
  status: ProjectStatus
}

export interface NewUpdateInput {
  type: UpdateType
  body: string
  status?: ProjectStatus
  progress?: number
  nextStep?: string
  nextStepDue?: string | null
  isBlocker: boolean
}

export function useQuestCoralDashboard(currentUserId: string, currentUserName: string) {
  const [projects, setProjects] = useState<Project[]>([])
  const [updates, setUpdates] = useState<ProjectUpdate[]>([])
  const [contexts, setContexts] = useState<ProjectContext[]>([])
  const [unreadStates, setUnreadStates] = useState<ProjectUnreadState[]>([])
  const [filters, setFilters] = useState<QuestCoralFilters>(emptyQuestCoralFilters)
  const [isLoading, setIsLoading] = useState(QUEST_CORAL_BACKEND_ENABLED)
  const [updatesLoaded, setUpdatesLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const pendingUnreadSyncRef = useRef(new Set<string>())

  // ── Data source ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!QUEST_CORAL_BACKEND_ENABLED) {
      return subscribeQuestCoral((next) => {
        setProjects(next.projects)
        setUpdates(next.updates)
        setIsLoading(false)
        setUpdatesLoaded(true)
        setLoadError(null)
      })
    }
    const unsubscribeProjects = subscribeQuestCoralProjects(
      (next) => {
        setProjects(next)
        setIsLoading(false)
        setLoadError(null)
      },
      (error) => {
        setIsLoading(false)
        setLoadError(
          error.message.includes("permission") ? "Quest Coral access is not enabled for this environment yet." : "The projects could not be loaded.",
        )
      },
    )
    const unsubscribeUpdates = subscribeQuestCoralUpdates(
      (next) => setUpdates(next),
      (error) => {
        setUpdatesLoaded(false)
        // Projects still drive isLoading/loadError; this listener only adds
        // detail if updates fail independently (e.g. a rules regression that
        // only affects one of the two collections).
        setLoadError((current) => current ?? (error.message.includes("permission") ? "Quest Coral access is not enabled for this environment yet." : "The updates could not be loaded."))
      },
      () => setUpdatesLoaded(true),
    )
    const unsubscribeContexts = subscribeQuestCoralProjectContexts(
      (next) => setContexts(next),
      (error) => {
        // Context is additive to project tracking. Keep the dashboard usable
        // when a brief fails to load, but surface the problem for a real rules
        // regression instead of silently treating every project as contextless.
        setLoadError((current) => current ?? (error.message.includes("permission") ? "Project context access is not enabled for this environment yet." : "The project contexts could not be loaded."))
      },
    )
    return () => {
      unsubscribeProjects()
      unsubscribeUpdates()
      unsubscribeContexts()
    }
  }, [])

  useEffect(() => {
    if (QUEST_CORAL_BACKEND_ENABLED) return
    return subscribeQuestCoralContexts(setContexts)
  }, [])

  // Per-user reading state is deliberately separate from projects and updates:
  // reading a detail view must never rewrite shared project activity.
  useEffect(() => {
    if (!currentUserId) {
      setUnreadStates([])
      return
    }
    if (QUEST_CORAL_BACKEND_ENABLED) {
      return subscribeQuestCoralProjectUnreadStates(
        currentUserId,
        setUnreadStates,
        (error) => setLoadError((current) => current ?? (error.message.includes("permission") ? "Project activity status is not enabled for this environment yet." : "Project activity status could not be loaded.")),
      )
    }
    return subscribeMockQuestCoralProjectUnreadStates(currentUserId, setUnreadStates)
  }, [currentUserId])

  const unreadStatesByProjectId = useMemo(
    () => new Map(unreadStates.map((state) => [state.projectId, state])),
    [unreadStates],
  )

  // Count from the immutable feed and a per-user read marker rather than
  // incrementing from listener events. Snapshot replays therefore cannot
  // duplicate activities, and the value is always non-negative.
  const unreadCountsByProjectId = useMemo(() => {
    const counts = new Map<string, number>()
    for (const project of projects) {
      const state = unreadStatesByProjectId.get(project.id)
      counts.set(
        project.id,
        updatesLoaded
          ? countUnreadProjectActivities(updates, project.id, currentUserId, state?.lastReadAt)
          : state?.unreadCount ?? 0,
      )
    }
    return counts
  }, [projects, updates, unreadStatesByProjectId, currentUserId, updatesLoaded])

  // Persist the exact derived value as a convenience for future sessions.
  // Each transaction compares the last-read marker first, so a stale
  // dashboard callback cannot resurrect a count after another device reads it.
  useEffect(() => {
    if (!currentUserId || !updatesLoaded) return
    for (const project of projects) {
      const state = unreadStatesByProjectId.get(project.id)
      const unreadCount = unreadCountsByProjectId.get(project.id) ?? 0
      if (state?.unreadCount === unreadCount) continue
      const key = `${project.id}:${state?.lastReadAt ?? "unread"}:${unreadCount}`
      if (pendingUnreadSyncRef.current.has(key)) continue
      pendingUnreadSyncRef.current.add(key)
      const synchronize = QUEST_CORAL_BACKEND_ENABLED
        ? synchronizeQuestCoralProjectUnreadCount(currentUserId, project.id, unreadCount, state?.lastReadAt ?? null)
        : synchronizeMockQuestCoralProjectUnreadCount(currentUserId, project.id, unreadCount, state?.lastReadAt ?? null)
      void synchronize
        .catch(() => {
          setLoadError((current) => current ?? "Project activity status could not be saved.")
        })
        .finally(() => pendingUnreadSyncRef.current.delete(key))
    }
  }, [projects, unreadCountsByProjectId, unreadStatesByProjectId, currentUserId, updatesLoaded])

  const counts = useMemo(() => {
    // "Updated this week" was a recency vanity metric — it said something
    // happened, not whether it needs attention. Open blockers is the more
    // useful portfolio-level stat, matching the module's own framing
    // ("what is blocking them"). A blocker tied to an already-completed
    // project doesn't count as open — same reasoning as clearing a stale
    // next step once a project is done.
    const completedProjectIds = new Set(
      projects.filter((project) => effectiveProjectStatus(project) === "completed").map((project) => project.id),
    )
    return {
      active: projects.length - completedProjectIds.size,
      atRisk: projects.filter((project) => effectiveProjectStatus(project) === "at_risk").length,
      completed: completedProjectIds.size,
      openBlockers: updates.filter((update) => update.isBlocker && !completedProjectIds.has(update.projectId)).length,
    }
  }, [projects, updates])

  const visibleProjects = useMemo(() => {
    const query = filters.query.trim().toLowerCase()
    return projects.filter((project) => {
      if (filters.status !== "all" && effectiveProjectStatus(project) !== filters.status) return false
      if (query && !project.name.toLowerCase().includes(query)) return false
      return true
    })
  }, [projects, filters])

  const getProject = useCallback(
    (id: string | null) => {
      if (!id) return null
      const found = projects.find((project) => project.id === id)
      if (found) return found
      // Covers the mount-race where a screen opens before the mock store's
      // first callback fires. Firestore has no synchronous equivalent — the
      // listener above is the only source there.
      return QUEST_CORAL_BACKEND_ENABLED ? null : projectById(id)
    },
    [projects],
  )

  const updatesForProject = useCallback(
    (projectId: string) => updates.filter((update) => update.projectId === projectId),
    [updates],
  )

  const coverageFor = useCallback((project: Project) => computeProjectCoverage(project, updates), [updates])
  const blockerCountFor = useCallback((projectId: string) => openBlockerCount(projectId, updates), [updates])
  const unreadCountFor = useCallback(
    (projectId: string) => unreadCountsByProjectId.get(projectId) ?? 0,
    [unreadCountsByProjectId],
  )

  const markProjectRead = useCallback(
    async (projectId: string): Promise<void> => {
      if (!currentUserId || !updatesLoaded) return
      const next = QUEST_CORAL_BACKEND_ENABLED
        ? await markQuestCoralProjectRead(currentUserId, projectId)
        : await markMockQuestCoralProjectRead(currentUserId, projectId)
      // Optimistic local state removes the badge immediately; the listener
      // reconciles it with the server timestamp moments later.
      setUnreadStates((current) => [
        ...current.filter((state) => state.projectId !== projectId),
        next,
      ])
    },
    [currentUserId, updatesLoaded],
  )

  const createProject = useCallback(
    async (input: NewProjectInput): Promise<Project> => {
      // Real contacts already carry their own id (Firebase UID or /contacts doc
      // id) — de-dupe by id rather than name in case the picker allows it twice.
      const seen = new Set([currentUserId])
      const extraPeople: ProjectPerson[] = []
      for (const person of input.additionalPeople) {
        if (seen.has(person.id)) continue
        seen.add(person.id)
        extraPeople.push(person)
      }
      const people: ProjectPerson[] = [
        { id: currentUserId, name: currentUserName, initials: initialsFromName(currentUserName) },
        ...extraPeople,
      ]
      const timelineNote = input.timelineNote?.trim()
      const patch: Partial<Project> = {
        name: input.name.trim(),
        description: input.description.trim(),
        missionFitScore: input.missionFitScore,
        status: input.status,
        progress: input.status === "completed" ? 100 : 0,
        people,
        nextStep: input.nextStep,
        nextStepDue: input.nextStepDue,
        timeline: timelineNote
          ? {
              past: { range: "—", items: [] },
              present: { range: "Now", items: [timelineNote] },
              future: { range: "—", items: [] },
            }
          : null,
      }
      if (QUEST_CORAL_BACKEND_ENABLED) {
        return createQuestCoralProject(currentUserId, currentUserName, patch)
      }
      return createMockProject(currentUserId, currentUserName, patch)
    },
    [currentUserId, currentUserName],
  )

  const addUpdate = useCallback(
    async (projectId: string, input: NewUpdateInput): Promise<ProjectUpdate> => {
      const progressValue = input.progress !== undefined ? clampProgress(input.progress) : undefined
      // Reaching 100% always means the project is Completed, even if the
      // status dropdown was left on something else — progress and status
      // must agree, otherwise a project can look "done" on its progress ring
      // while the rest of the app (portfolio stats, filters) still treats it
      // as active.
      const completingProject = input.status === "completed" || progressValue === 100
      const resolvedStatus = completingProject ? "completed" : input.status
      const update: Omit<ProjectUpdate, "id"> = {
        projectId,
        type: input.type,
        authorId: currentUserId,
        authorName: currentUserName,
        body: input.body.trim(),
        status: resolvedStatus,
        progress: progressValue,
        nextStep: input.nextStep,
        nextStepDue: input.nextStepDue ?? null,
        isBlocker: input.isBlocker,
        createdAt: new Date().toISOString(),
      }
      // Completing a project always clears any leftover next step — otherwise
      // an update that marks a project "Completed" without retyping the next
      // step (the common case: there isn't one anymore) leaves the old one
      // dangling, and Project Detail keeps showing it as something to
      // "Mark complete" even though the whole project is already done.
      const projectPatch = {
        status: resolvedStatus,
        progress: progressValue,
        nextStep: completingProject && input.nextStep === undefined ? null : input.nextStep,
        nextStepDue: completingProject && input.nextStepDue === undefined ? null : input.nextStepDue,
      }
      if (QUEST_CORAL_BACKEND_ENABLED) {
        return createQuestCoralUpdate(update, projectPatch)
      }
      const fullUpdate: ProjectUpdate = { ...update, id: generateUpdateId() }
      addMockUpdate(fullUpdate)
      updateMockProject(projectId, (project) => ({
        ...project,
        status: projectPatch.status ?? project.status,
        progress: projectPatch.progress !== undefined ? projectPatch.progress : project.progress,
        nextStep: projectPatch.nextStep !== undefined ? projectPatch.nextStep : project.nextStep,
        nextStepDue: projectPatch.nextStepDue !== undefined ? projectPatch.nextStepDue : project.nextStepDue,
      }))
      return fullUpdate
    },
    [currentUserId, currentUserName],
  )

  /** Progress/status/next-step edits that don't come with a narrative update. */
  const patchProject = useCallback(async (projectId: string, patch: Partial<Project>): Promise<void> => {
    if (QUEST_CORAL_BACKEND_ENABLED) {
      await patchQuestCoralProject(projectId, patch)
      return
    }
    updateMockProject(projectId, (project) => ({ ...project, ...patch }))
  }, [])

  /**
   * Rule-guarded to the project's own owner (firestore.rules), same as the
   * mock's Map-based delete. Deliberately leaves that project's updates
   * behind on both backends — see deleteMockProject's comment.
   */
  const deleteProject = useCallback(async (projectId: string): Promise<void> => {
    if (QUEST_CORAL_BACKEND_ENABLED) {
      await deleteQuestCoralProject(projectId)
      return
    }
    deleteMockProject(projectId)
  }, [])

  /** Rule-guarded to the update's own author on both backends. */
  const deleteUpdate = useCallback(async (updateId: string): Promise<void> => {
    if (QUEST_CORAL_BACKEND_ENABLED) {
      await deleteQuestCoralUpdate(updateId)
      return
    }
    deleteMockUpdate(updateId)
  }, [])

  return {
    currentUserId,
    currentUserName,
    projects,
    updates,
    contexts,
    unreadCountsByProjectId,
    visibleProjects,
    counts,
    filters,
    setFilters,
    isLoading,
    loadError,
    getProject,
    updatesForProject,
    coverageFor,
    blockerCountFor,
    unreadCountFor,
    updatesLoaded,
    markProjectRead,
    createProject,
    addUpdate,
    patchProject,
    deleteProject,
    deleteUpdate,
  }
}

export type QuestCoralDashboard = ReturnType<typeof useQuestCoralDashboard>
