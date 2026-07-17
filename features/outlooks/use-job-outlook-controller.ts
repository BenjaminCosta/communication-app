"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import {
  OutlookConflictError,
  attachPdfToOutlookVersion,
  publishJobOutlook,
  saveJobOutlookDraft,
  subscribeJobOutlook,
  subscribeJobOutlookVersions,
  type JobOutlookDraft,
  type JobOutlookVersion,
} from "@/lib/job-outlooks"
import { uploadDirectoryFile } from "@/lib/directory-files"
import {
  formatOutlookRange,
  isIsoDate,
  mondayForDate,
  outlookWindow,
  scheduleOutlookTasks,
  type OutlookTask,
} from "@/lib/outlook-core"
import type { JobProfileViewModel } from "@/lib/directory-view-models"
import type { MessageFileAttachment } from "@/lib/store"

export interface OutlookPostPayload {
  text: string
  contextId: string
  attachment?: MessageFileAttachment | null
}

interface UseJobOutlookControllerInput {
  job: JobProfileViewModel
  userId: string
  onPostUpdate?: (payload: OutlookPostPayload) => void
}

function outlookLoadMessage(error: Error): string {
  const code = "code" in error && typeof error.code === "string" ? error.code : ""
  return code === "permission-denied"
    ? "Outlook access is not enabled for this environment yet."
    : "The outlook could not be loaded."
}

function outlookPdfErrorMessage(error: unknown): string {
  const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : ""
  if (code === "storage/unauthorized") {
    return "The version was saved, but PDF upload is not enabled in Storage yet. Try again after Storage rules are updated."
  }
  return error instanceof Error ? error.message : "The PDF could not be generated."
}

function tasksMatchVersion(tasks: OutlookTask[], version: JobOutlookVersion | null): version is JobOutlookVersion {
  if (!version || version.pdf || tasks.length !== version.tasks.length) return false
  const key = (task: OutlookTask) => [
    task.id,
    task.sortOrder,
    task.title,
    task.description,
    task.trade,
    task.companyName,
    task.companyContextId,
    task.startDate,
    task.durationDays,
    task.endDate,
    task.dependencyTaskId,
    task.status,
    task.completionPercent,
  ]
  return tasks.every((task, index) => JSON.stringify(key(task)) === JSON.stringify(key(version.tasks[index])))
}

export function useJobOutlookController({ job, userId, onPostUpdate }: UseJobOutlookControllerInput) {
  const [windowStart, setWindowStart] = useState(() => mondayForDate(new Date()))
  const window = useMemo(() => outlookWindow(windowStart), [windowStart])
  const [draft, setDraft] = useState<JobOutlookDraft | null>(null)
  const [versions, setVersions] = useState<JobOutlookVersion[]>([])
  const [tasks, setTasks] = useState<OutlookTask[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [generatingPdf, setGeneratingPdf] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const revisionRef = useRef<number | null>(null)

  useEffect(() => {
    setLoading(true)
    setError("")
    setDraft(null)
    setTasks([])
    setVersions([])
    revisionRef.current = null
    const unsubscribeDraft = subscribeJobOutlook(job.sourceId, window.start, (next) => {
      setError("")
      setDraft(next)
      revisionRef.current = next?.revision ?? null
      setTasks(next ? scheduleOutlookTasks(next.tasks, window).tasks : [])
      setLoading(false)
    }, (loadError) => {
      setError(outlookLoadMessage(loadError))
      setLoading(false)
    })
    const unsubscribeVersions = subscribeJobOutlookVersions(job.sourceId, window.start, setVersions, () => {})
    return () => {
      unsubscribeDraft()
      unsubscribeVersions()
    }
  }, [job.sourceId, window.start, window.end])

  useEffect(() => {
    if (!notice) return
    const timer = globalThis.window.setTimeout(() => setNotice(""), 2600)
    return () => globalThis.window.clearTimeout(timer)
  }, [notice])

  const scheduled = useMemo(() => scheduleOutlookTasks(tasks, window), [tasks, window])
  const latestVersion = versions[0] ?? null

  const persist = async (nextTasks: OutlookTask[], message = "Draft saved.") => {
    if (saving) return
    setSaving(true)
    setError("")
    try {
      const normalized = scheduleOutlookTasks(nextTasks, window).tasks
      const revision = await saveJobOutlookDraft({
        userId,
        jobId: job.sourceId,
        jobDirectoryId: job.id,
        window,
        tasks: normalized,
        expectedRevision: revisionRef.current,
      })
      revisionRef.current = revision
      setTasks(normalized)
      setNotice(message)
    } catch (err) {
      setError(err instanceof OutlookConflictError ? err.message : "Changes could not be saved. Try again.")
      throw err
    } finally {
      setSaving(false)
    }
  }

  const selectWindowStart = (value: string) => {
    if (!isIsoDate(value)) return
    setWindowStart(value)
  }

  const generatePdf = async (nextTasks: OutlookTask[] = scheduled.tasks) => {
    if (generatingPdf || saving) return
    setGeneratingPdf(true)
    setError("")
    try {
      let publishedVersion: JobOutlookVersion
      if (tasksMatchVersion(nextTasks, latestVersion)) {
        publishedVersion = latestVersion
      } else {
        const published = await publishJobOutlook({
          userId,
          jobId: job.sourceId,
          jobDirectoryId: job.id,
          window,
          tasks: nextTasks,
          expectedRevision: revisionRef.current,
        })
        revisionRef.current = published.revision
        publishedVersion = published.version
        setTasks(publishedVersion.tasks)
      }
      const [{ generateOutlookPdf }, { shareOrDownloadOutlookPdf }] = await Promise.all([
        import("@/features/outlooks/pdf/generate-outlook-pdf"),
        import("@/features/outlooks/pdf/share-outlook-pdf"),
      ])
      const bytes = await generateOutlookPdf({
        jobName: job.name,
        companyName: job.companyName,
        location: job.location,
        window,
        versionNumber: publishedVersion.versionNumber,
        tasks: publishedVersion.tasks,
      })
      const safeJob = job.name.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/-{2,}/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "job"
      const fileName = `${safeJob}-3-week-outlook-${window.start}-v${publishedVersion.versionNumber}.pdf`
      const file = new File([bytes as BlobPart], fileName, { type: "application/pdf" })
      const stored = await uploadDirectoryFile(userId, job.id, file, {
        category: "report",
        caption: `3-Week Outlook · ${formatOutlookRange(window)} · Version ${publishedVersion.versionNumber}`,
      })
      await attachPdfToOutlookVersion(job.sourceId, window.start, publishedVersion.id, {
        directoryFileId: stored.id,
        storagePath: stored.storagePath,
        downloadUrl: stored.downloadUrl,
        fileName: stored.fileName,
      })
      const outcome = await shareOrDownloadOutlookPdf(file, `3-Week Outlook · ${job.name}`)
      setNotice(
        outcome === "shared"
          ? "PDF published and shared."
          : outcome === "downloaded"
            ? "PDF published and downloaded."
            : "PDF published. Sharing was cancelled.",
      )
    } catch (err) {
      setError(outlookPdfErrorMessage(err))
      throw err
    } finally {
      setGeneratingPdf(false)
    }
  }

  const postLatestVersion = () => {
    if (!latestVersion?.pdf || !onPostUpdate) return
    onPostUpdate({
      text: buildPostText(job, latestVersion),
      contextId: job.sourceId,
      attachment: buildPostAttachment(latestVersion),
    })
  }

  return {
    window,
    draft,
    versions,
    tasks,
    scheduled,
    latestVersion,
    loading,
    saving,
    generatingPdf,
    error,
    notice,
    canPostUpdate: Boolean(latestVersion?.pdf && onPostUpdate),
    setError,
    setNotice,
    persist,
    selectWindowStart,
    generatePdf,
    postLatestVersion,
  }
}

function buildPostText(job: JobProfileViewModel, version: JobOutlookVersion): string {
  return [
    `3-Week Outlook · ${job.name}`,
    `${formatOutlookRange(version.window)} · Version ${version.versionNumber}`,
    "",
    `${version.tasks.length} scheduled task${version.tasks.length === 1 ? "" : "s"}.`,
  ].join("\n")
}

function buildPostAttachment(version: JobOutlookVersion): MessageFileAttachment | null {
  if (!version.pdf?.downloadUrl) return null
  return {
    url: version.pdf.downloadUrl,
    name: version.pdf.fileName || "3-week-outlook.pdf",
    contentType: "application/pdf",
    path: version.pdf.storagePath || undefined,
  }
}
