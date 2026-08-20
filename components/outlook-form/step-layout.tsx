"use client"

/**
 * One wizard step = one scroll region, one primary (and optional secondary)
 * action pinned to the bottom. Mirrors
 * components/applications/candidate/step-layout.tsx exactly, using the
 * .outlook-form-scope tokens.
 */

import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import { OutlookFormButton } from "@/components/outlook-form/ui/outlook-form-primitives"

interface StepAction {
  label: string
  onClick: () => void
  disabled?: boolean
  icon?: ReactNode
}

interface OutlookFormStepLayoutProps {
  title?: string
  intro?: string
  children: ReactNode
  primary?: StepAction
  secondary?: StepAction
  note?: ReactNode
  className?: string
}

export function OutlookFormStepLayout({ title, intro, children, primary, secondary, note, className }: OutlookFormStepLayoutProps) {
  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-hide">
        <div className="outlook-form-step-enter mx-auto w-full max-w-xl px-5 pb-8 pt-5 md:px-6">
          {title && <h1 className="text-[1.75rem] font-bold leading-[1.2] tracking-[-0.02em] text-[var(--of-text)]">{title}</h1>}
          {intro && <p className="mt-2 text-[0.9375rem] leading-relaxed text-[var(--of-text-muted)]">{intro}</p>}
          <div className={title || intro ? "mt-6" : ""}>{children}</div>
        </div>
      </div>

      {(primary || secondary) && (
        <div
          className="shrink-0 border-t border-[var(--of-border)] bg-[var(--of-surface)] px-5 pt-3.5 md:px-6"
          style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom, 0px))" }}
        >
          <div className="mx-auto flex w-full max-w-xl flex-col gap-2.5">
            {primary && (
              <OutlookFormButton fullWidth onClick={primary.onClick} disabled={primary.disabled} icon={primary.icon}>
                {primary.label}
              </OutlookFormButton>
            )}
            {secondary && (
              <OutlookFormButton variant="secondary" fullWidth onClick={secondary.onClick} disabled={secondary.disabled} icon={secondary.icon}>
                {secondary.label}
              </OutlookFormButton>
            )}
            {note && <div className="pt-0.5 text-center text-xs text-[var(--of-text-muted)]">{note}</div>}
          </div>
        </div>
      )}
    </div>
  )
}
