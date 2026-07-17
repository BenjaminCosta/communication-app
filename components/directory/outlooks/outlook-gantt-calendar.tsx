"use client"

import { formatOutlookDate, localDateToIso, outlookDates, type OutlookTask, type OutlookWindow } from "@/lib/outlook-core"
import { cn } from "@/lib/utils"

const BAR_TONES = [
  "border-violet-400/55 bg-violet-400/30 text-violet-100",
  "border-cyan-400/50 bg-cyan-400/25 text-cyan-100",
  "border-blue-400/50 bg-blue-400/25 text-blue-100",
  "border-amber-400/50 bg-amber-400/25 text-amber-100",
  "border-emerald-400/50 bg-emerald-400/25 text-emerald-100",
]

function clampDate(date: string, start: string, end: string): string {
  if (date < start) return start
  if (date > end) return end
  return date
}

export function OutlookGanttCalendar({ window, tasks }: { window: OutlookWindow; tasks: OutlookTask[] }) {
  const dates = outlookDates(window.start)
  const todayIndex = dates.indexOf(localDateToIso(new Date()))
  const visibleTasks = tasks.filter((task) => task.startDate && task.endDate && task.startDate <= window.end && task.endDate >= window.start)

  return (
    <section className="overflow-hidden rounded-2xl border border-white/[0.09] bg-[#091019]/82 shadow-[inset_0_1px_0_rgba(255,255,255,0.045)]" aria-label="Full three-week Gantt calendar">
      <div className="grid grid-cols-[82px_minmax(0,1fr)] border-b border-white/[0.08]">
        <div className="border-r border-white/[0.07]" />
        <div className="grid grid-cols-3 divide-x divide-white/[0.07]">
          {[0, 1, 2].map((weekIndex) => {
            const start = dates[weekIndex * 7]
            const end = dates[weekIndex * 7 + 6]
            return (
              <div key={start} className="px-1 py-2.5 text-center">
                <p className="text-[9px] font-semibold uppercase tracking-[0.09em] text-foreground/75">Week {weekIndex + 1}</p>
                <p className="mt-0.5 truncate font-mono text-[8px] text-muted-foreground/50">{formatOutlookDate(start)} - {formatOutlookDate(end)}</p>
              </div>
            )
          })}
        </div>
      </div>

      {visibleTasks.length === 0 ? (
        <div className="px-5 py-12 text-center">
          <p className="text-xs font-medium text-foreground/72">No scheduled work</p>
          <p className="mt-1 text-[10px] text-muted-foreground/50">Add a task to populate this three-week calendar.</p>
        </div>
      ) : (
        <div className="relative">
          {todayIndex >= 0 && (
            <div className="pointer-events-none absolute inset-y-0 left-[82px] right-0 z-[2]" aria-hidden="true">
              <div className="absolute inset-y-0 w-px bg-violet-400/75" style={{ left: `${((todayIndex + 0.5) / 21) * 100}%` }}>
                <span className="absolute -top-px left-1/2 -translate-x-1/2 rounded-sm bg-violet-500 px-1 py-0.5 text-[7px] font-semibold text-white">Today</span>
              </div>
            </div>
          )}

          {visibleTasks.map((task, index) => {
            const start = dates.indexOf(clampDate(task.startDate!, window.start, window.end)) + 1
            const end = dates.indexOf(clampDate(task.endDate!, window.start, window.end)) + 2
            return (
              <div key={task.id} className="grid min-h-10 grid-cols-[82px_minmax(0,1fr)] border-b border-white/[0.055] last:border-b-0">
                <div className="flex min-w-0 items-center border-r border-white/[0.07] px-2">
                  <span className="truncate text-[9px] font-medium leading-3 text-foreground/78" title={task.title}>{task.title || "Untitled"}</span>
                </div>
                <div className="relative grid grid-cols-[repeat(21,minmax(0,1fr))] items-center">
                  <div className="pointer-events-none absolute inset-0 grid grid-cols-[repeat(21,minmax(0,1fr))]">
                    {dates.map((date, dateIndex) => (
                      <span key={date} className={cn("border-r border-white/[0.035] last:border-r-0", (dateIndex === 6 || dateIndex === 13) && "border-r-white/[0.13]")} />
                    ))}
                  </div>
                  <div
                    className={cn("relative z-[1] mx-0.5 min-w-0 truncate rounded border px-1.5 py-1 text-[8px] font-medium", BAR_TONES[index % BAR_TONES.length])}
                    style={{ gridColumn: `${start} / ${end}` }}
                    title={`${task.title} · ${formatOutlookDate(task.startDate!)} - ${formatOutlookDate(task.endDate!)}`}
                  >
                    {task.title || "Untitled"}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
