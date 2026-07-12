"use client"

import { ArrowLeft } from "lucide-react"
import { DirectoryResultRow } from "@/components/directory/directory-result-row"
import { DirectoryEmptyState, DirectoryErrorState, DirectoryRowsSkeleton } from "@/components/directory/directory-states"
import { cn } from "@/lib/utils"
import type { DirectoryListItem } from "@/lib/directory-config"

interface DirectoryFavoritesScreenProps {
  items: DirectoryListItem[]
  isLoading: boolean
  hasUnresolvedFavorites: boolean
  onBack: () => void
  onSelect: (item: DirectoryListItem) => void
  onRetry: () => void
  className?: string
}

export function DirectoryFavoritesScreen({
  items,
  isLoading,
  hasUnresolvedFavorites,
  onBack,
  onSelect,
  onRetry,
  className,
}: DirectoryFavoritesScreenProps) {
  return (
    <div className={cn("directory-glass-screen flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden", className)}>
      <header className="glass-panel app-topbar flex shrink-0 items-center gap-3 border-b px-4 animate-slide-down">
        <button type="button" onClick={onBack} className="glass-button flex h-9 w-9 items-center justify-center rounded-full border active:scale-[0.96]" aria-label="Back to Directory">
          <ArrowLeft className="h-4 w-4 text-white/80" strokeWidth={1.8} />
        </button>
        <h1 className="text-base font-semibold tracking-tight text-foreground">Favorites</h1>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto scrollbar-hide">
        <div className="mx-auto w-full max-w-3xl px-4 pb-12 pt-4 md:px-6">
          {isLoading ? (
            <DirectoryRowsSkeleton count={7} />
          ) : items.length > 0 ? (
            <div className="flex flex-col">
              {items.map((item) => <DirectoryResultRow key={item.id} item={item} onSelect={onSelect} />)}
            </div>
          ) : hasUnresolvedFavorites ? (
            <DirectoryErrorState onRetry={onRetry} />
          ) : (
            <DirectoryEmptyState kind="favorites" />
          )}
        </div>
      </main>
    </div>
  )
}
