"use client"

/**
 * Bottom sheet for Applications.
 *
 * Rendered inside the module container (not portaled to <body>) so it keeps
 * the .applications-scope tokens and stays inside the app's fixed shell.
 */

import { useEffect, type ReactNode } from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"

interface AppsSheetProps {
  open: boolean
  title: string
  description?: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  className?: string
}

export function AppsSheet({ open, title, description, onClose, children, footer, className }: AppsSheetProps) {
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
        aria-label={title}
        className={cn(
          "applications-step-enter relative flex max-h-[88%] w-full flex-col rounded-t-3xl border border-[var(--apps-border)] bg-[var(--apps-surface)] shadow-[0_-8px_40px_rgba(15,23,42,0.18)] md:max-w-lg md:rounded-3xl",
          className,
        )}
      >
        <header className="flex items-start gap-3 border-b border-[var(--apps-border)] px-5 pb-3.5 pt-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-[var(--apps-text)]">{title}</h2>
            {description && <p className="mt-1 text-[0.8125rem] leading-snug text-[var(--apps-text-muted)]">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="applications-tap -mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--apps-text-muted)] hover:bg-[var(--apps-surface-2)]"
            aria-label="Close"
          >
            <X className="h-4.5 w-4.5" strokeWidth={2} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer && (
          <footer
            className="border-t border-[var(--apps-border)] px-5 pt-3.5"
            style={{ paddingBottom: "max(1rem, var(--sab))" }}
          >
            {footer}
          </footer>
        )}
      </section>
    </div>
  )
}
