import { tokenize } from "@/lib/directory-core"

/**
 * Generic token-overlap reranking, shared by every module's own bounded
 * in-memory keyword fallback (Quest Coral project names, Applications
 * candidate names) — the non-Directory-specific twin of
 * `rerankKeywordMatches` in `directory.ts`. Prefers candidates matching
 * every query token over noisy partial matches, falling back to the best
 * partial matches only when nothing matched fully.
 */
export interface ScoredMatch<T> {
  record: T
  score: number
}

export function rerankByTokenScore<T>(scored: ScoredMatch<T>[], tokenCount: number, limit: number): T[] {
  const maxScore = scored.reduce((max, entry) => Math.max(max, entry.score), 0)
  const threshold = maxScore >= tokenCount ? tokenCount : maxScore
  return scored
    .filter((entry) => entry.score >= threshold && entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.record)
}

/** How many of `tokens` appear among `name`'s own tokens. */
export function scoreNameAgainstTokens(name: string, tokens: string[]): number {
  const nameTokens = new Set(tokenize(name))
  return tokens.reduce((total, token) => total + (nameTokens.has(token) ? 1 : 0), 0)
}
