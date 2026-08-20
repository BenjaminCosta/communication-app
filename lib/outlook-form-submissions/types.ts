import type { OutlookTask, OutlookWindow } from "@/lib/outlook-core"

/**
 * Structured intake from the public "3-Week Outlook" form — supers submit via
 * a shared link, no WhatsApp or app login required. Reviewed from Courtney
 * Roberts Center (see lib/courtney-roberts-center/). `tasks` is real
 * `OutlookTask[]` (lib/outlook-core.ts), built with the same `createOutlookTask()`
 * factory the authenticated editor uses, so a future write-enabled phase can
 * feed a submission straight into `scheduleOutlookTasks()` with no transform.
 */

export const OUTLOOK_FORM_SUBMISSION_SCHEMA_VERSION = 1
export const MAX_OUTLOOK_FORM_TASKS = 30

export type OutlookFormSubmissionStatus = "new" | "reviewed"
export type OutlookFormSubmitterRole = "site_super" | "pm" | "other"

export interface OutlookFormSubmission {
  id: string
  schemaVersion: number
  status: OutlookFormSubmissionStatus

  submittedByName: string
  /** Optional — the super may not always have it handy on a mobile form. Empty string, never null, when absent. */
  submittedByPhone: string
  submittedByCompany: string
  submittedByRole: OutlookFormSubmitterRole
  jobName: string
  /** jobs/{id} the super picked, or null for "Other / not listed". */
  byeByeDprJobId: string | null
  /** contexts/{id}, resolved SERVER-SIDE from jobs/{byeByeDprJobId}.directoryContextId — never trusted from the client. */
  jobContextId: string | null

  window: OutlookWindow
  tasks: OutlookTask[]
  generalNotes: string

  submittedAtMs: number

  reviewedAtMs: number | null
  reviewedByUid: string | null
  reviewedByName: string | null
}
