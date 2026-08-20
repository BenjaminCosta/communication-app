"use client"

/**
 * State + navigation for the public 3-Week Outlook wizard
 * (app/outlook-form/page.tsx). Mirrors the shape of
 * features/applications/use-candidate-application.ts, scaled down: no
 * server-side session/autosave (nothing is persisted until the final submit,
 * per the shared static public link design).
 */

import { useCallback, useMemo, useState } from "react"
import { createOutlookTask, mondayForDate, outlookWindow, type OutlookTask } from "@/lib/outlook-core"
import {
  composeGeneralNotes,
  nextOutlookFormStep,
  outlookFormWeekBuckets,
  previousOutlookFormStep,
  type OutlookFormNoteTagId,
  type OutlookFormStepId,
} from "@/lib/outlook-form-submissions/wizard-core"
import {
  fetchOutlookFormJobs,
  OutlookFormClientError,
  submitOutlookForm,
  type OutlookFormJobOption,
  type OutlookFormSubmitterRole,
} from "@/lib/outlook-form-submissions/client"

export function useOutlookFormWizard() {
  const [step, setStep] = useState<OutlookFormStepId>("identify")

  // Step 1 — identify
  const [submittedByName, setSubmittedByName] = useState("")
  const [submittedByPhone, setSubmittedByPhone] = useState("")
  const [submittedByCompany, setSubmittedByCompany] = useState("")
  const [submittedByRole, setSubmittedByRole] = useState<OutlookFormSubmitterRole>("site_super")

  // Step 2 — job
  const [jobs, setJobs] = useState<OutlookFormJobOption[] | null>(null)
  const [jobsError, setJobsError] = useState<string | null>(null)
  const [jobSelection, setJobSelection] = useState("") // job id, "other", or ""
  const [otherJobName, setOtherJobName] = useState("")
  const [jobSearch, setJobSearch] = useState("")

  const loadJobs = useCallback(() => {
    if (jobs !== null) return
    fetchOutlookFormJobs()
      .then(setJobs)
      .catch(() => {
        setJobs([])
        setJobsError("Unable to load the job list — pick \"Other\" and type it in.")
      })
  }, [jobs])

  const selectedJob = jobs?.find((job) => job.id === jobSelection) ?? null
  const jobName = jobSelection === "other" ? otherJobName.trim() : (selectedJob?.name ?? "")

  const filteredJobs = useMemo(() => {
    const list = jobs ?? []
    const query = jobSearch.trim().toLowerCase()
    if (!query) return list
    return list.filter((job) => job.name.toLowerCase().includes(query) || job.address?.toLowerCase().includes(query))
  }, [jobs, jobSearch])

  // Step 3 — tasks. The window is fixed at mount (today's Monday), matching
  // the same OUTLOOK_DAY_COUNT=21 convention the real Outlook editor uses.
  const [window] = useState(() => outlookWindow(mondayForDate(new Date())))
  const weekBuckets = useMemo(() => outlookFormWeekBuckets(window.start), [window.start])
  const [tasks, setTasks] = useState<OutlookTask[]>([])
  const [editingTask, setEditingTask] = useState<{ task: OutlookTask; isNew: boolean } | null>(null)

  const startAddTask = useCallback(
    (weekIndex: 0 | 1 | 2) => {
      const bucket = weekBuckets[weekIndex]
      setEditingTask({ task: createOutlookTask({ sortOrder: tasks.length, startDate: bucket.start, durationDays: 3 }), isNew: true })
    },
    [weekBuckets, tasks.length],
  )
  const startEditTask = useCallback((task: OutlookTask) => setEditingTask({ task, isNew: false }), [])
  const closeTaskEditor = useCallback(() => setEditingTask(null), [])
  const saveTask = useCallback((task: OutlookTask) => {
    setTasks((current) => (current.some((entry) => entry.id === task.id) ? current.map((entry) => (entry.id === task.id ? task : entry)) : [...current, task]))
    setEditingTask(null)
  }, [])
  const removeTask = useCallback((taskId: string) => {
    setTasks((current) => current.filter((entry) => entry.id !== taskId))
  }, [])

  // Step 4 — notes
  const [noteTags, setNoteTags] = useState<OutlookFormNoteTagId[]>([])
  const [notesText, setNotesText] = useState("")
  const toggleNoteTag = useCallback((tag: OutlookFormNoteTagId) => {
    setNoteTags((current) => (current.includes(tag) ? current.filter((entry) => entry !== tag) : [...current, tag]))
  }, [])

  // Honeypot — real supers never see or fill this in.
  const [honeypot, setHoneypot] = useState("")

  // Submit
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submittedId, setSubmittedId] = useState<string | null>(null)

  const goNext = useCallback(() => {
    const next = nextOutlookFormStep(step)
    if (next) setStep(next)
  }, [step])
  const goBack = useCallback(() => {
    const prev = previousOutlookFormStep(step)
    if (prev) setStep(prev)
  }, [step])
  const goTo = useCallback((target: OutlookFormStepId) => setStep(target), [])

  const submit = useCallback(() => {
    if (isSubmitting) return
    setIsSubmitting(true)
    setSubmitError(null)
    const tagLabels = noteTags.map((tag) => tag.charAt(0).toUpperCase() + tag.slice(1))
    submitOutlookForm({
      submittedByName: submittedByName.trim(),
      submittedByPhone: submittedByPhone.trim(),
      submittedByCompany: submittedByCompany.trim(),
      submittedByRole,
      byeByeDprJobId: jobSelection && jobSelection !== "other" ? jobSelection : null,
      jobName,
      tasks: tasks
        .filter((task) => task.title.trim())
        .map((task) => ({
          title: task.title,
          trade: task.trade,
          companyName: task.companyName,
          startDate: task.startDate ?? "",
          durationDays: task.durationDays,
          description: task.description,
        })),
      generalNotes: composeGeneralNotes(tagLabels, notesText),
      website: honeypot,
    })
      .then(({ submissionId }) => {
        setSubmittedId(submissionId)
        setStep("submitted")
      })
      .catch((err: unknown) => {
        setSubmitError(err instanceof OutlookFormClientError ? err.message : "Unable to submit this form.")
      })
      .finally(() => setIsSubmitting(false))
  }, [isSubmitting, submittedByName, submittedByPhone, submittedByCompany, submittedByRole, jobSelection, jobName, tasks, noteTags, notesText, honeypot])

  /** "Submit another outlook" — keeps the super's own identity, resets the job/tasks/notes. */
  const resetForAnother = useCallback(() => {
    setJobSelection("")
    setOtherJobName("")
    setJobSearch("")
    setTasks([])
    setNoteTags([])
    setNotesText("")
    setSubmitError(null)
    setSubmittedId(null)
    setStep("identify")
  }, [])

  return {
    step,
    goNext,
    goBack,
    goTo,

    submittedByName,
    setSubmittedByName,
    submittedByPhone,
    setSubmittedByPhone,
    submittedByCompany,
    setSubmittedByCompany,
    submittedByRole,
    setSubmittedByRole,

    jobs,
    jobsError,
    loadJobs,
    jobSelection,
    setJobSelection,
    otherJobName,
    setOtherJobName,
    jobSearch,
    setJobSearch,
    filteredJobs,
    selectedJob,
    jobName,

    window,
    weekBuckets,
    tasks,
    editingTask,
    startAddTask,
    startEditTask,
    closeTaskEditor,
    saveTask,
    removeTask,

    noteTags,
    toggleNoteTag,
    notesText,
    setNotesText,

    honeypot,
    setHoneypot,

    isSubmitting,
    submitError,
    submittedId,
    submit,
    resetForAnother,
  }
}

export type OutlookFormWizard = ReturnType<typeof useOutlookFormWizard>
