"use client"

import { useId, type KeyboardEvent, type RefObject } from "react"
import { DirectorySearchBar } from "@/components/directory/directory-search-bar"
import {
  DirectorySearchSuggestions,
  directorySuggestionOptionId,
} from "@/components/directory/directory-search-suggestions"
import type { DirectoryListItem } from "@/lib/directory-config"

interface DirectorySearchExperienceProps {
  inputRef: RefObject<HTMLInputElement | null>
  value: string
  suggestions: DirectoryListItem[]
  activeSuggestionIndex: number
  isSuggestionsOpen: boolean
  variant: "home" | "results"
  isLoading?: boolean
  onChange: (value: string) => void
  onSubmit: () => void
  onClear: () => void
  onFocus: () => void
  onBlur: () => void
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void
  onSuggestionSelect: (item: DirectoryListItem) => void
}

export function DirectorySearchExperience({
  inputRef,
  value,
  suggestions,
  activeSuggestionIndex,
  isSuggestionsOpen,
  variant,
  isLoading = false,
  onChange,
  onSubmit,
  onClear,
  onFocus,
  onBlur,
  onKeyDown,
  onSuggestionSelect,
}: DirectorySearchExperienceProps) {
  const searchId = useId()
  const listboxId = `directory-suggestions-${searchId}`
  const activeItem = suggestions[activeSuggestionIndex]

  return (
    <div className="relative">
      <DirectorySearchBar
        ref={inputRef}
        value={value}
        onChange={onChange}
        onSubmit={onSubmit}
        onClear={onClear}
        onFocus={onFocus}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        suggestionsId={isSuggestionsOpen ? listboxId : undefined}
        suggestionsOpen={isSuggestionsOpen}
        activeSuggestionId={activeItem ? directorySuggestionOptionId(listboxId, activeItem.id) : undefined}
        variant={variant}
        isLoading={isLoading}
      />
      {isSuggestionsOpen && (
        <DirectorySearchSuggestions
          id={listboxId}
          items={suggestions}
          activeIndex={activeSuggestionIndex}
          onSelect={onSuggestionSelect}
        />
      )}
    </div>
  )
}
