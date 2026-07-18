"use client"

import { DirectoryResultRow } from "@/components/directory/directory-result-row"
import { DirectoryEmptyState, DirectoryRowsSkeleton } from "@/components/directory/directory-states"
import { useGeneratingReveal } from "@/hooks/use-generating-reveal"
import type { DirectoryListItem } from "@/lib/directory-config"

interface DirectoryRecentListProps {
  items: DirectoryListItem[]
  isLoading: boolean
  onSelect: (item: DirectoryListItem) => void
}

export function DirectoryRecentList({ items, isLoading, onSelect }: DirectoryRecentListProps) {
  // Show the generating shimmer for a deliberate minimum beat on entry, so it's
  // a visible micro-moment even when recents are already cached (loads instantly).
  const generating = useGeneratingReveal(undefined, isLoading, 650)
  return (
    <section aria-labelledby="directory-recent-heading">
      <h2 id="directory-recent-heading" className="mb-2 text-xs font-medium tracking-wide text-muted-foreground/70">
        Recent
      </h2>
      <div>
        {generating ? (
          <DirectoryRowsSkeleton count={3} ai />
        ) : items.length > 0 ? (
          <div className="flex flex-col">
            {items.map((item) => <DirectoryResultRow key={item.id} item={item} onSelect={onSelect} compact />)}
          </div>
        ) : (
          <DirectoryEmptyState kind="recent" />
        )}
      </div>
    </section>
  )
}
