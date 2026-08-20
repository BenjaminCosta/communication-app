"use client"

/**
 * Public 3-Week Outlook form design primitives — everything reads its colors
 * from the .outlook-form-scope tokens (app/globals.css). Mirrors
 * components/applications/ui/apps-primitives.tsx's shape/conventions.
 */

import { useEffect, type ButtonHTMLAttributes, type ReactNode } from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"

// ── Button ──────────────────────────────────────────────────────────────

interface OutlookFormButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger"
  icon?: ReactNode
  fullWidth?: boolean
}

export function OutlookFormButton({ variant = "primary", icon, fullWidth, className, children, ...props }: OutlookFormButtonProps) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "outlook-form-tap inline-flex min-h-[3.25rem] items-center justify-center gap-2 rounded-xl px-5 text-[0.95rem] font-semibold disabled:cursor-not-allowed",
        fullWidth && "w-full",
        variant === "primary" && "outlook-form-primary-button text-white disabled:text-white/80",
        variant === "secondary" &&
          "border border-[var(--of-border)] bg-[var(--of-surface)] text-[var(--of-blue-strong)] hover:bg-[var(--of-surface-2)] disabled:text-[var(--of-text-muted)]",
        variant === "ghost" && "text-[var(--of-text-muted)] hover:bg-[var(--of-surface-2)]",
        variant === "danger" && "border border-[#FBD0D0] bg-[var(--of-missing-soft)] text-[#DC5A5A] hover:bg-[#FDDCDC]",
        className,
      )}
    >
      {icon}
      {children}
    </button>
  )
}

// ── Card ────────────────────────────────────────────────────────────────

export function OutlookFormCard({ children, className, flat = false }: { children: ReactNode; className?: string; flat?: boolean }) {
  return <div className={cn(flat ? "outlook-form-card-flat" : "outlook-form-card", "rounded-2xl", className)}>{children}</div>
}

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h2 className={cn("text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-[var(--of-text-muted)]", className)}>{children}</h2>
  )
}

// ── Chip (multi-select tag, used on the notes step) ────────────────────

export function OutlookFormChip({
  label,
  icon,
  selected,
  onClick,
}: {
  label: string
  icon: ReactNode
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "outlook-form-tap flex items-center gap-1.5 rounded-xl border px-3.5 py-2.5 text-sm font-medium",
        selected
          ? "border-[var(--of-blue)] bg-[var(--of-blue-soft)] text-[var(--of-blue-strong)]"
          : "border-[var(--of-border)] bg-[var(--of-surface)] text-[var(--of-text)] hover:bg-[var(--of-surface-2)]",
      )}
    >
      {icon}
      {label}
      {selected && (
        <span className="ml-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--of-blue)] text-white">
          <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none">
            <path d="M2.5 6.2 4.8 8.5 9.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      )}
    </button>
  )
}

// ── Icon badge (circular icon wrapper — info card, review rows, success) ─

export function OutlookFormIconBadge({
  icon,
  tone = "blue",
  size = "md",
  className,
}: {
  icon: ReactNode
  tone?: "blue" | "muted"
  size?: "sm" | "md" | "lg"
  className?: string
}) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full",
        size === "sm" && "h-8 w-8",
        size === "md" && "h-10 w-10",
        size === "lg" && "h-16 w-16",
        tone === "blue" ? "bg-[var(--of-blue-soft)] text-[var(--of-blue-strong)]" : "bg-[var(--of-surface-2)] text-[var(--of-text-muted)]",
        className,
      )}
    >
      {icon}
    </span>
  )
}

// ── Bottom sheet ────────────────────────────────────────────────────────

export function OutlookFormSheet({
  open,
  title,
  description,
  onClose,
  children,
  footer,
}: {
  open: boolean
  title: string
  description?: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="absolute inset-0 z-50 flex flex-col justify-end md:items-center md:justify-center">
      <button type="button" className="absolute inset-0 cursor-default bg-[#0F172A]/35 animate-fade-in" onClick={onClose} aria-label={`Close ${title}`} />
      <section
        role="dialog"
        aria-label={title}
        className="outlook-form-step-enter relative flex max-h-[88%] w-full flex-col rounded-t-3xl border border-[var(--of-border)] bg-[var(--of-surface)] shadow-[0_-8px_40px_rgba(15,23,42,0.18)] md:max-w-lg md:rounded-3xl"
      >
        <header className="flex items-start gap-3 border-b border-[var(--of-border)] px-5 pb-3.5 pt-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-[var(--of-text)]">{title}</h2>
            {description && <p className="mt-1 text-[0.8125rem] leading-snug text-[var(--of-text-muted)]">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="outlook-form-tap -mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--of-text-muted)] hover:bg-[var(--of-surface-2)]"
            aria-label="Close"
          >
            <X className="h-4.5 w-4.5" strokeWidth={2} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <footer className="border-t border-[var(--of-border)] px-5 pt-3.5" style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom, 0px))" }}>
            {footer}
          </footer>
        )}
      </section>
    </div>
  )
}
