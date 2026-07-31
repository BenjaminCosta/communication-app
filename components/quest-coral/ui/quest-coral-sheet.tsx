"use client"

/**
 * Bottom sheet for Quest Coral. Rendered inside the module container (not
 * portaled to <body>) so it keeps the .quest-coral-scope tokens — same
 * reasoning as components/applications/ui/apps-sheet.tsx.
 */

import { useEffect, type ReactNode } from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"

interface QcSheetProps {
  open: boolean
  title: string
  description?: string
  eyebrow?: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  className?: string
}

export function QcSheet({ open, title, description, eyebrow, onClose, children, footer, className }: QcSheetProps) {
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
      <button
        type="button"
        className="absolute inset-0 cursor-default bg-[#0F172A]/35 animate-fade-in"
        onClick={onClose}
        aria-label={`Close ${title}`}
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "quest-coral-step-enter relative flex max-h-[90%] w-full flex-col rounded-t-[1.75rem] border border-[var(--coral-border)] bg-[var(--coral-surface)] shadow-[0_-12px_42px_rgba(15,23,42,0.16)] md:max-w-lg md:rounded-[1.75rem]",
          className,
        )}
      >
        <span className="absolute left-1/2 top-2.5 h-1 w-10 -translate-x-1/2 rounded-full bg-[#D8DCE5]" aria-hidden="true" />
        <header className="flex items-start gap-3 border-b border-[var(--coral-border)] px-5 pb-3.5 pt-6">
          <div className="min-w-0 flex-1">
            {eyebrow && <p className="mb-1 text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-[var(--coral-strong)]">{eyebrow}</p>}
            <h2 className="text-base font-semibold text-[var(--coral-text)]">{title}</h2>
            {description && <p className="mt-1 text-[0.8125rem] leading-snug text-[var(--coral-text-muted)]">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="quest-coral-tap -mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--coral-text-muted)] hover:bg-[var(--coral-surface-2)]"
            aria-label="Close"
          >
            <X className="h-4.5 w-4.5" strokeWidth={2} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer && (
          <footer
            className="border-t border-[var(--coral-border)] px-5 pt-3.5"
            style={{ paddingBottom: "max(1rem, var(--sab))" }}
          >
            {footer}
          </footer>
        )}
      </section>
    </div>
  )
}
