"use client"

/**
 * Applications design primitives.
 *
 * Small, presentational and shared by both experiences (candidate flow and
 * internal dashboard) so the two never drift. Everything reads its colors
 * from the .applications-scope tokens.
 */

import type { ButtonHTMLAttributes, ReactNode } from "react"
import { Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"
import { TONE_STYLES } from "@/components/applications/ui/tone"
import type { ApplicationTone } from "@/lib/applications-core"

// ── Button ──────────────────────────────────────────────────────────────

interface AppsButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger"
  size?: "lg" | "md" | "sm"
  icon?: ReactNode
  fullWidth?: boolean
}

export function AppsButton({
  variant = "primary",
  size = "lg",
  icon,
  fullWidth,
  className,
  children,
  ...props
}: AppsButtonProps) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "applications-tap inline-flex items-center justify-center gap-2 rounded-xl font-semibold disabled:cursor-not-allowed",
        size === "lg" && "min-h-[3.25rem] px-5 text-[0.95rem]",
        size === "md" && "min-h-[2.75rem] px-4 text-sm",
        size === "sm" && "min-h-[2.25rem] px-3 text-[0.8125rem]",
        fullWidth && "w-full",
        variant === "primary" && "applications-primary-button text-white disabled:text-white/80",
        variant === "secondary" &&
          "border border-[var(--apps-border)] bg-[var(--apps-surface)] text-[var(--apps-blue-strong)] hover:bg-[var(--apps-surface-2)] disabled:text-[var(--apps-text-muted)]",
        variant === "ghost" && "text-[var(--apps-text-muted)] hover:bg-[var(--apps-surface-2)]",
        variant === "danger" &&
          "border border-[#FBD0D0] bg-[var(--apps-missing-soft)] text-[#DC5A5A] hover:bg-[#FDDCDC]",
        className,
      )}
    >
      {icon}
      {children}
    </button>
  )
}

// ── Status pill ─────────────────────────────────────────────────────────

export function StatusPill({
  label,
  tone,
  className,
  dot = false,
}: {
  label: string
  tone: ApplicationTone
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

// ── Progress bar ────────────────────────────────────────────────────────

export function ProgressBar({
  percent,
  className,
  tone = "info",
  showLabel = false,
}: {
  percent: number
  className?: string
  tone?: ApplicationTone
  showLabel?: boolean
}) {
  const value = Math.max(0, Math.min(100, Math.round(percent)))
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <div
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--apps-surface-2)]"
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={cn("h-full rounded-full transition-[width] duration-500 ease-out", TONE_STYLES[tone].solid)}
          style={{ width: `${value}%` }}
        />
      </div>
      {showLabel && <span className="w-9 shrink-0 text-right text-xs font-semibold tabular-nums">{value}%</span>}
    </div>
  )
}

/** Circular meter used on the candidate home card. */
export function ProgressRing({ percent, size = 92 }: { percent: number; size?: number }) {
  const value = Math.max(0, Math.min(100, Math.round(percent)))
  const stroke = 8
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--apps-blue-soft)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--apps-blue)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference - (circumference * value) / 100}
          className="transition-[stroke-dashoffset] duration-700 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-lg font-bold leading-none tabular-nums text-[var(--apps-blue-strong)]">{value}%</span>
        <span className="mt-0.5 text-[0.625rem] font-medium text-[var(--apps-text-muted)]">complete</span>
      </div>
    </div>
  )
}

// ── Card ────────────────────────────────────────────────────────────────

export function AppsCard({
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
  return <Tag className={cn(flat ? "applications-card-flat" : "applications-card", "rounded-2xl", className)}>{children}</Tag>
}

// ── Section heading ─────────────────────────────────────────────────────

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h2
      className={cn(
        "text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-[var(--apps-text-muted)]",
        className,
      )}
    >
      {children}
    </h2>
  )
}

// ── AI placeholder ──────────────────────────────────────────────────────

/**
 * Purple is reserved for AI. This card is a placeholder until the video
 * transcription + summary pipeline exists.
 */
export function AiSummaryCard({
  title = "AI video summary",
  body,
  footer,
  className,
}: {
  title?: string
  body: string
  footer?: ReactNode
  className?: string
}) {
  return (
    <div className={cn("rounded-2xl border border-[#E0D6FB] bg-[var(--apps-ai-soft)] p-4", className)}>
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-[var(--apps-ai)]" strokeWidth={2} />
        <h3 className="text-[0.8125rem] font-semibold text-[#6D3EE0]">{title}</h3>
      </div>
      <p className="mt-2 text-[0.8125rem] leading-relaxed text-[#4C3A80]">{body}</p>
      {footer && <div className="mt-3">{footer}</div>}
    </div>
  )
}

// ── Misc ────────────────────────────────────────────────────────────────

export function Avatar({ initials, className }: { initials: string; className?: string }) {
  return (
    <span
      className={cn(
        "flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--apps-blue-soft)] text-sm font-bold text-[var(--apps-blue-strong)]",
        className,
      )}
      aria-hidden="true"
    >
      {initials}
    </span>
  )
}

/**
 * "You have something to deal with" — same idea as an app icon's badge count,
 * not a real push notification. Meant to sit absolutely positioned on a
 * corner (an avatar, an icon) via `className`.
 */
export function NoticeBadge({
  count = 1,
  tone = "missing",
  className,
}: {
  count?: number
  tone?: ApplicationTone
  className?: string
}) {
  return (
    <span
      className={cn(
        "flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full px-1 text-[0.625rem] font-bold leading-none text-white ring-2 ring-[var(--apps-surface)]",
        TONE_STYLES[tone].solid,
        className,
      )}
    >
      {count}
    </span>
  )
}
