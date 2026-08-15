import { z } from "zod"
import type { Firestore } from "firebase-admin/firestore"
import type { DirectoryDataProvider } from "@/features/directory/ai/server/tools/types"
import { getFirebaseAdminApp } from "@/lib/ai/server/firebase-admin"
import { findWhatsAppReportJobsByNameCandidates, type WhatsAppReportJob } from "@/lib/whatsapp-reports"
import type { SecretaryTool, SecretaryToolResult } from "@/lib/whatsapp-secretary/tool-registry"
import { describeUnresolved, type EntityResolver } from "@/lib/whatsapp-secretary/entity-resolver"
import { createServerDirectoryProviderWithKeywordFallback } from "@/lib/whatsapp-secretary/tools/directory"
import { listActiveJobsForFanOut, resolveJobByNameViaDirectory, type FanOutJob } from "@/lib/whatsapp-secretary/tools/job-fanout"

/**
 * ByeByeDPR clocking tools for the WhatsApp Secretary orchestrator.
 *
 * `getClockHistoryForJob` is built on the already-deployed-but-unused
 * `clockRecords(jobId ASC, clockInAt DESC)` composite index, so no new index
 * is needed; a date range on `clockInAt` (the same field the index sorts on)
 * needs nothing extra either. Job-name resolution tries Directory's job
 * search first (`resolveJobByNameViaDirectory` in `job-fanout.ts`) and falls
 * back to `findWhatsAppReportJobsByNameCandidates` (ByeByeDPR's own `jobs`
 * collection) whenever Directory can't produce a single, linked match,
 * matching `lib/whatsapp-secretary/tools/reports.ts`. Per the project's
 * privacy posture, the compact result reports only *whether* a location was
 * recorded for a clock-in/out, never the raw coordinates.
 *
 * `getMostActiveJobs` answers the cross-job question `getClockHistoryForJob`
 * structurally can't: "which job is most active right now" needs every job's
 * activity compared, not one job's history. It fans out over the same small,
 * bounded job list `outlooks.ts`'s cross-job tool uses
 * (`listActiveJobsForFanOut`, capped at `MAX_FANOUT_JOBS`), and for each job
 * runs two already-index-free queries (an equality-only `status=="active"`
 * count, mirroring the existing `getActiveClock()` pattern in
 * `lib/bye-bye-dpr-server.ts`, plus the same newest-clock-in query
 * `getClockHistoryForJob` already uses) — no new Firestore index needed.
 * Ranks by currently-clocked-in worker count first, then most recent
 * clock-in. Deliberately does not resolve names for every candidate (that
 * would double the read cost); the model can follow up with
 * `getClockHistoryForJob` on the winning job for who's actually on it.
 */

const CLOCK_RECORDS_COLLECTION = "clockRecords"
const USERS_COLLECTION = "users"
const MAX_HISTORY_ITEMS = 12
const MAX_ACTIVE_JOBS_RETURNED = 10

type RecordValue = Record<string, unknown>

export interface ClockHistoryEntry {
  userName: string
  status: "active" | "closed"
  clockInAt: string | null
  clockOutAt: string | null
  durationMinutes: number | null
  hadClockInLocation: boolean
  hadClockOutLocation: boolean
}

export interface JobClockActivity {
  activeWorkerCount: number
  mostRecentClockInAt: string | null
}

export interface MostActiveJobSummary {
  jobName: string
  activeWorkerCount: number
  mostRecentClockInAt: string | null
}

export interface ClockingToolsProvider {
  getClockHistoryForJob(
    jobId: string,
    options: { since?: string; until?: string; limit: number },
  ): Promise<ClockHistoryEntry[]>
  getJobClockActivity(jobId: string): Promise<JobClockActivity | null>
}

function asRecord(value: unknown): RecordValue | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as RecordValue) : null
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function toIso(value: unknown): string | null {
  if (value && typeof value === "object" && "toDate" in value && typeof (value as { toDate?: unknown }).toDate === "function") {
    const date = (value as { toDate: () => Date }).toDate()
    if (date instanceof Date && !Number.isNaN(date.getTime())) return date.toISOString()
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString()
  return typeof value === "string" && value ? value : null
}

async function getAdminDb(): Promise<Firestore> {
  const { getFirestore } = await import("firebase-admin/firestore")
  return getFirestore(await getFirebaseAdminApp())
}

function createServerClockingToolsProvider(): ClockingToolsProvider {
  return {
    async getClockHistoryForJob(jobId, options) {
      const db = await getAdminDb()
      let query = db.collection(CLOCK_RECORDS_COLLECTION).where("jobId", "==", jobId).orderBy("clockInAt", "desc")
      if (options.until) query = query.where("clockInAt", "<=", new Date(options.until))
      if (options.since) query = query.where("clockInAt", ">=", new Date(options.since))
      const snapshot = await query.limit(options.limit).get()
      if (snapshot.empty) return []

      const records = snapshot.docs.map((document) => document.data() as RecordValue)
      const userIds = [...new Set(records.map((record) => asString(record.userId)).filter(Boolean))].slice(0, 12)
      const userRefs = userIds.map((id) => db.collection(USERS_COLLECTION).doc(id))
      const userSnapshots = userRefs.length > 0 ? await db.getAll(...userRefs) : []
      const namesById = new Map(
        userSnapshots.filter((snap) => snap.exists).map((snap) => [snap.id, asString((snap.data() as RecordValue | undefined)?.name)]),
      )

      return records.map((record) => ({
        userName: namesById.get(asString(record.userId)) || "Unknown",
        status: record.status === "closed" ? "closed" : "active",
        clockInAt: toIso(record.clockInAt),
        clockOutAt: toIso(record.clockOutAt),
        durationMinutes: typeof record.durationMinutes === "number" ? record.durationMinutes : null,
        hadClockInLocation: Boolean(asRecord(record.clockInLocation)),
        hadClockOutLocation: Boolean(asRecord(record.clockOutLocation)),
      }))
    },
    async getJobClockActivity(jobId) {
      const db = await getAdminDb()
      const [activeSnap, recentSnap] = await Promise.all([
        db.collection(CLOCK_RECORDS_COLLECTION).where("jobId", "==", jobId).where("status", "==", "active").count().get(),
        db.collection(CLOCK_RECORDS_COLLECTION).where("jobId", "==", jobId).orderBy("clockInAt", "desc").limit(1).get(),
      ])
      const activeWorkerCount = activeSnap.data().count
      const recentDoc = recentSnap.docs[0]
      if (activeWorkerCount === 0 && !recentDoc) return null
      const recentData = recentDoc?.data() as RecordValue | undefined
      return {
        activeWorkerCount,
        mostRecentClockInAt: recentData ? toIso(recentData.clockInAt) : null,
      }
    },
  }
}

export function createClockingTools(
  deps: {
    resolver?: EntityResolver
    provider?: ClockingToolsProvider
    directoryProvider?: DirectoryDataProvider
    resolveJobsByName?: (name: string) => Promise<WhatsAppReportJob[]>
    listJobsProvider?: () => Promise<FanOutJob[]>
  } = {},
): SecretaryTool[] {
  const provider = deps.provider ?? createServerClockingToolsProvider()
  const directoryProvider = deps.directoryProvider ?? createServerDirectoryProviderWithKeywordFallback()
  const resolveJobsByName =
    deps.resolveJobsByName ??
    ((name: string) => resolveJobByNameViaDirectory(name, directoryProvider, (candidate) => findWhatsAppReportJobsByNameCandidates([candidate])))
  const listJobs = deps.listJobsProvider ?? listActiveJobsForFanOut
  const resolver = deps.resolver

  const getClockHistoryForJob: SecretaryTool<{ jobRef?: string; jobName?: string; since?: string; until?: string; limit?: number }> = {
    name: "clocking_getClockHistoryForJob",
    module: "clocking",
    description:
      "List clock-in/out history for one ByeByeDPR job, newest first — who clocked in/out, when, and how long. Supports an optional date range (`since`/`until`, ISO dates). Never returns exact GPS coordinates, only whether a location was recorded. For a cross-job question ('which job is most active'), use clocking_getMostActiveJobs instead.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: [],
      properties: {
        jobRef: { type: "string", description: "Opaque job ref from an earlier result. Preferred over jobName." },
        jobName: { type: "string", description: "The job's name." },
        since: { type: "string", description: "Only clock-ins on/after this ISO date." },
        until: { type: "string", description: "Only clock-ins on/before this ISO date." },
        limit: { type: "number", description: "Max clock records to return (1-12)." },
      },
    },
    schema: z.object({
      jobRef: z.string().max(20).optional(),
      jobName: z.string().min(1).max(160).optional(),
      since: z.string().max(40).optional(),
      until: z.string().max(40).optional(),
      limit: z.number().int().min(1).max(MAX_HISTORY_ITEMS).optional(),
    }),
    async run(args, budget): Promise<SecretaryToolResult> {
      let jobs: WhatsAppReportJob[]
      if (resolver) {
        const resolution = await resolver.resolveArg({ ref: args.jobRef, name: args.jobName }, "job")
        if (resolution.status !== "found") return describeUnresolved(resolution, "job", args.jobName ?? args.jobRef ?? "")
        const jobId = resolution.entity.sourceIds.byeByeDprJobId
        if (!jobId) return { summary: `"${resolution.entity.name}" has no linked ByeByeDPR job, so it has no clock history.`, empty: true }
        jobs = [{ id: jobId, name: resolution.entity.name }]
      } else {
        jobs = await resolveJobsByName(args.jobName as string)
        if (jobs.length === 0) return { summary: `No ByeByeDPR job matches "${args.jobName}".`, empty: true }
        if (jobs.length > 1) {
          return {
            summary: `More than one job matches "${args.jobName}". Ask which one.`,
            data: { candidates: jobs.map((job) => ({ name: job.name })) },
          }
        }
      }

      const limit = Math.max(1, Math.min(args.limit ?? budget.maxRecordsPerTool, budget.maxRecordsPerTool, budget.remainingRecords))
      if (limit <= 0) return { summary: "The retrieval budget for this question is used up.", empty: true }

      const history = await provider.getClockHistoryForJob(jobs[0].id, { since: args.since, until: args.until, limit })
      budget.remainingRecords -= history.length
      if (history.length === 0) return { summary: `No clock history was retrieved for "${jobs[0].name}" in that range.`, empty: true }
      return { summary: `${history.length} clock record(s) for "${jobs[0].name}", newest first.`, data: { history } }
    },
  }

  const getMostActiveJobs: SecretaryTool<{ limit?: number }> = {
    name: "clocking_getMostActiveJobs",
    module: "clocking",
    description:
      "Rank ByeByeDPR jobs by clock activity right now — currently-clocked-in worker count first, then most recent clock-in — for cross-job questions like 'which job is most active' or 'what's busiest today'. Does not include who's on each job; follow up with clocking_getClockHistoryForJob for that.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: [],
      properties: { limit: { type: "number", description: "Max jobs to return (1-10)." } },
    },
    schema: z.object({ limit: z.number().int().min(1).max(MAX_ACTIVE_JOBS_RETURNED).optional() }),
    async run(args, budget): Promise<SecretaryToolResult> {
      const limit = Math.max(1, Math.min(args.limit ?? 5, budget.maxRecordsPerTool, budget.remainingRecords))
      if (limit <= 0) return { summary: "The retrieval budget for this question is used up.", empty: true }

      const jobs = await listJobs()
      if (jobs.length === 0) return { summary: "No active ByeByeDPR jobs were found.", empty: true }

      const activity = await Promise.all(
        jobs.map(async (job) => ({ job, info: await provider.getJobClockActivity(job.id) })),
      )
      const withActivity = activity.filter(
        (entry): entry is { job: FanOutJob; info: JobClockActivity } => entry.info !== null,
      )
      if (withActivity.length === 0) {
        return { summary: `No clock activity was retrieved across the ${jobs.length} job(s) checked.`, empty: true }
      }

      const ranked: MostActiveJobSummary[] = withActivity
        .sort((a, b) => {
          if (b.info.activeWorkerCount !== a.info.activeWorkerCount) return b.info.activeWorkerCount - a.info.activeWorkerCount
          const aTime = a.info.mostRecentClockInAt ? Date.parse(a.info.mostRecentClockInAt) : 0
          const bTime = b.info.mostRecentClockInAt ? Date.parse(b.info.mostRecentClockInAt) : 0
          return bTime - aTime
        })
        .slice(0, limit)
        .map((entry) => ({ jobName: entry.job.name, activeWorkerCount: entry.info.activeWorkerCount, mostRecentClockInAt: entry.info.mostRecentClockInAt }))

      budget.remainingRecords -= ranked.length
      return {
        summary: `${ranked.length} job(s) ranked by clock activity, most active first (out of ${jobs.length} job(s) checked).`,
        data: { jobs: ranked },
      }
    },
  }

  return [getClockHistoryForJob, getMostActiveJobs]
}
