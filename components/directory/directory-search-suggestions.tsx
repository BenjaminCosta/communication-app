"use client"

import type { DirectoryListItem } from "@/lib/directory-config"
import { cn } from "@/lib/utils"

interface DirectorySearchSuggestionsProps {
  id: string
  items: DirectoryListItem[]
  activeIndex: number
  onSelect: (item: DirectoryListItem) => void
}

export function directorySuggestionOptionId(listboxId: string, directoryId: string): string {
  return `${listboxId}-option-${directoryId.replace(/[^a-zA-Z0-9_-]/g, "-")}`
}

/** A deliberately plain, title-only combobox list. */
export function DirectorySearchSuggestions({ id, items, activeIndex, onSelect }: DirectorySearchSuggestionsProps) {
  return (
    <div
      id={id}
      role="listbox"
      aria-label="Directory suggestions"
      className="absolute left-0 right-0 top-full z-20 mt-2 overflow-hidden rounded-2xl border border-white/10 bg-[#11161d] py-1"
    >
      {items.map((item, index) => (
        <button
          key={item.id}
          id={directorySuggestionOptionId(id, item.id)}
          type="button"
          role="option"
          aria-selected={activeIndex === index}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onSelect(item)}
          className={cn(
            "flex h-11 w-full items-center px-5 text-left text-sm text-foreground/88 transition-[background-color,color,transform] duration-150 active:scale-[0.995]",
            activeIndex === index ? "bg-white/[0.075] text-white" : "hover:bg-white/[0.045] hover:text-white",
          )}
        >
          <span className="truncate">{item.name}</span>
        </button>
      ))}
    </div>
  )
}
