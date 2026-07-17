"use client"

import { useEffect, useMemo, useState } from "react"
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react"
import { createOutlookTask, formatOutlookDate, outlookDates, scheduleOutlookTasks, taskStatusLabel, type OutlookTask, type OutlookWindow } from "@/lib/outlook-core"
import { cn } from "@/lib/utils"

const WEEK_PROGRESS_TONES = ["bg-violet-400/75", "bg-cyan-400/75", "bg-emerald-400/75"] as const

export function OutlookAdvancedView({
  window,
  drafts,
  companies,
  focusTaskId,
  onChange,
}: {
  window: OutlookWindow
  drafts: OutlookTask[]
  companies: Array<{ id: string; name: string }>
  focusTaskId?: string | null
  onChange: (tasks: OutlookTask[]) => void
}) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set(drafts.map((task) => task.id)))
  const companyNames = useMemo(() => companies.map((company) => company.name), [companies])

  useEffect(() => {
    if (!focusTaskId) return
    setExpandedIds((current) => new Set(current).add(focusTaskId))
  }, [focusTaskId])

  const update = (id: string, patch: Partial<OutlookTask>) => {
    onChange(drafts.map((task) => task.id === id ? { ...task, ...patch } : task))
  }

  const remove = (id: string) => {
    onChange(drafts.filter((task) => task.id !== id).map((task, sortOrder) => ({ ...task, sortOrder })))
    setExpandedIds((current) => {
      const next = new Set(current)
      next.delete(id)
      return next
    })
  }

  const add = () => {
    const next = createOutlookTask({ sortOrder: drafts.length, startDate: window.start })
    onChange([...drafts, next])
    setExpandedIds((current) => new Set(current).add(next.id))
  }

  const toggle = (id: string) => {
    setExpandedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="space-y-3 animate-fade-up">
      <WeekProgress window={window} tasks={drafts} />

      {drafts.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/[0.1] px-5 py-12 text-center">
          <p className="text-xs font-medium text-foreground/72">No editable tasks</p>
          <p className="mt-1 text-[10px] text-muted-foreground/50">Add a task to start the advanced schedule.</p>
        </div>
      ) : drafts.map((task, index) => {
        const expanded = expandedIds.has(task.id)
        return (
          <section key={task.id} className="overflow-hidden rounded-xl border border-white/[0.09] bg-[#0a111a]/82 shadow-[inset_0_1px_0_rgba(255,255,255,0.045)]">
            <button type="button" onClick={() => toggle(task.id)} className="flex min-h-12 w-full items-center gap-2.5 px-3.5 py-3 text-left transition-colors active:bg-white/[0.035]" aria-expanded={expanded}>
              <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", index % 4 === 0 ? "bg-violet-400" : index % 4 === 1 ? "bg-cyan-400" : index % 4 === 2 ? "bg-blue-400" : "bg-amber-400")} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-foreground/88">{task.title || "Untitled task"}</span>
                <span className="mt-0.5 block truncate text-[9px] text-muted-foreground/50">{task.startDate ? formatOutlookDate(task.startDate) : "Missing date"} · {task.durationDays}d · {taskStatusLabel(task.status)}</span>
              </span>
              {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground/45" strokeWidth={1.8} /> : <ChevronDown className="h-4 w-4 text-muted-foreground/45" strokeWidth={1.8} />}
            </button>

            {expanded && (
              <div className="border-t border-white/[0.07] px-3.5 pb-4 pt-3.5">
                <div className="outlook-compact-fields grid grid-cols-1 gap-3 min-[370px]:grid-cols-2">
                  <Field label="Task" wide><input value={task.title} onChange={(event) => update(task.id, { title: event.target.value })} className="outlook-input" /></Field>
                  <Field label="Description" wide><textarea value={task.description} onChange={(event) => update(task.id, { description: event.target.value })} rows={2} className="outlook-input resize-none" /></Field>
                  <Field label="Trade"><input value={task.trade} onChange={(event) => update(task.id, { trade: event.target.value })} className="outlook-input" placeholder="Concrete" /></Field>
                  <Field label="Company"><input list="advanced-outlook-company-options" value={task.companyName} onChange={(event) => {
                    const match = companies.find((company) => company.name === event.target.value)
                    update(task.id, { companyName: event.target.value, companyContextId: match?.id ?? null })
                  }} className="outlook-input" /></Field>
                  <Field label="Start date"><input type="date" value={task.startDate ?? ""} onChange={(event) => update(task.id, { startDate: event.target.value || null, dependencyTaskId: null })} className="outlook-input" /></Field>
                  <Field label="Duration"><input type="number" min={1} max={90} inputMode="numeric" value={task.durationDays} onChange={(event) => update(task.id, { durationDays: Math.max(1, Number(event.target.value) || 1) })} className="outlook-input" /></Field>
                  <Field label="Dependency"><select value={task.dependencyTaskId ?? ""} onChange={(event) => update(task.id, { dependencyTaskId: event.target.value || null, ...(event.target.value ? { startDate: null } : {}) })} className="outlook-input"><option value="">None</option>{drafts.filter((candidate) => candidate.id !== task.id).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.title || "Untitled task"}</option>)}</select></Field>
                  <Field label="Status"><select value={task.status} onChange={(event) => update(task.id, { status: event.target.value as OutlookTask["status"] })} className="outlook-input"><option value="not_started">Planned</option><option value="in_progress">In progress</option><option value="blocked">Blocked</option><option value="complete">Complete</option></select></Field>
                  <Field label="Completion" wide>
                    <div className="flex items-center gap-3 py-1">
                      <span className="w-8 font-mono text-[10px] text-foreground/68">{task.completionPercent}%</span>
                      <input type="range" min={0} max={100} step={5} value={task.completionPercent} onChange={(event) => update(task.id, { completionPercent: Number(event.target.value) })} className="min-w-0 flex-1 accent-[var(--directory-job)]" />
                    </div>
                  </Field>
                </div>
                <button type="button" onClick={() => remove(task.id)} className="mt-3 flex items-center gap-1.5 border-t border-white/[0.06] pt-3 text-[10px] font-medium text-red-300/68 active:opacity-60">
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} /> Delete task
                </button>
              </div>
            )}
          </section>
        )
      })}

      <button type="button" onClick={add} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--directory-job-border)] bg-[var(--directory-job-soft)] py-3 text-[10px] font-semibold text-[var(--directory-job)] transition-transform active:scale-[0.99]">
        <Plus className="h-3.5 w-3.5" strokeWidth={1.8} /> Add task
      </button>
      <datalist id="advanced-outlook-company-options">{companyNames.map((name) => <option key={name} value={name} />)}</datalist>
    </div>
  )
}

function WeekProgress({ window, tasks }: { window: OutlookWindow; tasks: OutlookTask[] }) {
  const dates = outlookDates(window.start)
  const scheduledTasks = scheduleOutlookTasks(tasks, window).tasks
  return (
    <section className="grid grid-cols-3 divide-x divide-white/[0.07] overflow-hidden rounded-2xl border border-white/[0.085] bg-[#0a111a]/72">
      {[0, 1, 2].map((weekIndex) => {
        const start = dates[weekIndex * 7]
        const end = dates[weekIndex * 7 + 6]
        const weekTasks = scheduledTasks.filter((task) => task.startDate && task.endDate && task.startDate <= end && task.endDate >= start)
        const complete = weekTasks.filter((task) => task.status === "complete").length
        const percent = weekTasks.length ? Math.round((complete / weekTasks.length) * 100) : 0
        return (
          <div key={start} className="px-2 py-3 text-center">
            <p className="text-[9px] font-semibold uppercase tracking-[0.08em] text-foreground/72">Week {weekIndex + 1}</p>
            <p className="mt-0.5 truncate font-mono text-[7px] text-muted-foreground/45">{formatOutlookDate(start)} - {formatOutlookDate(end)}</p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.08]"><div className={cn("h-full rounded-full transition-[width]", WEEK_PROGRESS_TONES[weekIndex])} style={{ width: `${percent}%` }} /></div>
            <p className="mt-1.5 font-mono text-[8px] text-muted-foreground/55">{complete} / {weekTasks.length} done</p>
          </div>
        )
      })}
    </section>
  )
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return <label className={cn("block min-w-0", wide && "min-[370px]:col-span-2")}><span className="outlook-label">{label}</span>{children}</label>
}
