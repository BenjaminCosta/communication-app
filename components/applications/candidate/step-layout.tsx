"use client"

/**
 * One candidate step = one screen title, one scroll region, one primary
 * action pinned to the bottom. Every step uses this so the flow feels
 * identical from screen to screen.
 */

import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import { AppsButton } from "@/components/applications/ui/apps-primitives"

interface StepAction {
  label: string
  onClick: () => void
  disabled?: boolean
  icon?: ReactNode
}

interface StepLayoutProps {
  /** Optional: steps whose name already sits in the header omit it. */
  title?: string
  intro?: string
  children: ReactNode
  primary?: StepAction
  secondary?: StepAction
  /** Small line under the actions — autosave / timing reassurance. */
  note?: ReactNode
  className?: string
}

export function StepLayout({ title, intro, children, primary, secondary, note, className }: StepLayoutProps) {
  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-hide">
        <div className="applications-step-enter mx-auto w-full max-w-xl px-5 pb-8 pt-5 md:px-6">
          {title && (
            <h1 className="text-[1.75rem] font-bold leading-[1.2] tracking-[-0.02em] text-[var(--apps-text)]">{title}</h1>
          )}
          {intro && <p className="mt-2 text-[0.9375rem] leading-relaxed text-[var(--apps-text-muted)]">{intro}</p>}
          <div className={title || intro ? "mt-6" : ""}>{children}</div>
        </div>
      </div>

      {(primary || secondary) && (
        <div
          className="shrink-0 border-t border-[var(--apps-border)] bg-[var(--apps-surface)] px-5 pt-3.5 md:px-6"
          style={{ paddingBottom: "max(1rem, var(--sab))" }}
        >
          <div className="mx-auto flex w-full max-w-xl flex-col gap-2.5">
            {primary && (
              <AppsButton fullWidth onClick={primary.onClick} disabled={primary.disabled} icon={primary.icon}>
                {primary.label}
              </AppsButton>
            )}
            {secondary && (
              <AppsButton variant="secondary" fullWidth onClick={secondary.onClick} disabled={secondary.disabled} icon={secondary.icon}>
                {secondary.label}
              </AppsButton>
            )}
            {note && <div className="pt-0.5 text-center text-xs text-[var(--apps-text-muted)]">{note}</div>}
          </div>
        </div>
      )}
    </div>
  )
}
