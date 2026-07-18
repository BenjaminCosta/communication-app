"use client"

import { Building2, CalendarDays, Clock3, GitBranch } from "lucide-react"
import { OutlookGanttCalendar } from "@/components/directory/outlooks/outlook-gantt-calendar"
import { formatOutlookDate, taskStatusLabel, type OutlookTask, type OutlookWindow } from "@/lib/outlook-core"
import { cn } from "@/lib/utils"

const TASK_VISUALS = [
  { dot: "bg-violet-400", border: "border-violet-400/35", text: "text-violet-300", ring: "#a78bfa" },
  { dot: "bg-cyan-400", border: "border-cyan-400/35", text: "text-cyan-300", ring: "#22d3ee" },
  { dot: "bg-amber-400", border: "border-amber-400/35", text: "text-amber-300", ring: "#fb923c" },
  { dot: "bg-blue-400", border: "border-blue-400/35", text: "text-blue-300", ring: "#60a5fa" },
] as const

export function OutlookPreviewView({
  window,
  tasks,
  onOpenTask,
}: {
  window: OutlookWindow
  tasks: OutlookTask[]
  onOpenTask?: (task: OutlookTask) => void
}) {
  return (
    <div className="space-y-3 animate-fade-up">
      <OutlookGanttCalendar window={window} tasks={tasks} onOpenTask={onOpenTask} />

      {tasks.length === 0 ? (
        <section className="rounded-2xl border border-white/[0.08] bg-[#0a111a]/72 px-5 py-10 text-center">
          <p className="text-xs font-medium text-foreground/70">No tasks yet</p>
          <p className="mt-1 text-[10px] text-muted-foreground/50">Quick Update will add the first scheduled activity.</p>
        </section>
      ) : (
        <div className="space-y-2">
          {tasks.map((task) => {
            const visual = TASK_VISUALS[task.sortOrder % TASK_VISUALS.length]
            const dependency = tasks.find((candidate) => candidate.id === task.dependencyTaskId)?.title
            return (
              <button
                key={task.id}
                type="button"
                onClick={() => onOpenTask?.(task)}
                className="w-full rounded-xl border border-white/[0.09] bg-[#0a111a]/82 p-3 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.045)] transition-[background-color,border-color,transform] hover:border-white/[0.14] active:scale-[0.99] active:bg-white/[0.035]"
              >
                <div className="flex min-w-0 items-start gap-2.5">
                  <span className={cn("mt-1 size-2 shrink-0 rounded-full", visual.dot)} aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-semibold text-foreground/88">{task.title || "Untitled task"}</p>
                    <p className="mt-0.5 flex min-w-0 items-center gap-1 truncate text-[9px] text-muted-foreground/55">
                      <Building2 className="h-2.5 w-2.5 shrink-0" strokeWidth={1.8} />
                      {task.trade || "General"}
                    </p>
                    {task.companyName && (
                      <span className={cn("mt-1.5 inline-flex max-w-full truncate rounded-full border px-2 py-0.5 text-[9px]", visual.border, visual.text)}>{task.companyName}</span>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <StatusBadge task={task} />
                    <MiniRing value={task.completionPercent} color={visual.ring} />
                  </div>
                </div>

                <div className="ml-[18px] mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[9px] text-muted-foreground/58">
                  <span className="flex items-center gap-1"><CalendarDays className="h-3 w-3 shrink-0" strokeWidth={1.8} />{task.startDate ? formatOutlookDate(task.startDate) : "Missing"}{task.endDate ? ` - ${formatOutlookDate(task.endDate)}` : ""}</span>
                  <span className="flex items-center gap-1"><Clock3 className="h-3 w-3 shrink-0" strokeWidth={1.8} />{task.durationDays}d</span>
                  {dependency && <span className="flex min-w-0 items-center gap-1"><GitBranch className="h-3 w-3 shrink-0" strokeWidth={1.8} /><span className="truncate text-muted-foreground/70">{dependency}</span></span>}
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function StatusBadge({ task }: { task: OutlookTask }) {
  return (
    <span className={cn(
      "shrink-0 rounded-full border px-1.5 py-0.5 text-[7px] font-semibold uppercase tracking-wide",
      task.status === "complete" && "border-emerald-400/25 bg-emerald-400/[0.07] text-emerald-200/78",
      task.status === "blocked" && "border-orange-400/25 bg-orange-400/[0.07] text-orange-200/78",
      task.status === "in_progress" && "border-cyan-400/25 bg-cyan-400/[0.07] text-cyan-200/78",
      task.status === "not_started" && "border-blue-400/25 bg-blue-400/[0.07] text-blue-200/78",
    )}>
      {taskStatusLabel(task.status)}
    </span>
  )
}

function MiniRing({ value, color }: { value: number; color: string }) {
  const radius = 13
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - value / 100)
  return (
    <span className="relative grid size-8 shrink-0 place-items-center" role="img" aria-label={`${value}% complete`}>
      <svg className="absolute inset-0 size-full -rotate-90" viewBox="0 0 32 32" aria-hidden="true">
        <circle cx="16" cy="16" r={radius} fill="none" stroke="rgba(255,255,255,0.09)" strokeWidth="3" />
        <circle cx="16" cy="16" r={radius} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset} />
      </svg>
      <span className="font-mono text-[7px] font-semibold text-foreground/76">{value}</span>
    </span>
  )
}
