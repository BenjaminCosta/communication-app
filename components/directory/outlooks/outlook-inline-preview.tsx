"use client"

import { CalendarDays, Clock3 } from "lucide-react"
import {
  formatOutlookDate,
  localDateToIso,
  outlookDates,
  taskStatusLabel,
  type OutlookTask,
  type OutlookWindow,
} from "@/lib/outlook-core"
import { cn } from "@/lib/utils"

const TASK_TONES = [
  "border-violet-600 bg-violet-600 text-white",
  "border-cyan-600 bg-cyan-600 text-white",
  "border-amber-500 bg-amber-500 text-[#14100a]",
  "border-emerald-600 bg-emerald-600 text-white",
]

function clampDate(date: string, start: string, end: string): string {
  if (date < start) return start
  if (date > end) return end
  return date
}

export function OutlookInlinePreview({ window, tasks }: { window: OutlookWindow; tasks: OutlookTask[] }) {
  const dates = outlookDates(window.start)
  const todayIndex = dates.indexOf(localDateToIso(new Date()))
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

      <div className="relative min-h-36 overflow-hidden px-1.5 py-3">
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

        {todayIndex >= 0 && (
          <div className="pointer-events-none absolute inset-y-0 z-[2] w-px bg-[var(--directory-job)]/70" style={{ left: `${((todayIndex + 0.5) / 21) * 100}%` }} aria-hidden="true">
            <span className="absolute left-1/2 top-1 -translate-x-1/2 rounded bg-[var(--directory-job)] px-1 py-0.5 text-[7px] font-semibold text-[#0b0f14]">Today</span>
          </div>
        )}

        {visibleTasks.length === 0 ? (
          <div className="relative flex min-h-28 flex-col items-center justify-center text-center">
            <CalendarDays className="h-5 w-5 text-[var(--directory-job)]/65" strokeWidth={1.7} />
            <p className="mt-2 text-xs font-medium text-foreground/70">No tasks in this window</p>
            <p className="mt-0.5 text-[10px] text-muted-foreground/50">Use Quick Update to add the first activity.</p>
          </div>
        ) : (
          <div className="relative grid grid-cols-[repeat(21,minmax(0,1fr))] grid-rows-[repeat(4,26px)] gap-y-1.5">
            {visibleTasks.map((task, index) => {
              const start = dates.indexOf(clampDate(task.startDate!, window.start, window.end)) + 1
              const end = dates.indexOf(clampDate(task.endDate!, window.start, window.end)) + 2
              return (
                <div
                  key={task.id}
                  className={cn(
                    "z-[1] mx-0.5 min-w-0 self-center truncate rounded-md border px-1.5 py-1 text-[9px] font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_2px_5px_rgba(2,6,12,0.28)]",
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
