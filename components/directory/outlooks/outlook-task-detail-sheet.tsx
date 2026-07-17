"use client"

import { Building2, CalendarDays, Clock3, Link2, Pencil, X } from "lucide-react"
import { formatOutlookDate, taskStatusLabel, type OutlookTask } from "@/lib/outlook-core"

export function OutlookTaskDetailSheet({
  task,
  tasks,
  onClose,
  onEdit,
}: {
  task: OutlookTask
  tasks: OutlookTask[]
  onClose: () => void
  onEdit: () => void
}) {
  const dependency = tasks.find((candidate) => candidate.id === task.dependencyTaskId)?.title ?? "None"
  return (
    <div className="fixed inset-0 z-40 flex items-end bg-[#04070b]/72 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="outlook-task-detail-title">
      <button type="button" className="absolute inset-0" onClick={onClose} aria-label="Close task details" />
      <section className="directory-glass-screen relative z-[1] max-h-[86dvh] w-full overflow-y-auto rounded-t-[1.75rem] border-t border-white/[0.11] px-4 pb-[max(1rem,var(--sab))] pt-4 shadow-[0_-18px_48px_rgba(1,5,12,0.5)] animate-slide-up">
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/15" aria-hidden="true" />
        <div className="mx-auto w-full max-w-xl">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-violet-300/68">Task details</p>
              <h2 id="outlook-task-detail-title" className="mt-1 text-lg font-semibold tracking-tight text-foreground/92">{task.title || "Untitled task"}</h2>
              <p className="mt-1 text-[10px] text-muted-foreground/55">{taskStatusLabel(task.status)} · {task.completionPercent}% complete</p>
            </div>
            <button type="button" onClick={onClose} className="glass-button flex h-9 w-9 shrink-0 items-center justify-center rounded-full border active:scale-[0.96]" aria-label="Close task details">
              <X className="h-4 w-4" strokeWidth={1.8} />
            </button>
          </div>

          {task.description && <p className="mt-4 text-xs leading-5 text-foreground/70">{task.description}</p>}

          <dl className="mt-5 divide-y divide-white/[0.06] border-y border-white/[0.07]">
            <Detail icon={<Building2 className="h-3.5 w-3.5" strokeWidth={1.8} />} label="Trade / company" value={`${task.trade || "General"}${task.companyName ? ` · ${task.companyName}` : ""}`} />
            <Detail icon={<CalendarDays className="h-3.5 w-3.5" strokeWidth={1.8} />} label="Schedule" value={`${task.startDate ? formatOutlookDate(task.startDate) : "Missing date"}${task.endDate ? ` - ${formatOutlookDate(task.endDate)}` : ""}`} />
            <Detail icon={<Clock3 className="h-3.5 w-3.5" strokeWidth={1.8} />} label="Duration" value={`${task.durationDays} day${task.durationDays === 1 ? "" : "s"}`} />
            <Detail icon={<Link2 className="h-3.5 w-3.5" strokeWidth={1.8} />} label="Dependency" value={dependency} />
          </dl>

          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between text-[10px]">
              <span className="font-medium text-muted-foreground/58">Completion</span>
              <span className="font-mono text-foreground/75">{task.completionPercent}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/[0.08]">
              <div className="h-full rounded-full bg-violet-400/78" style={{ width: `${task.completionPercent}%` }} />
            </div>
          </div>

          <button type="button" onClick={onEdit} className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl border border-violet-400/25 bg-violet-400/[0.1] py-3 text-xs font-semibold text-violet-200 active:scale-[0.98]">
            <Pencil className="h-3.5 w-3.5" strokeWidth={1.8} /> Edit in Advanced
          </button>
        </div>
      </section>
    </div>
  )
}

function Detail({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="grid grid-cols-[20px_92px_minmax(0,1fr)] items-center gap-2 py-3">
      <span className="text-muted-foreground/50">{icon}</span>
      <dt className="text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/45">{label}</dt>
      <dd className="text-right text-[11px] text-foreground/75">{value}</dd>
    </div>
  )
}
