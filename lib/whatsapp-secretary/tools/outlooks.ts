import { z } from "zod"
import type { Firestore } from "firebase-admin/firestore"
import { createServerDirectoryProvider } from "@/features/directory/ai/server/tools/provider"
import type { DirectoryDataProvider } from "@/features/directory/ai/server/tools/types"
import { getFirebaseAdminApp } from "@/lib/ai/server/firebase-admin"
import { buildOutlookDeepLink } from "@/lib/whatsapp-secretary/guidance"
import type { SecretaryTool, SecretaryToolResult } from "@/lib/whatsapp-secretary/tool-registry"
import { listActiveJobsForFanOut, type FanOutJob } from "@/lib/whatsapp-secretary/tools/job-fanout"

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

export interface OutlooksToolsProvider {
  getOutlookForJob(jobId: string, windowStart?: string): Promise<{ windowStart: string; windowEnd: string; tasks: OutlookTaskSummary[] } | null>
  getMostRecentOutlookWindow(jobId: string): Promise<{ windowStart: string; windowEnd: string; taskCount: number } | null>
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
  }
}

export function createOutlooksTools(
  deps: {
    provider?: OutlooksToolsProvider
    directoryProvider?: DirectoryDataProvider
    listJobsProvider?: () => Promise<FanOutJob[]>
  } = {},
): SecretaryTool[] {
  const provider = deps.provider ?? createServerOutlooksToolsProvider()
  const directoryProvider = deps.directoryProvider ?? createServerDirectoryProvider()
  const listJobs = deps.listJobsProvider ?? listActiveJobsForFanOut

  const getOutlookForJob: SecretaryTool<{ jobName: string; windowStart?: string }> = {
    name: "outlooks_getOutlookForJob",
    module: "outlooks",
    description:
      "Get one job's 3-Week Outlook (scheduled tasks: trade, company, dates, status, completion). Without `windowStart`, returns the most recent week. For a cross-job question ('which jobs have an active outlook today'), use outlooks_listActiveOutlooks instead.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["jobName"],
      properties: {
        jobName: { type: "string", description: "The job's name." },
        windowStart: { type: "string", description: "Optional ISO Monday date identifying a specific 3-week window." },
      },
    },
    schema: z.object({ jobName: z.string().min(1).max(160), windowStart: z.string().max(20).optional() }),
    async run(args, budget): Promise<SecretaryToolResult> {
      const jobMatches = await directoryProvider.findByName(args.jobName, { type: "job", limit: 5 })
      if (jobMatches.length === 0) return { summary: `No job matches "${args.jobName}".`, empty: true }
      if (jobMatches.length > 1) {
        return {
          summary: `More than one job matches "${args.jobName}". Ask which one.`,
          data: { candidates: jobMatches.map((job) => ({ name: job.name, location: job.location })) },
        }
      }

      const job = jobMatches[0]
      const outlook = await provider.getOutlookForJob(job.sourceId, args.windowStart)
      if (!outlook) return { summary: `No 3-Week Outlook was retrieved for "${job.name}"${args.windowStart ? ` for ${args.windowStart}` : ""}.`, empty: true }

      const allowed = Math.max(0, Math.min(MAX_TASKS_RETURNED, budget.maxRecordsPerTool, budget.remainingRecords))
      const tasks = outlook.tasks.slice(0, allowed)
      budget.remainingRecords -= tasks.length

      const summary: OutlookSummary = {
        windowStart: outlook.windowStart,
        windowEnd: outlook.windowEnd,
        taskCount: outlook.tasks.length,
        tasks,
        deepLink: buildOutlookDeepLink(job.id),
      }
      return {
        summary: `3-Week Outlook for "${job.name}" (${outlook.windowStart} to ${outlook.windowEnd}), ${outlook.tasks.length} task(s).`,
        data: { outlook: toModelOutlook(summary) },
        presentation: { deepLink: summary.deepLink },
      }
    },
  }

  const listActiveOutlooks: SecretaryTool<{ onDate?: string; limit?: number }> = {
    name: "outlooks_listActiveOutlooks",
    module: "outlooks",
    description:
      "List every ByeByeDPR job whose 3-Week Outlook window covers a given date (defaults to today) — answers cross-job questions like 'are there any active outlooks today' or 'which jobs have an outlook this week'. Bounded to active jobs.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: [],
      properties: {
        onDate: { type: "string", description: "ISO date to check (defaults to today), e.g. 2026-08-13." },
        limit: { type: "number", description: "Max jobs to return (1-20)." },
      },
    },
    schema: z.object({ onDate: z.string().max(20).optional(), limit: z.number().int().min(1).max(20).optional() }),
    async run(args, budget): Promise<SecretaryToolResult> {
      const onDate = args.onDate ?? new Date().toISOString().slice(0, 10)
      const limit = Math.max(1, Math.min(args.limit ?? 10, budget.maxRecordsPerTool, budget.remainingRecords))
      if (limit <= 0) return { summary: "The retrieval budget for this question is used up.", empty: true }

      const jobs = (await listJobs()).filter((job) => job.directoryContextId)
      if (jobs.length === 0) return { summary: "No ByeByeDPR jobs are linked to a Directory job context, so no outlooks could be checked.", empty: true }

      const windows = await Promise.all(
        jobs.map(async (job) => {
          const window = await provider.getMostRecentOutlookWindow(job.directoryContextId as string)
          return { job, window }
        }),
      )
      const active: ActiveOutlookSummary[] = windows
        .filter((entry) => entry.window && isDateWithinWindow(onDate, entry.window.windowStart, entry.window.windowEnd))
        .map((entry) => ({
          jobName: entry.job.name,
          windowStart: entry.window!.windowStart,
          windowEnd: entry.window!.windowEnd,
          taskCount: entry.window!.taskCount,
          deepLink: buildOutlookDeepLink(entry.job.directoryContextId as string),
        }))
        .slice(0, limit)

      budget.remainingRecords -= active.length
      if (active.length === 0) {
        return { summary: `No active 3-Week Outlook covers ${onDate} across the ${jobs.length} job(s) checked.`, empty: true }
      }
      return {
        summary: `${active.length} job(s) have a 3-Week Outlook active on ${onDate}.`,
        data: { outlooks: active.map(toModelActiveOutlook) },
        presentation: { deepLinks: active.map((entry) => ({ jobName: entry.jobName, deepLink: entry.deepLink })) },
      }
    },
  }

  return [getOutlookForJob, listActiveOutlooks]
}
