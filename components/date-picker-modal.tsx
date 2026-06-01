"use client"

import { useState } from "react"
import { ChevronLeft, ChevronRight, X } from "lucide-react"
import { cn } from "@/lib/utils"

interface DatePickerModalProps {
  /** Currently selected dates as "YYYY-MM-DD" strings */
  selectedDates: string[]
  onConfirm: (dates: string[]) => void
  onClose: () => void
  title?: string
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]
const DAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"]

function toDateStr(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

function todayStr(): string {
  const d = new Date()
  return toDateStr(d.getFullYear(), d.getMonth(), d.getDate())
}

function formatShort(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number)
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

export function DatePickerModal({
  selectedDates,
  onConfirm,
  onClose,
  title = "Pick dates",
}: DatePickerModalProps) {
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())
  const [picked, setPicked] = useState<Set<string>>(new Set(selectedDates))

  const iso = todayStr()

  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const firstWeekday = new Date(year, month, 1).getDay() // 0=Sun

  const prevMonth = () => {
    if (month === 0) { setYear((y) => y - 1); setMonth(11) }
    else setMonth((m) => m - 1)
  }
  const nextMonth = () => {
    if (month === 11) { setYear((y) => y + 1); setMonth(0) }
    else setMonth((m) => m + 1)
  }

  const toggle = (dateStr: string) => {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(dateStr)) next.delete(dateStr)
      else next.add(dateStr)
      return next
    })
  }

  // Build flat array: nulls for leading empty cells, then 1..daysInMonth
  const cells: (number | null)[] = [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  // Pad to full weeks
  while (cells.length % 7 !== 0) cells.push(null)

  const sorted = [...picked].sort()

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center px-0 sm:px-4">
      {/* Backdrop */}
      <button
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        aria-label="Close"
      />

      {/* Card */}
      <div className="relative z-10 w-full sm:max-w-xs glass-modal rounded-t-3xl sm:rounded-3xl border border-white/10 shadow-2xl animate-spring-pop safe-area-pb overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-0">
          <div>
            <p className="text-[10px] font-bold tracking-[2px] uppercase text-muted-foreground font-mono">
              Calendar
            </p>
            <h2 className="text-lg font-bold leading-tight">{title}</h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center active:scale-95 transition-transform"
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* Month nav */}
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <button
            onClick={prevMonth}
            className="w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center active:scale-95 transition-transform"
          >
            <ChevronLeft className="w-4 h-4 text-muted-foreground" />
          </button>
          <span className="text-sm font-bold text-foreground">
            {MONTH_NAMES[month]} {year}
          </span>
          <button
            onClick={nextMonth}
            className="w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center active:scale-95 transition-transform"
          >
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* Day labels */}
        <div className="grid grid-cols-7 px-3 pb-1">
          {DAY_LABELS.map((d) => (
            <div
              key={d}
              className="text-center text-[10px] font-bold uppercase tracking-wider text-muted-foreground/40 py-1"
            >
              {d}
            </div>
          ))}
        </div>

        {/* Calendar grid */}
        <div className="grid grid-cols-7 px-3 pb-3 gap-y-1">
          {cells.map((day, i) => {
            if (!day) return <div key={`e-${i}`} className="aspect-square" />
            const dateStr = toDateStr(year, month, day)
            const isSelected = picked.has(dateStr)
            const isToday = dateStr === iso

            return (
              <button
                key={dateStr}
                onClick={() => toggle(dateStr)}
                className={cn(
                  "aspect-square rounded-xl text-sm font-semibold flex items-center justify-center transition-all active:scale-90",
                  isSelected
                    ? "bg-primary text-white shadow-[0_2px_10px_rgba(37,99,235,0.45)]"
                    : isToday
                    ? "bg-white/10 text-foreground ring-1 ring-white/20"
                    : "text-foreground/75 hover:bg-white/5"
                )}
              >
                {day}
              </button>
            )
          })}
        </div>

        {/* Selected dates summary */}
        {sorted.length > 0 && (
          <div className="px-5 pb-2">
            <p className="text-[11px] text-muted-foreground/70 text-center leading-relaxed">
              {sorted.length === 1
                ? formatShort(sorted[0])
                : sorted.length <= 3
                ? sorted.map(formatShort).join(" · ")
                : `${formatShort(sorted[0])} + ${sorted.length - 1} more`}
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="px-5 pt-2 pb-6 flex flex-col gap-2">
          <button
            onClick={() => onConfirm(sorted)}
            className={cn(
              "w-full py-3.5 rounded-xl text-sm font-semibold tracking-wide transition-all active:scale-[0.98]",
              picked.size > 0
                ? "bg-primary text-white shadow-[0_4px_16px_rgba(37,99,235,0.4)]"
                : "bg-white/8 text-muted-foreground/60"
            )}
          >
            {picked.size > 0
              ? `Confirm ${picked.size} date${picked.size !== 1 ? "s" : ""}`
              : "Confirm (clear dates)"}
          </button>
          <button
            onClick={onClose}
            className="w-full py-2 text-xs text-muted-foreground/50 active:opacity-70 transition-opacity"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
