"use client"

import { useEffect, useState } from "react"
import { AlertTriangle, Loader2, Trash2, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { type DirectoryProfileViewModel } from "@/lib/directory-view-models"
import {
  DirectoryCleanupClientError,
  requestDirectoryDelete,
  requestDirectoryDeleteImpact,
  type DirectoryDeleteImpact,
} from "@/lib/directory-cleanup-client"

interface DirectoryDeleteConfirmSheetProps {
  vm: DirectoryProfileViewModel
  onClose: () => void
  onDeleted: () => void
}

const TYPE_LABEL: Record<DirectoryProfileViewModel["type"], string> = {
  person: "contact",
  company: "company",
  job: "job",
  other: "record",
}

function impactLines(vm: DirectoryProfileViewModel, impact: DirectoryDeleteImpact): string[] {
  const lines: string[] = []
  if (vm.type === "person" && impact.contexts > 0) {
    lines.push(`Removed from ${impact.contexts} job/company "People involved" list${impact.contexts === 1 ? "" : "s"}`)
  }
  if (vm.type === "company" && impact.contacts > 0) {
    lines.push(`Company link cleared on ${impact.contacts} contact${impact.contacts === 1 ? "" : "s"} (their name/details are kept)`)
  }
  if (vm.type === "company" && impact.contexts > 0) {
    lines.push(`Company link cleared on ${impact.contexts} job${impact.contexts === 1 ? "" : "s"}`)
  }
  if (impact.notes > 0) lines.push(`Untagged from ${impact.notes} note${impact.notes === 1 ? "" : "s"}`)
  if (impact.files > 0) lines.push(`Untagged from ${impact.files} file${impact.files === 1 ? "" : "s"}`)
  if (impact.relations > 0) lines.push(`${impact.relations} relationship link${impact.relations === 1 ? "" : "s"} removed`)
  if (vm.type === "person" && impact.messages > 0) {
    lines.push(`Untagged from ${impact.messages}${impact.messagesCapped ? "+" : ""} message${impact.messages === 1 ? "" : "s"} (messages themselves are kept)`)
  }
  return lines
}

/**
 * Admin-only. Shows what deleting this record will touch (from the server's
 * dry-run impact preview) before requiring an explicit confirm. The delete
 * itself, and every reference cleanup listed here, happens server-side via
 * app/api/directory/delete (see lib/directory-server-writes.ts) — this sheet
 * never writes Firestore directly.
 */
export function DirectoryDeleteConfirmSheet({ vm, onClose, onDeleted }: DirectoryDeleteConfirmSheetProps) {
  const [impact, setImpact] = useState<DirectoryDeleteImpact | null>(null)
  const [isLoadingImpact, setIsLoadingImpact] = useState(true)
  const [isDeleting, setIsDeleting] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    let active = true
    setIsLoadingImpact(true)
    setError("")
    requestDirectoryDeleteImpact(vm.id)
      .then((result) => { if (active) setImpact(result) })
      .catch((err) => {
        if (!active) return
        setError(err instanceof DirectoryCleanupClientError ? err.message : "Could not check what this would affect. Try again.")
      })
      .finally(() => { if (active) setIsLoadingImpact(false) })
    return () => { active = false }
  }, [vm.id])

  const confirmDelete = async () => {
    if (isDeleting || isLoadingImpact) return
    setIsDeleting(true)
    setError("")
    try {
      await requestDirectoryDelete(vm.id)
      onDeleted()
    } catch (err) {
      setError(err instanceof DirectoryCleanupClientError ? err.message : "Could not delete this record. Try again.")
      setIsDeleting(false)
    }
  }

  const lines = impact ? impactLines(vm, impact) : []

  return (
    <div className="directory-glass-screen !fixed inset-0 z-40 flex min-h-0 w-full flex-col overflow-hidden animate-slide-in-right">
      <header className="glass-panel app-topbar flex shrink-0 items-center justify-between border-b px-4">
        <button
          type="button"
          onClick={onClose}
          disabled={isDeleting}
          className="glass-button flex h-9 w-9 items-center justify-center rounded-full border active:scale-[0.96] disabled:opacity-40"
          aria-label="Cancel"
        >
          <X className="h-4 w-4 text-white/80" strokeWidth={1.8} />
        </button>
        <h2 className="text-sm font-semibold text-foreground/90">Delete {TYPE_LABEL[vm.type]}</h2>
        <span className="h-9 w-9 shrink-0" aria-hidden="true" />
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden scrollbar-hide">
        <div className="mx-auto w-full max-w-2xl px-4 pb-24 pt-6 md:px-6">
          {error && (
            <p className="mb-4 rounded-xl border border-orange-400/20 bg-orange-400/[0.06] px-4 py-3 text-xs text-orange-200/85" role="alert">
              {error}
            </p>
          )}

          <div className="flex items-start gap-3 rounded-2xl border border-red-400/20 bg-red-400/[0.05] px-4 py-3.5">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-300/85" strokeWidth={1.8} />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-red-200/90">Delete {vm.name}?</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground/70">
                This permanently removes this {TYPE_LABEL[vm.type]} from Directory. This cannot be undone.
              </p>
            </div>
          </div>

          <div className="mt-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/50">What else this affects</p>
            {isLoadingImpact ? (
              <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground/60">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Checking related records…
              </div>
            ) : lines.length > 0 ? (
              <ul className="mt-3 space-y-1.5 text-xs leading-5 text-muted-foreground/75">
                {lines.map((line) => (
                  <li key={line} className="flex gap-2">
                    <span className="text-muted-foreground/40">·</span>
                    {line}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-xs leading-5 text-muted-foreground/55">Nothing else in Directory references this record.</p>
            )}
          </div>

          <button
            type="button"
            onClick={confirmDelete}
            disabled={isDeleting || isLoadingImpact}
            className={cn(
              "mt-6 flex w-full items-center justify-center gap-2 rounded-xl border border-red-400/25 bg-red-400/[0.1] px-4 py-3 text-sm font-semibold text-red-200/90 transition-colors active:scale-[0.99] disabled:opacity-40",
            )}
          >
            <Trash2 className="h-4 w-4" strokeWidth={1.8} />
            {isDeleting ? "Deleting…" : `Delete ${TYPE_LABEL[vm.type]}`}
          </button>
        </div>
      </main>
    </div>
  )
}
