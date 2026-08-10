"use client"

/**
 * Review & Submit — the AI draft is always shown as plain editable text, not
 * a locked-in result (PRODUCT.md principle: "AI output is always an
 * editable draft the worker visibly controls"). Submitting is a single
 * button; PDF generation and the Comms post happen invisibly server-side.
 */

import { useState } from "react"
import { ArrowLeft, Building2, CalendarDays, CheckCircle2, ListTodo, Loader2, Paperclip, Pencil, Send, Sparkles, StickyNote, TriangleAlert, Users2, X } from "lucide-react"
import { BdButton, BdCard } from "@/components/bye-bye-dpr/ui/byebye-dpr-primitives"
import type { DailyReportStructuredData } from "@/lib/bye-bye-dpr-core"
import { ByeByeDprClientError, submitReport, updateReportDraft } from "@/features/bye-bye-dpr/client/byebye-dpr-client"
import type { Job } from "@/lib/bye-bye-dpr-store"

interface ReportReviewScreenProps {
  job: Job
  reportId: string
  source: "voice" | "typed"
  fields: DailyReportStructuredData
  photos: string[]
  onRemovePhoto: (index: number) => void
  onBack: () => void
  onSubmitted: () => void
}

const FIELD_META: Array<{ key: keyof DailyReportStructuredData; label: string; icon: typeof CheckCircle2; tone: "complete" | "pending" | "info" | "ai" | "neutral" }> = [
  { key: "workCompleted", label: "Work completed", icon: CheckCircle2, tone: "complete" },
  { key: "issuesOrDelays", label: "Issues or delays", icon: TriangleAlert, tone: "pending" },
  { key: "attendanceNotes", label: "Attendance notes", icon: Users2, tone: "info" },
  { key: "nextSteps", label: "Next steps", icon: ListTodo, tone: "ai" },
  { key: "additionalNotes", label: "Additional notes", icon: StickyNote, tone: "neutral" },
]

const ICON_CLASS: Record<string, string> = {
  complete: "bg-[var(--bd-complete-soft)] text-[#15803D]",
  pending: "bg-[var(--bd-pending-soft)] text-[#B45309]",
  info: "bg-[var(--bd-sky-soft)] text-[var(--bd-sky)]",
  ai: "bg-[var(--bd-ai-soft)] text-[var(--bd-purple-strong)]",
  neutral: "bg-[var(--bd-surface-2)] text-[var(--bd-text-muted)]",
}

function toDisplayValues(fields: DailyReportStructuredData): Record<keyof DailyReportStructuredData, string> {
  return {
    workCompleted: fields.workCompleted ?? "",
    issuesOrDelays: fields.issuesOrDelays ?? "",
    attendanceNotes: fields.attendanceNotes ?? "",
    nextSteps: fields.nextSteps ?? "",
    additionalNotes: fields.additionalNotes ?? "",
  }
}

export function ReportReviewScreen({ job, reportId, source, fields, photos, onRemovePhoto, onBack, onSubmitted }: ReportReviewScreenProps) {
  const [values, setValues] = useState(() => toDisplayValues(fields))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setSubmitting(true)
    setError(null)
    try {
      const original = toDisplayValues(fields)
      const dirty = (Object.keys(values) as Array<keyof DailyReportStructuredData>).some((key) => values[key] !== original[key])
      if (dirty) {
        await updateReportDraft(reportId, { structuredData: values, structuredDataSource: "manual" })
      }
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
              {new Date().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
            </span>
          </BdCard>

          <div className="byebye-dpr-step-enter mt-4 flex items-start gap-2 rounded-2xl bg-[var(--bd-ai-soft)] px-3.5 py-2.5 text-[0.8125rem] font-semibold text-[var(--bd-purple-strong)]">
            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
            <span className="min-w-0 flex-1">
              Draft created from your {source === "voice" ? "recording" : "note"} — edit anything below
            </span>
            <span className="mt-0.5 shrink-0 rounded-full bg-white px-1.5 py-0.5 text-[0.625rem] font-bold tracking-wide">AI</span>
          </div>

          <div className="mt-4 flex flex-col gap-3">
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
            onClick={submit}
            disabled={submitting}
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
