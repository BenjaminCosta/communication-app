"use client"

import { useEffect, useState } from "react"
import { AlertTriangle, GitMerge, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { PeopleSelector } from "@/components/directory/directory-edit-sheet"
import { loadDirectorySearch } from "@/lib/directory-search"
import { type DirectoryInvolvedPerson } from "@/lib/directory-writes"
import { type PersonProfileViewModel } from "@/lib/directory-view-models"
import {
  DirectoryCleanupClientError,
  requestDirectoryMerge,
} from "@/lib/directory-cleanup-client"

interface DirectoryMergeSheetProps {
  vm: PersonProfileViewModel
  userId: string
  people: Array<{ id: string; name: string }>
  onClose: () => void
  onMerged: (survivorDirectoryId: string) => void
}

/**
 * Admin-only. Picks a duplicate contact and merges it into the currently
 * open profile (the survivor). The actual merge — union of contact fields,
 * re-pointing job/company membership, relations, notes/files and message
 * tags, then deleting the duplicate — happens server-side via
 * app/api/directory/merge (see lib/directory-server-writes.ts). People only
 * in V1; this sheet is only ever opened from a person's profile.
 */
export function DirectoryMergeSheet({ vm, userId, people, onClose, onMerged }: DirectoryMergeSheetProps) {
  // Same self-loading pattern as DirectoryEditSheet's PeopleSelector: the
  // profile can open before the app-level Directory catalog is ready, so
  // this refreshes from the same cached-then-live index rather than relying
  // on a possibly-empty/stale `people` prop.
  const [availablePeople, setAvailablePeople] = useState(people)
  const [isIndexLoading, setIsIndexLoading] = useState(people.length === 0)

  useEffect(() => {
    let active = true
    setAvailablePeople(people)
    setIsIndexLoading(people.length === 0)
    loadDirectorySearch(userId, {
      onCache: (index) => {
        if (!active) return
        setAvailablePeople(index.byType.person.map((entry) => ({ id: entry.sourceId, name: entry.name })))
        setIsIndexLoading(false)
      },
    })
      .then((index) => {
        if (!active) return
        setAvailablePeople(index.byType.person.map((entry) => ({ id: entry.sourceId, name: entry.name })))
        setIsIndexLoading(false)
      })
      .catch(() => { if (active) setIsIndexLoading(false) })
    return () => { active = false }
  }, [people, userId])

  const [duplicate, setDuplicate] = useState<DirectoryInvolvedPerson | null>(null)
  const [isMerging, setIsMerging] = useState(false)
  const [error, setError] = useState("")

  const candidates = availablePeople.filter((person) => person.id !== vm.sourceId)

  const merge = async () => {
    if (!duplicate || isMerging) return
    setIsMerging(true)
    setError("")
    try {
      const result = await requestDirectoryMerge(vm.sourceId, duplicate.id)
      onMerged(result.survivorDirectoryId)
    } catch (err) {
      setError(err instanceof DirectoryCleanupClientError ? err.message : "Could not merge these contacts. Try again.")
      setIsMerging(false)
    }
  }

  return (
    <div className="directory-glass-screen !fixed inset-0 z-40 flex min-h-0 w-full flex-col overflow-hidden animate-slide-in-right">
      <header className="glass-panel app-topbar flex shrink-0 items-center justify-between border-b px-4">
        <button
          type="button"
          onClick={onClose}
          disabled={isMerging}
          className="glass-button flex h-9 w-9 items-center justify-center rounded-full border active:scale-[0.96] disabled:opacity-40"
          aria-label="Cancel"
        >
          <X className="h-4 w-4 text-white/80" strokeWidth={1.8} />
        </button>
        <h2 className="text-sm font-semibold text-foreground/90">Merge Duplicate</h2>
        <button
          type="button"
          onClick={merge}
          disabled={isMerging || !duplicate}
          className={cn(
            "rounded-full px-4 py-1.5 text-xs font-semibold transition-colors active:scale-[0.97] disabled:opacity-40",
            "bg-[var(--directory-title)]/15 text-[var(--directory-title)]",
          )}
        >
          {isMerging ? "Merging…" : "Merge"}
        </button>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden scrollbar-hide">
        <div className="mx-auto w-full max-w-2xl px-4 pb-24 pt-6 md:px-6">
          {error && (
            <p className="mb-4 rounded-xl border border-orange-400/20 bg-orange-400/[0.06] px-4 py-3 text-xs text-orange-200/85" role="alert">
              {error}
            </p>
          )}

          <p className="text-xs leading-5 text-muted-foreground/65">
            Find the duplicate contact to merge into <span className="font-semibold text-foreground/85">{vm.name}</span>.
            Emails, phones, tags and links are combined onto {vm.name}; the duplicate is deleted.
          </p>

          <div className="mt-5">
            <PeopleSelector
              people={candidates}
              isLoading={isIndexLoading}
              selectedPeople={duplicate ? [duplicate] : []}
              onAdd={(person) => setDuplicate(person)}
              onRemove={() => setDuplicate(null)}
            />
          </div>

          {duplicate && (
            <div className="mt-5 flex items-start gap-3 rounded-2xl border border-red-400/20 bg-red-400/[0.05] px-4 py-3.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-300/85" strokeWidth={1.8} />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-red-200/90 flex items-center gap-1.5">
                  <GitMerge className="h-3.5 w-3.5" strokeWidth={1.8} />
                  {duplicate.name} will be merged into {vm.name}
                </p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground/70">
                  Jobs, companies, notes, files and message tags on {duplicate.name} move to {vm.name}. {duplicate.name} is then
                  deleted. This cannot be undone.
                </p>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
