"use client"

import { createPortal } from "react-dom"
import { Sparkles, X } from "lucide-react"
import { OutlookAiQuickUpdate } from "@/components/directory/outlooks/outlook-ai-quick-update"
import type { OutlookTask, OutlookWindow } from "@/lib/outlook-core"

/**
 * Bottom-sheet host for the AI Quick Update on the dedicated screen. The
 * embedded job panel renders `OutlookAiQuickUpdate` inline instead — both
 * surfaces share the same compose card + review modal flow, and AI still only
 * produces a draft the user confirms through the existing persist path.
 */
export function OutlookAiCaptureSheet({
  window,
  companies,
  existingTasks,
  jobName,
  location,
  saving,
  onClose,
  onConfirm,
  onManualFallback,
  onAdvanced,
}: {
  window: OutlookWindow
  companies: Array<{ id: string; name: string }>
  existingTasks: OutlookTask[]
  jobName?: string | null
  location?: string | null
  saving: boolean
  onClose: () => void
  onConfirm: (tasks: OutlookTask[]) => Promise<void>
  onManualFallback?: () => void
  onAdvanced?: () => void
}) {
  if (typeof document === "undefined") return null
  return createPortal(
    <div className="fixed inset-0 z-40 flex items-end bg-[#04070b]/72 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="ai-capture-title">
      <button type="button" className="absolute inset-0" onClick={onClose} aria-label="Close quick update" />
      <section className="directory-glass-screen relative z-[1] max-h-[92dvh] w-full overflow-y-auto rounded-t-[1.75rem] border-t border-white/[0.11] px-4 pb-[max(1rem,var(--sab))] pt-4 shadow-[0_-18px_48px_rgba(1,5,12,0.5)] animate-slide-up">
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/15" aria-hidden="true" />
        <div className="mx-auto w-full max-w-xl">
          <div className="mb-5 flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--directory-job-border)] bg-[var(--directory-job-soft)] text-[var(--directory-job)]">
              <Sparkles className="h-4 w-4" strokeWidth={1.8} />
            </div>
            <div className="min-w-0 flex-1">
              <h2 id="ai-capture-title" className="text-sm font-semibold text-foreground/90">Quick Update</h2>
              <p className="mt-0.5 text-[10px] text-muted-foreground/52">Write or speak what’s happening in the next 3 weeks.</p>
            </div>
            <button type="button" onClick={onClose} className="glass-button flex h-9 w-9 items-center justify-center rounded-full border active:scale-[0.96]" aria-label="Close quick update">
              <X className="h-4 w-4" strokeWidth={1.8} />
            </button>
          </div>

          <OutlookAiQuickUpdate
            window={window}
            companies={companies}
            existingTasks={existingTasks}
            jobName={jobName}
            location={location}
            saving={saving}
            onConfirm={onConfirm}
            onManualFallback={onManualFallback}
            onAdvanced={onAdvanced}
            onDone={onClose}
          />
        </div>
      </section>
    </div>,
    document.body,
  )
}
