"use client"

import { useMemo, useState } from "react"
import { Plus, Search } from "lucide-react"
import { formatOutlookDate, taskStatusLabel, type OutlookTask } from "@/lib/outlook-core"
import { cn } from "@/lib/utils"

type TaskFilter = "all" | "planned" | "active" | "risk" | "done"

const FILTERS: Array<{ id: TaskFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "planned", label: "Planned" },
  { id: "active", label: "Active" },
  { id: "risk", label: "At risk" },
  { id: "done", label: "Done" },
]

const TASK_VISUALS = [
  { dot: "bg-violet-400", border: "border-violet-400/35", text: "text-violet-300", ring: "#a78bfa" },
  { dot: "bg-cyan-400", border: "border-cyan-400/35", text: "text-cyan-300", ring: "#22d3ee" },
  { dot: "bg-amber-400", border: "border-amber-400/35", text: "text-amber-300", ring: "#fb923c" },
  { dot: "bg-blue-400", border: "border-blue-400/35", text: "text-blue-300", ring: "#60a5fa" },
] as const

function matchesFilter(task: OutlookTask, filter: TaskFilter): boolean {
  if (filter === "planned") return task.status === "not_started"
  if (filter === "active") return task.status === "in_progress"
  if (filter === "risk") return task.status === "blocked"
  if (filter === "done") return task.status === "complete"
  return true
}

export function OutlookTasksView({
  tasks,
  onAddTask,
  onOpenTask,
}: {
  tasks: OutlookTask[]
  onAddTask: () => void
  onOpenTask: (task: OutlookTask) => void
}) {
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<TaskFilter>("all")
  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return tasks.filter((task) => {
      if (!matchesFilter(task, filter)) return false
      if (!normalized) return true
      return [task.title, task.description, task.trade, task.companyName]
        .some((value) => value.toLowerCase().includes(normalized))
    })
  }, [filter, query, tasks])

  return (
    <div className="space-y-3 animate-fade-up">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
        <label className="relative block">
          <span className="sr-only">Search tasks</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/45" strokeWidth={1.8} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search tasks..." className="outlook-input !py-2.5 !pl-9 !text-xs" />
        </label>
        <button type="button" onClick={onAddTask} className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl border border-[var(--directory-job-border)] bg-[var(--directory-job-soft)] px-3 text-[10px] font-semibold text-[var(--directory-job)] transition-transform active:scale-[0.98]">
          <Plus className="h-3.5 w-3.5" strokeWidth={1.8} /> Add task
        </button>
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide" role="group" aria-label="Filter outlook tasks">
        {FILTERS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setFilter(entry.id)}
            className={cn(
              "shrink-0 rounded-full border px-3 py-1.5 text-[9px] font-semibold transition-[background-color,border-color,color,transform] active:scale-[0.97]",
              filter === entry.id
                ? "border-[var(--directory-job-border)] bg-[var(--directory-job-soft)] text-[var(--directory-job)]"
                : "border-white/[0.08] bg-white/[0.025] text-muted-foreground/58",
            )}
            aria-pressed={filter === entry.id}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/[0.1] px-5 py-12 text-center">
          <p className="text-xs font-medium text-foreground/72">No matching tasks</p>
          <p className="mt-1 text-[10px] text-muted-foreground/50">Change the search or filter, or add a new task.</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {visible.map((task) => {
            const dependency = tasks.find((candidate) => candidate.id === task.dependencyTaskId)?.title
            const visual = TASK_VISUALS[task.sortOrder % TASK_VISUALS.length]
            return (
              <button
                key={task.id}
                type="button"
                onClick={() => onOpenTask(task)}
                className="w-full rounded-2xl border border-white/[0.09] bg-[#0a111a]/82 p-3.5 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.045)] transition-[background-color,border-color,transform] hover:border-white/[0.14] active:scale-[0.99] active:bg-white/[0.035]"
              >
                <div className="grid grid-cols-[10px_minmax(0,1fr)_44px] items-start gap-3 min-[460px]:grid-cols-[10px_minmax(0,1fr)_80px_48px]">
                  <span className={cn("mt-1.5 size-2.5 rounded-full", visual.dot)} aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground/90">{task.title || "Untitled task"}</p>
                    <p className="mt-1 truncate text-[10px] text-muted-foreground/60">{task.trade || "General"}</p>
                    {task.companyName && <span className={cn("mt-1 inline-flex max-w-full truncate rounded-full border px-2 py-0.5 text-[9px]", visual.border, visual.text)}>{task.companyName}</span>}
                    <p className="mt-1.5 flex items-center gap-2 font-mono text-[9px] text-muted-foreground/58 min-[460px]:hidden"><span>{task.startDate ? formatOutlookDate(task.startDate) : "Missing"}</span><span>{task.durationDays}d</span></p>
                  </div>
                  <div className="hidden space-y-1.5 font-mono text-[10px] text-muted-foreground/62 min-[460px]:block">
                    <p>{task.startDate ? formatOutlookDate(task.startDate) : "Missing"}</p>
                    <p>{task.durationDays} day{task.durationDays === 1 ? "" : "s"}</p>
                  </div>
                  <ProgressRing value={task.completionPercent} color={visual.ring} />
                </div>

                <div className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 border-t border-white/[0.065] pt-2.5 min-[390px]:grid-cols-[auto_minmax(0,1fr)_auto_auto]">
                  <span className="text-[9px] text-muted-foreground/48">Depends on</span>
                  <span className="min-w-0 truncate rounded-full border border-white/[0.1] px-2 py-1 text-[9px] text-muted-foreground/70">{dependency || "None"}</span>
                  <span className="hidden text-[9px] text-muted-foreground/48 min-[390px]:inline">Status</span>
                  <StatusBadge task={task} />
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
      "col-span-2 ml-auto flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-[8px] font-semibold uppercase tracking-wide min-[390px]:col-span-1",
      task.status === "complete" && "border-emerald-400/25 bg-emerald-400/[0.07] text-emerald-200/78",
      task.status === "blocked" && "border-orange-400/25 bg-orange-400/[0.07] text-orange-200/78",
      task.status === "in_progress" && "border-cyan-400/25 bg-cyan-400/[0.07] text-cyan-200/78",
      task.status === "not_started" && "border-blue-400/25 bg-blue-400/[0.07] text-blue-200/78",
    )}>
      {taskStatusLabel(task.status)}
    </span>
  )
}

function ProgressRing({ value, color }: { value: number; color: string }) {
  const radius = 18
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - value / 100)
  return (
    <span className="relative grid size-11 shrink-0 place-items-center min-[460px]:size-12" role="img" aria-label={`${value}% complete`}>
      <svg className="absolute inset-0 size-full -rotate-90" viewBox="0 0 44 44" aria-hidden="true">
        <circle cx="22" cy="22" r={radius} fill="none" stroke="rgba(255,255,255,0.09)" strokeWidth="4" />
        <circle cx="22" cy="22" r={radius} fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset} />
      </svg>
      <span className="font-mono text-[9px] font-semibold text-foreground/76">{value}%</span>
    </span>
  )
}
