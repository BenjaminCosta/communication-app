import type { ClockRecord, Job } from "@/lib/bye-bye-dpr-store"

/**
 * In-memory, module-scoped cache of the last successful ByeByeDPR boot
 * fetch (jobs/recentJobs/activeClock).
 *
 * ByeByeDPR is a standalone route (`/byebye-dpr`), unlike the other four
 * modules, which are conditional screens inside the single `app/page.tsx`
 * instance and never remount when the user switches between them. Every
 * navigation into ByeByeDPR fully unmounts/remounts `ByeByeDprApp`, so
 * without this cache it would re-run the full blocking loading screen on
 * every module switch, not just on a genuine cold app open — this plain JS
 * module variable survives across those mounts (it only resets on an actual
 * page reload, which is exactly when a loading screen is expected again),
 * so a same-session return can render immediately and refresh in the
 * background instead.
 */

export interface ByeByeDprBootSnapshot {
  jobs: Job[]
  recentJobs: Job[]
  activeClock: ClockRecord | null
}

let cached: ByeByeDprBootSnapshot | null = null

export function getByeByeDprBootCache(): ByeByeDprBootSnapshot | null {
  return cached
}

export function setByeByeDprBootCache(snapshot: ByeByeDprBootSnapshot): void {
  cached = snapshot
}
