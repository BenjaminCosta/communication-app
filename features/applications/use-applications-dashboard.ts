"use client"

/**
 * State for the internal Applications dashboard.
 *
 * Two backends behind one surface: local mock data (default) and Firestore
 * (`NEXT_PUBLIC_APPLICATIONS_BACKEND=true`). The screens never learn which one
 * is live — that is the whole point of the flag, and what lets the mock keep
 * working as a demo after the backend lands.
 *
 * In Firestore mode, mutations are optimistic: the local copy updates first so
 * the UI stays instant, and the snapshot listener reconciles right after.
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  emptyFilters,
  filterApplications,
  summarizeApplications,
  type ActivityEvent,
  type ApplicationFilters,
  type ApplicationStatus,
  type ApplicationLink,
  type CandidateApplication,
} from "@/lib/applications-core"
import { APPLICATIONS_BACKEND_ENABLED } from "@/lib/applications-flags"
import {
  deleteMockApplication,
  issueApplicationLink,
  subscribeMockApplications,
  updateMockApplication,
} from "@/features/applications/candidate-links"
import {
  approveApplication,
  archiveApplication,
  deleteApplication as deleteApplicationRequest,
  markApplicationHired,
  recordApplicationActivity,
  requestApplicationInfo,
  retryVideoTranscription,
  startApplicationReview,
  subscribeApplicationActivity,
  subscribeApplications,
  unarchiveApplication,
  type ReviewerIdentity,
} from "@/lib/applications-writes"

export type ApplicationSort = "newest" | "oldest" | "progress"

function nowIso(): string {
  return new Date().toISOString()
}

function eventId(): string {
  return `evt-${Math.random().toString(36).slice(2, 9)}`
}

export function useApplicationsDashboard(reviewerName = "You", reviewerUid = "") {
  // No fake data: the pipeline is empty until real applications arrive (live)
  // or an invite creates one. Flag-off dev shows an empty dashboard.
  const [applications, setApplications] = useState<CandidateApplication[]>([])
  const [isLoading, setIsLoading] = useState(APPLICATIONS_BACKEND_ENABLED)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [filters, setFilters] = useState<ApplicationFilters>(emptyFilters)
  const [sort, setSort] = useState<ApplicationSort>("newest")
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const reviewer: ReviewerIdentity = useMemo(
    () => ({ uid: reviewerUid, name: reviewerName }),
    [reviewerUid, reviewerName],
  )

  // ── Data source ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!APPLICATIONS_BACKEND_ENABLED) {
      // The mock pipeline is empty until a reviewer creates an invite. Unlike
      // the retired fixture list, these are real local invite records and the
      // candidate flow writes back to the same registry on submit.
      return subscribeMockApplications((next) => {
        setApplications(next)
        setIsLoading(false)
        setLoadError(null)
      })
    }
    const unsubscribe = subscribeApplications(
      (next) => {
        setApplications(next)
        setIsLoading(false)
        setLoadError(null)
      },
      (error) => {
        setIsLoading(false)
        setLoadError(
          error.message.includes("permission")
            ? "Applications access is not enabled for this environment yet."
            : "The applications could not be loaded.",
        )
      },
    )
    return unsubscribe
  }, [])

  /**
   * Activity is a subcollection, so it only loads for the open candidate —
   * fetching it for the whole list would be a read per row for data nobody
   * is looking at.
   */
  useEffect(() => {
    if (!APPLICATIONS_BACKEND_ENABLED || !selectedId) return
    const unsubscribe = subscribeApplicationActivity(selectedId, (events: ActivityEvent[]) => {
      setApplications((current) =>
        current.map((application) => (application.id === selectedId ? { ...application, activity: events } : application)),
      )
    })
    return unsubscribe
  }, [selectedId])

  // ── Mutations ─────────────────────────────────────────────────────────

  const patchLocal = useCallback(
    (id: string, patch: (application: CandidateApplication) => CandidateApplication) => {
      if (!APPLICATIONS_BACKEND_ENABLED) {
        const next = updateMockApplication(id, patch)
        if (next) {
          setApplications((current) => current.map((application) => (application.id === id ? next : application)))
          return
        }
      }
      setApplications((current) => current.map((application) => (application.id === id ? patch(application) : application)))
    },
    [],
  )

  const localEvent = useCallback(
    (kind: ActivityEvent["kind"], message: string): ActivityEvent => ({
      id: eventId(),
      kind,
      actor: reviewerName,
      message,
      at: nowIso(),
    }),
    [reviewerName],
  )

  const requestInfo = useCallback(
    async (id: string, message: string): Promise<boolean> => {
      if (APPLICATIONS_BACKEND_ENABLED) {
        try {
          await requestApplicationInfo(id, message, reviewer)
        } catch (error) {
          setLoadError(error instanceof Error ? error.message : "The request could not be sent.")
          return false
        }
      }
      patchLocal(id, (application) => ({
        ...application,
        status: "needs_information",
        pendingRequest: message,
        updatedAt: nowIso(),
        activity: [...application.activity, localEvent("info_requested", message)],
      }))
      return true
    },
    [localEvent, patchLocal, reviewer],
  )

  const approve = useCallback(
    async (id: string): Promise<ApplicationLink | null> => {
      if (APPLICATIONS_BACKEND_ENABLED) {
        try {
          const { approvedAt, link } = await approveApplication(id, reviewer)
          patchLocal(id, (application) => ({
            ...application,
            status: "approved",
            pendingRequest: null,
            updatedAt: approvedAt,
            agreement: { ...application.agreement, status: "awaiting_signature", sentAt: approvedAt, expiresAt: link.expiresAt },
            activity: [
              ...application.activity,
              localEvent("approved", "Approved the application and unlocked the operating agreement"),
              localEvent("link_generated", "Generated a secure operating agreement link"),
            ],
          }))
          return link
        } catch (error) {
          setLoadError(error instanceof Error ? error.message : "The approval could not be saved.")
          return null
        }
      }

      const approvedAt = nowIso()
      const link = issueApplicationLink({ applicationId: id, purpose: "agreement" })
      patchLocal(id, (application) => ({
        ...application,
        status: "approved",
        pendingRequest: null,
        updatedAt: approvedAt,
        agreement: { ...application.agreement, status: "awaiting_signature", sentAt: approvedAt, expiresAt: link.expiresAt },
        activity: [
          ...application.activity,
          localEvent("approved", "Approved the application"),
          localEvent("link_generated", "Generated a secure operating agreement link"),
        ],
      }))
      return link
    },
    [localEvent, patchLocal, reviewer],
  )

  const recordActivity = useCallback(
    (id: string, kind: ActivityEvent["kind"], message: string) => {
      if (!message.trim()) return
      patchLocal(id, (application) => ({
        ...application,
        activity: [...application.activity, localEvent(kind, message)],
      }))
      if (APPLICATIONS_BACKEND_ENABLED) {
        recordApplicationActivity(id, kind, message, reviewer).catch(() => setLoadError("The activity could not be recorded."))
      }
    },
    [localEvent, patchLocal, reviewer],
  )

  const archive = useCallback(
    async (id: string): Promise<boolean> => {
      if (APPLICATIONS_BACKEND_ENABLED) {
        try {
          await archiveApplication(id, reviewer)
        } catch (error) {
          setLoadError(error instanceof Error ? error.message : "The application could not be archived.")
          return false
        }
      }
      patchLocal(id, (application) => ({
        ...application,
        status: "archived",
        previousStatus: application.status,
        updatedAt: nowIso(),
        activity: [...application.activity, localEvent("archived", "Archived the application")],
      }))
      return true
    },
    [localEvent, patchLocal, reviewer],
  )

  const unarchive = useCallback(
    async (id: string): Promise<boolean> => {
      if (APPLICATIONS_BACKEND_ENABLED) {
        try {
          await unarchiveApplication(id, reviewer)
        } catch (error) {
          setLoadError(error instanceof Error ? error.message : "The application could not be restored.")
          return false
        }
      }
      patchLocal(id, (application) => ({
        ...application,
        status: application.previousStatus ?? "submitted",
        previousStatus: null,
        updatedAt: nowIso(),
        activity: [...application.activity, localEvent("note", "Restored the application from archive")],
      }))
      return true
    },
    [localEvent, patchLocal, reviewer],
  )

  /** Irreversible — the caller confirms with the reviewer before calling this. */
  const deleteApplication = useCallback(
    async (id: string): Promise<boolean> => {
      if (APPLICATIONS_BACKEND_ENABLED) {
        try {
          await deleteApplicationRequest(id, reviewer)
        } catch (error) {
          setLoadError(error instanceof Error ? error.message : "The application could not be deleted.")
          return false
        }
      } else {
        deleteMockApplication(id)
      }
      setApplications((current) => current.filter((application) => application.id !== id))
      setSelectedId((current) => (current === id ? null : current))
      return true
    },
    [reviewer],
  )

  const retryTranscription = useCallback(
    async (id: string): Promise<boolean> => {
      if (APPLICATIONS_BACKEND_ENABLED) {
        try {
          await retryVideoTranscription(id, reviewer)
        } catch (error) {
          setLoadError(error instanceof Error ? error.message : "The transcript could not be retried.")
          return false
        }
        return true
      }
      // Mock has no Cloud Function behind it — fake a successful retry so the
      // dashboard demonstrates the full pending → processing → completed arc.
      patchLocal(id, (application) => ({
        ...application,
        video: { ...application.video, transcriptionStatus: "pending", processingError: null },
      }))
      setTimeout(() => {
        patchLocal(id, (application) => ({
          ...application,
          video: { ...application.video, transcriptionStatus: "processing" },
        }))
        setTimeout(() => {
          patchLocal(id, (application) => ({
            ...application,
            video: {
              ...application.video,
              transcriptionStatus: "completed",
              transcriptionModel: "mock",
              summaryModel: "mock",
              processedAt: nowIso(),
              processingError: null,
            },
          }))
        }, 1200)
      }, 900)
      return true
    },
    [patchLocal, reviewer],
  )

  const markHired = useCallback(
    async (id: string): Promise<boolean> => {
      if (APPLICATIONS_BACKEND_ENABLED) {
        try {
          await markApplicationHired(id, reviewer)
        } catch (error) {
          setLoadError(error instanceof Error ? error.message : "The candidate could not be marked as hired.")
          return false
        }
      }

      patchLocal(id, (application) => ({
        ...application,
        status: "hired",
        updatedAt: nowIso(),
        activity: [
          ...application.activity,
          localEvent("hired", "Completed payroll setup and marked the candidate as hired"),
        ],
      }))
      return true
    },
    [localEvent, patchLocal, reviewer],
  )

  const startReview = useCallback(
    async (id: string): Promise<boolean> => {
      if (APPLICATIONS_BACKEND_ENABLED) {
        try {
          await startApplicationReview(id, reviewer)
        } catch (error) {
          setLoadError(error instanceof Error ? error.message : "The status could not be updated.")
          return false
        }
      }
      patchLocal(id, (application) => ({
        ...application,
        status: "ready_for_review",
        updatedAt: nowIso(),
        activity: [...application.activity, localEvent("note", "Moved to review")],
      }))
      return true
    },
    [localEvent, patchLocal, reviewer],
  )

  // ── Derived ───────────────────────────────────────────────────────────

  const visibleApplications = useMemo(() => {
    const filtered = filterApplications(applications, filters)
    const sorted = [...filtered]
    sorted.sort((a, b) => {
      if (sort === "progress") return b.updatedAt.localeCompare(a.updatedAt)
      const left = a.submittedAt ?? a.updatedAt
      const right = b.submittedAt ?? b.updatedAt
      return sort === "newest" ? right.localeCompare(left) : left.localeCompare(right)
    })
    return sorted
  }, [applications, filters, sort])

  const counts = useMemo(() => summarizeApplications(applications), [applications])

  const trades = useMemo(
    () => Array.from(new Set(applications.map((application) => application.trade).filter(Boolean))).sort(),
    [applications],
  )

  const jobs = useMemo(() => {
    // Job filter options come from what is actually in the pipeline.
    const byId = new Map<string, CandidateApplication["job"]>()
    applications.forEach((application) => {
      if (application.job.id) byId.set(application.job.id, application.job)
    })
    return [...byId.values()]
  }, [applications])

  const getApplication = useCallback(
    (id: string | null) => (id ? applications.find((application) => application.id === id) ?? null : null),
    [applications],
  )

  return {
    applications,
    visibleApplications,
    counts,
    isLoading,
    loadError,
    isLive: APPLICATIONS_BACKEND_ENABLED,
    reviewer,
    filters,
    setFilters,
    sort,
    setSort,
    jobs,
    trades,
    getApplication,
    /** Tells the hook which candidate's activity to subscribe to. */
    setSelectedId,
    requestInfo,
    approve,
    recordActivity,
    archive,
    unarchive,
    deleteApplication,
    retryTranscription,
    markHired,
    startReview,
  }
}

export type ApplicationsDashboard = ReturnType<typeof useApplicationsDashboard>
