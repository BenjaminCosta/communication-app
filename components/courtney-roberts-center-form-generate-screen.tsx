"use client"

import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, ArrowLeft, ExternalLink, FileDown, Loader2, Lock, Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatDateTimeInAppZone } from "@/lib/datetime"
import { auth } from "@/lib/firebase"
import { directoryId, parseDirectoryId } from "@/lib/directory-core"
import { loadDirectoryProfileViewModel } from "@/lib/directory-profile-loader"
import { formatOutlookDate, scheduleOutlookTasks, type OutlookIssue, type OutlookTask } from "@/lib/outlook-core"
import { getJobOutlookDraft, getJobOutlookVersion, type JobOutlookVersion } from "@/lib/job-outlooks"
import { generateRealOutlook } from "@/features/outlooks/generate-real-outlook"
import { buildOutlookDeepLink } from "@/lib/whatsapp-secretary/guidance"
import { OutlookAdvancedView } from "@/components/directory/outlooks/outlook-advanced-view"
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

export function CourtneyRobertsCenterFormGenerateScreen({ submissionId, companies, onBack, className }: CourtneyRobertsCenterFormGenerateScreenProps) {
  const [submission, setSubmission] = useState<OutlookFormSubmission | null>(null)
  const [errorStatus, setErrorStatus] = useState<number | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const [tasks, setTasks] = useState<OutlookTask[]>([])
  const [resolvedJob, setResolvedJob] = useState<ResolvedJob | null>(null)
  const [resolvingJob, setResolvingJob] = useState(false)
  const [showJobResolver, setShowJobResolver] = useState(false)
  const [existingDraftRevision, setExistingDraftRevision] = useState<number | null>(null)

  const [generating, setGenerating] = useState(false)
  const [generateError, setGenerateError] = useState<string | null>(null)
  const [commsWarning, setCommsWarning] = useState<string | null>(null)

  // Set once converted (either just now, or re-resolved on reopen below) — the
  // real version's PDF link. Firestore stays the source of truth; never cached
  // on the submission itself.
  const [realVersion, setRealVersion] = useState<JobOutlookVersion | null>(null)
  const [reopenLoading, setReopenLoading] = useState(false)

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
  useEffect(() => {
    if (!submission || submission.status === "converted") return
    if (!submission.jobContextId) {
      setShowJobResolver(true)
      return
    }
    const sourceId = parseDirectoryId(submission.jobContextId)?.sourceId ?? submission.jobContextId
    const compositeId = directoryId("job", sourceId)
    setResolvingJob(true)
    loadDirectoryProfileViewModel(compositeId)
      .then((vm) => setResolvedJob({ sourceId, directoryId: compositeId, name: vm.name, companyName: vm.companyName ?? null, location: vm.location ?? null }))
      .catch(() => setResolvedJob({ sourceId, directoryId: compositeId, name: submission.jobName, companyName: null, location: null }))
      .finally(() => setResolvingJob(false))
  }, [submission])

  // Collision guard — surfaced as a persistent warning, not a blocking dialog.
  useEffect(() => {
    if (!resolvedJob || !submission) return
    let cancelled = false
    getJobOutlookDraft(resolvedJob.sourceId, submission.window.start)
      .then((draft) => {
        if (!cancelled) setExistingDraftRevision(draft && draft.revision > 0 ? draft.revision : null)
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
    setReopenLoading(true)
    getJobOutlookVersion(submission.convertedJobContextId, submission.convertedWindowStart, submission.convertedVersionId)
      .then(setRealVersion)
      .finally(() => setReopenLoading(false))
  }, [submission])

  const scheduled = useMemo(() => (submission ? scheduleOutlookTasks(tasks, submission.window) : null), [tasks, submission])
  const blockingIssues = useMemo(() => (scheduled ? scheduled.issues.filter((issue) => issue.kind !== "warning") : []), [scheduled])

  const isLoading = !submission && !errorMessage
  const isDenied = errorStatus === 401 || errorStatus === 403
  const isConverted = submission?.status === "converted"

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
      const result = await generateRealOutlook({
        userId: user.uid,
        jobId: resolvedJob.sourceId,
        jobDirectoryId: resolvedJob.directoryId,
        jobName: resolvedJob.name,
        companyName: resolvedJob.companyName,
        location: resolvedJob.location,
        window: submission.window,
        tasks: scheduled?.tasks ?? tasks,
        expectedRevision: null,
      })
      const updated = await convertOutlookFormSubmission(submissionId, {
        jobContextId: resolvedJob.sourceId,
        windowStart: submission.window.start,
        versionId: result.version.id,
      })
      setSubmission(updated)
      setRealVersion(result.version)
      if (result.commsError) setCommsWarning(result.commsError)
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : "Unable to generate the Outlook.")
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className={cn("flex-1 min-h-0 flex flex-col courtney-roberts-center-glass-screen", className ?? "animate-fade-in")}>
      <div className="shrink-0 border-b border-white/10 animate-slide-down">
        <div className="max-w-2xl mx-auto px-4 md:px-6 app-topbar flex items-center gap-3">
          <button
            onClick={onBack}
            className="w-9 h-9 rounded-full bg-white/5 border border-white/10 flex items-center justify-center active:scale-95 hover:bg-white/8 transition-all duration-150 shrink-0"
          >
            <ArrowLeft className="w-4 h-4 text-muted-foreground" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-bold tracking-tight truncate">{submission?.jobName ?? "Generate Outlook"}</h1>
            {submission && <p className="text-[11px] text-muted-foreground/60">{isConverted ? "Converted" : "Review & Generate Outlook"}</p>}
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
              <div className="rounded-xl border border-violet-500/30 bg-violet-500/[0.06] p-4">
                <p className="text-sm font-semibold text-violet-300 mb-1 flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4" /> Converted to a real Outlook
                </p>
                <p className="text-xs text-muted-foreground/70">
                  {submission.jobName} · Week of {formatOutlookDate(submission.convertedWindowStart ?? submission.window.start)}
                  {realVersion ? ` · Version ${realVersion.versionNumber}` : ""}
                </p>
                {submission.convertedByName && (
                  <p className="text-xs text-muted-foreground/50 mt-1">
                    By {submission.convertedByName}
                    {submission.convertedAtMs ? ` on ${formatDateTimeInAppZone(new Date(submission.convertedAtMs), { dateStyle: "medium", timeStyle: "short" })}` : ""}
                  </p>
                )}
                <div className="flex items-center gap-2 mt-3">
                  {submission.convertedJobContextId && (
                    <a
                      href={buildOutlookDeepLink(directoryId("job", submission.convertedJobContextId))}
                      className="flex-1 flex items-center justify-center gap-1.5 rounded-full border border-violet-500/30 bg-violet-500/15 text-violet-200 px-4 py-2.5 text-xs font-semibold active:scale-95 transition-all duration-150"
                    >
                      <ExternalLink className="w-3.5 h-3.5" /> View in Directory
                    </a>
                  )}
                  {reopenLoading ? (
                    <span className="flex-1 flex items-center justify-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-xs font-semibold text-muted-foreground/60">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading PDF…
                    </span>
                  ) : realVersion?.pdf?.downloadUrl ? (
                    <a
                      href={realVersion.pdf.downloadUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 flex items-center justify-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-xs font-semibold active:scale-95 transition-all duration-150"
                    >
                      <FileDown className="w-3.5 h-3.5" /> View PDF
                    </a>
                  ) : null}
                </div>
              </div>
            </div>
          ) : submission ? (
            <div className="flex flex-col gap-4 pb-4">
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3.5">
                <p className="text-xs font-semibold text-muted-foreground/60 mb-1">Job</p>
                {resolvingJob ? (
                  <p className="text-sm text-muted-foreground/60 flex items-center gap-1.5">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Resolving…
                  </p>
                ) : resolvedJob ? (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold truncate">{resolvedJob.name}</span>
                    <button
                      onClick={() => setShowJobResolver((current) => !current)}
                      className="shrink-0 text-xs font-semibold text-violet-300 active:opacity-60"
                    >
                      Change
                    </button>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground/60">Not linked yet</p>
                )}
              </div>

              {showJobResolver && (
                <OutlookFormJobResolver
                  initialQuery={submission.jobName}
                  onResolved={(job) => {
                    const sourceId = parseDirectoryId(job.directoryContextId)?.sourceId ?? job.directoryContextId
                    setResolvedJob({ sourceId, directoryId: job.directoryContextId, name: job.name, companyName: null, location: null })
                    setShowJobResolver(false)
                  }}
                />
              )}

              {existingDraftRevision !== null && (
                <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-3.5">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
                  <p className="text-xs text-amber-200/90">
                    An outlook already exists for this job and week (revision {existingDraftRevision}). Generating will overwrite it.
                  </p>
                </div>
              )}

              {blockingIssues.length > 0 && (
                <div className="rounded-xl border border-red-500/30 bg-red-500/[0.06] p-3.5">
                  <p className="text-xs font-semibold text-red-300 mb-1.5">Fix before generating</p>
                  <ul className="flex flex-col gap-1">
                    {blockingIssues.map((issue) => (
                      <IssueRow key={issue.id} issue={issue} tasks={tasks} />
                    ))}
                  </ul>
                </div>
              )}

              <div>
                <p className="text-xs font-semibold text-muted-foreground/60 mb-2 px-1">
                  Week: {formatOutlookDate(submission.window.start, { month: "long", day: "numeric" })} –{" "}
                  {formatOutlookDate(submission.window.end, { month: "long", day: "numeric", year: "numeric" })}
                </p>
                <OutlookAdvancedView
                  window={submission.window}
                  drafts={tasks}
                  companies={companies}
                  saving={false}
                  dirty={false}
                  onChange={setTasks}
                  onSave={() => {}}
                  onDeleteTask={(id) => setTasks((current) => current.filter((task) => task.id !== id))}
                />
              </div>

              {generateError && <p className="text-xs text-red-400/90">{generateError}</p>}
              {commsWarning && <p className="text-xs text-amber-400/90">Outlook created, but posting to Communications failed: {commsWarning}</p>}

              <button
                onClick={handleGenerate}
                disabled={!resolvedJob || resolvingJob || generating || Boolean(scheduled && !scheduled.canPublish)}
                className="flex items-center justify-center gap-1.5 rounded-full bg-violet-500 text-white px-4 py-3 text-sm font-semibold disabled:opacity-40 active:scale-95 transition-all duration-150"
              >
                {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                {generating ? "Generating…" : "Generate Outlook"}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function IssueRow({ issue, tasks }: { issue: OutlookIssue; tasks: OutlookTask[] }) {
  const taskTitle = tasks.find((task) => task.id === issue.taskId)?.title || "Untitled task"
  return (
    <li className="text-xs text-red-200/80">
      <span className="font-semibold">{taskTitle}:</span> {issue.message}
    </li>
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
