"use client"

import { useEffect, useState } from "react"
import { ArrowLeft, CheckCircle2, ClipboardList, Eye, FileDown, Loader2, Lock, Sparkles, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatDateTimeInAppZone } from "@/lib/datetime"
import { formatOutlookDate } from "@/lib/outlook-core"
import {
  CourtneyRobertsCenterClientError,
  deleteOutlookFormSubmission,
  fetchOutlookFormSubmission,
  fetchOutlookFormSubmissionPdf,
  markOutlookFormSubmissionReviewed,
} from "@/lib/courtney-roberts-center/client"
import type { OutlookFormSubmission, OutlookFormSubmitterRole } from "@/lib/outlook-form-submissions/types"

const SUBMITTER_ROLE_LABEL: Record<OutlookFormSubmitterRole, string> = {
  site_super: "Site Super",
  pm: "PM",
  other: "Other",
}

interface CourtneyRobertsCenterFormDetailScreenProps {
  submissionId: string
  onBack: () => void
  onReviewAndGenerate: () => void
  className?: string
}

export function CourtneyRobertsCenterFormDetailScreen({ submissionId, onBack, onReviewAndGenerate, className }: CourtneyRobertsCenterFormDetailScreenProps) {
  const [submission, setSubmission] = useState<OutlookFormSubmission | null>(null)
  const [errorStatus, setErrorStatus] = useState<number | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isMarking, setIsMarking] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setSubmission(null)
    setErrorStatus(null)
    setErrorMessage(null)
    fetchOutlookFormSubmission(submissionId)
      .then((result) => {
        if (!cancelled) setSubmission(result)
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

  const isLoading = !submission && !errorMessage
  const isDenied = errorStatus === 401 || errorStatus === 403

  const handleMarkReviewed = () => {
    if (isMarking || !submission || submission.status === "reviewed") return
    setIsMarking(true)
    markOutlookFormSubmissionReviewed(submissionId)
      .then(setSubmission)
      .catch((err: unknown) => {
        setErrorMessage(err instanceof CourtneyRobertsCenterClientError ? err.message : "Unable to mark this reviewed.")
      })
      .finally(() => setIsMarking(false))
  }

  const handleExportPdf = () => {
    if (isExporting) return
    setIsExporting(true)
    setExportError(null)
    fetchOutlookFormSubmissionPdf(submissionId)
      .then((blob) => {
        const url = URL.createObjectURL(blob)
        window.open(url, "_blank", "noopener,noreferrer")
        setTimeout(() => URL.revokeObjectURL(url), 60_000)
      })
      .catch((err: unknown) => {
        setExportError(err instanceof CourtneyRobertsCenterClientError ? err.message : "Unable to generate this PDF.")
      })
      .finally(() => setIsExporting(false))
  }

  const handleDelete = () => {
    if (isDeleting) return
    setIsDeleting(true)
    setDeleteError(null)
    deleteOutlookFormSubmission(submissionId)
      .then(() => onBack())
      .catch((err: unknown) => {
        setDeleteError(err instanceof CourtneyRobertsCenterClientError ? err.message : "Unable to delete this submission.")
        setConfirmingDelete(false)
      })
      .finally(() => setIsDeleting(false))
  }

  return (
    <div className={cn("flex-1 min-h-0 flex flex-col courtney-roberts-center-glass-screen", className ?? "animate-fade-in")}>
      <div className="shrink-0 border-b border-white/10 animate-slide-down">
        <div className="max-w-2xl mx-auto px-4 md:px-6 app-topbar flex items-center gap-3">
          <button
            onClick={onBack}
            className="w-9 h-9 rounded-full bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center active:scale-95 hover:bg-emerald-500/15 transition-all duration-150 shrink-0"
          >
            <ArrowLeft className="w-4 h-4 text-emerald-300" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-bold tracking-tight truncate">{submission?.jobName ?? "Outlook form"}</h1>
            {submission && <p className="text-[11px] text-muted-foreground/60">{submission.submittedByName}</p>}
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide">
        <div className="max-w-2xl mx-auto w-full px-4 md:px-6 py-4">
          {isDenied ? (
            <EmptyState icon={<Lock className="w-5 h-5" />} title="Not approved" description={errorMessage ?? "You are not approved to view this."} />
          ) : isLoading ? (
            <DetailSkeleton />
          ) : errorMessage ? (
            <EmptyState icon={<ClipboardList className="w-5 h-5" />} title="Can't load this submission" description={errorMessage} />
          ) : submission ? (
            <div className="flex flex-col gap-5">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium border",
                    submission.status === "converted"
                      ? "border-emerald-500/60 text-white bg-emerald-500"
                      : submission.status === "reviewed"
                        ? "border-sky-500/40 text-sky-400 bg-sky-500/10"
                        : "border-amber-500/40 text-amber-400 bg-amber-500/10",
                  )}
                >
                  {submission.status === "converted" ? "Converted" : submission.status === "reviewed" ? "Reviewed" : "New"}
                </span>
                <span className="text-xs text-muted-foreground/60">
                  Submitted {formatDateTimeInAppZone(new Date(submission.submittedAtMs), { dateStyle: "medium", timeStyle: "short" })}
                </span>
              </div>

              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3.5">
                <p className="text-xs font-semibold text-muted-foreground/60 mb-1">Submitted by</p>
                <p className="text-sm">
                  {submission.submittedByName}
                  <span className="text-muted-foreground/60"> · {SUBMITTER_ROLE_LABEL[submission.submittedByRole]}</span>
                </p>
                {(submission.submittedByPhone || submission.submittedByCompany) && (
                  <p className="text-xs text-muted-foreground/60 mt-1">
                    {[submission.submittedByPhone, submission.submittedByCompany].filter(Boolean).join(" · ")}
                  </p>
                )}
              </div>

              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3.5">
                <p className="text-xs font-semibold text-muted-foreground/60 mb-1">3-Week Window</p>
                <p className="text-sm">
                  {formatOutlookDate(submission.window.start, { month: "long", day: "numeric" })} –{" "}
                  {formatOutlookDate(submission.window.end, { month: "long", day: "numeric", year: "numeric" })}
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <p className="text-xs font-semibold text-muted-foreground/60">Tasks ({submission.tasks.length})</p>
                {submission.tasks.length === 0 ? (
                  <p className="text-sm text-muted-foreground/60">No tasks were listed.</p>
                ) : (
                  submission.tasks.map((task) => (
                    <div key={task.id} className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3.5">
                      <div className="w-9 h-9 rounded-full bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center shrink-0">
                        <ClipboardList className="w-4 h-4 text-emerald-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold">{task.title}</p>
                        <p className="text-xs text-muted-foreground/60 mt-0.5">
                          {task.startDate ? formatOutlookDate(task.startDate) : "No start date"} · {task.durationDays} day(s)
                        </p>
                        {(task.trade || task.companyName) && (
                          <p className="text-xs text-muted-foreground/50 mt-0.5">{[task.trade, task.companyName].filter(Boolean).join(" · ")}</p>
                        )}
                        {task.description && <p className="text-sm mt-2 whitespace-pre-wrap">{task.description}</p>}
                      </div>
                    </div>
                  ))
                )}
              </div>

              {submission.generalNotes && (
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3.5">
                  <p className="text-xs font-semibold text-muted-foreground/60 mb-1">Notes / issues</p>
                  <p className="text-sm whitespace-pre-wrap">{submission.generalNotes}</p>
                </div>
              )}

              {submission.status === "reviewed" && submission.reviewedByName && (
                <p className="text-xs text-muted-foreground/50">
                  Reviewed by {submission.reviewedByName}
                  {submission.reviewedAtMs
                    ? ` on ${formatDateTimeInAppZone(new Date(submission.reviewedAtMs), { dateStyle: "medium", timeStyle: "short" })}`
                    : ""}
                </p>
              )}

              {exportError && <p className="text-xs text-red-400/90">{exportError}</p>}

              {submission.status === "converted" ? (
                <div className="flex flex-col gap-2 pb-2">
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.06] p-3.5">
                    <p className="text-xs font-semibold text-emerald-300 flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5" /> This submission became a real Outlook
                    </p>
                  </div>
                  <button
                    onClick={onReviewAndGenerate}
                    className="flex items-center justify-center gap-1.5 rounded-full bg-emerald-500 text-white px-4 py-3 text-sm font-semibold active:scale-95 transition-all duration-150"
                  >
                    <Eye className="w-4 h-4" /> View Outlook
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-2 pb-2">
                  <button
                    onClick={onReviewAndGenerate}
                    className="flex items-center justify-center gap-1.5 rounded-full bg-emerald-500 text-white px-4 py-3 text-sm font-semibold active:scale-95 transition-all duration-150"
                  >
                    <Sparkles className="w-4 h-4" /> Review Outlook
                  </button>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleExportPdf}
                      disabled={isExporting}
                      className="flex-1 flex items-center justify-center gap-1.5 rounded-full border border-white/15 px-4 py-2.5 text-xs font-semibold text-muted-foreground disabled:opacity-40 active:scale-95 transition-all duration-150"
                    >
                      {isExporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5" />}
                      Raw Submission PDF
                    </button>
                    <button
                      onClick={handleMarkReviewed}
                      disabled={isMarking || submission.status === "reviewed"}
                      className="flex-1 flex items-center justify-center gap-1.5 rounded-full border border-emerald-500/30 px-4 py-2.5 text-xs font-semibold text-emerald-300 disabled:opacity-40 active:scale-95 transition-all duration-150"
                    >
                      {isMarking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                      {submission.status === "reviewed" ? "Reviewed" : "Mark reviewed"}
                    </button>
                  </div>
                </div>
              )}

              {deleteError && <p className="text-xs text-red-400/90 text-center">{deleteError}</p>}

              {confirmingDelete ? (
                <div className="rounded-xl border border-red-500/30 bg-red-500/[0.06] p-3.5">
                  <p className="text-xs text-red-200/90 mb-2.5">Delete this submission? This can&apos;t be undone.</p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setConfirmingDelete(false)}
                      className="flex-1 text-xs font-semibold text-muted-foreground/70 border border-white/10 rounded-lg px-3 py-2 active:opacity-60"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleDelete}
                      disabled={isDeleting}
                      className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-red-500 text-white px-3 py-2 text-xs font-semibold disabled:opacity-40 active:scale-[0.98] transition-all duration-150"
                    >
                      {isDeleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                      Delete
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmingDelete(true)}
                  className="flex items-center justify-center gap-1.5 py-1 text-xs font-medium text-red-400/70 active:opacity-60"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Delete submission
                </button>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      {[0, 1, 2].map((index) => (
        <div key={index} className="h-16 rounded-xl bg-white/6 animate-pulse" />
      ))}
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
