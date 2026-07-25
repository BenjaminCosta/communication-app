"use client"

/**
 * Form controls for the candidate flow.
 *
 * Placeholder-first and icon-led: no floating labels, one field per row,
 * 3.25rem targets and 16px text so iOS never zooms on focus. Labels live in
 * the field model and are exposed to screen readers only.
 */

import { useRef, type ReactNode } from "react"
import {
  CalendarDays,
  Check,
  ChevronDown,
  FileText,
  HardHat,
  Mail,
  MapPin,
  Phone,
  Upload,
  User,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { FieldIcon, GeneralFieldMeta } from "@/lib/applications-core"

const FIELD_ICON: Record<FieldIcon, typeof User> = {
  user: User,
  phone: Phone,
  mail: Mail,
  pin: MapPin,
  calendar: CalendarDays,
  trade: HardHat,
  file: FileText,
}

const ROW_CLASS =
  "flex min-h-[3.25rem] w-full items-center gap-3 rounded-xl border bg-[var(--apps-surface)] px-3.5 transition-[border-color,box-shadow] duration-150"

function Shell({ error, children }: { error?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      {children}
      {error && <p className="pl-1 text-xs font-medium text-[#DC5A5A]">{error}</p>}
    </div>
  )
}

interface AppsFieldProps {
  field: GeneralFieldMeta
  value: string
  onChange: (value: string) => void
  error?: string
}

export function AppsField({ field, value, onChange, error }: AppsFieldProps) {
  const id = `apps-field-${field.id}`
  const Icon = FIELD_ICON[field.icon]
  const borderClass = error ? "border-[#F3B4B4]" : "border-[var(--apps-border)]"

  if (field.kind === "upload") {
    return (
      <Shell error={error}>
        <UploadRow
          id={id}
          icon={<Icon className="h-4.5 w-4.5" strokeWidth={2} />}
          title={field.label}
          subtitle={field.placeholder}
          fileName={value}
          onPick={(file) => onChange(file.name)}
          onClear={() => onChange("")}
        />
      </Shell>
    )
  }

  if (field.kind === "select") {
    return (
      <Shell error={error}>
        <div className={cn(ROW_CLASS, borderClass, "relative focus-within:border-[var(--apps-blue)] focus-within:shadow-[0_0_0_3px_rgba(37,99,235,0.12)]")}>
          <Icon className="h-4.5 w-4.5 shrink-0 text-[var(--apps-text-muted)]" strokeWidth={2} />
          <select
            id={id}
            aria-label={field.label}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className={cn(
              "min-w-0 flex-1 appearance-none bg-transparent py-3 text-base outline-none",
              value ? "text-[var(--apps-text)]" : "text-[#94A3B8]",
            )}
          >
            <option value="">{field.placeholder}</option>
            {(field.options ?? []).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none h-4 w-4 shrink-0 text-[var(--apps-text-muted)]" strokeWidth={2} />
        </div>
      </Shell>
    )
  }

  return (
    <Shell error={error}>
      <div className={cn(ROW_CLASS, borderClass, "focus-within:border-[var(--apps-blue)] focus-within:shadow-[0_0_0_3px_rgba(37,99,235,0.12)]")}>
        <Icon className="h-4.5 w-4.5 shrink-0 text-[var(--apps-text-muted)]" strokeWidth={2} />
        <input
          id={id}
          aria-label={field.label}
          type={field.kind === "number" ? "text" : field.kind}
          inputMode={field.kind === "number" ? "numeric" : field.kind === "tel" ? "tel" : undefined}
          autoComplete={field.kind === "email" ? "email" : field.kind === "tel" ? "tel" : undefined}
          value={value}
          placeholder={field.placeholder}
          onChange={(event) => onChange(event.target.value)}
          className="min-w-0 flex-1 bg-transparent py-3 text-base text-[var(--apps-text)] outline-none placeholder:text-[#94A3B8]"
        />
        {value.trim() && <Check className="h-4 w-4 shrink-0 text-[var(--apps-complete)]" strokeWidth={2.5} />}
      </div>
    </Shell>
  )
}

/**
 * Upload rows read as a list item, not a form control — picking a file is
 * mocked until Storage is wired up.
 */
export function UploadRow({
  id,
  icon,
  title,
  subtitle,
  fileName,
  onPick,
  onClear,
  accept = "application/pdf,image/*",
  capture,
  tone = "neutral",
  busy = false,
}: {
  id?: string
  icon: ReactNode
  title: string
  subtitle: string
  fileName: string | null
  onPick: (file: File) => void
  onClear?: () => void
  accept?: string
  capture?: "user" | "environment"
  tone?: "neutral" | "missing"
  busy?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const filled = !!fileName?.trim()

  return (
    <>
      <input
        ref={inputRef}
        id={id}
        type="file"
        accept={accept}
        capture={capture}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) onPick(file)
          event.target.value = ""
        }}
      />
      <div
        className={cn(
          ROW_CLASS,
          "py-2.5",
          filled ? "border-[#BFDBFE] bg-[var(--apps-blue-soft)]/40" : tone === "missing" ? "border-[#F3B4B4]" : "border-[var(--apps-border)]",
        )}
      >
        <span
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
            filled
              ? "bg-[var(--apps-blue-soft)] text-[var(--apps-blue-strong)]"
              : tone === "missing"
                ? "bg-[var(--apps-missing-soft)] text-[#DC5A5A]"
                : "bg-[var(--apps-surface-2)] text-[var(--apps-text-muted)]",
          )}
        >
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-[var(--apps-text)]">{title}</span>
          <span className="mt-0.5 block truncate text-xs text-[var(--apps-text-muted)]">{filled ? fileName : subtitle}</span>
        </span>
        {filled ? (
          onClear && (
            <button
              type="button"
              onClick={onClear}
              className="applications-tap flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--apps-text-muted)] hover:bg-white"
              aria-label={`Remove ${title}`}
            >
              <X className="h-4 w-4" strokeWidth={2} />
            </button>
          )
        ) : busy ? (
          <span
            className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-[var(--apps-blue-soft)] border-t-[var(--apps-blue)]"
            aria-label="Uploading"
          />
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="applications-tap flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--apps-blue)] hover:bg-[var(--apps-blue-soft)]"
            aria-label={`Upload ${title}`}
          >
            <Upload className="h-4.5 w-4.5" strokeWidth={2} />
          </button>
        )}
      </div>
    </>
  )
}

export function AppsTextarea({
  id,
  value,
  onChange,
  placeholder,
  rows = 4,
  maxLength,
}: {
  id?: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  rows?: number
  maxLength?: number
}) {
  return (
    <div className="relative">
      <textarea
        id={id}
        rows={rows}
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="w-full resize-none rounded-xl border border-[var(--apps-border)] bg-[var(--apps-surface)] px-3.5 py-3 pb-7 text-base leading-relaxed text-[var(--apps-text)] outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-[#94A3B8] focus:border-[var(--apps-blue)] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.12)]"
      />
      {maxLength && (
        <span className="pointer-events-none absolute bottom-2.5 right-3.5 text-[0.6875rem] font-medium tabular-nums text-[var(--apps-text-muted)]">
          {value.length}/{maxLength}
        </span>
      )}
    </div>
  )
}
