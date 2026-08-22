"use client"

/**
 * Resolves an outlook form submission to a real Directory job — search an
 * existing one, or create a new context when nothing matches. Mirrors
 * components/bye-bye-dpr/change-job-screen.tsx's search-or-create shape
 * (the one existing precedent for this in the app), rebuilt for CRC's admin
 * surface since no admin-facing version of that flow exists yet.
 */

import { useEffect, useState } from "react"
import { Loader2, MapPin, Plus, Search } from "lucide-react"
import {
  CourtneyRobertsCenterClientError,
  createCourtneyRobertsCenterDirectoryJob,
  searchCourtneyRobertsCenterDirectoryJobs,
  type DirectoryJobSearchResult,
} from "@/lib/courtney-roberts-center/client"

interface OutlookFormJobResolverProps {
  initialQuery: string
  onResolved: (job: { directoryContextId: string; name: string }) => void
}

const SEARCH_DEBOUNCE_MS = 350

export function OutlookFormJobResolver({ initialQuery, onResolved }: OutlookFormJobResolverProps) {
  const [query, setQuery] = useState(initialQuery)
  const [results, setResults] = useState<DirectoryJobSearchResult[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  // "Create new job" is deliberately a second, separate tap from search — an
  // accidental duplicate Directory job is hard to undo, so it never sits right
  // next to real search results where a mis-tap could create one.
  const [confirmingCreate, setConfirmingCreate] = useState(false)

  useEffect(() => {
    setConfirmingCreate(false)
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
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-3.5">
      <p className="text-xs font-semibold text-amber-300 mb-1">This job isn't linked to Directory yet</p>
      <p className="text-xs text-muted-foreground/70 mb-3">Search for the real job, or create a new one, before generating the Outlook.</p>

      <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-full px-3.5 py-2.5 mb-2">
        <Search className="w-4 h-4 text-muted-foreground/60 shrink-0" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search Directory job name or location"
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
          autoFocus
        />
      </div>

      {error && <p className="text-xs text-red-400/90 mb-2">{error}</p>}

      {results && results.length > 0 && (
        <div className="flex flex-col gap-1.5 mb-2">
          {results.map((result) => (
            <button
              key={result.directoryContextId}
              onClick={() => onResolved({ directoryContextId: result.directoryContextId, name: result.name })}
              className="w-full flex items-center gap-2.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-left hover:bg-white/8 active:scale-[0.99] transition-all duration-150"
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
            </button>
          ))}
        </div>
      )}

      {results && results.length === 0 && query.trim().length >= 2 && (
        <p className="text-xs text-muted-foreground/60 mb-2">No matching Directory job found.</p>
      )}

      {query.trim().length >= 2 &&
        (confirmingCreate ? (
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
            className="w-full text-center text-[11px] font-medium text-muted-foreground/50 py-1.5 active:opacity-60"
          >
            Can&apos;t find it? Create &quot;{query.trim()}&quot; as a new job
          </button>
        ))}
    </div>
  )
}
