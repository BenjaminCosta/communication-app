import { DirectoryResultRow } from "@/components/directory/directory-result-row"
import { DirectoryEmptyState, DirectoryRowsSkeleton } from "@/components/directory/directory-states"
import type { DirectoryListItem } from "@/lib/directory-config"

interface DirectoryResultsProps {
  items: DirectoryListItem[]
  total: number
  isLoading: boolean
  onSelect: (item: DirectoryListItem) => void
  onLoadMore: () => void
}

export function DirectoryResults({ items, total, isLoading, onSelect, onLoadMore }: DirectoryResultsProps) {
  if (isLoading) return <DirectoryRowsSkeleton count={7} />
  if (total === 0) return <DirectoryEmptyState kind="results" />
  return (
    <div>
      <p className="mb-2 px-2 text-xs text-muted-foreground/55">About {total.toLocaleString()} results</p>
      <div className="flex flex-col">
        {items.map((item) => <DirectoryResultRow key={item.id} item={item} onSelect={onSelect} />)}
      </div>
      {items.length < total && (
        <button
          type="button"
          onClick={onLoadMore}
          className="mt-3 w-full rounded-xl border border-white/10 bg-white/[0.025] py-2.5 text-xs text-muted-foreground transition-[background-color,color,transform] hover:bg-white/[0.05] hover:text-foreground active:scale-[0.99]"
        >
          Load 50 more · {total - items.length} remaining
        </button>
      )}
    </div>
  )
}
