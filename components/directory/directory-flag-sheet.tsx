"use client"

import { useState } from "react"
import { Flag, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { type DirectoryProfileViewModel } from "@/lib/directory-view-models"
import {
  clearDirectoryReviewFlag,
  DirectoryWriteError,
  flagDirectoryEntityForReview,
  type DirectoryReviewReason,
} from "@/lib/directory-writes"
import { FormField, textareaClassName } from "@/components/directory/directory-edit-sheet"

interface DirectoryFlagSheetProps {
  vm: DirectoryProfileViewModel
  userId: string
  onClose: () => void
  onSaved: () => void
}

const REASONS: DirectoryReviewReason[] = ["Duplicate", "Incorrect info", "Inactive", "Other"]

/**
 * Flag/un-flag a person, company or job for review. Available to every
 * signed-in user (unlike merge/delete) — a lightweight, non-destructive way
 * to surface duplicates or bad records for someone else to act on.
 */
export function DirectoryFlagSheet({ vm, userId, onClose, onSaved }: DirectoryFlagSheetProps) {
  const [reason, setReason] = useState<DirectoryReviewReason | null>(null)
  const [note, setNote] = useState("")
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState("")
  const [confirmingClear, setConfirmingClear] = useState(false)

  const flag = async () => {
    if (!reason || isSaving) return
    setIsSaving(true)
    setError("")
    try {
      await flagDirectoryEntityForReview(vm.sourceCollection, vm.sourceId, { reason, note, flaggedBy: userId })
      onSaved()
    } catch (err) {
      setError(err instanceof DirectoryWriteError ? err.message : "Could not flag this record. Try again.")
      setIsSaving(false)
    }
  }

  const clear = async () => {
    if (isSaving) return
    setIsSaving(true)
    setError("")
    try {
      await clearDirectoryReviewFlag(vm.sourceCollection, vm.sourceId)
      onSaved()
    } catch (err) {
      setError(err instanceof DirectoryWriteError ? err.message : "Could not clear the flag. Try again.")
      setIsSaving(false)
      setConfirmingClear(false)
    }
  }

  return (
    <div className="directory-glass-screen !fixed inset-0 z-40 flex min-h-0 w-full flex-col overflow-hidden animate-slide-in-right">
      <header className="glass-panel app-topbar flex shrink-0 items-center justify-between border-b px-4">
        <button
          type="button"
          onClick={onClose}
          disabled={isSaving}
          className="glass-button flex h-9 w-9 items-center justify-center rounded-full border active:scale-[0.96] disabled:opacity-40"
          aria-label="Cancel"
        >
          <X className="h-4 w-4 text-white/80" strokeWidth={1.8} />
        </button>
        <h2 className="text-sm font-semibold text-foreground/90">Flag for Review</h2>
        <button
          type="button"
          onClick={flag}
          disabled={isSaving || !reason}
          className={cn(
            "rounded-full px-4 py-1.5 text-xs font-semibold transition-colors active:scale-[0.97] disabled:opacity-40",
            "bg-[var(--directory-title)]/15 text-[var(--directory-title)]",
          )}
        >
          {isSaving ? "Saving…" : "Flag"}
        </button>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden scrollbar-hide">
        <div className="mx-auto w-full max-w-2xl px-4 pb-24 pt-6 md:px-6">
          {error && (
            <p className="mb-4 rounded-xl border border-orange-400/20 bg-orange-400/[0.06] px-4 py-3 text-xs text-orange-200/85" role="alert">
              {error}
            </p>
          )}

          {vm.needsReview && (
            <div className="mb-5 flex items-start gap-2.5 rounded-2xl border border-orange-400/20 bg-orange-400/[0.05] px-4 py-3">
              <Flag className="mt-0.5 h-4 w-4 shrink-0 text-[var(--directory-focus)]" strokeWidth={1.8} />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-orange-200/85">Already flagged for review</p>
                {vm.reviewReason && <p className="mt-0.5 text-xs leading-5 text-muted-foreground/70">{vm.reviewReason}</p>}
                {/* Two-step confirm — this used to be a single tap in the flagged-queue
                    list too, easy to hit by accident while scanning quickly. */}
                {confirmingClear ? (
                  <div className="mt-2 flex items-center gap-3">
                    <span className="text-xs text-muted-foreground/70">Clear this flag?</span>
                    <button
                      type="button"
                      onClick={clear}
                      disabled={isSaving}
                      className="text-xs font-semibold text-red-300/90 disabled:opacity-40"
                    >
                      {isSaving ? "Clearing…" : "Yes, clear"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingClear(false)}
                      disabled={isSaving}
                      className="text-xs font-medium text-muted-foreground/60 disabled:opacity-40"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmingClear(true)}
                    disabled={isSaving}
                    className="mt-2 text-xs font-semibold text-[var(--directory-title)] disabled:opacity-40"
                  >
                    Clear flag
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="space-y-5">
            <fieldset className="min-w-0">
              <legend className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/50">Reason</legend>
              <p className="mt-1.5 text-xs leading-5 text-muted-foreground/55">Why does this record need attention?</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {REASONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setReason(option)}
                    className={cn(
                      "rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors active:scale-[0.97]",
                      reason === option
                        ? "border-[var(--directory-title)]/25 bg-[var(--directory-title)]/[0.09] text-[var(--directory-title)]"
                        : "border-white/[0.1] bg-white/[0.03] text-foreground/70",
                    )}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </fieldset>

            <FormField label="Note (optional)">
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={3}
                placeholder="Add any context that will help whoever reviews this."
                className={textareaClassName}
              />
            </FormField>
          </div>
        </div>
      </main>
    </div>
  )
}
