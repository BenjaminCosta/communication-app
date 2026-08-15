import { z } from "zod"
import type { Firestore, Timestamp } from "firebase-admin/firestore"
import type { DirectoryDataProvider } from "@/features/directory/ai/server/tools/types"
import { getFirebaseAdminApp } from "@/lib/ai/server/firebase-admin"
import { findWhatsAppReportJobsByNameCandidates, type WhatsAppReportJob } from "@/lib/whatsapp-reports"
import { allowedPageSize, type SecretaryTool, type SecretaryToolResult } from "@/lib/whatsapp-secretary/tool-registry"
import { describeUnresolved, type EntityResolver } from "@/lib/whatsapp-secretary/entity-resolver"
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
/** Matches the bucket name `lib/bye-bye-dpr-server.ts` already signs report PDF URLs against. */
const STORAGE_BUCKET = "svc-comms.firebasestorage.app"

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
  /** Only used server-side to build a WhatsApp attachment (see `buildReportAttachments`) — stripped by `toModelReport` before the model ever sees it. */
  pdfStoragePath: string | null
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
    pdfStoragePath: asString(data.pdfStoragePath) || null,
  }
}

/**
 * Strips the internal-only `pdfStoragePath` before a report reaches the
 * model, replacing it with a plain `hasPdf` boolean — enough for the model to
 * say "I'm sending the PDF" instead of declining, without ever seeing the
 * path or a URL it could leak, invent, or mis-type. The deterministic
 * response-ux layer (`attachmentsFromExecutions`) decides whether to
 * actually attach it, using `presentation.attachments` from
 * `buildReportAttachments` below, not this field.
 */
function toModelReport({ pdfStoragePath, ...report }: DailyReportSummary): Omit<DailyReportSummary, "pdfStoragePath"> & { hasPdf: boolean } {
  return { ...report, hasPdf: Boolean(pdfStoragePath) }
}

type ReportAttachment = { kind: "document"; url: string; filename: string; caption: string }

/** Mints a signed, directly-fetchable URL for one report PDF, or `null` if signing fails. Injectable so tests never touch real Storage. */
export interface ReportPdfSigner {
  sign(pdfStoragePath: string): Promise<string | null>
}

function createServerReportPdfSigner(): ReportPdfSigner {
  return {
    async sign(pdfStoragePath) {
      try {
        const { getStorage } = await import("firebase-admin/storage")
        const bucket = getStorage(await getFirebaseAdminApp()).bucket(STORAGE_BUCKET)
        const [url] = await bucket.file(pdfStoragePath).getSignedUrl({ action: "read", expires: "01-01-2500" })
        return url
      } catch {
        return null
      }
    },
  }
}

/**
 * Mints a long-lived signed URL for each report that actually has a
 * generated PDF (only submitted reports do), so the deterministic
 * `whatsapp-response-ux.ts` layer can attach it as a real WhatsApp document
 * message when the user's question asks for the file — the model itself
 * never sees this path or URL. Best-effort per report: one failed signing
 * call is dropped, never blocks the others or the answer already computed.
 */
async function buildReportAttachments(reports: DailyReportSummary[], signer: ReportPdfSigner): Promise<ReportAttachment[]> {
  const withPaths = reports.filter((report) => report.pdfStoragePath)
  if (withPaths.length === 0) return []

  const signed = await Promise.all(
    withPaths.map(async (report): Promise<ReportAttachment | null> => {
      const url = await signer.sign(report.pdfStoragePath as string)
      if (!url) return null
      const dateLabel = (report.submittedAt ?? report.createdAt)?.slice(0, 10)
      return {
        kind: "document",
        url,
        filename: `Daily Report - ${report.jobName}${dateLabel ? ` - ${dateLabel}` : ""}.pdf`,
        caption: `Daily Report — ${report.jobName}${dateLabel ? ` (${dateLabel})` : ""}`,
      }
    }),
  )
  return signed.filter((entry): entry is ReportAttachment => entry !== null)
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
  return query.select("jobId", "authorId", "type", "status", "structuredData.workCompleted", "structuredData.issuesOrDelays", "structuredData.nextSteps", "createdAt", "submittedAt", "pdfStoragePath")
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
    resolver?: EntityResolver
    provider?: ReportsToolsProvider
    directoryProvider?: DirectoryDataProvider
    resolveJobsByName?: (name: string) => Promise<WhatsAppReportJob[]>
    resolveAuthorIdByName?: (name: string) => Promise<string | null>
    listJobsProvider?: () => Promise<FanOutJob[]>
    pdfSigner?: ReportPdfSigner
  } = {},
): SecretaryTool[] {
  const provider = deps.provider ?? createServerReportsToolsProvider()
  const directoryProvider = deps.directoryProvider ?? createServerDirectoryProviderWithKeywordFallback()
  const resolver = deps.resolver
  const resolveJobsByName =
    deps.resolveJobsByName ??
    ((name: string) => resolveJobByNameViaDirectory(name, directoryProvider, (candidate) => findWhatsAppReportJobsByNameCandidates([candidate])))
  const resolveAuthorId = deps.resolveAuthorIdByName ?? ((name: string) => resolveAuthorIdByName(directoryProvider, name))
  const pdfSigner = deps.pdfSigner ?? createServerReportPdfSigner()
  const listJobs = deps.listJobsProvider ?? listActiveJobsForFanOut

  /**
   * Per-job, per-author and portfolio-wide report reads were three tools that
   * differed only in which filter they applied to the same query. They are one
   * tool with optional filters now — which also means a question that combines
   * them ("Courtney's reports on North Ridge since Monday") is expressible,
   * where before the model had to pick one filter and drop the other.
   */
  const search: SecretaryTool<{ jobRef?: string; jobName?: string; authorName?: string; status?: ReportStatus; since?: string; until?: string; cursor?: string; limit?: number }> = {
    name: "reports_search",
    module: "reports",
    description:
      "Search ByeByeDPR Daily Reports, newest first. Filter by job (`jobRef` from an earlier result, or `jobName`), by author (`authorName` — must be a recognized SVC user with a linked account), by `status`, and by date range (`since`/`until`, ISO dates). Omit every filter for the most recent reports across all jobs. Page into older reports with `cursor` from a previous call's `nextCursor`. Results are a bounded slice, not a day-level audit — a `truncated` flag tells you when more exist; never treat an absence here as proof a report is missing or overdue.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: [],
      properties: {
        jobRef: { type: "string", description: "Opaque job ref from an earlier result. Preferred over jobName." },
        jobName: { type: "string", description: "The job's name." },
        authorName: { type: "string", description: "The report author's name." },
        status: { type: "string", enum: ["draft", "submitted"], description: "Defaults to all when searching a job, submitted when searching by author." },
        since: { type: "string", description: "Only reports created on/after this ISO date." },
        until: { type: "string", description: "Only reports created on/before this ISO date." },
        cursor: { type: "string", description: "Opaque pagination cursor from a previous call's nextCursor." },
        limit: { type: "number", description: "Max reports to return (1-12)." },
      },
    },
    schema: z.object({
      jobRef: z.string().max(20).optional(),
      jobName: z.string().min(1).max(160).optional(),
      authorName: z.string().min(1).max(160).optional(),
      status: z.enum(["draft", "submitted"]).optional(),
      since: z.string().max(40).optional(),
      until: z.string().max(40).optional(),
      cursor: z.string().max(60).optional(),
      limit: z.number().int().min(1).max(12).optional(),
    }),
    async run(args, budget): Promise<SecretaryToolResult> {
      const limit = allowedPageSize(budget, args.limit, 12)
      if (limit <= 0) return { summary: "The retrieval budget for this question is used up.", empty: true }

      let job: { id: string; name: string } | null = null
      if (args.jobRef || args.jobName) {
        if (resolver) {
          const resolution = await resolver.resolveArg({ ref: args.jobRef, name: args.jobName }, "job")
          if (resolution.status !== "found") return describeUnresolved(resolution, "job", args.jobName ?? args.jobRef ?? "")
          const jobId = resolution.entity.sourceIds.byeByeDprJobId
          if (!jobId) return { summary: `"${resolution.entity.name}" has no linked ByeByeDPR job, so it has no Daily Reports.`, empty: true }
          job = { id: jobId, name: resolution.entity.name }
        } else {
          const jobs = await resolveJobsByName(args.jobName as string)
          if (jobs.length === 0) return { summary: `No ByeByeDPR job matches "${args.jobName}".`, empty: true }
          if (jobs.length > 1) {
            return { summary: `More than one job matches "${args.jobName}". Ask which one.`, data: { candidates: jobs.map((entry) => ({ name: entry.name })) } }
          }
          job = jobs[0]
        }
      }

      let authorId: string | null = null
      if (args.authorName) {
        authorId = await resolveAuthorId(args.authorName)
        if (!authorId) {
          return { summary: `"${args.authorName}" could not be resolved to a linked SVC user, so no reports can be looked up by author.`, empty: true }
        }
      }

      // Author filtering runs on its own composite index, so an author query
      // takes that path and narrows to the job in memory when both are given.
      let reports: DailyReportSummary[]
      let nextCursor: string | null = null
      if (authorId) {
        const byAuthor = await provider.getReportsByAuthor(authorId, { status: args.status, since: args.since, until: args.until, limit: limit + (job ? 8 : 0) })
        reports = job ? byAuthor.filter((report) => report.jobId === job.id).slice(0, limit) : byAuthor.slice(0, limit)
      } else if (job) {
        const page = await provider.getReportsForJob(job.id, job.name, { since: args.since, until: args.until, cursor: args.cursor, limit })
        reports = args.status ? page.reports.filter((report) => report.status === args.status) : page.reports
        nextCursor = page.nextCursor
      } else {
        const recent = await provider.getRecentReports({ since: args.since, limit })
        reports = args.status ? recent.filter((report) => report.status === args.status) : recent
      }

      budget.remainingRecords -= reports.length
      const scope = job ? ` for "${job.name}"` : args.authorName ? ` by "${args.authorName}"` : ""
      if (reports.length === 0) return { summary: `No Daily Reports were retrieved${scope}.`, empty: true }

      const attachments = await buildReportAttachments(reports, pdfSigner)
      return {
        summary: `${reports.length} Daily Report(s)${scope}, newest first.`,
        data: { reports: reports.map(toModelReport) },
        ...(nextCursor ? { nextCursor, truncated: true } : {}),
        ...(reports.length === limit && !nextCursor ? { truncated: true } : {}),
        ...(attachments.length > 0 ? { presentation: { attachments } } : {}),
      }
    },
  }

  const getJobsWithoutRecentReports: SecretaryTool<{ withinDays?: number; limit?: number }> = {
    name: "reports_getCoverageGaps",
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

  return [search, getJobsWithoutRecentReports]
}
