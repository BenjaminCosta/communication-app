"use client"

import type { KeyboardEvent, RefObject } from "react"
import { DirectoryRecentList } from "@/components/directory/directory-recent-list"
import { DirectoryResults } from "@/components/directory/directory-results"
import { DirectoryScopeTabs } from "@/components/directory/directory-scope-tabs"
import { DirectorySearchExperience } from "@/components/directory/directory-search-experience"
import { DIRECTORY_ENTITY_META, type DirectoryListItem, type DirectoryScope } from "@/lib/directory-config"

interface DirectoryHomeProps {
  query: string
  suggestions: DirectoryListItem[]
  activeSuggestionIndex: number
  isSuggestionsOpen: boolean
  scope: DirectoryScope
  recentItems: DirectoryListItem[]
  scopeItems: DirectoryListItem[]
  scopeTotal: number
  isIndexLoading: boolean
  isRecentsLoading: boolean
  inputRef: RefObject<HTMLInputElement | null>
  onQueryChange: (value: string) => void
  onSearchFocus: () => void
  onSearchBlur: () => void
  onSearchKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void
  onSuggestionSelect: (item: DirectoryListItem) => void
  onSubmit: () => void
  onClear: () => void
  onScopeChange: (scope: DirectoryScope) => void
  onSelect: (item: DirectoryListItem) => void
  onLoadMoreScope: () => void
}

export function DirectoryHome({
  query,
  suggestions,
  activeSuggestionIndex,
  isSuggestionsOpen,
  scope,
  recentItems,
  scopeItems,
  scopeTotal,
  isIndexLoading,
  isRecentsLoading,
  inputRef,
  onQueryChange,
  onSearchFocus,
  onSearchBlur,
  onSearchKeyDown,
  onSuggestionSelect,
  onSubmit,
  onClear,
  onScopeChange,
  onSelect,
  onLoadMoreScope,
}: DirectoryHomeProps) {
  return (
    <div className="directory-home-enter mx-auto flex w-full max-w-3xl flex-col px-4 pb-12 pt-[clamp(3.5rem,13vh,8.5rem)] md:px-6">
      <h1 className="max-w-[14ch] text-[clamp(2rem,7vw,3.65rem)] font-light leading-[1.15] tracking-[-0.045em] text-foreground/95">
        Find <span className="text-[var(--directory-person)]">people</span>,{" "}
        <span className="text-[var(--directory-company)]">companies</span> and{" "}
        <span className="text-[var(--directory-job)]">jobs</span>
      </h1>
      <div className="mt-9 md:mt-12">
        <DirectorySearchExperience
          inputRef={inputRef}
          value={query}
          suggestions={suggestions}
          activeSuggestionIndex={activeSuggestionIndex}
          isSuggestionsOpen={isSuggestionsOpen}
          onChange={onQueryChange}
          onSubmit={onSubmit}
          onClear={onClear}
          onFocus={onSearchFocus}
          onBlur={onSearchBlur}
          onKeyDown={onSearchKeyDown}
          onSuggestionSelect={onSuggestionSelect}
          variant="home"
          isLoading={isIndexLoading && !!query.trim()}
        />
      </div>
      <div className="mt-4 md:mt-5">
        <DirectoryScopeTabs value={scope} onChange={onScopeChange} includeAll={false} variant="home" />
      </div>
      <div className="mt-14 md:mt-16">
        {scope === "all" ? (
          <DirectoryRecentList items={recentItems} isLoading={isRecentsLoading || isIndexLoading} onSelect={onSelect} />
        ) : (
          <section aria-labelledby="directory-scope-browse-heading">
            <h2 id="directory-scope-browse-heading" className="mb-2 text-xs font-medium tracking-wide text-muted-foreground/70">
              {DIRECTORY_ENTITY_META[scope].plural}
            </h2>
            <DirectoryResults
              items={scopeItems}
              total={scopeTotal}
              isLoading={isIndexLoading}
              onSelect={onSelect}
              onLoadMore={onLoadMoreScope}
            />
          </section>
        )}
      </div>
    </div>
  )
}
