import { z } from "zod"
import type { Firestore } from "firebase-admin/firestore"
import { createServerDirectoryProvider } from "@/features/directory/ai/server/tools/provider"
import type { DirectoryDataProvider } from "@/features/directory/ai/server/tools/types"
import { getFirebaseAdminApp } from "@/lib/ai/server/firebase-admin"
import { todayIsoInAppZone } from "@/lib/datetime"
import { buildOutlookDeepLink } from "@/lib/whatsapp-secretary/guidance"
import type { SecretaryTool, SecretaryToolResult } from "@/lib/whatsapp-secretary/tool-registry"
import { describeUnresolved, type EntityResolver } from "@/lib/whatsapp-secretary/entity-resolver"
import { detailCard } from "@/lib/whatsapp-secretary/response-format"
import { listActiveJobsForFanOut, type FanOutJob } from "@/lib/whatsapp-secretary/tools/job-fanout"
import {
  getOutlookFormSubmission as getOutlookFormSubmissionRecord,
  listOutlookFormSubmissions as listOutlookFormSubmissionsRecords,
} from "@/lib/outlook-form-submissions/store"
import type { OutlookFormSubmissionStatus } from "@/lib/outlook-form-submissions/types"

/**
 * 3-Week Outlook tools for the WhatsApp Secretary orchestrator.
 *
 * Per-job reads (`getOutlookForJob`) go through `contexts/{jobId}/outlooks`, a
 * normal single-collection read — no index needed.
 *
 * Cross-job listing (`listActiveOutlooks`) was originally deferred: querying
 * across every job's `outlooks` subcollection directly needs a new
 * `collectionGroup("outlooks")` composite index. It turns out that's not
 * actually necessary: ByeByeDPR's own `jobs` collection is already small
 * (`listActiveJobsForFanOut()` below reads it directly — a single-field
 * equality query, automatically indexed, no scan concern, capped at
 * `MAX_FANOUT_JOBS`), and most Outlook-tracked jobs are already linked to a
 * ByeByeDPR job via `directoryContextId`. So this fans out over that bounded
 * job list and reads each linked job's most recent outlook — the exact same
 * bounded per-job read `getOutlookForJob` already does, just repeated a
 * small, capped number of times. No new Firestore index needed. This file
 * deliberately does NOT import `lib/bye-bye-dpr-server.ts`/`-store.ts` (both
 * `server-only`, which only resolves inside Next's bundler) — it reads
 * `jobs` directly instead, matching `reports.ts`/`clocking.ts`'s pattern.
 */

const OUTLOOKS_SUBCOLLECTION = "outlooks"
const MAX_TASKS_RETURNED = 20

type RecordValue = Record<string, unknown>

export interface OutlookTaskSummary {
  title: string
  trade: string
  companyName: string
  startDate: string | null
  durationDays: number
  endDate: string | null
  status: string
  completionPercent: number
}

export interface OutlookSummary {
  windowStart: string
  windowEnd: string
  taskCount: number
  tasks: OutlookTaskSummary[]
  deepLink: string
}

export interface ActiveOutlookSummary {
  jobName: string
  windowStart: string
  windowEnd: string
  taskCount: number
  deepLink: string
}

function toModelOutlook({ deepLink: _deepLink, ...outlook }: OutlookSummary): Omit<OutlookSummary, "deepLink"> {
  return outlook
}

function toModelActiveOutlook({ deepLink: _deepLink, ...outlook }: ActiveOutlookSummary): Omit<ActiveOutlookSummary, "deepLink"> {
  return outlook
}

function outlookTaskItem(task: OutlookTaskSummary): string {
  const schedule = task.startDate && task.endDate ? `${task.startDate} to ${task.endDate}` : task.startDate || task.endDate || ""
  const progress = task.completionPercent > 0 ? `${task.completionPercent}% complete` : task.status
  return [task.title, task.trade, task.companyName, schedule, progress].filter(Boolean).join(" — ")
}

function outlookDetailFormat(jobName: string, outlook: OutlookSummary) {
  return detailCard({
    title: `3-Week Outlook — ${jobName}`,
    fields: [
      { label: "Window", value: `${outlook.windowStart} to ${outlook.windowEnd}` },
      { label: "Tasks", value: `${outlook.taskCount}` },
    ],
    sections: [outlook.tasks.length > 0 ? { label: "Scheduled work", items: outlook.tasks.map(outlookTaskItem) } : null],
  })
}

export interface OutlookFormSubmissionListSummary {
  id: string
  jobName: string
  submittedByName: string
  status: OutlookFormSubmissionStatus
  submittedAtMs: number
  taskCount: number
}

export interface OutlookFormSubmissionDetail {
  id: string
  jobName: string
  submittedByName: string
  submittedByRole: string
  status: OutlookFormSubmissionStatus
  submittedAtMs: number
  windowStart: string
  windowEnd: string
  tasks: OutlookTaskSummary[]
  generalNotes: string
}

function formSubmissionDetailFormat(submission: OutlookFormSubmissionDetail, totalTaskCount = submission.tasks.length) {
  return detailCard({
    title: `3-Week Outlook submission — ${submission.jobName}`,
    fields: [
      { label: "Submitted by", value: [submission.submittedByName, submission.submittedByRole].filter(Boolean).join(" · ") },
      { label: "Status", value: submission.status },
      { label: "Window", value: `${submission.windowStart} to ${submission.windowEnd}` },
      { label: "Tasks", value: totalTaskCount === submission.tasks.length ? `${totalTaskCount}` : `${totalTaskCount} (showing ${submission.tasks.length})` },
    ],
    sections: [
      submission.tasks.length > 0 ? { label: "Planned tasks", items: submission.tasks.map(outlookTaskItem) } : null,
      submission.generalNotes ? { label: "Notes", items: [submission.generalNotes] } : null,
    ],
  })
}

export interface OutlooksToolsProvider {
  getOutlookForJob(jobId: string, windowStart?: string): Promise<{ windowStart: string; windowEnd: string; tasks: OutlookTaskSummary[] } | null>
  getMostRecentOutlookWindow(jobId: string): Promise<{ windowStart: string; windowEnd: string; taskCount: number } | null>
  /** 3-Week Outlook FORM submissions — supers' public-link intake, distinct from the authenticated editor's own outlooks above. */
  listFormSubmissions(filter: { jobName?: string; status?: OutlookFormSubmissionStatus; limit: number }): Promise<OutlookFormSubmissionListSummary[]>
  getFormSubmission(submissionId: string): Promise<OutlookFormSubmissionDetail | null>
}

function asRecord(value: unknown): RecordValue | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as RecordValue) : null
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function mapTask(value: unknown): OutlookTaskSummary | null {
  const record = asRecord(value)
  if (!record) return null
  const title = asString(record.title)
  if (!title) return null
  return {
    title,
    trade: asString(record.trade),
    companyName: asString(record.companyName),
    startDate: asString(record.startDate) || null,
    durationDays: typeof record.durationDays === "number" ? record.durationDays : 0,
    endDate: asString(record.endDate) || null,
    status: asString(record.status) || "not_started",
    completionPercent: typeof record.completionPercent === "number" ? record.completionPercent : 0,
  }
}

async function getAdminDb(): Promise<Firestore> {
  const { getFirestore } = await import("firebase-admin/firestore")
  return getFirestore(await getFirebaseAdminApp())
}

/** True when `onDate` (ISO date) falls within [windowStart, windowEnd] — plain string compare, since all three are ISO `YYYY-MM-DD`. */
function isDateWithinWindow(onDate: string, windowStart: string, windowEnd: string): boolean {
  return Boolean(windowStart) && Boolean(windowEnd) && onDate >= windowStart && onDate <= windowEnd
}

function createServerOutlooksToolsProvider(): OutlooksToolsProvider {
  return {
    async getOutlookForJob(jobId, windowStart) {
      const db = await getAdminDb()
      const outlooksRef = db.collection("contexts").doc(jobId).collection(OUTLOOKS_SUBCOLLECTION)
      const snapshot = windowStart
        ? await outlooksRef.doc(windowStart).get()
        : (await outlooksRef.orderBy("windowStart", "desc").limit(1).get()).docs[0]
      if (!snapshot || !snapshot.exists) return null
      const data = snapshot.data() as RecordValue
      const tasks = Array.isArray(data.tasks) ? data.tasks.map(mapTask).filter((task): task is OutlookTaskSummary => task !== null) : []
      return {
        windowStart: asString(data.windowStart) || snapshot.id,
        windowEnd: asString(data.windowEnd),
        tasks,
      }
    },
    async getMostRecentOutlookWindow(jobId) {
      const db = await getAdminDb()
      const snapshot = await db.collection("contexts").doc(jobId).collection(OUTLOOKS_SUBCOLLECTION).orderBy("windowStart", "desc").limit(1).get()
      const doc = snapshot.docs[0]
      if (!doc) return null
      const data = doc.data() as RecordValue
      const tasks = Array.isArray(data.tasks) ? data.tasks.filter((task) => asString(asRecord(task)?.title)) : []
      return {
        windowStart: asString(data.windowStart) || doc.id,
        windowEnd: asString(data.windowEnd),
        taskCount: tasks.length,
      }
    },
    async listFormSubmissions(filter) {
      const { submissions } = await listOutlookFormSubmissionsRecords({
        limit: filter.limit,
        jobName: filter.jobName,
        status: filter.status,
      })
      return submissions.map((submission) => ({
        id: submission.id,
        jobName: submission.jobName,
        submittedByName: submission.submittedByName,
        status: submission.status,
        submittedAtMs: submission.submittedAtMs,
        taskCount: submission.tasks.length,
      }))
    },
    async getFormSubmission(submissionId) {
      const submission = await getOutlookFormSubmissionRecord(submissionId)
      if (!submission) return null
      return {
        id: submission.id,
        jobName: submission.jobName,
        submittedByName: submission.submittedByName,
        submittedByRole: submission.submittedByRole,
        status: submission.status,
        submittedAtMs: submission.submittedAtMs,
        windowStart: submission.window.start,
        windowEnd: submission.window.end,
        tasks: submission.tasks.map((task) => ({
          title: task.title,
          trade: task.trade,
          companyName: task.companyName,
          startDate: task.startDate,
          durationDays: task.durationDays,
          endDate: task.endDate,
          status: task.status,
          completionPercent: task.completionPercent,
        })),
        generalNotes: submission.generalNotes,
      }
    },
  }
}

export function createOutlooksTools(
  deps: {
    resolver?: EntityResolver
    provider?: OutlooksToolsProvider
    directoryProvider?: DirectoryDataProvider
    listJobsProvider?: () => Promise<FanOutJob[]>
  } = {},
): SecretaryTool[] {
  const provider = deps.provider ?? createServerOutlooksToolsProvider()
  const directoryProvider = deps.directoryProvider ?? createServerDirectoryProvider()
  const listJobs = deps.listJobsProvider ?? listActiveJobsForFanOut
  const resolver = deps.resolver

  /**
   * Per-job reads and the cross-job listing were two tools whose descriptions
   * each had to point at the other. They are the same question at two scopes,
   * so scope is the parameter: with a job, you get that job's tasks; without
   * one, every job whose window covers the date.
   */
  const get: SecretaryTool<{ jobRef?: string; jobName?: string; windowStart?: string; onDate?: string; limit?: number }> = {
    name: "outlooks_get",
    module: "outlooks",
    description:
      "Read 3-Week Outlooks. With a job (`jobRef` from an earlier result, or `jobName`), returns that job's scheduled tasks — trade, company, dates, status, completion — for the most recent window, or for a specific `windowStart`. Without a job, lists every active job whose Outlook window covers `onDate` (defaults to today), which answers 'are there any active outlooks' and 'which jobs have an outlook this week'.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: [],
      properties: {
        jobRef: { type: "string", description: "Opaque job ref from an earlier result. Preferred over jobName." },
        jobName: { type: "string", description: "The job's name. Omit for the cross-job listing." },
        windowStart: { type: "string", description: "Per-job only: ISO Monday date identifying a specific 3-week window." },
        onDate: { type: "string", description: "Cross-job only: ISO date to check, defaults to today." },
        limit: { type: "number", description: "Cross-job only: max jobs to return (1-20)." },
      },
    },
    schema: z.object({
      jobRef: z.string().max(20).optional(),
      jobName: z.string().min(1).max(160).optional(),
      windowStart: z.string().max(20).optional(),
      onDate: z.string().max(20).optional(),
      limit: z.number().int().min(1).max(20).optional(),
    }),
    async run(args, budget): Promise<SecretaryToolResult> {
      if (args.jobRef || args.jobName) {
        let contextId: string | undefined
        let jobName = args.jobName ?? ""
        let deepLinkId: string | undefined

        if (resolver) {
          const resolution = await resolver.resolveArg({ ref: args.jobRef, name: args.jobName }, "job")
          if (resolution.status !== "found") return describeUnresolved(resolution, "job", args.jobName ?? args.jobRef ?? "")
          contextId = resolution.entity.sourceIds.contextId
          jobName = resolution.entity.name
          deepLinkId = resolution.entity.sourceIds.directoryId
          if (!contextId) return { summary: `"${jobName}" isn't linked to a Directory job context, so it has no 3-Week Outlook.`, empty: true }
        } else {
          const jobMatches = await directoryProvider.findByName(args.jobName as string, { type: "job", limit: 5 })
          if (jobMatches.length === 0) return { summary: `No job matches "${args.jobName}".`, empty: true }
          if (jobMatches.length > 1) {
            return {
              summary: `More than one job matches "${args.jobName}". Ask which one.`,
              data: { candidates: jobMatches.map((job) => ({ name: job.name, location: job.location })) },
            }
          }
          contextId = jobMatches[0].sourceId
          jobName = jobMatches[0].name
          deepLinkId = jobMatches[0].id
        }

        const outlook = await provider.getOutlookForJob(contextId, args.windowStart)
        if (!outlook) return { summary: `No 3-Week Outlook was retrieved for "${jobName}"${args.windowStart ? ` for ${args.windowStart}` : ""}.`, empty: true }

        const allowed = Math.max(0, Math.min(MAX_TASKS_RETURNED, budget.maxRecordsPerTool, budget.remainingRecords))
        const tasks = outlook.tasks.slice(0, allowed)
        budget.remainingRecords -= tasks.length

        const summary: OutlookSummary = {
          windowStart: outlook.windowStart,
          windowEnd: outlook.windowEnd,
          taskCount: outlook.tasks.length,
          tasks,
          deepLink: buildOutlookDeepLink(deepLinkId ?? contextId),
        }
        return {
          summary: `3-Week Outlook for "${jobName}" (${outlook.windowStart} to ${outlook.windowEnd}), ${outlook.tasks.length} task(s).`,
          data: { outlook: toModelOutlook(summary) },
          responseFormat: outlookDetailFormat(jobName, summary),
          ...(outlook.tasks.length > tasks.length ? { truncated: true, totalMatched: outlook.tasks.length } : {}),
          presentation: { deepLink: summary.deepLink },
        }
      }

      const onDate = args.onDate ?? todayIsoInAppZone()
      const limit = Math.max(1, Math.min(args.limit ?? 10, budget.maxRecordsPerTool, budget.remainingRecords))
      if (limit <= 0) return { summary: "The retrieval budget for this question is used up.", empty: true }

      const jobs = (await listJobs()).filter((job) => job.directoryContextId)
      if (jobs.length === 0) return { summary: "No ByeByeDPR jobs are linked to a Directory job context, so no outlooks could be checked.", empty: true }

      const windows = await Promise.all(
        jobs.map(async (job) => ({ job, window: await provider.getMostRecentOutlookWindow(job.directoryContextId as string) })),
      )
      const matching = windows.filter((entry) => entry.window && isDateWithinWindow(onDate, entry.window.windowStart, entry.window.windowEnd))
      const active: ActiveOutlookSummary[] = matching.slice(0, limit).map((entry) => ({
        jobName: entry.job.name,
        windowStart: entry.window!.windowStart,
        windowEnd: entry.window!.windowEnd,
        taskCount: entry.window!.taskCount,
        deepLink: buildOutlookDeepLink(entry.job.directoryContextId as string),
      }))

      budget.remainingRecords -= active.length
      if (active.length === 0) {
        return { summary: `No active 3-Week Outlook covers ${onDate} across the ${jobs.length} job(s) checked.`, empty: true }
      }
      return {
        summary: `${active.length} job(s) have a 3-Week Outlook active on ${onDate}.`,
        data: { outlooks: active.map(toModelActiveOutlook) },
        ...(matching.length > active.length ? { truncated: true, totalMatched: matching.length } : {}),
        presentation: { deepLinks: active.map((entry) => ({ jobName: entry.jobName, deepLink: entry.deepLink })) },
      }
    },
  }

  const listFormSubmissions: SecretaryTool<{ jobName?: string; status?: OutlookFormSubmissionStatus; limit?: number }> = {
    name: "outlooks_listFormSubmissions",
    module: "outlooks",
    description:
      "Lists 3-Week Outlook form submissions from site supers — the public-link intake form, distinct from the authenticated outlook editor. Returns job, who submitted, when, and review status (new/reviewed), each with a submissionId. Optionally filter by job name or status. Answers 'show me the latest outlook forms' and 'what has John submitted'. Call this again (filtered by jobName) whenever you need a specific submission's id for outlooks_getFormSubmission and don't already have it from earlier in this same turn — e.g. the user asked for one by job/job name in a message that didn't itself list them. Cheap, bounded, never worth asking the user to repeat instead.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: [],
      properties: {
        jobName: { type: "string", description: "Filter to submissions for a job whose name contains this text." },
        status: { type: "string", enum: ["new", "reviewed"], description: "Filter by review status." },
        limit: { type: "number", description: "Max submissions to return (1-20)." },
      },
    },
    schema: z.object({
      jobName: z.string().max(160).optional(),
      status: z.enum(["new", "reviewed"]).optional(),
      limit: z.number().int().min(1).max(20).optional(),
    }),
    async run(args, budget): Promise<SecretaryToolResult> {
      const limit = Math.max(1, Math.min(args.limit ?? 10, 20, budget.maxRecordsPerTool, budget.remainingRecords))
      if (limit <= 0) return { summary: "The retrieval budget for this question is used up.", empty: true }

      const submissions = await provider.listFormSubmissions({ jobName: args.jobName, status: args.status, limit })
      budget.remainingRecords -= submissions.length
      if (submissions.length === 0) {
        return { summary: "No 3-Week Outlook form submissions matched.", empty: true }
      }
      return {
        summary: `${submissions.length} 3-Week Outlook form submission(s) found.`,
        data: { submissions },
      }
    },
  }

  const getFormSubmission: SecretaryTool<{ submissionId: string }> = {
    name: "outlooks_getFormSubmission",
    module: "outlooks",
    description:
      "Reads one 3-Week Outlook form submission in full — job, submitter, tasks (title/trade/company/dates/duration/status), and general notes/issues. Requires `submissionId` — a raw record id, not a name, and it does NOT persist across separate messages, only within tool results already returned this turn. If the user asks for a specific submission's detail (by job or person) and you don't already have its id from this turn, call outlooks_listFormSubmissions first (filtered by that job/name) to get it, then call this — do not ask the user to pick from a list again just because the id isn't already in hand.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["submissionId"],
      properties: {
        submissionId: { type: "string", description: "The submission id, from an earlier outlooks_listFormSubmissions result." },
      },
    },
    schema: z.object({ submissionId: z.string().min(1).max(200) }),
    async run(args, budget): Promise<SecretaryToolResult> {
      const submission = await provider.getFormSubmission(args.submissionId)
      if (!submission) return { summary: `No form submission found for "${args.submissionId}".`, empty: true }

      const allowed = Math.max(0, Math.min(MAX_TASKS_RETURNED, budget.maxRecordsPerTool, budget.remainingRecords))
      const tasks = submission.tasks.slice(0, allowed)
      budget.remainingRecords -= tasks.length

      return {
        summary: `3-Week Outlook form submission for "${submission.jobName}" by ${submission.submittedByName}, ${submission.tasks.length} task(s).`,
        data: { submission: { ...submission, tasks } },
        responseFormat: formSubmissionDetailFormat({ ...submission, tasks }, submission.tasks.length),
        ...(submission.tasks.length > tasks.length ? { truncated: true, totalMatched: submission.tasks.length } : {}),
      }
    },
  }

  return [get, listFormSubmissions, getFormSubmission]
}
