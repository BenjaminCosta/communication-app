"use client"

import { CalendarDays, MapPin, Upload, User } from "lucide-react"
import { formatOutlookDate, type OutlookTask } from "@/lib/outlook-core"
import { OutlookFormStepLayout } from "@/components/outlook-form/step-layout"
import { OutlookFormButton, OutlookFormCard } from "@/components/outlook-form/ui/outlook-form-primitives"
import { TradeIcon } from "@/components/outlook-form/trade-icon"
import { composeGeneralNotes, weekIndexForDate, type OutlookFormNoteTagId } from "@/lib/outlook-form-submissions/wizard-core"
import type { OutlookFormWizard } from "@/features/outlook-form/use-outlook-form-wizard"

export function ReviewStep({ wizard }: { wizard: OutlookFormWizard }) {
  const tasks = wizard.tasks.filter((task) => task.title.trim())
  const tagLabels = wizard.noteTags.map((tag: OutlookFormNoteTagId) => tag.charAt(0).toUpperCase() + tag.slice(1))
  const notesPreview = composeGeneralNotes(tagLabels, wizard.notesText)

  return (
    <OutlookFormStepLayout
      title="Review Outlook"
      primary={{
        label: wizard.isSubmitting ? "Submitting…" : "Submit Outlook",
        onClick: wizard.submit,
        disabled: wizard.isSubmitting,
        icon: <Upload className="h-4 w-4" strokeWidth={2} />,
      }}
      secondary={{ label: "Edit submission", onClick: wizard.goBack }}
      note={wizard.submitError}
    >
      <OutlookFormCard className="overflow-hidden">
        <dl className="divide-y divide-[var(--of-border)]">
          <ReviewRow icon={<User className="h-4 w-4" strokeWidth={2} />} label="Supervisor" value={wizard.submittedByName || "—"} />
          <ReviewRow icon={<MapPin className="h-4 w-4" strokeWidth={2} />} label="Selected job" value={wizard.jobName || "—"} />
          <ReviewRow icon={<CalendarDays className="h-4 w-4" strokeWidth={2} />} label="Timeframe" value="For the next 3 weeks" />
        </dl>
      </OutlookFormCard>

      <div className="mt-5 flex flex-col gap-5">
        {wizard.weekBuckets.map((bucket) => {
          const weekTasks = tasks.filter((task) => weekIndexForDate(wizard.window.start, task.startDate) === bucket.weekIndex)
          if (weekTasks.length === 0) return null
          return (
            <div key={bucket.weekIndex}>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-bold text-[var(--of-text)]">Week {bucket.weekIndex + 1}</h3>
                <span className="text-xs font-medium text-[var(--of-text-muted)]">
                  {formatOutlookDate(bucket.start)} – {formatOutlookDate(bucket.end)}
                </span>
              </div>
              <OutlookFormCard flat className="divide-y divide-[var(--of-border)] overflow-hidden">
                {weekTasks.map((task) => (
                  <ReviewTaskRow key={task.id} task={task} />
                ))}
              </OutlookFormCard>
            </div>
          )
        })}

        {tasks.length === 0 && <p className="text-sm text-[var(--of-text-muted)]">No work items were added.</p>}
      </div>

      <div className="mt-5">
        <h3 className="mb-2 px-1 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-[var(--of-text-muted)]">Notes for Frank</h3>
        <OutlookFormCard flat className="p-4">
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--of-text)]">{notesPreview || "No notes added."}</p>
        </OutlookFormCard>
      </div>
    </OutlookFormStepLayout>
  )
}

function ReviewRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--of-blue-soft)] text-[var(--of-blue-strong)]">{icon}</span>
      <dt className="min-w-0 flex-1 text-xs font-medium text-[var(--of-text-muted)]">{label}</dt>
      <dd className="min-w-0 max-w-[60%] truncate text-right text-sm font-semibold text-[var(--of-text)]">{value}</dd>
    </div>
  )
}

function ReviewTaskRow({ task }: { task: OutlookTask }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center text-[var(--of-blue-strong)]">
        <TradeIcon trade={task.trade} className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--of-text)]">{task.title}</span>
      {task.trade && (
        <span className="shrink-0 rounded-full bg-[var(--of-blue-soft)] px-2.5 py-1 text-[0.6875rem] font-medium text-[var(--of-blue-strong)]">{task.trade}</span>
      )}
    </div>
  )
}
