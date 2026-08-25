"use client"

import { useEffect, useState } from "react"
import { AlertTriangle, GitMerge, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { CompanySelector, JobsSelector, PeopleSelector } from "@/components/directory/directory-edit-sheet"
import { loadDirectorySearch } from "@/lib/directory-search"
import {
  type CompanyProfileViewModel,
  type JobProfileViewModel,
  type PersonProfileViewModel,
} from "@/lib/directory-view-models"
import {
  DirectoryCleanupClientError,
  requestDirectoryMerge,
} from "@/lib/directory-cleanup-client"

type MergeableViewModel = PersonProfileViewModel | CompanyProfileViewModel | JobProfileViewModel

interface DuplicateCandidate {
  id: string
  name: string
}

interface DirectoryMergeSheetProps {
  vm: MergeableViewModel
  userId: string
  companies: Array<{ id: string; name: string }>
  people: Array<{ id: string; name: string }>
  onClose: () => void
  onMerged: (survivorDirectoryId: string) => void
}

const NOUN: Record<MergeableViewModel["type"], string> = {
  person: "contact",
  company: "company",
  job: "job",
}

/**
 * Admin-only. Picks a duplicate person/company/job and merges it into the
 * currently open profile (the survivor). The actual merge — union of fields,
 * re-pointing every reference (job/company membership or company links,
 * relations, notes/files, and for people, message tags), then deleting the
 * duplicate — happens server-side via app/api/directory/merge (see
 * lib/directory-server-writes.ts). Reuses the same picker component the
 * profile Edit sheet uses for each type, just capped to a single selection.
 */
export function DirectoryMergeSheet({ vm, userId, companies, people, onClose, onMerged }: DirectoryMergeSheetProps) {
  // Same self-loading pattern as DirectoryEditSheet: the profile can open
  // before the app-level Directory catalog is ready, so this refreshes from
  // the same cached-then-live index rather than relying on possibly-empty/
  // stale props (jobs in particular are never passed down as a prop at all).
  const [availableCompanies, setAvailableCompanies] = useState(companies)
  const [availablePeople, setAvailablePeople] = useState(people)
  const [availableJobs, setAvailableJobs] = useState<Array<{ id: string; name: string }>>([])
  const initialCandidatesReady = vm.type === "person" ? people.length > 0 : vm.type === "company" ? companies.length > 0 : false
  const [isIndexLoading, setIsIndexLoading] = useState(!initialCandidatesReady)

  useEffect(() => {
    let active = true
    setAvailableCompanies(companies)
    setAvailablePeople(people)
    const applyIndex = (index: Awaited<ReturnType<typeof loadDirectorySearch>>) => {
      if (!active) return
      setAvailableCompanies(index.byType.company.map((entry) => ({ id: entry.sourceId, name: entry.name })))
      setAvailablePeople(index.byType.person.map((entry) => ({ id: entry.sourceId, name: entry.name })))
      setAvailableJobs(index.byType.job.map((entry) => ({ id: entry.sourceId, name: entry.name })))
      setIsIndexLoading(false)
    }
    loadDirectorySearch(userId, { onCache: applyIndex })
      .then(applyIndex)
      .catch(() => { if (active) setIsIndexLoading(false) })
    return () => { active = false }
  }, [companies, people, userId])

  const [duplicate, setDuplicate] = useState<DuplicateCandidate | null>(null)
  const [isMerging, setIsMerging] = useState(false)
  const [error, setError] = useState("")

  const candidatePool = vm.type === "person" ? availablePeople : vm.type === "company" ? availableCompanies : availableJobs
  const candidates = candidatePool.filter((entry) => entry.id !== vm.sourceId)
  const noun = NOUN[vm.type]

  const merge = async () => {
    if (!duplicate || isMerging) return
    setIsMerging(true)
    setError("")
    try {
      const result = await requestDirectoryMerge(vm.type, vm.sourceId, duplicate.id)
      onMerged(result.survivorDirectoryId)
    } catch (err) {
      setError(err instanceof DirectoryCleanupClientError ? err.message : "Could not merge these records. Try again.")
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
        <h2 className="text-sm font-semibold text-foreground/90">Merge duplicate</h2>
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
            Find the duplicate {noun} to merge into <span className="font-semibold text-foreground/85">{vm.name}</span>.
            Their details are combined onto {vm.name}; the duplicate is deleted.
          </p>

          <div className="mt-5">
            {vm.type === "person" && (
              <PeopleSelector
                people={candidates}
                isLoading={isIndexLoading}
                selectedPeople={duplicate ? [duplicate] : []}
                onAdd={(entry) => setDuplicate(entry)}
                onRemove={() => setDuplicate(null)}
              />
            )}
            {vm.type === "company" && (
              <CompanySelector
                companies={candidates}
                isLoading={isIndexLoading}
                value={duplicate?.name ?? ""}
                selectedId={duplicate?.id ?? null}
                onChange={(name, id) => setDuplicate(id ? { id, name } : null)}
              />
            )}
            {vm.type === "job" && (
              <JobsSelector
                jobs={candidates}
                isLoading={isIndexLoading}
                selectedJobs={duplicate ? [duplicate] : []}
                onAdd={(entry) => setDuplicate(entry)}
                onRemove={() => setDuplicate(null)}
              />
            )}
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
                  Relationships, notes and files on {duplicate.name} move to {vm.name}. {duplicate.name} is then deleted. This
                  cannot be undone.
                </p>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
