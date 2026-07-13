"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react"
import { Star } from "lucide-react"
import { DirectoryFavoritesScreen } from "@/components/directory/directory-favorites-screen"
import { DirectoryHome } from "@/components/directory/directory-home"
import { DirectoryResults } from "@/components/directory/directory-results"
import { DirectoryScopeTabs } from "@/components/directory/directory-scope-tabs"
import { DirectorySearchExperience } from "@/components/directory/directory-search-experience"
import { DirectoryErrorState } from "@/components/directory/directory-states"
import { ModuleSwitcher } from "@/components/module-switcher"
import { cn } from "@/lib/utils"
import { useDirectoryUserState } from "@/components/directory/directory-state-provider"
import type { DirectoryListItem, DirectoryScope } from "@/lib/directory-config"
import {
  directoryItemsForIds,
  directoryListItemFromDoc,
  getDirectoryTitleSuggestions,
  loadDirectorySearch,
  paginateDirectoryItems,
  searchDirectory,
  type DirectorySearchIndex,
} from "@/lib/directory-search"

interface DirectoryScreenProps {
  userId: string
  initialIndex?: DirectorySearchIndex | null
  onOpenDetail: (directoryId: string) => void
  onSwitchToStream: () => void
  className?: string
}

const PAGE_SIZE = 50

export function DirectoryScreen({ userId, initialIndex = null, onOpenDetail, onSwitchToStream, className }: DirectoryScreenProps) {
  const [draftQuery, setDraftQuery] = useState("")
  const [submittedQuery, setSubmittedQuery] = useState("")
  const [scope, setScope] = useState<DirectoryScope>("all")
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [homeVisibleCount, setHomeVisibleCount] = useState(PAGE_SIZE)
  const [searchIndex, setSearchIndex] = useState<DirectorySearchIndex | null>(initialIndex)
  const [isIndexLoading, setIsIndexLoading] = useState(!initialIndex)
  const [loadError, setLoadError] = useState(false)
  const [retryKey, setRetryKey] = useState(0)
  const {
    favoriteIds,
    recentIds,
    favoritesLoading: isFavoritesLoading,
    recentsLoading: isRecentsLoading,
  } = useDirectoryUserState()
  const [showFavorites, setShowFavorites] = useState(false)
  const [isSearchFocused, setIsSearchFocused] = useState(false)
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1)
  const [debouncedDraftQuery, setDebouncedDraftQuery] = useState("")
  const [isRefreshing, setIsRefreshing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const searchIndexRef = useRef(searchIndex)

  useEffect(() => {
    searchIndexRef.current = searchIndex
  }, [searchIndex])

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedDraftQuery(draftQuery), 120)
    return () => window.clearTimeout(timer)
  }, [draftQuery])

  useEffect(() => {
    if (initialIndex && retryKey === 0) {
      setSearchIndex(initialIndex)
      setIsIndexLoading(false)
      setIsRefreshing(initialIndex.stale)
      setLoadError(false)
      return
    }
    let active = true
    setIsIndexLoading(!searchIndexRef.current)
    setIsRefreshing(false)
    setLoadError(false)
    loadDirectorySearch(userId, {
      onCache: (index) => {
        if (!active) return
        setSearchIndex(index)
        setIsIndexLoading(false)
        setIsRefreshing(true)
      },
    })
      .then((index) => {
        if (!active) return
        setSearchIndex(index)
        setIsRefreshing(false)
        setLoadError(false)
      })
      .catch(() => {
        if (!active) return
        setSearchIndex(null)
        setLoadError(true)
      })
      .finally(() => {
        if (active) { setIsIndexLoading(false); setIsRefreshing(false) }
      })
    return () => { active = false }
  }, [initialIndex, userId, retryKey])

  useEffect(() => { setVisibleCount(PAGE_SIZE) }, [submittedQuery, scope])
  useEffect(() => { setHomeVisibleCount(PAGE_SIZE) }, [scope])

  const allResults = useMemo(
    () => searchIndex ? searchDirectory(searchIndex, submittedQuery, scope) : [],
    [searchIndex, submittedQuery, scope],
  )
  const titleSuggestions = useMemo(
    () => getDirectoryTitleSuggestions(searchIndex, debouncedDraftQuery, scope),
    [searchIndex, debouncedDraftQuery, scope],
  )
  const isSuggestionsOpen =
    isSearchFocused &&
    !isIndexLoading &&
    draftQuery.trim().length >= 2 &&
    debouncedDraftQuery === draftQuery &&
    titleSuggestions.length > 0
  const visibleResults = paginateDirectoryItems(allResults, visibleCount)
  const recentItems = useMemo(() => directoryItemsForIds(searchIndex, recentIds), [searchIndex, recentIds])
  const favoriteItems = useMemo(() => directoryItemsForIds(searchIndex, favoriteIds), [searchIndex, favoriteIds])
  const hasUnresolvedFavorites =
    !isFavoritesLoading && !isIndexLoading && favoriteIds.length > 0 && favoriteItems.length === 0
  const hasSubmitted = submittedQuery.length > 0

  // Home browse-by-type: recents of that type first, then the rest A→Z.
  const scopeBrowseItems = useMemo(() => {
    if (!searchIndex || scope === "all") return []
    const recentOfScope = recentItems.filter((item) => item.type === scope)
    const recentIdSet = new Set(recentOfScope.map((item) => item.id))
    const restOfScope = searchIndex.byType[scope]
      .filter((document) => !recentIdSet.has(document.id))
      .map((document) => directoryListItemFromDoc(document))
    return [...recentOfScope, ...restOfScope]
  }, [searchIndex, scope, recentItems])
  const visibleScopeBrowseItems = paginateDirectoryItems(scopeBrowseItems, homeVisibleCount)

  const submitSearch = useCallback(() => {
    const next = draftQuery.trim()
    if (!next) return
    setSubmittedQuery(next)
    setIsSearchFocused(false)
    setActiveSuggestionIndex(-1)
  }, [draftQuery])

  const clearSearch = useCallback(() => {
    setDraftQuery("")
    setSubmittedQuery("")
    setActiveSuggestionIndex(-1)
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [])

  const selectScope = useCallback((nextScope: DirectoryScope, focusInput = false) => {
    setScope((current) => (current === nextScope ? "all" : nextScope))
    setIsSearchFocused(false)
    setActiveSuggestionIndex(-1)
    if (focusInput) requestAnimationFrame(() => inputRef.current?.focus())
  }, [])

  const selectHomeScope = useCallback((nextScope: DirectoryScope) => {
    selectScope(nextScope, true)
  }, [selectScope])

  const selectResultsScope = useCallback((nextScope: DirectoryScope) => {
    selectScope(nextScope)
  }, [selectScope])

  const changeDraftQuery = useCallback((value: string) => {
    setDraftQuery(value)
    setIsSearchFocused(true)
    setActiveSuggestionIndex(-1)
  }, [])

  const selectSuggestion = useCallback((item: DirectoryListItem) => {
    setDraftQuery(item.name)
    setSubmittedQuery(item.name)
    setIsSearchFocused(false)
    setActiveSuggestionIndex(-1)
  }, [])

  const handleSearchKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    if (!isSuggestionsOpen) return
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setActiveSuggestionIndex((current) => Math.min(current + 1, titleSuggestions.length - 1))
      return
    }
    if (event.key === "ArrowUp") {
      event.preventDefault()
      setActiveSuggestionIndex((current) => Math.max(current - 1, -1))
      return
    }
    if (event.key === "Escape") {
      event.preventDefault()
      setIsSearchFocused(false)
      setActiveSuggestionIndex(-1)
      return
    }
    if (event.key === "Enter" && activeSuggestionIndex >= 0) {
      event.preventDefault()
      const selected = titleSuggestions[activeSuggestionIndex]
      if (selected) selectSuggestion(selected)
    }
  }, [activeSuggestionIndex, isSuggestionsOpen, selectSuggestion, titleSuggestions])

  const openItem = useCallback((item: DirectoryListItem) => {
    setShowFavorites(false)
    onOpenDetail(item.id)
  }, [onOpenDetail])

  return (
    <div className={cn("directory-glass-screen flex min-h-0 flex-1 flex-col overflow-hidden", className)}>
      <header className="glass-panel app-topbar flex shrink-0 items-center justify-between border-b px-4 animate-slide-down">
        <ModuleSwitcher
          activeModule="directory"
          onSelect={(module) => { if (module === "communications") onSwitchToStream() }}
        />
        <button
          type="button"
          onClick={() => setShowFavorites(true)}
          className="glass-button flex h-9 w-9 items-center justify-center rounded-full border transition-transform duration-150 active:scale-[0.96]"
          aria-label="Open Directory favorites"
        >
          <Star className="h-4 w-4 text-white" strokeWidth={1.8} />
        </button>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto scrollbar-hide">
        {!hasSubmitted ? (
          <DirectoryHome
            query={draftQuery}
            suggestions={titleSuggestions}
            activeSuggestionIndex={activeSuggestionIndex}
            isSuggestionsOpen={isSuggestionsOpen}
            scope={scope}
            recentItems={recentItems}
            scopeItems={visibleScopeBrowseItems}
            scopeTotal={scopeBrowseItems.length}
            isIndexLoading={isIndexLoading}
            isRecentsLoading={isRecentsLoading}
            inputRef={inputRef}
            onQueryChange={changeDraftQuery}
            onSearchFocus={() => setIsSearchFocused(true)}
            onSearchBlur={() => { setIsSearchFocused(false); setActiveSuggestionIndex(-1) }}
            onSearchKeyDown={handleSearchKeyDown}
            onSuggestionSelect={selectSuggestion}
            onSubmit={submitSearch}
            onClear={clearSearch}
            onScopeChange={selectHomeScope}
            onSelect={openItem}
            onLoadMoreScope={() => setHomeVisibleCount((count) => count + PAGE_SIZE)}
          />
        ) : (
          <div className="directory-results-enter mx-auto w-full max-w-3xl px-4 pb-12 md:px-6">
            <div className="sticky top-0 z-10 -mx-4 border-b border-white/[0.06] bg-[rgba(7,11,17,0.88)] px-4 pb-3 pt-3 backdrop-blur-xl md:-mx-6 md:px-6">
              <DirectorySearchExperience
                inputRef={inputRef}
                value={draftQuery}
                suggestions={titleSuggestions}
                activeSuggestionIndex={activeSuggestionIndex}
                isSuggestionsOpen={isSuggestionsOpen}
                onChange={changeDraftQuery}
                onSubmit={submitSearch}
                onClear={clearSearch}
                onFocus={() => setIsSearchFocused(true)}
                onBlur={() => { setIsSearchFocused(false); setActiveSuggestionIndex(-1) }}
                onKeyDown={handleSearchKeyDown}
                onSuggestionSelect={selectSuggestion}
                variant="results"
                isLoading={isIndexLoading}
              />
              <div className="mt-3">
                <DirectoryScopeTabs value={scope} onChange={selectResultsScope} />
              </div>
            </div>
            <div className="pt-3">
              {loadError ? (
                <DirectoryErrorState onRetry={() => setRetryKey((key) => key + 1)} />
              ) : (
                <DirectoryResults
                  items={visibleResults}
                  total={allResults.length}
                  isLoading={isIndexLoading}
                  onSelect={openItem}
                  onLoadMore={() => setVisibleCount((count) => count + PAGE_SIZE)}
                />
              )}
            </div>
          </div>
        )}
        {!hasSubmitted && loadError && (
          <div className="mx-auto -mt-7 w-full max-w-3xl px-4 pb-8 md:px-6">
            <DirectoryErrorState compact onRetry={() => setRetryKey((key) => key + 1)} />
          </div>
        )}
      </main>

      {(searchIndex?.stale || isRefreshing) && (
        <div className="pointer-events-none absolute bottom-[calc(var(--sab)+0.75rem)] left-1/2 -translate-x-1/2 rounded-full border border-white/10 bg-[#101720]/90 px-3 py-1 text-[10px] text-muted-foreground backdrop-blur-md">
          {isRefreshing ? "Updating Directory" : "Showing saved Directory data"}
        </div>
      )}
      {showFavorites && (
        <div className="animate-slide-in-right absolute inset-0 z-20">
          <DirectoryFavoritesScreen
            items={favoriteItems}
            isLoading={isFavoritesLoading || isIndexLoading}
            hasUnresolvedFavorites={hasUnresolvedFavorites}
            onBack={() => setShowFavorites(false)}
            onSelect={openItem}
            onRetry={() => setRetryKey((key) => key + 1)}
          />
        </div>
      )}
    </div>
  )
}
