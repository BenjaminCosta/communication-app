import { z } from "zod"
import type { Firestore, Timestamp } from "firebase-admin/firestore"
import type { DirectoryDataProvider } from "@/features/directory/ai/server/tools/types"
import { getFirebaseAdminApp } from "@/lib/ai/server/firebase-admin"
import { findWhatsAppReportJobsByNameCandidates, type WhatsAppReportJob } from "@/lib/whatsapp-reports"
import type { SecretaryTool, SecretaryToolResult } from "@/lib/whatsapp-secretary/tool-registry"
import { createServerDirectoryProviderWithKeywordFallback } from "@/lib/whatsapp-secretary/tools/directory"
import { listActiveJobsForFanOut, resolveJobByNameViaDirectory, type FanOutJob } from "@/lib/whatsapp-secretary/tools/job-fanout"

/**
 * ByeByeDPR Daily Report tools for the WhatsApp Secretary orchestrator.
 *
 * Job-name resolution tries Directory's job search first
 * (`resolveJobByNameViaDirectory` in `job-fanout.ts`, inheriting Directory's
 * keyword/partial-name fallback quality) and falls back to
 * `findWhatsAppReportJobsByNameCandidates` from `lib/whatsapp-reports.ts`
 * (kept alive there because the Daily Report draft action also depends on
 * it) whenever Directory can't produce a single, linked match.
 * `searchDailyReportsForJob`/`getRecentDailyReports` extend the old fixed
 * newest-four slice with real date-range/cursor pagination, on the existing
 * `reports(jobId ASC, type ASC, createdAt DESC)` index — a range on
 * `createdAt` itself needs no new index. `getDailyReportsByAuthor` is new: it
 * uses the already-deployed-but-unused `reports(authorId ASC, status ASC,
 * createdAt DESC)` composite index, resolving a person's name to their linked
 * Firebase user id via Directory + a bounded `/contacts` point read (the id
 * is never echoed in the final answer, only used to filter — the same trust
 * boundary Directory's own `directoryId` already crosses in tool-call JSON).
 * The old "missing report" refusal guard is preserved in this tool's
 * description text, matching the deleted `lib/whatsapp-reports.ts` reader's
 * documented limitation: this data has no reporting cadence to infer from.
 * `getJobsWithoutRecentReports` is new: a portfolio-wide answer to "which
 * jobs don't have a recent report", fanning out over the same small, bounded
 * active-job list `clocking.ts`/`outlooks.ts`'s cross-job tools use
 * (`listActiveJobsForFanOut`), then a `.limit(1)` newest-report lookup per
 * job on the same `reports(jobId ASC, type ASC, createdAt DESC)` index — no
 * new Firestore index needed. It states only what it retrieved (a report
 * from date X, or none on file) — same guardrail as the other tools here:
 * never "missing" or "required", since this data has no cadence to infer.
 */

const REPORTS_COLLECTION = "reports"
const CONTACTS_COLLECTION = "contacts"
const MAX_REPORT_SECTION_CHARACTERS = 440
const MAX_STALE_JOBS_RETURNED = 10

type RecordValue = Record<string, unknown>
type ReportStatus = "draft" | "submitted"

export interface DailyReportSummary {
  jobId: string
  jobName: string
  status: ReportStatus
  createdAt: string | null
  submittedAt: string | null
  workCompleted: string | null
  issuesOrDelays: string | null
  nextSteps: string | null
}

export interface StaleJobReportSummary {
  jobName: string
  mostRecentReportAt: string | null
}

export interface ReportsToolsProvider {
  getReportsForJob(
    jobId: string,
    jobName: string,
    options: { since?: string; until?: string; cursor?: string; limit: number },
  ): Promise<{ reports: DailyReportSummary[]; nextCursor: string | null }>
  getRecentReports(options: { since?: string; limit: number }): Promise<DailyReportSummary[]>
  getReportsByAuthor(authorId: string, options: { status?: ReportStatus; since?: string; until?: string; limit: number }): Promise<DailyReportSummary[]>
  /** Newest report's `createdAt` for one job, or `null` when it has none on file. */
  getMostRecentReportDateForJob(jobId: string): Promise<string | null>
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

function compactSection(value: unknown): string | null {
  const result = asString(value)
  return result ? result.slice(0, MAX_REPORT_SECTION_CHARACTERS) : null
}

function mapReport(data: RecordValue, jobName: string): DailyReportSummary {
  const structuredData = asRecord(data.structuredData)
  return {
    jobId: asString(data.jobId),
    jobName,
    status: data.status === "submitted" ? "submitted" : "draft",
    createdAt: toIso(data.createdAt),
    submittedAt: toIso(data.submittedAt),
    workCompleted: compactSection(structuredData?.workCompleted),
    issuesOrDelays: compactSection(structuredData?.issuesOrDelays),
    nextSteps: compactSection(structuredData?.nextSteps),
  }
}

async function getAdminDb(): Promise<Firestore> {
  const { getFirestore } = await import("firebase-admin/firestore")
  return getFirestore(await getFirebaseAdminApp())
}

async function attachJobNames(db: Firestore, reports: Array<RecordValue & { jobId: string }>): Promise<DailyReportSummary[]> {
  const jobIds = [...new Set(reports.map((report) => report.jobId).filter(Boolean))].slice(0, 12)
  const snapshots = jobIds.length > 0 ? await db.getAll(...jobIds.map((jobId) => db.collection("jobs").doc(jobId))) : []
  const names = new Map(snapshots.filter((snapshot) => snapshot.exists).map((snapshot) => [snapshot.id, asString((snapshot.data() as RecordValue | undefined)?.name)]))
  return reports.map((report) => mapReport(report, names.get(report.jobId) || "Unnamed job"))
}

function reportQueryFields<T extends { select: (...fieldPaths: string[]) => T }>(query: T): T {
  return query.select("jobId", "authorId", "type", "status", "structuredData.workCompleted", "structuredData.issuesOrDelays", "structuredData.nextSteps", "createdAt", "submittedAt")
}

function createServerReportsToolsProvider(): ReportsToolsProvider {
  return {
    async getReportsForJob(jobId, jobName, options) {
      const db = await getAdminDb()
      let query = reportQueryFields(
        db.collection(REPORTS_COLLECTION).where("jobId", "==", jobId).where("type", "==", "daily_report").orderBy("createdAt", "desc"),
      )
      if (options.until) query = query.where("createdAt", "<=", new Date(options.until))
      if (options.since) query = query.where("createdAt", ">=", new Date(options.since))
      if (options.cursor) {
        const cursorMs = Number(options.cursor)
        if (Number.isFinite(cursorMs)) query = query.startAfter(new Date(cursorMs))
      }
      const snapshot = await query.limit(options.limit).get()
      const reports = snapshot.docs.map((document) => mapReport(document.data() as RecordValue, jobName))
      const last = snapshot.docs.at(-1)?.get("createdAt") as Timestamp | undefined
      const nextCursor = snapshot.docs.length === options.limit && last ? String(last.toMillis()) : null
      return { reports, nextCursor }
    },
    async getRecentReports(options) {
      const db = await getAdminDb()
      let query = reportQueryFields(db.collection(REPORTS_COLLECTION).orderBy("createdAt", "desc"))
      if (options.since) query = query.where("createdAt", ">=", new Date(options.since))
      const snapshot = await query.limit(options.limit).get()
      return attachJobNames(db, snapshot.docs.map((document) => ({ ...(document.data() as RecordValue), jobId: asString((document.data() as RecordValue).jobId) })))
    },
    async getReportsByAuthor(authorId, options) {
      const db = await getAdminDb()
      const status = options.status ?? "submitted"
      let query = reportQueryFields(
        db.collection(REPORTS_COLLECTION).where("authorId", "==", authorId).where("status", "==", status).orderBy("createdAt", "desc"),
      )
      if (options.until) query = query.where("createdAt", "<=", new Date(options.until))
      if (options.since) query = query.where("createdAt", ">=", new Date(options.since))
      const snapshot = await query.limit(options.limit).get()
      return attachJobNames(db, snapshot.docs.map((document) => ({ ...(document.data() as RecordValue), jobId: asString((document.data() as RecordValue).jobId) })))
    },
    async getMostRecentReportDateForJob(jobId) {
      const db = await getAdminDb()
      const snapshot = await db
        .collection(REPORTS_COLLECTION)
        .where("jobId", "==", jobId)
        .where("type", "==", "daily_report")
        .orderBy("createdAt", "desc")
        .select("createdAt")
        .limit(1)
        .get()
      const doc = snapshot.docs[0]
      return doc ? toIso((doc.data() as RecordValue).createdAt) : null
    },
  }
}

/** Resolves a person's name to their linked Firebase user id via Directory + a bounded contact read. Never guesses. */
async function resolveAuthorIdByName(directoryProvider: DirectoryDataProvider, personName: string): Promise<string | null> {
  const matches = await directoryProvider.findByName(personName, { type: "person", limit: 3 })
  const person = matches.find((match) => match.sourceCollection === "contacts")
  if (!person) return null
  const db = await getAdminDb()
  const snapshot = await db.collection(CONTACTS_COLLECTION).doc(person.sourceId).get()
  const linkedUserId = asString((snapshot.data() as RecordValue | undefined)?.linkedUserId)
  return linkedUserId || null
}

export function createReportsTools(
  deps: {
    provider?: ReportsToolsProvider
    directoryProvider?: DirectoryDataProvider
    resolveJobsByName?: (name: string) => Promise<WhatsAppReportJob[]>
    resolveAuthorIdByName?: (name: string) => Promise<string | null>
    listJobsProvider?: () => Promise<FanOutJob[]>
  } = {},
): SecretaryTool[] {
  const provider = deps.provider ?? createServerReportsToolsProvider()
  const directoryProvider = deps.directoryProvider ?? createServerDirectoryProviderWithKeywordFallback()
  const resolveJobsByName =
    deps.resolveJobsByName ??
    ((name: string) => resolveJobByNameViaDirectory(name, directoryProvider, (candidate) => findWhatsAppReportJobsByNameCandidates([candidate])))
  const resolveAuthorId = deps.resolveAuthorIdByName ?? ((name: string) => resolveAuthorIdByName(directoryProvider, name))
  const listJobs = deps.listJobsProvider ?? listActiveJobsForFanOut

  const searchDailyReportsForJob: SecretaryTool<{ jobName: string; since?: string; until?: string; cursor?: string; limit?: number }> = {
    name: "reports_searchDailyReportsForJob",
    module: "reports",
    description:
      "List ByeByeDPR Daily Reports for one job, newest first. Supports an optional date range (`since`/`until`, ISO dates) and a `cursor` (the `nextCursor` from a previous call) to page into older reports. This is a bounded slice, not a complete day-level audit — never treat an absence here as proof a report is missing or overdue.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["jobName"],
      properties: {
        jobName: { type: "string", description: "The job's name." },
        since: { type: "string", description: "Only reports created on/after this ISO date." },
        until: { type: "string", description: "Only reports created on/before this ISO date." },
        cursor: { type: "string", description: "Opaque pagination cursor from a previous call's nextCursor." },
        limit: { type: "number", description: "Max reports to return (1-12)." },
      },
    },
    schema: z.object({
      jobName: z.string().min(1).max(160),
      since: z.string().max(40).optional(),
      until: z.string().max(40).optional(),
      cursor: z.string().max(60).optional(),
      limit: z.number().int().min(1).max(12).optional(),
    }),
    async run(args, budget): Promise<SecretaryToolResult> {
      const jobs = await resolveJobsByName(args.jobName)
      if (jobs.length === 0) return { summary: `No ByeByeDPR job matches "${args.jobName}".`, empty: true }
      if (jobs.length > 1) {
        return {
          summary: `More than one job matches "${args.jobName}". Ask which one.`,
          data: { candidates: jobs.map((job) => ({ name: job.name })) },
        }
      }

      const limit = Math.max(1, Math.min(args.limit ?? budget.maxRecordsPerTool, budget.maxRecordsPerTool, budget.remainingRecords))
      if (limit <= 0) return { summary: "The retrieval budget for this question is used up.", empty: true }

      const { reports, nextCursor } = await provider.getReportsForJob(jobs[0].id, jobs[0].name, {
        since: args.since,
        until: args.until,
        cursor: args.cursor,
        limit,
      })
      budget.remainingRecords -= reports.length
      if (reports.length === 0) return { summary: `No Daily Reports were retrieved for "${jobs[0].name}" in that range.`, empty: true }
      return { summary: `${reports.length} Daily Report(s) for "${jobs[0].name}", newest first.`, data: { reports, nextCursor } }
    },
  }

  const getRecentDailyReports: SecretaryTool<{ since?: string; limit?: number }> = {
    name: "reports_getRecentDailyReports",
    module: "reports",
    description: "List the most recent ByeByeDPR Daily Reports across all jobs, newest first. Optional `since` (ISO date) bounds how far back to look.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: [],
      properties: {
        since: { type: "string", description: "Only reports created on/after this ISO date." },
        limit: { type: "number", description: "Max reports to return (1-12)." },
      },
    },
    schema: z.object({ since: z.string().max(40).optional(), limit: z.number().int().min(1).max(12).optional() }),
    async run(args, budget): Promise<SecretaryToolResult> {
      const limit = Math.max(1, Math.min(args.limit ?? budget.maxRecordsPerTool, budget.maxRecordsPerTool, budget.remainingRecords))
      if (limit <= 0) return { summary: "The retrieval budget for this question is used up.", empty: true }
      const reports = await provider.getRecentReports({ since: args.since, limit })
      budget.remainingRecords -= reports.length
      if (reports.length === 0) return { summary: "No recent Daily Reports were retrieved.", empty: true }
      return { summary: `${reports.length} recent Daily Report(s), newest first.`, data: { reports } }
    },
  }

  const getDailyReportsByAuthor: SecretaryTool<{ personName: string; status?: ReportStatus; since?: string; until?: string; limit?: number }> = {
    name: "reports_getDailyReportsByAuthor",
    module: "reports",
    description:
      "List ByeByeDPR Daily Reports written by one identified SVC person (defaults to submitted reports), newest first. The person must be a recognized SVC user with a linked account; otherwise nothing is found.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["personName"],
      properties: {
        personName: { type: "string", description: "The report author's name." },
        status: { type: "string", enum: ["draft", "submitted"], description: "Defaults to submitted." },
        since: { type: "string", description: "Only reports created on/after this ISO date." },
        until: { type: "string", description: "Only reports created on/before this ISO date." },
        limit: { type: "number", description: "Max reports to return (1-12)." },
      },
    },
    schema: z.object({
      personName: z.string().min(1).max(160),
      status: z.enum(["draft", "submitted"]).optional(),
      since: z.string().max(40).optional(),
      until: z.string().max(40).optional(),
      limit: z.number().int().min(1).max(12).optional(),
    }),
    async run(args, budget): Promise<SecretaryToolResult> {
      const authorId = await resolveAuthorId(args.personName)
      if (!authorId) return { summary: `"${args.personName}" could not be resolved to a linked SVC user, so no reports can be looked up by author.`, empty: true }

      const limit = Math.max(1, Math.min(args.limit ?? budget.maxRecordsPerTool, budget.maxRecordsPerTool, budget.remainingRecords))
      if (limit <= 0) return { summary: "The retrieval budget for this question is used up.", empty: true }

      const reports = await provider.getReportsByAuthor(authorId, { status: args.status, since: args.since, until: args.until, limit })
      budget.remainingRecords -= reports.length
      if (reports.length === 0) return { summary: `No Daily Reports were retrieved for "${args.personName}".`, empty: true }
      return { summary: `${reports.length} Daily Report(s) by "${args.personName}".`, data: { reports } }
    },
  }

  const getJobsWithoutRecentReports: SecretaryTool<{ withinDays?: number; limit?: number }> = {
    name: "reports_getJobsWithoutRecentReports",
    module: "reports",
    description:
      "For active ByeByeDPR jobs, list each job's most recent Daily Report date, oldest/none first — for portfolio-wide questions like 'which jobs don't have a recent report'. Only includes jobs whose most recent report (if any) is older than `withinDays` (default 14), or that have none on file. This states only what was retrieved: never say a report is 'missing' or 'required' — this data has no reporting cadence to infer from, only report dates that were or weren't found.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: [],
      properties: {
        withinDays: { type: "number", description: "Only include jobs whose most recent report is older than this many days, or has none at all. Defaults to 14." },
        limit: { type: "number", description: "Max jobs to return (1-10)." },
      },
    },
    schema: z.object({
      withinDays: z.number().int().min(1).max(180).optional(),
      limit: z.number().int().min(1).max(MAX_STALE_JOBS_RETURNED).optional(),
    }),
    async run(args, budget): Promise<SecretaryToolResult> {
      const withinDays = args.withinDays ?? 14
      const limit = Math.max(1, Math.min(args.limit ?? MAX_STALE_JOBS_RETURNED, budget.maxRecordsPerTool, budget.remainingRecords))
      if (limit <= 0) return { summary: "The retrieval budget for this question is used up.", empty: true }

      const jobs = await listJobs()
      if (jobs.length === 0) return { summary: "No active ByeByeDPR jobs were found.", empty: true }

      const cutoffMs = Date.now() - withinDays * 24 * 60 * 60 * 1000
      const withDates = await Promise.all(
        jobs.map(async (job) => ({ job, mostRecentReportAt: await provider.getMostRecentReportDateForJob(job.id) })),
      )
      const stale = withDates.filter(({ mostRecentReportAt }) => !mostRecentReportAt || Date.parse(mostRecentReportAt) < cutoffMs)
      if (stale.length === 0) {
        return {
          summary: `Every one of the ${jobs.length} active job(s) checked has a Daily Report within the last ${withinDays} day(s).`,
          empty: true,
        }
      }

      const ranked: StaleJobReportSummary[] = stale
        .sort((a, b) => {
          const aTime = a.mostRecentReportAt ? Date.parse(a.mostRecentReportAt) : -Infinity
          const bTime = b.mostRecentReportAt ? Date.parse(b.mostRecentReportAt) : -Infinity
          return aTime - bTime
        })
        .slice(0, limit)
        .map(({ job, mostRecentReportAt }) => ({ jobName: job.name, mostRecentReportAt }))

      budget.remainingRecords -= ranked.length
      return {
        summary: `${ranked.length} job(s) with no Daily Report within the last ${withinDays} day(s) (out of ${jobs.length} active job(s) checked), oldest/none first.`,
        data: { jobs: ranked },
      }
    },
  }

  return [searchDailyReportsForJob, getRecentDailyReports, getDailyReportsByAuthor, getJobsWithoutRecentReports]
}
