"use client"

/**
 * Quest Coral design primitives — same shape as
 * components/applications/ui/apps-primitives.tsx, reading from the
 * .quest-coral-scope tokens instead of .applications-scope.
 */

import type { ButtonHTMLAttributes, ReactNode } from "react"
import { Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"
import { TONE_STYLES } from "@/components/quest-coral/ui/tone"
import type { MissionFitScore, QuestCoralTone } from "@/lib/quest-coral-core"

// ── Button ──────────────────────────────────────────────────────────────

interface QcButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger"
  size?: "lg" | "md" | "sm"
  icon?: ReactNode
  fullWidth?: boolean
}

export function QcButton({
  variant = "primary",
  size = "lg",
  icon,
  fullWidth,
  className,
  children,
  ...props
}: QcButtonProps) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "quest-coral-tap inline-flex items-center justify-center gap-2 rounded-xl font-semibold disabled:cursor-not-allowed",
        size === "lg" && "min-h-[3.25rem] px-5 text-[0.95rem]",
        size === "md" && "min-h-[2.75rem] px-4 text-sm",
        size === "sm" && "min-h-[2.25rem] px-3 text-[0.8125rem]",
        fullWidth && "w-full",
        variant === "primary" && "quest-coral-primary-button text-white disabled:text-white/80",
        variant === "secondary" &&
          "border border-[var(--coral-border)] bg-[var(--coral-surface)] text-[var(--coral-strong)] hover:bg-[var(--coral-surface-2)] disabled:text-[var(--coral-text-muted)]",
        variant === "ghost" && "text-[var(--coral-text-muted)] hover:bg-[var(--coral-surface-2)]",
        variant === "danger" &&
          "border border-[#FBD0D0] bg-[var(--coral-missing-soft)] text-[#DC5A5A] hover:bg-[#FDDCDC]",
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
  tone: QuestCoralTone
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
  tone?: QuestCoralTone
  showLabel?: boolean
}) {
  const value = Math.max(0, Math.min(100, Math.round(percent)))
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <div
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--coral-surface-2)]"
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

/** Circular meter — used for both project progress and the coverage ring. */
export function ProgressRing({
  percent,
  size = 92,
  label = "complete",
  color = "var(--coral)",
  trackColor = "#FDEAE4",
}: {
  percent: number
  size?: number
  label?: string
  /** A project can express its phase through the ring without changing its data. */
  color?: string
  trackColor?: string
}) {
  const value = Math.max(0, Math.min(100, Math.round(percent)))
  const stroke = size < 64 ? 4 : size < 90 ? 5 : 6.5
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={trackColor} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference - (circumference * value) / 100}
          className="transition-[stroke-dashoffset] duration-700 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={cn("font-bold leading-none tabular-nums text-[var(--coral-text)]", size < 64 ? "text-xs" : "text-lg")}>
          {value}%
        </span>
        {label && <span className="mt-0.5 text-[0.625rem] font-medium text-[var(--coral-text-muted)]">{label}</span>}
      </div>
    </div>
  )
}

// ── Mission fit dots ────────────────────────────────────────────────────

export function MissionFitDots({ score, className }: { score: MissionFitScore; className?: string }) {
  return (
    <div className={cn("flex items-center gap-1", className)} aria-label={`Mission fit ${score} out of 5`}>
      {[1, 2, 3, 4, 5].map((step) => (
        <span
          key={step}
          className={cn("h-1.5 w-1.5 rounded-full", step <= score ? "bg-[var(--coral)]" : "bg-[var(--coral-surface-2)]")}
          aria-hidden="true"
        />
      ))}
    </div>
  )
}

// ── Card ────────────────────────────────────────────────────────────────

export function QcCard({
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
  return <Tag className={cn(flat ? "quest-coral-card-flat" : "quest-coral-card", "rounded-2xl", className)}>{children}</Tag>
}

// ── Section heading ─────────────────────────────────────────────────────

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h2
      className={cn(
        "text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-[var(--coral-text-muted)]",
        className,
      )}
    >
      {children}
    </h2>
  )
}

// ── AI card ─────────────────────────────────────────────────────────────

export function AiBriefCard({
  title = "AI Project Brief",
  body,
  headerAction,
  footer,
  className,
}: {
  title?: string
  /** Plain text, or a loading/error node in its place — same card either way. */
  body: ReactNode
  /** Optional control on the header row (e.g. a "Regenerate" button). */
  headerAction?: ReactNode
  footer?: ReactNode
  className?: string
}) {
  return (
    <div className={cn("rounded-2xl border border-[#FFD9CD] bg-[var(--coral-ai-soft)] p-4", className)}>
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[var(--coral)] text-white shadow-[0_6px_12px_rgba(255,122,89,0.22)]">
          <Sparkles className="h-4 w-4" strokeWidth={2.2} />
        </span>
        <h3 className="min-w-0 flex-1 text-[0.875rem] font-semibold text-[var(--coral-text)]">{title}</h3>
        {headerAction}
      </div>
      {typeof body === "string" ? (
        <p className="quest-coral-reading-copy mt-2.5 text-[0.8125rem]">{body}</p>
      ) : (
        <div className="quest-coral-reading-copy mt-2.5 text-[0.8125rem]">{body}</div>
      )}
      {footer && <div className="mt-3">{footer}</div>}
    </div>
  )
}

// ── Misc ────────────────────────────────────────────────────────────────

export function Avatar({ initials, className }: { initials: string; className?: string }) {
  return (
    <span
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--coral-soft)] text-xs font-bold text-[var(--coral-strong)]",
        className,
      )}
      aria-hidden="true"
    >
      {initials}
    </span>
  )
}
