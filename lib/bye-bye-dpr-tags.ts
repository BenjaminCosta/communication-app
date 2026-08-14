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

import type { Firestore } from "firebase-admin/firestore"
import { projectTagId } from "@/lib/store"

const PROJECTS_COLLECTION = "projects"
const DAILY_REPORT_TAG_NAME = "Daily Report"

/** One shared operational tag for both Clock In and Clock Out events. */
export const BYE_BYE_DPR_TIME_TRACKING_PROJECT_ID = "byebye-dpr-time-tracking"

export interface ByeByeDprTagSeed {
  id: string
  name: string
  color: string
}

/** Seeded once by scripts/seed-bye-bye-dpr-tags.mjs. Daily Report is an existing Comms tag and is never recreated here. */
export const BYE_BYE_DPR_TAG_SEEDS: ByeByeDprTagSeed[] = [
  { id: BYE_BYE_DPR_TIME_TRACKING_PROJECT_ID, name: "Time Tracking", color: "bg-progress" },
]

export type ByeByeDprEventTag = "clock-in" | "clock-out" | "daily-report"

export interface ByeByeDprMessageTagAssociation {
  projectId: string
  projectIds: string[]
  tagIds: string[]
}

async function existingDailyReportProjectId(db: Firestore): Promise<string> {
  const snapshot = await db.collection(PROJECTS_COLLECTION).where("name", "==", DAILY_REPORT_TAG_NAME).limit(2).get()
  if (snapshot.size !== 1) {
    throw new Error(`Expected exactly one existing ${DAILY_REPORT_TAG_NAME} tag.`)
  }
  return snapshot.docs[0].id
}

/**
 * Resolves the single Comms tag that classifies an automatic ByeByeDPR action.
 * Clock events share Time Tracking; reports reuse the existing Daily Report
 * tag rather than creating a module-specific duplicate.
 */
export async function resolveByeByeDprMessageTagAssociation(
  db: Firestore,
  event: ByeByeDprEventTag,
): Promise<ByeByeDprMessageTagAssociation> {
  const projectId = event === "daily-report"
    ? await existingDailyReportProjectId(db)
    : BYE_BYE_DPR_TIME_TRACKING_PROJECT_ID
  return {
    projectId,
    projectIds: [projectId],
    tagIds: [projectTagId(projectId)],
  }
}
