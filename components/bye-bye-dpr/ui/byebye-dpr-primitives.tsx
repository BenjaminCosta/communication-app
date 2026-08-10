"use client"

/**
 * ByeByeDPR design primitives — same shape as
 * components/quest-coral/ui/quest-coral-primitives.tsx, reading from the
 * .byebye-dpr-scope tokens instead of .quest-coral-scope.
 */

import type { ButtonHTMLAttributes, ReactNode } from "react"
import { cn } from "@/lib/utils"
import { TONE_STYLES, type ByeByeDprTone } from "@/components/bye-bye-dpr/ui/tone"

// ── Button ──────────────────────────────────────────────────────────────

interface BdButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "clockout" | "secondary" | "ghost" | "danger"
  size?: "lg" | "md" | "sm"
  icon?: ReactNode
  fullWidth?: boolean
}

export function BdButton({
  variant = "primary",
  size = "lg",
  icon,
  fullWidth,
  className,
  children,
  ...props
}: BdButtonProps) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "byebye-dpr-tap inline-flex items-center justify-center gap-2 rounded-xl font-semibold disabled:cursor-not-allowed",
        size === "lg" && "min-h-[3.25rem] px-5 text-base",
        size === "md" && "min-h-[2.75rem] px-4 text-sm",
        size === "sm" && "min-h-[2.25rem] px-3 text-[0.8125rem]",
        fullWidth && "w-full",
        variant === "primary" && "byebye-dpr-primary-button text-white disabled:text-white/80",
        variant === "clockout" && "byebye-dpr-clockout-button text-white disabled:text-white/80",
        variant === "secondary" &&
          "border border-[var(--bd-border)] bg-[var(--bd-surface)] text-[var(--bd-purple-strong)] hover:bg-[var(--bd-surface-2)] disabled:text-[var(--bd-text-muted)]",
        variant === "ghost" && "text-[var(--bd-text-muted)] hover:bg-[var(--bd-surface-2)]",
        variant === "danger" &&
          "border border-[#FBD0D0] bg-[var(--bd-missing-soft)] text-[#DC5A5A] hover:bg-[#FDDCDC]",
        className,
      )}
    >
      {icon}
      {children}
    </button>
  )
}

// ── Card ────────────────────────────────────────────────────────────────

export function BdCard({
  children,
  className,
  flat = false,
  as = "div",
}: {
  children: ReactNode
  className?: string
  flat?: boolean
  as?: "div" | "section"
}) {
  const Tag = as
  return <Tag className={cn(flat ? "byebye-dpr-card-flat" : "byebye-dpr-card", "rounded-2xl", className)}>{children}</Tag>
}

// ── Status pill ─────────────────────────────────────────────────────────

export function StatusPill({
  label,
  tone,
  className,
  dot = false,
}: {
  label: string
  tone: ByeByeDprTone
  className?: string
  dot?: boolean
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.6875rem] font-semibold leading-none",
        TONE_STYLES[tone].pill,
        className,
      )}
    >
      {dot && <span className={cn("h-1.5 w-1.5 rounded-full", TONE_STYLES[tone].solid)} aria-hidden="true" />}
      {label}
    </span>
  )
}

// ── Section heading ─────────────────────────────────────────────────────

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h2 className={cn("text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-[var(--bd-text-muted)]", className)}>
      {children}
    </h2>
  )
}

// ── Empty state ─────────────────────────────────────────────────────────
// Same shape as QcCard's "No projects match" / Applications' "No
// applications match" empty states: icon circle + title + description +
// optional action, in a flat card. Kept as one shared primitive so every
// empty state in this module stays visually identical.

export function BdEmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon: ReactNode
  title: string
  description: string
  action?: ReactNode
  className?: string
}) {
  return (
    <BdCard flat className={cn("flex flex-col items-center px-6 py-10 text-center", className)}>
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--bd-surface-2)]" aria-hidden="true">
        {icon}
      </span>
      <p className="mt-3 text-sm font-semibold text-[var(--bd-text)]">{title}</p>
      <p className="mt-1 text-[0.8125rem] text-[var(--bd-text-muted)]">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </BdCard>
  )
}

// ── Row (nav item with chevron) ────────────────────────────────────────

export function BdRow({
  icon,
  iconTone = "ai",
  title,
  subtitle,
  onClick,
  trailing,
  className,
}: {
  icon: ReactNode
  iconTone?: ByeByeDprTone
  title: string
  subtitle?: string
  onClick?: () => void
  trailing?: ReactNode
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "byebye-dpr-tap flex w-full items-center gap-3 px-4 py-3.5 text-left",
        className,
      )}
    >
      <span
        className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", TONE_STYLES[iconTone].soft, TONE_STYLES[iconTone].text)}
        aria-hidden="true"
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[0.9375rem] font-semibold text-[var(--bd-text)]">{title}</span>
        {subtitle && <span className="mt-0.5 block truncate text-[0.75rem] text-[var(--bd-text-muted)]">{subtitle}</span>}
      </span>
      {trailing}
    </button>
  )
}

// ── Misc ────────────────────────────────────────────────────────────────

export function Avatar({ initials, className }: { initials: string; className?: string }) {
  return (
    <span
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--bd-purple-soft)] text-xs font-bold text-[var(--bd-purple-strong)]",
        className,
      )}
      aria-hidden="true"
    >
      {initials}
    </span>
  )
}
