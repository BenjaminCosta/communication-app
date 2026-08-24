"use client"

import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, ArrowLeft, Building2, CalendarDays, CheckCircle2, Eye, FileDown, ListChecks, Loader2, Lock, Plus, Sparkles, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatDateTimeInAppZone } from "@/lib/datetime"
import { auth } from "@/lib/firebase"
import { directoryId, parseDirectoryId } from "@/lib/directory-core"
import { loadDirectoryProfileViewModel } from "@/lib/directory-profile-loader"
import { addIsoDays, createOutlookTask, formatOutlookDate, scheduleOutlookTasks, type OutlookIssue, type OutlookTask } from "@/lib/outlook-core"
import { getJobOutlookDraft, getJobOutlookVersion, type JobOutlookVersion } from "@/lib/job-outlooks"
import { generateRealOutlook } from "@/features/outlooks/generate-real-outlook"
import { buildOutlookDeepLink } from "@/lib/whatsapp-secretary/guidance"
import { OutlookFormJobResolver } from "@/components/courtney-roberts-center/outlook-form-job-resolver"
import {
  CourtneyRobertsCenterClientError,
  convertOutlookFormSubmission,
  fetchOutlookFormSubmission,
} from "@/lib/courtney-roberts-center/client"
import type { OutlookFormSubmission } from "@/lib/outlook-form-submissions/types"

interface ResolvedJob {
  sourceId: string
  directoryId: string
  name: string
  companyName: string | null
  location: string | null
}

interface CourtneyRobertsCenterFormGenerateScreenProps {
  submissionId: string
  companies: Array<{ id: string; name: string }>
  onBack: () => void
  className?: string
}

const WEEK_LABELS = ["Week 1", "Week 2", "Week 3"] as const

function daysBetweenIso(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number)
  const [by, bm, bd] = b.split("-").map(Number)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000)
}

/** Which week card (0-2) a task belongs to, or null if it has no usable start date yet. */
function weekBucket(task: OutlookTask, windowStart: string): number | null {
  if (!task.startDate) return null
  const days = daysBetweenIso(windowStart, task.startDate)
  if (!Number.isFinite(days)) return null
  return Math.min(2, Math.max(0, Math.floor(days / 7)))
}

export function CourtneyRobertsCenterFormGenerateScreen({ submissionId, companies, onBack, className }: CourtneyRobertsCenterFormGenerateScreenProps) {
  const [submission, setSubmission] = useState<OutlookFormSubmission | null>(null)
  const [errorStatus, setErrorStatus] = useState<number | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const [tasks, setTasks] = useState<OutlookTask[]>([])
  const [resolvedJob, setResolvedJob] = useState<ResolvedJob | null>(null)
  const [resolvingJob, setResolvingJob] = useState(false)
  // True when the automatic Directory lookup itself failed (network/timeout,
  // not "no such job") — resolvedJob still gets set from the submission's own
  // typed name so the screen stays usable, but that name/company/location was
  // never actually confirmed against Directory. Surfaced explicitly instead of
  // looking identical to a real match.
  const [jobResolutionFailed, setJobResolutionFailed] = useState(false)
  const [showJobResolver, setShowJobResolver] = useState(false)
  const [draftCollisionRevision, setDraftCollisionRevision] = useState<number | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const [generating, setGenerating] = useState(false)
  const [generateError, setGenerateError] = useState<string | null>(null)
  const [commsWarning, setCommsWarning] = useState<string | null>(null)
  // Set as soon as generateRealOutlook() succeeds, cleared once the submission's
  // own bookkeeping (convertOutlookFormSubmission) also succeeds. If bookkeeping
  // fails after a successful generate (a dropped connection, a transient 500),
  // this survives so a retry re-links the ALREADY-created version instead of
  // publishing a second, orphaned one.
  const [createdVersion, setCreatedVersion] = useState<JobOutlookVersion | null>(null)

  // Set once converted (either just now, or re-resolved on reopen below) — the
  // real version's PDF link. Firestore stays the source of truth; never cached
  // on the submission itself.
  const [realVersion, setRealVersion] = useState<JobOutlookVersion | null>(null)
  const [reopenLoading, setReopenLoading] = useState(false)
  const [reopenError, setReopenError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setSubmission(null)
    setErrorStatus(null)
    setErrorMessage(null)
    fetchOutlookFormSubmission(submissionId)
      .then((result) => {
        if (cancelled) return
        setSubmission(result)
        setTasks(result.tasks)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setErrorStatus(err instanceof CourtneyRobertsCenterClientError ? err.status : null)
        setErrorMessage(err instanceof CourtneyRobertsCenterClientError ? err.message : "Unable to load this submission.")
      })
    return () => {
      cancelled = true
    }
  }, [submissionId])

  // Resolve the job once the submission loads — skipped once already converted.
  const resolveJobFromSubmission = (sub: OutlookFormSubmission) => {
    if (!sub.jobContextId) {
      setShowJobResolver(true)
      return
    }
    const sourceId = parseDirectoryId(sub.jobContextId)?.sourceId ?? sub.jobContextId
    const compositeId = directoryId("job", sourceId)
    setResolvingJob(true)
    setJobResolutionFailed(false)
    loadDirectoryProfileViewModel(compositeId)
      .then((vm) => setResolvedJob({ sourceId, directoryId: compositeId, name: vm.name, companyName: vm.companyName ?? null, location: vm.location ?? null }))
      .catch(() => {
        setResolvedJob({ sourceId, directoryId: compositeId, name: sub.jobName, companyName: null, location: null })
        setJobResolutionFailed(true)
      })
      .finally(() => setResolvingJob(false))
  }

  useEffect(() => {
    if (!submission || submission.status === "converted") return
    resolveJobFromSubmission(submission)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submission])

  // Collision guard — surfaced as a persistent warning, not a blocking dialog.
  // handleGenerate() re-checks this fresh right before publishing (this cached
  // value is for display only, so a stale read here can't weaken the guard).
  useEffect(() => {
    if (!resolvedJob || !submission) return
    let cancelled = false
    getJobOutlookDraft(resolvedJob.sourceId, submission.window.start)
      .then((draft) => {
        if (!cancelled) setDraftCollisionRevision(draft && draft.revision > 0 ? draft.revision : null)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [resolvedJob, submission])

  // Reopening an already-converted submission — re-resolve the real version from its 3 tracking fields.
  useEffect(() => {
    if (!submission || submission.status !== "converted") return
    if (!submission.convertedJobContextId || !submission.convertedWindowStart || !submission.convertedVersionId) return
    // Already have it — e.g. we just generated it ourselves this session. Skip the
    // redundant re-fetch so the success view doesn't flash "Loading PDF…" for no reason.
    if (realVersion?.id === submission.convertedVersionId) return
    let cancelled = false
    setReopenLoading(true)
    setReopenError(null)
    getJobOutlookVersion(submission.convertedJobContextId, submission.convertedWindowStart, submission.convertedVersionId)
      .then((version) => {
        if (!cancelled) setRealVersion(version)
      })
      .catch(() => {
        if (!cancelled) setReopenError("Couldn't load the PDF link. The Outlook itself is still available in Directory.")
      })
      .finally(() => {
        if (!cancelled) setReopenLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [submission])

  const scheduled = useMemo(() => (submission ? scheduleOutlookTasks(tasks, submission.window) : null), [tasks, submission])
  const issuesByTaskId = useMemo(() => {
    const map = new Map<string, OutlookIssue[]>()
    for (const issue of scheduled?.issues ?? []) {
      if (issue.kind === "warning") continue
      const list = map.get(issue.taskId) ?? []
      list.push(issue)
      map.set(issue.taskId, list)
    }
    return map
  }, [scheduled])
  const blockingCount = useMemo(() => new Set([...issuesByTaskId.keys()]).size, [issuesByTaskId])

  const weeks = useMemo(() => {
    if (!submission) return [[], [], []] as OutlookTask[][]
    const buckets: OutlookTask[][] = [[], [], []]
    for (const task of tasks) {
      const bucket = weekBucket(task, submission.window.start)
      if (bucket !== null) buckets[bucket].push(task)
    }
    return buckets
  }, [tasks, submission])
  const unscheduled = useMemo(() => tasks.filter((task) => weekBucket(task, submission?.window.start ?? "") === null), [tasks, submission])

  const isLoading = !submission && !errorMessage
  const isDenied = errorStatus === 401 || errorStatus === 403
  const isConverted = submission?.status === "converted"
  const companyNames = useMemo(() => companies.map((company) => company.name), [companies])

  const updateTask = (id: string, patch: Partial<OutlookTask>) => {
    setTasks((current) => current.map((task) => (task.id === id ? { ...task, ...patch } : task)))
  }

  const addTask = (weekIndex: number) => {
    if (!submission) return
    const next = createOutlookTask({ sortOrder: tasks.length, startDate: addIsoDays(submission.window.start, weekIndex * 7) })
    setTasks((current) => [...current, next])
  }

  const deleteTask = (id: string) => {
    setTasks((current) => current.filter((task) => task.id !== id))
    setConfirmDeleteId(null)
  }

  const handleGenerate = async () => {
    if (!submission || !resolvedJob || generating || (scheduled && !scheduled.canPublish)) return
    const user = auth.currentUser
    if (!user) {
      setGenerateError("Please sign in again.")
      return
    }
    setGenerating(true)
    setGenerateError(null)
    setCommsWarning(null)
    try {
      let version = createdVersion
      if (!version) {
        const latestDraft = await getJobOutlookDraft(resolvedJob.sourceId, submission.window.start)
        const expectedRevision = latestDraft && latestDraft.revision > 0 ? latestDraft.revision : null
        const result = await generateRealOutlook({
          userId: user.uid,
          jobId: resolvedJob.sourceId,
          jobDirectoryId: resolvedJob.directoryId,
          jobName: resolvedJob.name,
          companyName: resolvedJob.companyName,
          location: resolvedJob.location,
          window: submission.window,
          tasks: scheduled?.tasks ?? tasks,
          expectedRevision,
        })
        version = result.version
        setCreatedVersion(version)
        if (result.commsError) setCommsWarning(result.commsError)
      }
      const updated = await convertOutlookFormSubmission(submissionId, {
        jobContextId: resolvedJob.sourceId,
        windowStart: submission.window.start,
        versionId: version.id,
      })
      setSubmission(updated)
      setRealVersion(version)
      setCreatedVersion(null)
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : "Unable to generate the Outlook.")
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className={cn("relative flex-1 min-h-0 flex flex-col courtney-roberts-center-glass-screen", className ?? "animate-fade-in")}>
      <div className="shrink-0 border-b border-white/10 animate-slide-down">
        <div className="max-w-2xl mx-auto px-4 md:px-6 app-topbar flex items-center gap-3">
          <button
            onClick={onBack}
            className="w-9 h-9 rounded-full bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center active:scale-95 hover:bg-emerald-500/15 transition-all duration-150 shrink-0"
          >
            <ArrowLeft className="w-4 h-4 text-emerald-300" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-bold tracking-tight truncate">{submission?.jobName ?? "Review Outlook"}</h1>
            {submission && <p className="text-[11px] text-muted-foreground/60">{submission.submittedByName}</p>}
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide">
        <div className="max-w-2xl mx-auto w-full px-4 md:px-6 py-4">
          {isDenied ? (
            <EmptyState icon={<Lock className="w-5 h-5" />} title="Not approved" description={errorMessage ?? "You are not approved to view this."} />
          ) : isLoading ? (
            <div className="flex flex-col gap-3">
              {[0, 1, 2].map((index) => (
                <div key={index} className="h-16 rounded-xl bg-white/6 animate-pulse" />
              ))}
            </div>
          ) : errorMessage ? (
            <EmptyState icon={<AlertTriangle className="w-5 h-5" />} title="Can't load this submission" description={errorMessage} />
          ) : submission && isConverted ? (
            <div className="flex flex-col gap-4">
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.06] p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-emerald-300">Outlook created</p>
                  <p className="text-xs text-muted-foreground/70">
                    {realVersion ? `Version ${realVersion.versionNumber} · ` : ""}Converted successfully
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium border border-emerald-500/60 text-white bg-emerald-500">
                  Converted
                </span>
                {submission.convertedAtMs && (
                  <span className="text-xs text-muted-foreground/60">
                    Converted {formatDateTimeInAppZone(new Date(submission.convertedAtMs), { dateStyle: "medium", timeStyle: "short" })}
                  </span>
                )}
              </div>

              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3.5">
                <p className="text-xs font-semibold text-muted-foreground/60 mb-2.5">Outlook summary</p>
                <div className="flex flex-col gap-3">
                  <SummaryRow icon={<Building2 className="w-4 h-4 text-emerald-400" />} label="Job" value={submission.jobName} />
                  <SummaryRow
                    icon={<CalendarDays className="w-4 h-4 text-emerald-400" />}
                    label="Window"
                    value={`${formatOutlookDate(submission.convertedWindowStart ?? submission.window.start)} – ${formatOutlookDate(submission.window.end, { month: "short", day: "numeric" })}`}
                  />
                  <SummaryRow icon={<ListChecks className="w-4 h-4 text-emerald-400" />} label="Tasks" value={`${submission.tasks.length} tasks`} />
                </div>
              </div>

              {reopenError && <p className="text-xs text-amber-300/90">{reopenError}</p>}

              <div className="flex flex-col gap-2">
                {submission.convertedJobContextId && (
                  <a
                    href={buildOutlookDeepLink(directoryId("job", submission.convertedJobContextId))}
                    className="flex items-center justify-center gap-1.5 rounded-full bg-emerald-500 text-white px-4 py-3 text-sm font-semibold active:scale-95 transition-all duration-150"
                  >
                    <Eye className="w-4 h-4" /> View Outlook
                  </a>
                )}
                {reopenLoading ? (
                  <span className="flex items-center justify-center gap-1.5 rounded-full border border-white/15 px-4 py-2.5 text-xs font-semibold text-muted-foreground/60">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading PDF…
                  </span>
                ) : realVersion?.pdf?.downloadUrl ? (
                  <a
                    href={realVersion.pdf.downloadUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-1.5 rounded-full border border-white/15 px-4 py-2.5 text-xs font-semibold text-muted-foreground active:scale-95 transition-all duration-150"
                  >
                    <FileDown className="w-3.5 h-3.5" /> View PDF
                  </a>
                ) : null}
                <button onClick={onBack} className="flex items-center justify-center gap-1.5 py-2 text-xs font-medium text-emerald-300/90 active:opacity-60">
                  <ArrowLeft className="w-3.5 h-3.5" /> Back to Outlook Forms
                </button>
              </div>
            </div>
          ) : submission ? (
            <div className="flex flex-col gap-4 pb-4">
              <JobCard
                resolvingJob={resolvingJob}
                resolvedJob={resolvedJob}
                resolutionFailed={jobResolutionFailed}
                onChangeJob={() => setShowJobResolver(true)}
                onRetry={() => submission && resolveJobFromSubmission(submission)}
              />

              {showJobResolver && (
                <OutlookFormJobResolver
                  initialQuery={submission.jobName}
                  onCancel={() => setShowJobResolver(false)}
                  onResolved={(job) => {
                    const sourceId = parseDirectoryId(job.directoryContextId)?.sourceId ?? job.directoryContextId
                    setResolvedJob({ sourceId, directoryId: job.directoryContextId, name: job.name, companyName: null, location: null })
                    setShowJobResolver(false)
                  }}
                />
              )}

              {draftCollisionRevision !== null && (
                <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-3.5">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
                  <p className="text-xs text-amber-200/90">
                    An outlook already exists for this job and week (revision {draftCollisionRevision}). Generating will overwrite it.
                  </p>
                </div>
              )}

              {unscheduled.length > 0 && (
                <WeekSection
                  label="Unscheduled"
                  sublabel={`${unscheduled.length} task${unscheduled.length === 1 ? "" : "s"} need a start date`}
                  tasks={unscheduled}
                  companies={companies}
                  issuesByTaskId={issuesByTaskId}
                  confirmDeleteId={confirmDeleteId}
                  onUpdate={updateTask}
                  onDelete={deleteTask}
                  onRequestDelete={setConfirmDeleteId}
                />
              )}

              {weeks.map((weekTasks, index) => (
                <WeekSection
                  key={index}
                  label={WEEK_LABELS[index]}
                  sublabel={formatOutlookDate(addIsoDays(submission.window.start, index * 7), { month: "short", day: "numeric" }) + " – " + formatOutlookDate(addIsoDays(submission.window.start, index * 7 + 6), { month: "short", day: "numeric" })}
                  tasks={weekTasks}
                  companies={companies}
                  issuesByTaskId={issuesByTaskId}
                  confirmDeleteId={confirmDeleteId}
                  onUpdate={updateTask}
                  onDelete={deleteTask}
                  onRequestDelete={setConfirmDeleteId}
                  onAddTask={() => addTask(index)}
                />
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {submission && !isConverted && (
        <div className="shrink-0 border-t border-white/10 bg-[#060b09]/95 backdrop-blur-sm">
          <div className="max-w-2xl mx-auto w-full px-4 md:px-6 py-3 safe-area-pb flex flex-col gap-2">
            {generateError && <p className="text-xs text-red-400/90">{generateError}</p>}
            {commsWarning && <p className="text-xs text-amber-400/90">Outlook created, but posting to Communications failed: {commsWarning}</p>}
            {!generateError && blockingCount > 0 && (
              <p className="text-xs text-red-300/80">
                Fix {blockingCount} task{blockingCount === 1 ? "" : "s"} before generating.
              </p>
            )}
            <button
              onClick={handleGenerate}
              disabled={!resolvedJob || resolvingJob || generating || Boolean(scheduled && !scheduled.canPublish)}
              className="flex items-center justify-center gap-1.5 rounded-full bg-emerald-500 text-white px-4 py-3.5 text-sm font-semibold disabled:opacity-40 active:scale-[0.98] transition-all duration-150"
            >
              {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {generating ? (createdVersion ? "Saving…" : "Generating…") : createdVersion ? "Retry saving" : "Generate Outlook"}
            </button>
          </div>
        </div>
      )}
      <datalist id="crc-outlook-company-options">
        {companyNames.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
    </div>
  )
}

function JobCard({
  resolvingJob,
  resolvedJob,
  resolutionFailed,
  onChangeJob,
  onRetry,
}: {
  resolvingJob: boolean
  resolvedJob: ResolvedJob | null
  /** The automatic Directory lookup failed — resolvedJob is a best-effort fallback built from the submission's own typed name, never confirmed against Directory. */
  resolutionFailed: boolean
  onChangeJob: () => void
  onRetry: () => void
}) {
  return (
    <div className={cn("flex items-center gap-3 rounded-xl border p-3.5", resolutionFailed ? "border-amber-500/30 bg-amber-500/[0.05]" : "border-white/10 bg-white/[0.03]")}>
      <div
        className={cn(
          "w-9 h-9 rounded-full border flex items-center justify-center shrink-0",
          resolutionFailed ? "bg-amber-500/15 border-amber-500/25" : "bg-emerald-500/15 border-emerald-500/25",
        )}
      >
        {resolutionFailed ? <AlertTriangle className="w-4 h-4 text-amber-400" /> : <Building2 className="w-4 h-4 text-emerald-400" />}
      </div>
      <div className="flex-1 min-w-0">
        {resolvingJob ? (
          <p className="text-sm text-muted-foreground/60 flex items-center gap-1.5">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Resolving…
          </p>
        ) : resolvedJob ? (
          <>
            <p className="text-sm font-semibold truncate">{resolvedJob.name}</p>
            {resolutionFailed ? (
              <p className="text-xs text-amber-300/90 mt-0.5">
                Couldn&apos;t verify this against Directory — using the name from the submission.{" "}
                <button onClick={onRetry} className="underline font-semibold">
                  Retry
                </button>
              </p>
            ) : (
              (resolvedJob.companyName || resolvedJob.location) && (
                <p className="text-xs text-muted-foreground/60 truncate">{[resolvedJob.companyName, resolvedJob.location].filter(Boolean).join(" · ")}</p>
              )
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground/60">Not linked yet</p>
        )}
      </div>
      <button onClick={onChangeJob} className="shrink-0 text-xs font-semibold text-emerald-300 active:opacity-60">
        Change
      </button>
    </div>
  )
}

function WeekSection({
  label,
  sublabel,
  tasks,
  companies,
  issuesByTaskId,
  confirmDeleteId,
  onUpdate,
  onDelete,
  onRequestDelete,
  onAddTask,
}: {
  label: string
  sublabel: string
  tasks: OutlookTask[]
  companies: Array<{ id: string; name: string }>
  issuesByTaskId: Map<string, OutlookIssue[]>
  confirmDeleteId: string | null
  onUpdate: (id: string, patch: Partial<OutlookTask>) => void
  onDelete: (id: string) => void
  onRequestDelete: (id: string | null) => void
  onAddTask?: () => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between px-1">
        <p className="text-xs font-semibold text-foreground/80">{label}</p>
        <p className="text-[10px] text-muted-foreground/50">{sublabel}</p>
      </div>
      {tasks.map((task) => (
        <SimpleTaskCard
          key={task.id}
          task={task}
          companies={companies}
          issues={issuesByTaskId.get(task.id) ?? []}
          confirmingDelete={confirmDeleteId === task.id}
          onUpdate={(patch) => onUpdate(task.id, patch)}
          onDelete={() => onDelete(task.id)}
          onRequestDelete={() => onRequestDelete(task.id)}
          onCancelDelete={() => onRequestDelete(null)}
        />
      ))}
      {onAddTask && (
        <button
          onClick={onAddTask}
          className="flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-emerald-500/25 bg-emerald-500/[0.04] text-emerald-300/90 py-2.5 text-xs font-semibold active:scale-[0.99] transition-all duration-150"
        >
          <Plus className="w-3.5 h-3.5" /> Add task
        </button>
      )}
    </div>
  )
}

function SimpleTaskCard({
  task,
  companies,
  issues,
  confirmingDelete,
  onUpdate,
  onDelete,
  onRequestDelete,
  onCancelDelete,
}: {
  task: OutlookTask
  companies: Array<{ id: string; name: string }>
  issues: OutlookIssue[]
  confirmingDelete: boolean
  onUpdate: (patch: Partial<OutlookTask>) => void
  onDelete: () => void
  onRequestDelete: () => void
  onCancelDelete: () => void
}) {
  const [noteOpen, setNoteOpen] = useState(Boolean(task.description))
  const hasIssue = issues.length > 0

  return (
    <div className={cn("rounded-xl border bg-white/[0.03] p-3 flex flex-col gap-2", hasIssue ? "border-red-500/35" : "border-white/10")}>
      <div className="flex items-center gap-2">
        <input
          value={task.title}
          onChange={(event) => onUpdate({ title: event.target.value })}
          placeholder="Task name"
          className="outlook-input flex-1"
        />
        {confirmingDelete ? (
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={onCancelDelete} className="text-[10px] font-semibold text-muted-foreground/70 px-2 py-1.5 active:opacity-60">
              Cancel
            </button>
            <button onClick={onDelete} className="text-[10px] font-semibold text-red-300 bg-red-500/15 border border-red-500/30 rounded-lg px-2 py-1.5 active:opacity-60">
              Delete
            </button>
          </div>
        ) : (
          <button onClick={onRequestDelete} className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground/50 active:opacity-60">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <input
          value={task.trade}
          onChange={(event) => onUpdate({ trade: event.target.value })}
          placeholder="Trade"
          className="outlook-input"
        />
        <input
          list="crc-outlook-company-options"
          value={task.companyName}
          onChange={(event) => {
            const match = companies.find((company) => company.name === event.target.value)
            onUpdate({ companyName: event.target.value, companyContextId: match?.id ?? null })
          }}
          placeholder="Company"
          className="outlook-input"
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <input
          type="date"
          value={task.startDate ?? ""}
          onChange={(event) => onUpdate({ startDate: event.target.value || null })}
          className="outlook-input"
        />
        <input
          type="number"
          min={1}
          value={task.durationDays}
          onChange={(event) => onUpdate({ durationDays: Math.max(1, Math.round(Number(event.target.value) || 1)) })}
          className="outlook-input"
          aria-label="Duration in days"
        />
      </div>

      {noteOpen ? (
        <textarea
          value={task.description}
          onChange={(event) => onUpdate({ description: event.target.value })}
          placeholder="Notes"
          rows={2}
          className="outlook-input resize-none"
        />
      ) : (
        <button onClick={() => setNoteOpen(true)} className="text-left text-[11px] font-medium text-muted-foreground/50 active:opacity-60">
          + Add note
        </button>
      )}

      {hasIssue && <p className="text-[11px] text-red-300/85">{issues[0].message}</p>}
    </div>
  )
}

function SummaryRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-8 h-8 rounded-full bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center shrink-0">{icon}</div>
      <div className="min-w-0">
        <p className="text-[11px] text-muted-foreground/60">{label}</p>
        <p className="text-sm font-semibold truncate">{value}</p>
      </div>
    </div>
  )
}

function EmptyState({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="flex flex-col items-center text-center gap-2 px-6 py-16">
      <div className="w-12 h-12 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-muted-foreground/50">{icon}</div>
      <p className="text-sm font-semibold">{title}</p>
      <p className="text-xs text-muted-foreground/60 max-w-[240px]">{description}</p>
    </div>
  )
}
