import { z } from "zod"
import type { Firestore } from "firebase-admin/firestore"
import { createServerDirectoryProvider } from "@/features/directory/ai/server/tools/provider"
import type { DirectoryDataProvider } from "@/features/directory/ai/server/tools/types"
import { getFirebaseAdminApp } from "@/lib/ai/server/firebase-admin"
import { APPLICATION_STATUS_META, type ApplicationStatus } from "@/lib/applications-core"
import type { SecretaryTool, SecretaryToolResult } from "@/lib/whatsapp-secretary/tool-registry"

/**
 * Applications tools for the WhatsApp Secretary orchestrator.
 *
 * Ported from `lib/whatsapp-applications.ts` (deleted): candidate-name
 * resolution now takes a single model-supplied argument instead of regex
 * candidate extraction, and the review queue fix from the old file's known
 * gap lands here too — `needs_information` now gets a real listing, not just
 * a count, since the same `status+updatedAt` composite index already
 * supports it. `getApplicationsForJob` is new: it uses the
 * `entityIds CONTAINS, updatedAt DESC` composite index (already deployed,
 * previously unused by any query) to list a job's application history —
 * ordered/ranged on `updatedAt`, the same field the index sorts on, so no new
 * index is needed. There is no Applications AI module to reuse (none exists
 * in this repo) — this file is a direct, bounded Firestore reader.
 */

const APPLICATIONS_COLLECTION = "applications"
const MAX_CANDIDATE_MATCHES = 5
const MAX_PENDING_REQUEST_CHARACTERS = 280
const REVIEW_QUEUE_STATUSES: ApplicationStatus[] = ["submitted", "ready_for_review", "needs_information"]

type RecordValue = Record<string, unknown>

export interface ApplicationSummary {
  /** Kept server-side until the response UX builds a direct, authenticated SVC link. */
  id?: string
  candidateName: string
  trade: string
  jobName: string
  jobLocation: string
  companyName: string
  status: ApplicationStatus
  agreementStatus: string | null
  pendingRequest: string | null
  submittedAt: string | null
  updatedAt: string | null
}

export interface ApplicationsToolsProvider {
  findCandidatesByName(query: string, limit: number): Promise<ApplicationSummary[]>
  getReviewQueue(limitPerStatus: number): Promise<Record<ApplicationStatus, { count: number; recent: ApplicationSummary[] }>>
  getApplicationsForJob(jobEntityId: string, options: { since?: string; until?: string; limit: number }): Promise<ApplicationSummary[]>
}

/** Keeps Firestore document ids server-side for deterministic app CTAs only. */
function toModelApplication({ id: _id, ...application }: ApplicationSummary): Omit<ApplicationSummary, "id"> {
  return application
}

function singleApplicationPresentation(applications: ApplicationSummary[]): { applicationId: string } | undefined {
  const applicationId = applications.length === 1 ? applications[0]?.id : undefined
  return applicationId ? { applicationId } : undefined
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

function mapStatus(value: unknown): ApplicationStatus {
  return typeof value === "string" && value in APPLICATION_STATUS_META ? (value as ApplicationStatus) : "draft"
}

function mapApplication(data: RecordValue, id?: string): ApplicationSummary {
  const agreement = asRecord(data.agreement)
  const pendingRequest = asString(data.pendingRequest)
  return {
    ...(id ? { id } : {}),
    candidateName: asString(data.candidateName),
    trade: asString(data.trade),
    jobName: asString(data.jobName),
    jobLocation: asString(data.jobLocation),
    companyName: asString(data.companyName),
    status: mapStatus(data.status),
    agreementStatus: asString(agreement?.status) || null,
    pendingRequest: pendingRequest ? pendingRequest.slice(0, MAX_PENDING_REQUEST_CHARACTERS) : null,
    submittedAt: toIso(data.submittedAt),
    updatedAt: toIso(data.updatedAt),
  }
}

/** Highest Unicode code point — bounds a Firestore "starts with" prefix range query. */
const PREFIX_UPPER_BOUND = String.fromCharCode(0xf8ff)

function titleCaseFirstWord(value: string): string {
  return value.replace(/^\p{L}/u, (letter) => letter.toLocaleUpperCase())
}

function dedupeApplications(records: ApplicationSummary[]): ApplicationSummary[] {
  const unique = new Map<string, ApplicationSummary>()
  for (const record of records) {
    unique.set([record.candidateName, record.jobName, record.updatedAt, record.status].join(" "), record)
  }
  return [...unique.values()]
}

async function getAdminDb(): Promise<Firestore> {
  const { getFirestore } = await import("firebase-admin/firestore")
  return getFirestore(await getFirebaseAdminApp())
}

function applicationQueryFields<T extends { select: (...fieldPaths: string[]) => T }>(query: T): T {
  return query.select(
    "candidateName",
    "trade",
    "jobName",
    "jobLocation",
    "companyName",
    "status",
    "agreement.status",
    "pendingRequest",
    "submittedAt",
    "updatedAt",
  )
}

function createServerApplicationsProvider(): ApplicationsToolsProvider {
  return {
    async findCandidatesByName(query, limit) {
      const db = await getAdminDb()
      const exact = await applicationQueryFields(
        db.collection(APPLICATIONS_COLLECTION).where("candidateName", "==", query).limit(limit),
      ).get()
      const exactRecords = exact.docs.map((document) => mapApplication(document.data() as RecordValue, document.id)).filter((record) => record.candidateName)
      if (exactRecords.length > 0) return exactRecords

      const firstWord = query.split(/\s+/, 1)[0]
      if (firstWord.length < 3) return []
      const prefix = titleCaseFirstWord(firstWord)
      const snapshot = await applicationQueryFields(
        db.collection(APPLICATIONS_COLLECTION)
          .where("candidateName", ">=", prefix)
          .where("candidateName", "<", `${prefix}${PREFIX_UPPER_BOUND}`)
          .limit(limit),
      ).get()
      const normalizedQuery = query.toLocaleLowerCase()
      return dedupeApplications(
        snapshot.docs
          .map((document) => mapApplication(document.data() as RecordValue, document.id))
          .filter((record) => {
            const normalizedName = record.candidateName.toLocaleLowerCase()
            return normalizedName === normalizedQuery || normalizedName.startsWith(normalizedQuery) || normalizedQuery.startsWith(normalizedName)
          }),
      )
    },
    async getReviewQueue(limitPerStatus) {
      const db = await getAdminDb()
      const applications = db.collection(APPLICATIONS_COLLECTION)
      const entries = await Promise.all(
        REVIEW_QUEUE_STATUSES.map(async (status) => {
          const [count, recent] = await Promise.all([
            applications.where("status", "==", status).count().get(),
            applicationQueryFields(applications.where("status", "==", status).orderBy("updatedAt", "desc").limit(limitPerStatus)).get(),
          ])
          return [status, { count: count.data().count, recent: recent.docs.map((document) => mapApplication(document.data() as RecordValue, document.id)) }] as const
        }),
      )
      return Object.fromEntries(entries) as Record<ApplicationStatus, { count: number; recent: ApplicationSummary[] }>
    },
    async getApplicationsForJob(jobEntityId, options) {
      const db = await getAdminDb()
      let query = applicationQueryFields(
        db.collection(APPLICATIONS_COLLECTION).where("entityIds", "array-contains", jobEntityId).orderBy("updatedAt", "desc"),
      )
      if (options.until) query = query.where("updatedAt", "<=", new Date(options.until))
      if (options.since) query = query.where("updatedAt", ">=", new Date(options.since))
      const snapshot = await query.limit(options.limit).get()
      return snapshot.docs.map((document) => mapApplication(document.data() as RecordValue, document.id))
    },
  }
}

export function createApplicationsTools(
  deps: { provider?: ApplicationsToolsProvider; directoryProvider?: DirectoryDataProvider } = {},
): SecretaryTool[] {
  const provider = deps.provider ?? createServerApplicationsProvider()
  const directoryProvider = deps.directoryProvider ?? createServerDirectoryProvider()

  const searchCandidates: SecretaryTool<{ query: string; limit?: number }> = {
    name: "applications_searchCandidates",
    module: "applications",
    description: "Search Applications by candidate name. Returns compact matching applications (status, job, trade, agreement status).",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: {
        query: { type: "string", description: "Candidate name or a close guess at it." },
        limit: { type: "number", description: "Max applications to return (1-5)." },
      },
    },
    schema: z.object({ query: z.string().min(1).max(160), limit: z.number().int().min(1).max(MAX_CANDIDATE_MATCHES).optional() }),
    async run(args): Promise<SecretaryToolResult> {
      const matches = await provider.findCandidatesByName(args.query, args.limit ?? MAX_CANDIDATE_MATCHES)
      if (matches.length === 0) return { summary: "No matching application was found for that candidate name.", empty: true }
      return {
        summary: `${matches.length} application(s) matched.`,
        data: { applications: matches.map(toModelApplication) },
        presentation: singleApplicationPresentation(matches),
      }
    },
  }

  const getReviewQueue: SecretaryTool<{ limitPerStatus?: number }> = {
    name: "applications_getReviewQueue",
    module: "applications",
    description:
      "Get the Applications review queue: counts and a compact recent listing for each of Submitted, Ready for review, and Needs information.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: [],
      properties: { limitPerStatus: { type: "number", description: "Max applications listed per status (1-8)." } },
    },
    schema: z.object({ limitPerStatus: z.number().int().min(1).max(8).optional() }),
    async run(args, budget): Promise<SecretaryToolResult> {
      const limitPerStatus = Math.max(1, Math.min(args.limitPerStatus ?? 4, budget.maxRecordsPerTool))
      const queue = await provider.getReviewQueue(limitPerStatus)
      const totalListed = REVIEW_QUEUE_STATUSES.reduce((total, status) => total + queue[status].recent.length, 0)
      budget.remainingRecords -= totalListed
      return {
        summary: "Applications review queue counts and recent examples per status.",
        data: {
          submitted: { ...queue.submitted, recent: queue.submitted.recent.map(toModelApplication) },
          readyForReview: { ...queue.ready_for_review, recent: queue.ready_for_review.recent.map(toModelApplication) },
          needsInformation: { ...queue.needs_information, recent: queue.needs_information.recent.map(toModelApplication) },
        },
      }
    },
  }

  const getApplicationsForJob: SecretaryTool<{ jobName: string; since?: string; until?: string; limit?: number }> = {
    name: "applications_getApplicationsForJob",
    module: "applications",
    description: "List Applications linked to one job, newest-activity first. Supports an optional date range (`since`/`until`, ISO dates) on last-updated time.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["jobName"],
      properties: {
        jobName: { type: "string", description: "The job's name." },
        since: { type: "string", description: "Only applications updated on/after this ISO date." },
        until: { type: "string", description: "Only applications updated on/before this ISO date." },
        limit: { type: "number", description: "Max applications to return (1-12)." },
      },
    },
    schema: z.object({
      jobName: z.string().min(1).max(160),
      since: z.string().max(40).optional(),
      until: z.string().max(40).optional(),
      limit: z.number().int().min(1).max(12).optional(),
    }),
    async run(args, budget): Promise<SecretaryToolResult> {
      const jobMatches = await directoryProvider.findByName(args.jobName, { type: "job", limit: 5 })
      if (jobMatches.length === 0) return { summary: `No job matches "${args.jobName}".`, empty: true }
      if (jobMatches.length > 1) {
        return {
          summary: `More than one job matches "${args.jobName}". Ask which one.`,
          data: { candidates: jobMatches.map((job) => ({ name: job.name, location: job.location })) },
        }
      }

      const limit = Math.max(1, Math.min(args.limit ?? budget.maxRecordsPerTool, budget.maxRecordsPerTool, budget.remainingRecords))
      if (limit <= 0) return { summary: "The retrieval budget for this question is used up.", empty: true }

      const applications = await provider.getApplicationsForJob(jobMatches[0].id, { since: args.since, until: args.until, limit })
      budget.remainingRecords -= applications.length
      if (applications.length === 0) return { summary: `No applications were retrieved for "${jobMatches[0].name}".`, empty: true }
      return {
        summary: `${applications.length} application(s) for "${jobMatches[0].name}".`,
        data: { applications: applications.map(toModelApplication) },
        presentation: singleApplicationPresentation(applications),
      }
    },
  }

  return [searchCandidates, getReviewQueue, getApplicationsForJob]
}
