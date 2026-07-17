"use client"

import { CalendarDays, Clock3 } from "lucide-react"
import {
  formatOutlookDate,
  outlookDates,
  taskStatusLabel,
  type OutlookTask,
  type OutlookWindow,
} from "@/lib/outlook-core"
import { cn } from "@/lib/utils"

const TASK_TONES = [
  "border-violet-400/45 bg-violet-400/25 text-violet-100",
  "border-cyan-400/45 bg-cyan-400/20 text-cyan-100",
  "border-amber-400/45 bg-amber-400/20 text-amber-100",
  "border-emerald-400/45 bg-emerald-400/20 text-emerald-100",
]

function clampDate(date: string, start: string, end: string): string {
  if (date < start) return start
  if (date > end) return end
  return date
}

export function OutlookInlinePreview({ window, tasks }: { window: OutlookWindow; tasks: OutlookTask[] }) {
  const dates = outlookDates(window.start)
  const visibleTasks = tasks
    .filter((task) => task.startDate && task.endDate && task.startDate <= window.end && task.endDate >= window.start)
    .slice(0, 4)

  return (
    <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-[#080e16]/70">
      <div className="grid grid-cols-3 divide-x divide-white/[0.06] border-b border-white/[0.07]">
        {[0, 1, 2].map((weekIndex) => {
          const start = dates[weekIndex * 7]
          const end = dates[weekIndex * 7 + 6]
          return (
            <div key={start} className="px-2 py-2 text-center">
              <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-foreground/65">Week {weekIndex + 1}</p>
              <p className="mt-0.5 truncate font-mono text-[8px] text-muted-foreground/50">
                {formatOutlookDate(start)} - {formatOutlookDate(end)}
              </p>
            </div>
          )
        })}
      </div>

      <div className="relative min-h-28 overflow-hidden px-1.5 py-2">
        <div className="pointer-events-none absolute inset-0 grid grid-cols-[repeat(21,minmax(0,1fr))]">
          {dates.map((date, index) => (
            <span
              key={date}
              className={cn(
                "border-r border-white/[0.035] last:border-r-0",
                (index === 6 || index === 13) && "border-r-white/[0.14]",
              )}
            />
          ))}
        </div>

        {visibleTasks.length === 0 ? (
          <div className="relative flex min-h-24 flex-col items-center justify-center text-center">
            <CalendarDays className="h-5 w-5 text-violet-300/55" strokeWidth={1.7} />
            <p className="mt-2 text-xs font-medium text-foreground/70">No tasks in this window</p>
            <p className="mt-0.5 text-[10px] text-muted-foreground/50">Use Quick Update to add the first activity.</p>
          </div>
        ) : (
          <div className="relative grid grid-cols-[repeat(21,minmax(0,1fr))] grid-rows-[repeat(4,22px)] gap-y-1">
            {visibleTasks.map((task, index) => {
              const start = dates.indexOf(clampDate(task.startDate!, window.start, window.end)) + 1
              const end = dates.indexOf(clampDate(task.endDate!, window.start, window.end)) + 2
              return (
                <div
                  key={task.id}
                  className={cn(
                    "z-[1] mx-0.5 min-w-0 self-center truncate rounded border px-1.5 py-1 text-[9px] font-medium",
                    TASK_TONES[index % TASK_TONES.length],
                  )}
                  style={{ gridColumn: `${start} / ${end}`, gridRow: index + 1 }}
                  title={task.title}
                >
                  {task.title || "Untitled"}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {tasks.length > 0 && (
        <div className="divide-y divide-white/[0.06] border-t border-white/[0.07]">
          {tasks.slice(0, 3).map((task, index) => (
            <div key={task.id} className="flex items-center gap-2.5 px-3 py-2.5">
              <span className={cn("h-2 w-2 shrink-0 rounded-full", index % 3 === 0 ? "bg-violet-400" : index % 3 === 1 ? "bg-cyan-400" : "bg-amber-400")} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] font-medium text-foreground/85">{task.title || "Untitled task"}</p>
                <p className="mt-0.5 truncate text-[9px] text-muted-foreground/50">{task.trade || task.companyName || "General"}</p>
              </div>
              <span className="flex shrink-0 items-center gap-1 font-mono text-[9px] text-muted-foreground/60">
                <CalendarDays className="h-3 w-3" strokeWidth={1.7} />
                {task.startDate ? formatOutlookDate(task.startDate) : "Missing"}
              </span>
              <span className="hidden shrink-0 items-center gap-1 font-mono text-[9px] text-muted-foreground/60 min-[390px]:flex">
                <Clock3 className="h-3 w-3" strokeWidth={1.7} />
                {task.durationDays}d
              </span>
              <span className="hidden rounded-full border border-emerald-400/20 px-1.5 py-0.5 text-[8px] font-semibold uppercase text-emerald-200/65 min-[430px]:inline">
                {taskStatusLabel(task.status)}
              </span>
            </div>
          ))}
          {tasks.length > 3 && (
            <p className="px-3 py-2 text-center text-[9px] font-medium text-muted-foreground/50">
              +{tasks.length - 3} more task{tasks.length - 3 === 1 ? "" : "s"}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
