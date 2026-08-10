/**
 * ByeByeDPR — fixed tag/project ids.
 *
 * Tags in this app ARE `Project` docs (see `projectToTag()` in lib/store.ts)
 * — there is no separate pluggable tag-category registration mechanism.
 * Rather than get-or-create these at request time (a race condition under
 * concurrent first use), ByeByeDPR seeds a small, fixed set of Project docs
 * once via `scripts/seed-bye-bye-dpr-tags.mjs` and every server call
 * references their ids directly, with no runtime lookup.
 */

import { projectTagId } from "@/lib/store"

export const BYE_BYE_DPR_MODULE_PROJECT_ID = "byebye-dpr-module"
export const BYE_BYE_DPR_CLOCK_IN_PROJECT_ID = "byebye-dpr-clock-in"
export const BYE_BYE_DPR_CLOCK_OUT_PROJECT_ID = "byebye-dpr-clock-out"
export const BYE_BYE_DPR_DAILY_REPORT_PROJECT_ID = "byebye-dpr-daily-report"

export interface ByeByeDprTagSeed {
  id: string
  name: string
  color: string
}

/** Seeded once by scripts/seed-bye-bye-dpr-tags.mjs — the full fixed set. */
export const BYE_BYE_DPR_TAG_SEEDS: ByeByeDprTagSeed[] = [
  { id: BYE_BYE_DPR_MODULE_PROJECT_ID, name: "ByeByeDPR", color: "bg-indigo-600" },
  { id: BYE_BYE_DPR_CLOCK_IN_PROJECT_ID, name: "Clock In", color: "bg-progress" },
  { id: BYE_BYE_DPR_CLOCK_OUT_PROJECT_ID, name: "Clock Out", color: "bg-feedback" },
  { id: BYE_BYE_DPR_DAILY_REPORT_PROJECT_ID, name: "Daily Report", color: "bg-decision" },
]

export type ByeByeDprEventTag = "clock-in" | "clock-out" | "daily-report"

const EVENT_PROJECT_ID_BY_TAG: Record<ByeByeDprEventTag, string> = {
  "clock-in": BYE_BYE_DPR_CLOCK_IN_PROJECT_ID,
  "clock-out": BYE_BYE_DPR_CLOCK_OUT_PROJECT_ID,
  "daily-report": BYE_BYE_DPR_DAILY_REPORT_PROJECT_ID,
}

/** The two project-tag ids to stamp on an automatic Comms message: the module tag + the specific event tag. */
export function byeByeDprMessageTagIds(event: ByeByeDprEventTag): string[] {
  return [projectTagId(BYE_BYE_DPR_MODULE_PROJECT_ID), projectTagId(EVENT_PROJECT_ID_BY_TAG[event])]
}
