"use client"

/**
 * Form controls for the public 3-Week Outlook form. Icon-led, one field per
 * row, 3.25rem targets and 16px text so iOS never zooms on focus — same
 * conventions as components/applications/ui/apps-form.tsx.
 */

import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

const ROW_CLASS =
  "flex min-h-[3.25rem] w-full items-center gap-3 rounded-xl border bg-[var(--of-surface)] px-3.5 transition-[border-color,box-shadow] duration-150"
const FOCUS_CLASS = "focus-within:border-[var(--of-blue)] focus-within:shadow-[0_0_0_3px_rgba(37,99,235,0.12)]"

function Shell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-semibold text-[var(--of-text-muted)]">{label}</label>
      {children}
    </div>
  )
}

export function OutlookFormTextField({
  label,
  icon,
  value,
  onChange,
  placeholder,
  type = "text",
  inputMode,
}: {
  label: string
  icon?: ReactNode
  value: string
  onChange: (value: string) => void
  placeholder?: string
  type?: "text" | "tel"
  inputMode?: "text" | "tel" | "numeric"
}) {
  return (
    <Shell label={label}>
      <div className={cn(ROW_CLASS, "border-[var(--of-border)]", FOCUS_CLASS)}>
        {icon && <span className="shrink-0 text-[var(--of-text-muted)]">{icon}</span>}
        <input
          type={type}
          inputMode={inputMode}
          autoComplete={type === "tel" ? "tel" : undefined}
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          className="min-w-0 flex-1 bg-transparent py-3 text-base text-[var(--of-text)] outline-none placeholder:text-[#94A3B8]"
        />
      </div>
    </Shell>
  )
}

export function OutlookFormDateField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <Shell label={label}>
      <div className={cn(ROW_CLASS, "border-[var(--of-border)]", FOCUS_CLASS)}>
        <input
          type="date"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="min-w-0 flex-1 bg-transparent py-3 text-base text-[var(--of-text)] outline-none"
        />
      </div>
    </Shell>
  )
}

export function OutlookFormNumberField({
  label,
  value,
  onChange,
  min = 1,
}: {
  label: string
  value: number
  onChange: (value: number) => void
  min?: number
}) {
  return (
    <Shell label={label}>
      <div className={cn(ROW_CLASS, "border-[var(--of-border)]", FOCUS_CLASS)}>
        <input
          type="number"
          inputMode="numeric"
          min={min}
          value={value}
          onChange={(event) => onChange(Math.max(min, Number(event.target.value) || min))}
          className="min-w-0 flex-1 bg-transparent py-3 text-base text-[var(--of-text)] outline-none"
        />
      </div>
    </Shell>
  )
}

export function OutlookFormTextarea({
  label,
  value,
  onChange,
  placeholder,
  rows = 4,
  maxLength,
}: {
  label?: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  rows?: number
  maxLength?: number
}) {
  const field = (
    <div className="relative">
      <textarea
        rows={rows}
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          "w-full resize-none rounded-xl border border-[var(--of-border)] bg-[var(--of-surface)] px-3.5 py-3 text-base leading-relaxed text-[var(--of-text)] outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-[#94A3B8] focus:border-[var(--of-blue)] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.12)]",
          maxLength && "pb-7",
        )}
      />
      {maxLength && (
        <span className="pointer-events-none absolute bottom-2.5 right-3.5 text-[0.6875rem] font-medium tabular-nums text-[var(--of-text-muted)]">
          {value.length}/{maxLength}
        </span>
      )}
    </div>
  )
  return label ? <Shell label={label}>{field}</Shell> : field
}
