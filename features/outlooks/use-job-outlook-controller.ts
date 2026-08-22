"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import {
  OutlookConflictError,
  saveJobOutlookDraft,
  subscribeJobOutlook,
  subscribeJobOutlookVersions,
  type JobOutlookDraft,
  type JobOutlookVersion,
} from "@/lib/job-outlooks"
import {
  isIsoDate,
  mondayForDate,
  outlookWindow,
  scheduleOutlookTasks,
  type OutlookTask,
} from "@/lib/outlook-core"
import type { JobProfileViewModel } from "@/lib/directory-view-models"
import { generateRealOutlook, outlookPdfErrorMessage } from "@/features/outlooks/generate-real-outlook"
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
    if (tasksMatchVersion(nextTasks, latestVersion)) {
      return latestVersion
    }

    const result = await generateRealOutlook({
      userId,
      jobId: job.sourceId,
      jobDirectoryId: job.id,
      jobName: job.name,
      companyName: job.companyName,
      location: job.location,
      window,
      tasks: nextTasks,
      expectedRevision: revisionRef.current,
    })
    revisionRef.current = result.revision
    setTasks(result.version.tasks)
    // Preserves the pre-refactor behavior exactly: a Comms-posting failure
    // still surfaces as "Changes were saved, but X failed" even though the
    // Outlook + PDF themselves already exist by this point (the realtime
    // subscription above already picked up the new published version).
    if (result.commsError) throw new Error(result.commsError)
    return result.version
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
