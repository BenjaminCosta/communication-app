"use client"

/**
 * Daily-report review. The reviewed transcription/note is the report's
 * primary content. Organizing it into three fields is deliberately optional
 * and never replaces the original text.
 */

import { useState } from "react"
import { ArrowLeft, Building2, CalendarDays, CheckCircle2, ListTodo, Loader2, Paperclip, Pencil, Send, Sparkles, TriangleAlert, X } from "lucide-react"
import { BdButton, BdCard } from "@/components/bye-bye-dpr/ui/byebye-dpr-primitives"
import { emptyDailyReportStructuredData, type DailyReportStructuredData } from "@/lib/bye-bye-dpr-core"
import { formatDateInAppZone } from "@/lib/datetime"
import { ByeByeDprClientError, structureReportDraft, submitReport, updateReportDraft } from "@/features/bye-bye-dpr/client/byebye-dpr-client"
import type { Job } from "@/lib/bye-bye-dpr-store"

interface ReportReviewScreenProps {
  job: Job
  reportId: string
  source: "voice" | "typed"
  initialText: string
  photos: string[]
  onRemovePhoto: (index: number) => void
  onBack: () => void
  onSubmitted: () => void
}

const FIELD_META: Array<{ key: keyof DailyReportStructuredData; label: string; icon: typeof CheckCircle2; tone: "complete" | "pending" | "ai" }> = [
  { key: "workCompleted", label: "Work completed", icon: CheckCircle2, tone: "complete" },
  { key: "issuesOrDelays", label: "Issues or delays", icon: TriangleAlert, tone: "pending" },
  { key: "nextSteps", label: "Next steps", icon: ListTodo, tone: "ai" },
]

const ICON_CLASS: Record<string, string> = {
  complete: "bg-[var(--bd-complete-soft)] text-[#15803D]",
  pending: "bg-[var(--bd-pending-soft)] text-[#B45309]",
  ai: "bg-[var(--bd-ai-soft)] text-[var(--bd-purple-strong)]",
}

function toDisplayValues(fields: DailyReportStructuredData): Record<keyof DailyReportStructuredData, string> {
  return {
    workCompleted: fields.workCompleted ?? "",
    issuesOrDelays: fields.issuesOrDelays ?? "",
    nextSteps: fields.nextSteps ?? "",
  }
}

function toStructuredData(values: Record<keyof DailyReportStructuredData, string>): DailyReportStructuredData {
  return {
    workCompleted: values.workCompleted.trim() || null,
    issuesOrDelays: values.issuesOrDelays.trim() || null,
    nextSteps: values.nextSteps.trim() || null,
  }
}

export function ReportReviewScreen({ job, reportId, source, initialText, photos, onRemovePhoto, onBack, onSubmitted }: ReportReviewScreenProps) {
  const [rawText, setRawText] = useState(initialText)
  const [values, setValues] = useState(() => toDisplayValues(emptyDailyReportStructuredData()))
  const [organized, setOrganized] = useState(false)
  const [organizing, setOrganizing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function organizeReport() {
    const text = rawText.trim()
    if (!text || organizing) return

    setOrganizing(true)
    setError(null)
    try {
      const { structuredData } = await structureReportDraft(reportId, { text, source })
      setValues(toDisplayValues(structuredData))
      setOrganized(true)
    } catch (err) {
      setError(err instanceof ByeByeDprClientError ? err.message : "Could not organize your report. You can still submit your note as written.")
    } finally {
      setOrganizing(false)
    }
  }

  async function submit() {
    const text = rawText.trim()
    if (!text || submitting) {
      if (!text) setError("Add your daily update before submitting.")
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      await updateReportDraft(reportId, {
        rawText: text,
        structuredData: organized ? toStructuredData(values) : emptyDailyReportStructuredData(),
        structuredDataSource: organized ? "manual" : null,
      })
      await submitReport(reportId)
      onSubmitted()
    } catch (err) {
      setSubmitting(false)
      setError(err instanceof ByeByeDprClientError ? err.message : "Could not submit the report. Try again.")
    }
  }

  return (
    <div className="byebye-dpr-scope byebye-dpr-canvas relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="byebye-dpr-topbar app-topbar flex shrink-0 items-center gap-3 border-b px-4">
        <button type="button" onClick={onBack} className="byebye-dpr-tap flex h-9 w-9 items-center justify-center rounded-full text-[var(--bd-text)] hover:bg-[var(--bd-surface-2)]" aria-label="Back">
          <ArrowLeft className="h-4.5 w-4.5" strokeWidth={2} />
        </button>
        <h1 className="text-[1.0625rem] font-bold text-[var(--bd-text)]">Review & Submit</h1>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-hide">
        <div className="mx-auto w-full max-w-md px-5 pb-28 pt-5">
          <BdCard className="flex items-center gap-3 px-4 py-3" flat>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--bd-purple-soft)] text-[var(--bd-purple-strong)]" aria-hidden="true">
              <Building2 className="h-4 w-4" strokeWidth={1.8} />
            </span>
            <span className="truncate text-[0.9375rem] font-semibold text-[var(--bd-text)]">{job.name}</span>
            <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[0.8125rem] text-[var(--bd-text-muted)]">
              <CalendarDays className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
              {formatDateInAppZone(new Date())}
            </span>
          </BdCard>

          <BdCard className="mt-4 p-4">
            <div className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--bd-surface-2)] text-[var(--bd-text-muted)]" aria-hidden="true">
                <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
              </span>
              <div>
                <p className="text-[0.8125rem] font-semibold text-[var(--bd-text)]">{source === "voice" ? "Raw transcription" : "Your report note"}</p>
                <p className="mt-0.5 text-[0.75rem] text-[var(--bd-text-muted)]">Edit this text directly. Organizing it is optional.</p>
              </div>
            </div>
            <textarea
              value={rawText}
              onChange={(event) => setRawText(event.target.value)}
              rows={8}
              className="mt-3 w-full resize-none rounded-xl border border-[var(--bd-border)] bg-[var(--bd-surface)] p-3 text-[0.875rem] leading-relaxed text-[var(--bd-text)] outline-none focus:border-[var(--bd-purple)] focus:shadow-[0_0_0_3px_rgba(109,91,208,0.14)]"
            />
          </BdCard>

          {!organized && (
            <BdCard className="mt-3 p-4" flat>
              <div className="flex items-start gap-2.5">
                <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-[var(--bd-purple-strong)]" strokeWidth={2} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-[0.8125rem] font-semibold text-[var(--bd-text)]">Optional: organize report</p>
                  <p className="mt-0.5 text-[0.75rem] leading-relaxed text-[var(--bd-text-muted)]">Creates editable work, issues, and next-step sections from this text only.</p>
                </div>
              </div>
              <BdButton
                variant="secondary"
                size="md"
                className="mt-3"
                onClick={() => void organizeReport()}
                disabled={!rawText.trim() || organizing}
                icon={organizing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" strokeWidth={1.8} />}
              >
                {organizing ? "Organizing..." : "Organize report"}
              </BdButton>
            </BdCard>
          )}

          {organized && (
            <>
              <div className="byebye-dpr-step-enter mt-4 flex items-start gap-2 rounded-2xl bg-[var(--bd-ai-soft)] px-3.5 py-2.5 text-[0.8125rem] font-semibold text-[var(--bd-purple-strong)]">
                <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
                <span className="min-w-0 flex-1">Organized from your text — edit anything below</span>
              </div>

              <div className="mt-3 flex flex-col gap-3">
                {FIELD_META.map(({ key, label, icon: Icon, tone }) => (
                  <BdCard key={key} className="p-4">
                    <div className="flex items-center gap-2.5">
                      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${ICON_CLASS[tone]}`} aria-hidden="true">
                        <Icon className="h-3.5 w-3.5" strokeWidth={2} />
                      </span>
                      <span className="min-w-0 flex-1 text-[0.8125rem] font-semibold text-[var(--bd-text)]">{label}</span>
                      <span className="flex shrink-0 items-center gap-1 text-[0.75rem] font-semibold text-[var(--bd-purple-strong)]">
                        <Pencil className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
                        Edit
                      </span>
                    </div>
                    <textarea
                      value={values[key]}
                      onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))}
                      rows={2}
                      className="mt-2 w-full resize-none rounded-lg bg-transparent text-[0.875rem] leading-snug text-[var(--bd-text)] outline-none"
                    />
                  </BdCard>
                ))}
              </div>
            </>
          )}

          {photos.length > 0 && (
            <BdCard className="mt-3 p-4">
              <div className="flex items-center gap-2.5">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--bd-surface-2)] text-[var(--bd-text-muted)]" aria-hidden="true">
                  <Paperclip className="h-3.5 w-3.5" strokeWidth={2} />
                </span>
                <span className="text-[0.8125rem] font-semibold text-[var(--bd-text)]">Attachments ({photos.length})</span>
              </div>
              <div className="mt-2.5 flex flex-wrap gap-2">
                {photos.map((url, index) => (
                  <div key={url} className="relative h-16 w-16 overflow-hidden rounded-xl border border-[var(--bd-border)]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt="" className="h-full w-full object-cover" />
                    <button
                      type="button"
                      onClick={() => onRemovePhoto(index)}
                      className="absolute right-1 top-1 flex h-4.5 w-4.5 items-center justify-center rounded-full bg-black/55 text-white"
                      aria-label="Remove photo"
                    >
                      <X className="h-2.5 w-2.5" strokeWidth={3} />
                    </button>
                  </div>
                ))}
              </div>
            </BdCard>
          )}
        </div>
      </div>

      <div className="byebye-dpr-topbar shrink-0 border-t px-4 pb-[max(env(safe-area-inset-bottom),1rem)] pt-3">
        <div className="mx-auto w-full max-w-md">
          {error && <p className="mb-2 text-center text-[0.8125rem] font-semibold text-[#DC5A5A]">{error}</p>}
          <BdButton
            variant="primary"
            size="lg"
            fullWidth
            onClick={() => void submit()}
            disabled={submitting || organizing}
            icon={submitting ? <Loader2 className="h-4.5 w-4.5 animate-spin" /> : <Send className="h-4.5 w-4.5" strokeWidth={2} />}
          >
            {submitting ? "Submitting..." : "Submit Report"}
          </BdButton>
          <p className="mt-2 text-center text-[0.75rem] text-[var(--bd-text-muted)]">PDF + Comms post generated automatically</p>
        </div>
      </div>
    </div>
  )
}
