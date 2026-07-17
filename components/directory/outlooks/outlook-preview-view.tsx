"use client"

import { Building2, CalendarDays, Clock3 } from "lucide-react"
import { OutlookGanttCalendar } from "@/components/directory/outlooks/outlook-gantt-calendar"
import { formatOutlookDate, taskStatusLabel, type OutlookTask, type OutlookWindow } from "@/lib/outlook-core"
import { cn } from "@/lib/utils"

export function OutlookPreviewView({ window, tasks }: { window: OutlookWindow; tasks: OutlookTask[] }) {
  return (
    <div className="space-y-3 animate-fade-up">
      <OutlookGanttCalendar window={window} tasks={tasks} />

      <section className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0a111a]/72" aria-label="Compact outlook task rows">
        {tasks.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-xs font-medium text-foreground/70">No tasks yet</p>
            <p className="mt-1 text-[10px] text-muted-foreground/50">Quick Update will add the first scheduled activity.</p>
          </div>
        ) : tasks.map((task, index) => (
          <div key={task.id} className="grid grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_auto] items-center gap-2 border-b border-white/[0.06] px-3 py-2.5 last:border-b-0">
            <div className="flex min-w-0 items-start gap-2">
              <span className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", index % 4 === 0 ? "bg-violet-400" : index % 4 === 1 ? "bg-cyan-400" : index % 4 === 2 ? "bg-blue-400" : "bg-amber-400")} />
              <div className="min-w-0">
                <p className="truncate text-[10px] font-semibold text-foreground/84">{task.title || "Untitled task"}</p>
                <p className="mt-0.5 flex min-w-0 items-center gap-1 truncate text-[8px] text-muted-foreground/48">
                  <Building2 className="h-2.5 w-2.5 shrink-0" strokeWidth={1.8} />
                  {task.trade || "General"}{task.companyName ? ` · ${task.companyName}` : ""}
                </p>
              </div>
            </div>
            <div className="min-w-0 font-mono text-[8px] text-muted-foreground/58">
              <p className="flex items-center gap-1 truncate"><CalendarDays className="h-2.5 w-2.5 shrink-0" strokeWidth={1.8} />{task.startDate ? formatOutlookDate(task.startDate) : "Missing"}{task.endDate ? ` - ${formatOutlookDate(task.endDate)}` : ""}</p>
              <p className="mt-1 flex items-center gap-1"><Clock3 className="h-2.5 w-2.5" strokeWidth={1.8} />{task.durationDays}d</p>
            </div>
            <StatusBadge task={task} />
          </div>
        ))}
      </section>
    </div>
  )
}

function StatusBadge({ task }: { task: OutlookTask }) {
  return (
    <span className={cn(
      "rounded-full border px-1.5 py-0.5 text-[7px] font-semibold uppercase tracking-wide",
      task.status === "complete" && "border-emerald-400/25 bg-emerald-400/[0.07] text-emerald-200/78",
      task.status === "blocked" && "border-orange-400/25 bg-orange-400/[0.07] text-orange-200/78",
      task.status === "in_progress" && "border-cyan-400/25 bg-cyan-400/[0.07] text-cyan-200/78",
      task.status === "not_started" && "border-blue-400/25 bg-blue-400/[0.07] text-blue-200/78",
    )}>
      {taskStatusLabel(task.status)}
    </span>
  )
}
