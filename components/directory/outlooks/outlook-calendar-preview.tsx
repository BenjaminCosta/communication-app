"use client"

import { formatOutlookDate, outlookDates, type OutlookTask, type OutlookWindow } from "@/lib/outlook-core"
import { cn } from "@/lib/utils"

const TASK_TONES = [
  "border-violet-600 bg-violet-600 text-white",
  "border-cyan-600 bg-cyan-600 text-white",
  "border-amber-500 bg-amber-500 text-[#14100a]",
  "border-emerald-600 bg-emerald-600 text-white",
]

function maxDate(a: string, b: string): string { return a > b ? a : b }
function minDate(a: string, b: string): string { return a < b ? a : b }

export function OutlookCalendarPreview({ window, tasks }: { window: OutlookWindow; tasks: OutlookTask[] }) {
  const dates = outlookDates(window.start)
  const weeks = [dates.slice(0, 7), dates.slice(7, 14), dates.slice(14, 21)]

  return (
    <section className="overflow-hidden rounded-2xl border border-white/[0.09] bg-[#0b111a]/75 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]" aria-label="Three-week calendar preview">
      {weeks.map((week, weekIndex) => {
        const weekStart = week[0]
        const weekEnd = week[6]
        const visibleTasks = tasks.filter((task) => task.startDate && task.endDate && task.startDate <= weekEnd && task.endDate >= weekStart)
        return (
          <div key={weekStart} className={cn("px-3 py-3", weekIndex > 0 && "border-t border-white/[0.07]") }>
            <div className="mb-2 flex items-end justify-between gap-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground/75">Week {weekIndex + 1}</p>
              <p className="font-mono text-[10px] text-muted-foreground/55">
                {formatOutlookDate(weekStart)} - {formatOutlookDate(weekEnd)}
              </p>
            </div>
            <div className="grid grid-cols-7 border-x border-t border-white/[0.06]">
              {week.map((date) => (
                <div key={date} className="border-r border-white/[0.06] py-1.5 text-center last:border-r-0">
                  <p className="text-[9px] font-semibold uppercase text-muted-foreground/45">
                    {formatOutlookDate(date, { weekday: "narrow" })}
                  </p>
                  <p className="mt-0.5 font-mono text-[10px] text-foreground/65">{Number(date.slice(-2))}</p>
                </div>
              ))}
            </div>
            <div className="relative min-h-8 border border-white/[0.06] border-t-0 bg-white/[0.012] py-1.5">
              <div className="pointer-events-none absolute inset-0 grid grid-cols-7">
                {week.map((date) => <span key={date} className="border-r border-white/[0.045] last:border-r-0" />)}
              </div>
              {visibleTasks.length === 0 ? (
                <p className="relative py-1 text-center text-[10px] text-muted-foreground/35">No scheduled work</p>
              ) : (
                <div className="relative grid gap-1">
                  {visibleTasks.map((task, index) => {
                    const visibleStart = maxDate(task.startDate!, weekStart)
                    const visibleEnd = minDate(task.endDate!, weekEnd)
                    const startColumn = week.indexOf(visibleStart) + 1
                    const endColumn = week.indexOf(visibleEnd) + 2
                    return (
                      <div key={task.id} className="grid grid-cols-7 px-0.5">
                        <div
                          className={cn("min-w-0 truncate rounded-md border px-1.5 py-1 text-[9px] font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_2px_5px_rgba(2,6,12,0.28)]", TASK_TONES[(task.sortOrder + index) % TASK_TONES.length])}
                          style={{ gridColumn: `${startColumn} / ${endColumn}` }}
                          title={task.title}
                        >
                          {task.title || "Untitled"}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )
      })}
    </section>
  )
}
