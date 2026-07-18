"use client"

import { formatOutlookDate, localDateToIso, outlookDates, type OutlookTask, type OutlookWindow } from "@/lib/outlook-core"
import { cn } from "@/lib/utils"

const BAR_TONES = [
  "border-violet-600 bg-violet-600 text-white",
  "border-cyan-600 bg-cyan-600 text-white",
  "border-blue-600 bg-blue-600 text-white",
  "border-amber-500 bg-amber-500 text-[#14100a]",
  "border-emerald-600 bg-emerald-600 text-white",
]

function clampDate(date: string, start: string, end: string): string {
  if (date < start) return start
  if (date > end) return end
  return date
}

export function OutlookGanttCalendar({ window, tasks, onOpenTask }: { window: OutlookWindow; tasks: OutlookTask[]; onOpenTask?: (task: OutlookTask) => void }) {
  const dates = outlookDates(window.start)
  const todayIndex = dates.indexOf(localDateToIso(new Date()))
  const visibleTasks = tasks.filter((task) => task.startDate && task.endDate && task.startDate <= window.end && task.endDate >= window.start)

  return (
    <section className="overflow-hidden rounded-2xl border border-white/[0.09] bg-[#091019]/82 shadow-[inset_0_1px_0_rgba(255,255,255,0.045)]" aria-label="Full three-week Gantt calendar">
      <div className="grid grid-cols-[96px_minmax(0,1fr)] border-b border-white/[0.08]">
        <div className="border-r border-white/[0.07]" />
        <div className="grid grid-cols-3 divide-x divide-white/[0.07]">
          {[0, 1, 2].map((weekIndex) => {
            const start = dates[weekIndex * 7]
            const end = dates[weekIndex * 7 + 6]
            return (
              <div key={start} className="px-1 py-3 text-center">
                <p className="text-[9px] font-semibold uppercase tracking-[0.09em] text-foreground/75">Week {weekIndex + 1}</p>
                <p className="mt-0.5 truncate font-mono text-[8px] text-muted-foreground/50">{formatOutlookDate(start)} - {formatOutlookDate(end)}</p>
              </div>
            )
          })}
        </div>
      </div>

      {visibleTasks.length === 0 ? (
        <div className="px-5 py-16 text-center">
          <p className="text-xs font-medium text-foreground/72">No scheduled work</p>
          <p className="mt-1 text-[10px] text-muted-foreground/50">Add a task to populate this three-week calendar.</p>
        </div>
      ) : (
        <div className="relative">
          {todayIndex >= 0 && (
            <div className="pointer-events-none absolute inset-y-0 left-[96px] right-0 z-[2]" aria-hidden="true">
              <div className="absolute inset-y-0 w-px bg-[var(--directory-job)]/75" style={{ left: `${((todayIndex + 0.5) / 21) * 100}%` }}>
                <span className="absolute -top-px left-1/2 -translate-x-1/2 rounded-sm bg-[var(--directory-job)] px-1 py-0.5 text-[7px] font-semibold text-[#0b0f14]">Today</span>
              </div>
            </div>
          )}

          {visibleTasks.map((task, index) => {
            const start = dates.indexOf(clampDate(task.startDate!, window.start, window.end)) + 1
            const end = dates.indexOf(clampDate(task.endDate!, window.start, window.end)) + 2
            return (
              <button
                key={task.id}
                type="button"
                onClick={() => onOpenTask?.(task)}
                className="grid min-h-16 w-full grid-cols-[96px_minmax(0,1fr)] border-b border-white/[0.055] text-left transition-colors last:border-b-0 hover:bg-white/[0.02] active:bg-white/[0.04]"
              >
                <div className="flex min-w-0 items-center border-r border-white/[0.07] px-2.5">
                  <span className="line-clamp-2 text-[9px] font-semibold leading-3.5 text-foreground/82" title={task.title}>{task.title || "Untitled"}</span>
                </div>
                <div className="relative grid grid-cols-[repeat(21,minmax(0,1fr))] items-center">
                  <div className="pointer-events-none absolute inset-0 grid grid-cols-[repeat(21,minmax(0,1fr))]">
                    {dates.map((date, dateIndex) => (
                      <span key={date} className={cn("border-r border-white/[0.035] last:border-r-0", (dateIndex === 6 || dateIndex === 13) && "border-r-white/[0.13]")} />
                    ))}
                  </div>
                  <div
                    className={cn("relative z-[1] mx-0.5 h-5 min-w-0 rounded-md border shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_2px_5px_rgba(2,6,12,0.28)]", BAR_TONES[index % BAR_TONES.length])}
                    style={{ gridColumn: `${start} / ${end}` }}
                    title={`${task.title} · ${formatOutlookDate(task.startDate!)} - ${formatOutlookDate(task.endDate!)}`}
                  >
                    <span className="sr-only">{task.title || "Untitled"}</span>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}
