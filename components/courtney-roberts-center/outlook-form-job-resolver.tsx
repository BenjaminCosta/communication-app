"use client"

/**
 * Resolves an outlook form submission to a real Directory job — search an
 * existing one, or create a new context when nothing matches. A dedicated
 * full-screen step (not an inline widget) so it reads as a deliberate,
 * unhurried choice — mirrors components/bye-bye-dpr/change-job-screen.tsx's
 * search-or-create shape (the one existing precedent for this in the app),
 * rebuilt for CRC's admin surface since no admin-facing version existed yet.
 */

import { useEffect, useState } from "react"
import { ArrowLeft, CircleHelp, Loader2, MapPin, Plus, Search, X } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  CourtneyRobertsCenterClientError,
  createCourtneyRobertsCenterDirectoryJob,
  searchCourtneyRobertsCenterDirectoryJobs,
  type DirectoryJobSearchResult,
} from "@/lib/courtney-roberts-center/client"

interface OutlookFormJobResolverProps {
  initialQuery: string
  onResolved: (job: { directoryContextId: string; name: string }) => void
  onCancel: () => void
}

const SEARCH_DEBOUNCE_MS = 350

export function OutlookFormJobResolver({ initialQuery, onResolved, onCancel }: OutlookFormJobResolverProps) {
  const [query, setQuery] = useState(initialQuery)
  const [results, setResults] = useState<DirectoryJobSearchResult[] | null>(null)
  const [selected, setSelected] = useState<DirectoryJobSearchResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  // "Create new job" is deliberately a second, separate action from search — an
  // accidental duplicate Directory job is hard to undo, so it never sits right
  // next to real search results where a mis-tap could create one.
  const [confirmingCreate, setConfirmingCreate] = useState(false)

  useEffect(() => {
    setConfirmingCreate(false)
    setSelected(null)
  }, [query])

  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < 2) {
      setResults(null)
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      searchCourtneyRobertsCenterDirectoryJobs(trimmed)
        .then((found) => {
          if (!cancelled) setResults(found)
        })
        .catch((err: unknown) => {
          if (cancelled) return
          setResults([])
          setError(err instanceof CourtneyRobertsCenterClientError ? err.message : "Unable to search Directory jobs.")
        })
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query])

  const handleCreate = () => {
    const name = query.trim()
    if (!name || creating) return
    setCreating(true)
    setError(null)
    createCourtneyRobertsCenterDirectoryJob(name)
      .then((created) => onResolved(created))
      .catch((err: unknown) => {
        setError(err instanceof CourtneyRobertsCenterClientError ? err.message : "Unable to create this job.")
      })
      .finally(() => setCreating(false))
  }

  return (
    <div className="absolute inset-0 z-10 animate-fade-in">
      <div className="w-full h-full flex flex-col courtney-roberts-center-glass-screen">
        <div className="shrink-0 border-b border-white/10">
          <div className="max-w-2xl mx-auto px-4 md:px-6 app-topbar flex items-center gap-3">
            <button
              onClick={onCancel}
              className="w-9 h-9 rounded-full bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center active:scale-95 hover:bg-emerald-500/15 transition-all duration-150 shrink-0"
            >
              <ArrowLeft className="w-4 h-4 text-emerald-300" />
            </button>
            <h1 className="text-sm font-bold tracking-tight">Choose Job</h1>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide">
          <div className="max-w-2xl mx-auto w-full px-4 md:px-6 py-4 flex flex-col gap-3">
            <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-full px-3.5 py-2.5">
              <Search className="w-4 h-4 text-muted-foreground/60 shrink-0" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search job..."
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
                autoFocus
              />
              {query && (
                <button onClick={() => setQuery("")} className="shrink-0 w-5 h-5 rounded-full bg-white/10 flex items-center justify-center active:opacity-60">
                  <X className="w-3 h-3 text-muted-foreground" />
                </button>
              )}
            </div>

            {error && <p className="text-xs text-red-400/90">{error}</p>}

            {results && results.length > 0 && (
              <div className="flex flex-col gap-2">
                {results.map((result) => {
                  const isSelected = selected?.directoryContextId === result.directoryContextId
                  return (
                    <button
                      key={result.directoryContextId}
                      onClick={() => setSelected(result)}
                      className={cn(
                        "w-full flex items-center gap-2.5 rounded-xl border px-3.5 py-3 text-left active:scale-[0.99] transition-all duration-150",
                        isSelected ? "border-emerald-500/50 bg-emerald-500/[0.08]" : "border-white/10 bg-white/[0.03] hover:bg-white/[0.05]",
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold truncate">{result.name}</p>
                        {result.location && (
                          <p className="text-xs text-muted-foreground/60 truncate flex items-center gap-1 mt-0.5">
                            <MapPin className="w-3 h-3 shrink-0" />
                            {result.location}
                          </p>
                        )}
                      </div>
                      <span
                        className={cn(
                          "w-5 h-5 rounded-full border-2 shrink-0 flex items-center justify-center",
                          isSelected ? "border-emerald-400" : "border-white/20",
                        )}
                      >
                        {isSelected && <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}

            {results && results.length === 0 && query.trim().length >= 2 && (
              <p className="text-xs text-muted-foreground/60">No matching Directory job found.</p>
            )}

            {query.trim().length >= 2 && (
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3.5 flex flex-col gap-2.5">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                    <CircleHelp className="w-4 h-4 text-muted-foreground/60" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">Can&apos;t find the job?</p>
                    <p className="text-xs text-muted-foreground/60">Create a new job in the Directory.</p>
                  </div>
                </div>

                {confirmingCreate ? (
                  <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2.5">
                    <p className="text-xs text-emerald-200/90 mb-2">Create &quot;{query.trim()}&quot; as a new Directory job?</p>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setConfirmingCreate(false)}
                        className="flex-1 text-xs font-semibold text-muted-foreground/70 border border-white/10 rounded-lg px-3 py-1.5 active:opacity-60"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleCreate}
                        disabled={creating}
                        className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-emerald-500 text-white px-3 py-1.5 text-xs font-semibold disabled:opacity-40 active:scale-[0.99] transition-all duration-150"
                      >
                        {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                        Create job
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmingCreate(true)}
                    className="w-full flex items-center justify-center gap-1.5 rounded-full border border-emerald-500/30 text-emerald-300 px-4 py-2.5 text-xs font-semibold active:scale-[0.99] transition-all duration-150"
                  >
                    <Plus className="w-3.5 h-3.5" /> Create new Directory job
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="shrink-0 border-t border-white/10 bg-[#060b09]/95 backdrop-blur-sm">
          <div className="max-w-2xl mx-auto w-full px-4 md:px-6 py-3 safe-area-pb">
            <button
              onClick={() => selected && onResolved({ directoryContextId: selected.directoryContextId, name: selected.name })}
              disabled={!selected}
              className="w-full flex items-center justify-center rounded-full bg-emerald-500 text-white px-4 py-3.5 text-sm font-semibold disabled:opacity-40 active:scale-[0.98] transition-all duration-150"
            >
              Use selected job
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
