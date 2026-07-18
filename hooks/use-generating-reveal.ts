"use client"

import { useEffect, useState } from "react"

/**
 * Keeps an AI "generating" placeholder visible for a deliberate minimum window,
 * so the shimmer reads as an intentional micro-moment instead of an
 * imperceptible flicker when the underlying data resolves instantly (warm cache)
 * or was already loaded (e.g. recents on a re-mounted screen).
 *
 * Returns `true` while the content should still show its generating state:
 * that is, while the real data is still `pending` OR the minimum window since
 * the last `resetKey` change has not elapsed — whichever is longer.
 *
 * @param resetKey  restarts the window when it changes (e.g. the entity id, or a
 *                  constant to fire once per mount)
 * @param pending   true while the real data is still loading
 * @param minMs     minimum visible duration of the generating state
 */
export function useGeneratingReveal(resetKey: unknown, pending: boolean, minMs = 700): boolean {
  const [minElapsed, setMinElapsed] = useState(false)
  useEffect(() => {
    setMinElapsed(false)
    const timer = setTimeout(() => setMinElapsed(true), minMs)
    return () => clearTimeout(timer)
  }, [resetKey, minMs])
  return pending || !minElapsed
}
