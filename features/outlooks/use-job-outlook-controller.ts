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
import { publishOutlookVersionToComms } from "@/features/outlooks/outlook-comms-client"
import { shareOrOpenOutlookPdf } from "@/features/outlooks/pdf/share-outlook-pdf"

interface UseJobOutlookControllerInput {
  job: JobProfileViewModel
  userId: string
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
  if (!version || tasks.length !== version.tasks.length) return false
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

export function useJobOutlookController({ job, userId }: UseJobOutlookControllerInput) {
  const [windowStart, setWindowStart] = useState(() => mondayForDate(new Date()))
  const window = useMemo(() => outlookWindow(windowStart), [windowStart])
  const [draft, setDraft] = useState<JobOutlookDraft | null>(null)
  const [versions, setVersions] = useState<JobOutlookVersion[]>([])
  const [tasks, setTasks] = useState<OutlookTask[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
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

  const publishPdfAndComms = async (nextTasks: OutlookTask[]): Promise<JobOutlookVersion> => {
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

    if (!publishedVersion.pdf) {
      const [{ generateOutlookPdf }] = await Promise.all([
        import("@/features/outlooks/pdf/generate-outlook-pdf"),
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
      const pdf = {
        directoryFileId: stored.id,
        storagePath: stored.storagePath,
        downloadUrl: stored.downloadUrl,
        fileName: stored.fileName,
      }
      await attachPdfToOutlookVersion(job.sourceId, window.start, publishedVersion.id, pdf)
      publishedVersion = { ...publishedVersion, pdf }
    }

    await publishOutlookVersionToComms({
      jobContextId: job.sourceId,
      windowStart: window.start,
      versionId: publishedVersion.id,
    })
    return publishedVersion
  }

  const persist = async (nextTasks: OutlookTask[], message = "Draft saved.") => {
    if (saving || publishing) return
    setSaving(true)
    setError("")
    const normalized = scheduleOutlookTasks(nextTasks, window).tasks
    try {
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
    } catch (err) {
      setError(err instanceof OutlookConflictError ? err.message : "Changes could not be saved. Try again.")
      setSaving(false)
      throw err
    }

    const schedule = scheduleOutlookTasks(normalized, window)
    if (!schedule.canPublish) {
      setNotice(`${message} Complete the required task details to publish the PDF.`)
      setSaving(false)
      return
    }

    setPublishing(true)
    try {
      await publishPdfAndComms(normalized)
      setNotice(`${message} PDF updated and posted to Communications.`)
    } catch (err) {
      setError(`Changes were saved, but ${outlookPdfErrorMessage(err)}`)
      throw err
    } finally {
      setPublishing(false)
      setSaving(false)
    }
  }

  const selectWindowStart = (value: string) => {
    if (!isIsoDate(value)) return
    setWindowStart(value)
  }

  const viewLatestPdf = () => {
    if (!latestVersion?.pdf?.downloadUrl) return
    globalThis.window.open(latestVersion.pdf.downloadUrl, "_blank", "noopener,noreferrer")
  }

  const shareLatestPdf = async () => {
    if (!latestVersion?.pdf || saving || publishing) return
    setPublishing(true)
    setError("")
    try {
      const outcome = await shareOrOpenOutlookPdf(latestVersion.pdf, `3-Week Outlook · ${job.name}`)
      setNotice(
        outcome === "shared"
          ? "PDF shared."
          : outcome === "downloaded"
            ? "PDF downloaded."
            : outcome === "opened"
              ? "PDF opened."
              : "Sharing was cancelled.",
      )
    } catch (err) {
      setError(outlookPdfErrorMessage(err))
      throw err
    } finally {
      setPublishing(false)
    }
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
    publishing,
    error,
    notice,
    hasPdf: Boolean(latestVersion?.pdf),
    setError,
    setNotice,
    persist,
    selectWindowStart,
    viewLatestPdf,
    shareLatestPdf,
  }
}
