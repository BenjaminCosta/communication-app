"use client"

import { Sparkles } from "lucide-react"
import type { AskSuggestion } from "@/features/directory/ai/directory-retrieval"

/**
 * "Try asking" list. Suggestions are generated locally from recents / context —
 * never by calling OpenAI.
 */
export function DirectoryAskSuggestions({
  suggestions,
  onSelect,
}: {
  suggestions: AskSuggestion[]
  onSelect: (suggestion: AskSuggestion) => void
}) {
  if (suggestions.length === 0) return null
  return (
    <section aria-label="Suggested questions" className="mt-8">
      <h2 className="mb-3 text-xs font-medium tracking-wide text-muted-foreground/60">Try asking</h2>
      <div className="flex flex-col gap-2">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion.id}
            type="button"
            onClick={() => onSelect(suggestion)}
            className="directory-ask-suggestion group flex items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-[border-color,background-color,transform] duration-200 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--directory-ai)]/70"
          >
            <Sparkles className="h-4 w-4 shrink-0 text-[var(--directory-ai)]" strokeWidth={1.8} />
            <span className="text-sm text-foreground/90">{suggestion.text}</span>
          </button>
        ))}
      </div>
    </section>
  )
}
