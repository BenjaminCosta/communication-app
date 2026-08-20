"use client"

import { CalendarDays, Info, MoreVertical, Plus } from "lucide-react"
import { addIsoDays, formatOutlookDate, type OutlookTask } from "@/lib/outlook-core"
import { OutlookFormStepLayout } from "@/components/outlook-form/step-layout"
import { weekIndexForDate, type OutlookFormWeekBucket } from "@/lib/outlook-form-submissions/wizard-core"
import { TradeIcon } from "@/components/outlook-form/trade-icon"
import { TaskEditorSheet } from "@/components/outlook-form/steps/task-editor-sheet"
import type { OutlookFormWizard } from "@/features/outlook-form/use-outlook-form-wizard"

export function TasksStep({ wizard }: { wizard: OutlookFormWizard }) {
  const tasksByWeek = (weekIndex: 0 | 1 | 2) =>
    wizard.tasks.filter((task) => weekIndexForDate(wizard.window.start, task.startDate) === weekIndex)

  return (
    <>
      <OutlookFormStepLayout primary={{ label: "Continue", onClick: wizard.goNext }}>
        <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-[var(--of-border)] bg-[var(--of-surface)] p-3.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <CalendarDays className="h-4 w-4 shrink-0 text-[var(--of-text-muted)]" strokeWidth={2} />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-[var(--of-text-muted)]">Outlook starts</p>
              <p className="truncate text-sm font-semibold text-[var(--of-text)]">{formatOutlookDate(wizard.window.start, { month: "long", day: "numeric" })}</p>
            </div>
          </div>
          <input
            type="date"
            value={wizard.windowStart}
            onChange={(event) => wizard.setWindowStart(event.target.value)}
            aria-label="Outlook starts"
            className="shrink-0 rounded-lg border border-[var(--of-border)] bg-[var(--of-surface)] px-2.5 py-1.5 text-sm text-[var(--of-text)] outline-none focus:border-[var(--of-blue)]"
          />
        </div>

        <div className="mb-5 flex items-start gap-2 rounded-xl bg-[var(--of-blue-soft)] p-3.5">
          <Info className="h-4 w-4 shrink-0 text-[var(--of-blue-strong)]" strokeWidth={2} />
          <p className="text-[0.8125rem] leading-snug text-[var(--of-blue-strong)]">Add the main work planned for each week.</p>
        </div>

        <div className="flex flex-col gap-6">
          {wizard.weekBuckets.map((bucket) => (
            <WeekSection key={bucket.weekIndex} bucket={bucket} tasks={tasksByWeek(bucket.weekIndex)} wizard={wizard} />
          ))}
        </div>
      </OutlookFormStepLayout>

      <TaskEditorSheet editing={wizard.editingTask} onSave={wizard.saveTask} onRemove={wizard.removeTask} onClose={wizard.closeTaskEditor} />
    </>
  )
}

function WeekSection({ bucket, tasks, wizard }: { bucket: OutlookFormWeekBucket; tasks: OutlookTask[]; wizard: OutlookFormWizard }) {
  return (
    <div>
      <div className="mb-2.5 flex items-center justify-between">
        <h3 className="text-base font-bold text-[var(--of-text)]">Week {bucket.weekIndex + 1}</h3>
        <span className="text-xs font-medium text-[var(--of-text-muted)]">
          {formatOutlookDate(bucket.start)} – {formatOutlookDate(bucket.end)}
        </span>
      </div>

      <div className="flex flex-col gap-2">
        {tasks.map((task) => (
          <TaskRow key={task.id} task={task} onEdit={() => wizard.startEditTask(task)} />
        ))}

        <button
          type="button"
          onClick={() => wizard.startAddTask(bucket.weekIndex)}
          className="outlook-form-tap flex min-h-[2.75rem] w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-[var(--of-blue)] text-sm font-semibold text-[var(--of-blue-strong)] hover:bg-[var(--of-blue-soft)]"
        >
          <Plus className="h-4 w-4" strokeWidth={2.5} />
          Add work item
        </button>
      </div>
    </div>
  )
}

function TaskRow({ task, onEdit }: { task: OutlookTask; onEdit: () => void }) {
  return (
    <button
      type="button"
      onClick={onEdit}
      className="outlook-form-tap flex w-full items-center gap-3 rounded-xl border border-[var(--of-border)] bg-[var(--of-surface)] p-3 text-left hover:bg-[var(--of-surface-2)]"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center text-[var(--of-blue-strong)]">
        <TradeIcon trade={task.trade} className="h-4.5 w-4.5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-[var(--of-text)]">{task.title}</p>
        <div className="mt-1 flex items-center gap-2">
          {task.trade && (
            <span className="rounded-full bg-[var(--of-blue-soft)] px-2 py-0.5 text-[0.6875rem] font-medium text-[var(--of-blue-strong)]">{task.trade}</span>
          )}
          {task.startDate && (
            <span className="text-[0.6875rem] font-medium text-[var(--of-text-muted)]">
              {formatOutlookDate(task.startDate)} – {formatOutlookDate(addIsoDays(task.startDate, Math.max(0, task.durationDays - 1)))}
            </span>
          )}
        </div>
      </div>
      <MoreVertical className="h-4 w-4 shrink-0 text-[var(--of-text-muted)]" strokeWidth={2} />
    </button>
  )
}
