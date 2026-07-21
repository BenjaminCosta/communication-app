"use client"

import { useMemo, useState } from "react"
import { ChevronDown, Plus, Search, X } from "lucide-react"
import { DirectoryEntityIcon } from "@/components/directory/directory-entity-icon"
import { DIRECTORY_ENTITY_META, type DirectoryListItem } from "@/lib/directory-config"
import { searchDirectory, type DirectorySearchIndex } from "@/lib/directory-search"

export function DirectoryAskContextChips({
  index,
  pinnedEntity,
  onChange,
}: {
  index: DirectorySearchIndex | null
  pinnedEntity: DirectoryListItem | null
  onChange: (entity: DirectoryListItem | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const hasTypedQuery = query.trim().length >= 2
  const results = useMemo(() => {
    if (!index || !hasTypedQuery) return []
    return searchDirectory(index, query).slice(0, 6)
  }, [hasTypedQuery, index, query])

  const close = () => {
    setOpen(false)
    setQuery("")
  }

  return (
    <section className="mt-4" aria-label="Question context">
      <p className="mb-2 text-xs font-medium text-muted-foreground/60">Focus on <span className="text-muted-foreground/40">(optional)</span></p>
      <div className="flex flex-wrap items-center gap-2">
        {pinnedEntity && (
          <span className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] py-1 pl-2.5 pr-1.5 text-xs text-foreground/85">
            <span className="text-muted-foreground/60">{DIRECTORY_ENTITY_META[pinnedEntity.type].singular}:</span>
            {pinnedEntity.name}
            <button
              type="button"
              onClick={() => onChange(null)}
              className="flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground/60 transition-colors hover:bg-white/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--directory-ai)]/70"
              aria-label="Remove context"
            >
              <X className="h-3 w-3" strokeWidth={2} />
            </button>
          </span>
        )}
        {!open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex items-center gap-1.5 rounded-full border border-dashed border-white/15 px-3 py-1.5 text-xs text-muted-foreground/70 transition-colors hover:border-white/30 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--directory-ai)]/70"
          >
            <Plus className="h-3 w-3" strokeWidth={2} />
            {pinnedEntity ? "Change context" : "Add context"}
            <ChevronDown className="h-3 w-3" strokeWidth={2} />
          </button>
        )}
      </div>

      {open && (
        <div className="mt-2 rounded-2xl border border-white/[0.08] bg-[rgba(14,20,28,0.9)] p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
          <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground/60" strokeWidth={1.8} />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Escape") close() }}
              placeholder="Pin a person, company or job…"
              className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/45"
            />
            <button
              type="button"
              onClick={close}
              className="rounded-md px-1 text-xs text-muted-foreground/60 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--directory-ai)]/70"
            >
              Done
            </button>
          </div>
          {results.length > 0 && (
            <div className="mt-1 flex flex-col">
              {results.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => { onChange(item); close() }}
                  className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--directory-ai)]/70"
                >
                  <DirectoryEntityIcon item={item} size="xs" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-foreground/90">{item.name}</span>
                    {(item.companyName || item.location) && <span className="block truncate text-[11px] text-muted-foreground/55">{item.companyName || item.location}</span>}
                  </span>
                </button>
              ))}
            </div>
          )}
          {!hasTypedQuery && <p className="px-2 py-2.5 text-xs text-muted-foreground/55">Type at least two characters to search the Directory.</p>}
          {hasTypedQuery && results.length === 0 && <p className="px-2 py-2.5 text-xs text-muted-foreground/55">No matching people, companies or jobs.</p>}
        </div>
      )}
    </section>
  )
}
