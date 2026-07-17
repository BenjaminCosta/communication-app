"use client"

import { useMemo, useState } from "react"
import { CalendarDays, ChevronRight, Plus, Search } from "lucide-react"
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
        <button type="button" onClick={onAddTask} className="flex items-center gap-1.5 rounded-xl border border-violet-400/25 bg-violet-400/[0.08] px-3 text-[10px] font-semibold text-violet-200 active:scale-[0.98]">
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
                ? "border-violet-400/30 bg-violet-400/[0.12] text-violet-100"
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
          {visible.map((task, index) => {
            const dependency = tasks.find((candidate) => candidate.id === task.dependencyTaskId)?.title
            return (
              <button
                key={task.id}
                type="button"
                onClick={() => onOpenTask(task)}
                className="w-full rounded-2xl border border-white/[0.085] bg-[#0a111a]/76 p-3.5 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.035)] transition-[background-color,transform] active:scale-[0.99] active:bg-white/[0.035]"
              >
                <div className="flex items-start gap-2.5">
                  <span className={cn("mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full", index % 4 === 0 ? "bg-violet-400" : index % 4 === 1 ? "bg-cyan-400" : index % 4 === 2 ? "bg-blue-400" : "bg-amber-400")} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground/88">{task.title || "Untitled task"}</p>
                      <StatusBadge task={task} />
                    </div>
                    <p className="mt-1 truncate text-[10px] text-muted-foreground/55">{task.trade || "General"}{task.companyName ? ` · ${task.companyName}` : ""}</p>
                  </div>
                  <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground/35" strokeWidth={1.8} />
                </div>

                <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
                  <div className="min-w-0 text-[9px] text-muted-foreground/57">
                    <p className="flex items-center gap-1.5 font-mono"><CalendarDays className="h-3 w-3" strokeWidth={1.8} />{task.startDate ? formatOutlookDate(task.startDate) : "Missing date"}{task.endDate ? ` - ${formatOutlookDate(task.endDate)}` : ""} ({task.durationDays}d)</p>
                    <p className="mt-1 truncate">Depends on: {dependency || "None"}</p>
                  </div>
                  <div className="flex w-28 items-center gap-2">
                    <span className="w-7 text-right font-mono text-[9px] text-foreground/68">{task.completionPercent}%</span>
                    <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-white/[0.08]">
                      <span className="block h-full rounded-full bg-violet-400/75" style={{ width: `${task.completionPercent}%` }} />
                    </span>
                  </div>
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
      "shrink-0 rounded-full border px-2 py-0.5 text-[8px] font-semibold uppercase tracking-wide",
      task.status === "complete" && "border-emerald-400/25 bg-emerald-400/[0.07] text-emerald-200/78",
      task.status === "blocked" && "border-orange-400/25 bg-orange-400/[0.07] text-orange-200/78",
      task.status === "in_progress" && "border-cyan-400/25 bg-cyan-400/[0.07] text-cyan-200/78",
      task.status === "not_started" && "border-blue-400/25 bg-blue-400/[0.07] text-blue-200/78",
    )}>
      {taskStatusLabel(task.status)}
    </span>
  )
}
