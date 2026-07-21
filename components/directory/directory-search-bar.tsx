"use client"

import { forwardRef, type KeyboardEvent } from "react"
import { Search, X } from "lucide-react"

interface DirectorySearchBarProps {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  onClear: () => void
  onFocus?: () => void
  onBlur?: () => void
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void
  suggestionsId?: string
  suggestionsOpen?: boolean
  activeSuggestionId?: string
  variant: "home" | "results"
  isLoading?: boolean
  askAiAvailable?: boolean
}

export const DirectorySearchBar = forwardRef<HTMLInputElement, DirectorySearchBarProps>(function DirectorySearchBar({
  value,
  onChange,
  onSubmit,
  onClear,
  onFocus,
  onBlur,
  onKeyDown,
  suggestionsId,
  suggestionsOpen = false,
  activeSuggestionId,
  variant,
  isLoading = false,
  askAiAvailable = false,
}, ref) {
  const isHome = variant === "home"
  return (
    <form
      onSubmit={(event) => { event.preventDefault(); onSubmit() }}
      role="search"
      className={`directory-search-control group relative flex w-full items-center border bg-[rgba(18,24,33,0.74)] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_18px_50px_rgba(0,0,0,0.24)] backdrop-blur-xl transition-[border-color,background-color,transform] duration-300 focus-within:border-[var(--directory-focus)]/70 focus-within:bg-[rgba(18,24,33,0.9)] ${isHome ? "h-16 rounded-[2rem] px-5 md:h-[4.5rem] md:px-6" : "h-12 rounded-2xl px-4"}`}
    >
      <button
        type="submit"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white/65 transition-colors hover:text-white active:scale-[0.96]"
        aria-label="Search Directory"
      >
        <Search className={isHome ? "h-5 w-5 md:h-6 md:w-6" : "h-4 w-4"} strokeWidth={1.8} />
      </button>
      <input
        ref={ref}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        placeholder="Search people, companies or jobs..."
        autoComplete="off"
        className={`min-w-0 flex-1 bg-transparent px-2 text-foreground outline-none placeholder:text-muted-foreground/50 ${isHome ? "text-base md:text-lg" : "text-sm"} ${askAiAvailable ? "pr-24" : ""}`}
        aria-label="Search people, companies or jobs"
        role="combobox"
        aria-autocomplete="list"
        aria-controls={suggestionsId}
        aria-expanded={suggestionsOpen}
        aria-activedescendant={activeSuggestionId}
      />
      {isLoading && (
        <span className="h-4 w-4 shrink-0 animate-spin rounded-full border border-white/20 border-t-[var(--directory-title)]" aria-label="Loading Directory" />
      )}
      {value && !isLoading && (
        <button
          type="button"
          onClick={onClear}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white/45 transition-colors hover:bg-white/5 hover:text-white/80 active:scale-[0.96]"
          aria-label="Clear search"
        >
          <X className="h-4 w-4" strokeWidth={1.8} />
        </button>
      )}
    </form>
  )
})
