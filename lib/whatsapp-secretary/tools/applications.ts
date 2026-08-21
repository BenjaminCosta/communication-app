import { z } from "zod"
import type { Firestore } from "firebase-admin/firestore"
import type { DirectoryDataProvider } from "@/features/directory/ai/server/tools/types"
import { getFirebaseAdminApp } from "@/lib/ai/server/firebase-admin"
import { APPLICATION_STATUS_META, APPLICATION_STATUS_ORDER, type ApplicationStatus, type DocumentStatus, type IntroVideoState } from "@/lib/applications-core"
import { tokenize } from "@/lib/directory-core"
import { allowedPageSize, type SecretaryTool, type SecretaryToolResult } from "@/lib/whatsapp-secretary/tool-registry"
import { describeUnresolved, type EntityResolver } from "@/lib/whatsapp-secretary/entity-resolver"
import { detailCard } from "@/lib/whatsapp-secretary/response-format"
import { createServerDirectoryProviderWithKeywordFallback } from "@/lib/whatsapp-secretary/tools/directory"
import { rerankByTokenScore, scoreNameAgainstTokens, type ScoredMatch } from "@/lib/whatsapp-secretary/tools/keyword-match"
import { buildApplicationDeepLink, buildApplicationsQueueDeepLink } from "@/lib/whatsapp-secretary/guidance"

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
 *
 * Keyword-search fallback: `findCandidatesByName`'s exact/prefix path only
 * anchors on the query's first word, same limitation as Quest Coral's own
 * project search. Applications has no derived `keywords` index field either,
 * but the collection is small (confirmed single digits in production), so
 * the fallback simply fetches a capped page of every application and
 * reranks candidate names in memory with the same token-overlap logic
 * Directory and Quest Coral use (`rerankByTokenScore` in `keyword-match.ts`).
 */

const APPLICATIONS_COLLECTION = "applications"
const MAX_CANDIDATE_MATCHES = 5
const MAX_PENDING_REQUEST_CHARACTERS = 280
const REVIEW_QUEUE_STATUSES: ApplicationStatus[] = ["submitted", "ready_for_review", "needs_information"]
/** Bounded "scan every application" cap for the keyword fallback — generous
 * relative to the collection's real size, but still a hard bound, not an
 * unbounded read. */
const MAX_KEYWORD_OVERFETCH_APPLICATIONS = 200

type RecordValue = Record<string, unknown>

export interface ApplicationDocumentStatus {
  label: string
  status: DocumentStatus
  required: boolean
}

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
  /** Candidate contact info — shared the same way Directory person contact
   * info already is with internal senders (every WhatsApp sender who can
   * reach this tool is a uniquely identified internal SVC user). */
  phone: string | null
  email: string | null
  cityState: string | null
  yearsExperience: string | null
  workReference: string | null
  /** Just the file name, never the file itself/its download link. */
  resumeFileName: string | null
  videoState: IntroVideoState | null
  documents: ApplicationDocumentStatus[]
}

export interface ApplicationsToolsProvider {
  findCandidatesByName(query: string, limit: number): Promise<ApplicationSummary[]>
  getReviewQueue(limitPerStatus: number): Promise<Record<ApplicationStatus, { count: number; recent: ApplicationSummary[] }>>
  getApplicationsForJob(jobEntityId: string, options: { since?: string; until?: string; limit: number }): Promise<ApplicationSummary[]>
  /** Every application, newest-updated first — for "what applications are there" without naming a candidate/job. */
  listAllApplications(options: { status?: ApplicationStatus; limit: number }): Promise<ApplicationSummary[]>
}

/** Test seam: swap for a fixture in offline tests instead of hitting Firestore. */
export type ApplicationsKeywordSearchProvider = (tokens: string[], limit: number) => Promise<ApplicationSummary[]>

/** Keeps Firestore document ids server-side for deterministic app CTAs only. */
function toModelApplication({ id: _id, ...application }: ApplicationSummary): Omit<ApplicationSummary, "id"> {
  return application
}

function singleApplicationPresentation(applications: ApplicationSummary[]): { cta: { buttonText: string; url: string } } | undefined {
  const applicationId = applications.length === 1 ? applications[0]?.id : undefined
  return applicationId ? { cta: { buttonText: "Open Application", url: buildApplicationDeepLink(applicationId) } } : undefined
}

function titleCaseStatus(value: string): string {
  return value
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toLocaleUpperCase()}${part.slice(1)}`)
    .join(" ")
}

/**
 * A candidate's contact data stays available in `data` for a question that
 * asks for it, but is not part of the default card. That keeps an ordinary
 * "tell me about Jane" response decision-ready and not needlessly personal.
 */
function applicationDetailFormat(application: ApplicationSummary) {
  const requiredDocuments = application.documents.filter((document) => document.required)
  const missingDocuments = requiredDocuments.filter((document) => document.status === "missing")
  const readyDocuments = requiredDocuments.filter((document) => document.status === "uploaded" || document.status === "verified")
  const documentState = requiredDocuments.length > 0
    ? missingDocuments.length > 0
      ? `${missingDocuments.length} required document${missingDocuments.length === 1 ? "" : "s"} missing`
      : `${readyDocuments.length}/${requiredDocuments.length} required documents received`
    : "No required documents listed"
  const intakeItems = [
    application.resumeFileName ? "Resume uploaded" : "No resume on file",
    application.videoState ? `Intro video: ${titleCaseStatus(application.videoState)}` : null,
    documentState,
  ].filter((item): item is string => Boolean(item))

  return detailCard({
    title: application.candidateName,
    fields: [
      { label: "Status", value: APPLICATION_STATUS_META[application.status].label },
      application.trade ? { label: "Trade", value: application.trade } : null,
      application.jobName ? { label: "Job", value: application.jobName } : null,
      application.companyName ? { label: "Company", value: application.companyName } : null,
      application.jobLocation || application.cityState ? { label: "Location", value: application.jobLocation || application.cityState || "" } : null,
      application.yearsExperience ? { label: "Experience", value: `${application.yearsExperience} year${application.yearsExperience === "1" ? "" : "s"}` } : null,
    ],
    sections: [
      application.pendingRequest ? { label: "Next step", items: [application.pendingRequest] } : null,
      intakeItems.length > 0 ? { label: "Application materials", items: intakeItems } : null,
    ],
  })
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

const DOCUMENT_STATUSES: DocumentStatus[] = ["missing", "uploaded", "verified", "not_required"]
function mapDocumentStatus(value: unknown): DocumentStatus {
  return typeof value === "string" && (DOCUMENT_STATUSES as string[]).includes(value) ? (value as DocumentStatus) : "missing"
}

function mapDocuments(value: unknown): ApplicationDocumentStatus[] {
  if (!Array.isArray(value)) return []
  return value
    .map(asRecord)
    .filter((doc): doc is RecordValue => doc !== null)
    .map((doc) => ({ label: asString(doc.label), status: mapDocumentStatus(doc.status), required: doc.required !== false }))
    .filter((doc) => doc.label)
    .slice(0, 10)
}

const VIDEO_STATES: IntroVideoState[] = ["not_started", "processing", "ready"]
function mapVideoState(value: unknown): IntroVideoState | null {
  return typeof value === "string" && (VIDEO_STATES as string[]).includes(value) ? (value as IntroVideoState) : null
}

function mapApplication(data: RecordValue, id?: string): ApplicationSummary {
  const agreement = asRecord(data.agreement)
  const general = asRecord(data.general)
  const video = asRecord(data.video)
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
    phone: asString(general?.phone) || null,
    email: asString(general?.email) || null,
    cityState: asString(general?.cityState) || null,
    yearsExperience: asString(general?.yearsExperience) || null,
    workReference: asString(general?.workReference) || null,
    resumeFileName: asString(general?.resumeFileName) || null,
    videoState: mapVideoState(video?.state),
    documents: mapDocuments(data.documents),
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
    "general.phone",
    "general.email",
    "general.cityState",
    "general.yearsExperience",
    "general.workReference",
    "general.resumeFileName",
    "video.state",
    "documents",
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
    async listAllApplications(options) {
      const db = await getAdminDb()
      // (status ASC, updatedAt DESC) is already deployed and used by
      // getReviewQueue above — no new index needed for the filtered case;
      // omitting the filter drops to a single-field orderBy, also index-free.
      let query = applicationQueryFields(db.collection(APPLICATIONS_COLLECTION).orderBy("updatedAt", "desc"))
      if (options.status) {
        query = applicationQueryFields(db.collection(APPLICATIONS_COLLECTION).where("status", "==", options.status).orderBy("updatedAt", "desc"))
      }
      const snapshot = await query.limit(options.limit).get()
      return snapshot.docs.map((document) => mapApplication(document.data() as RecordValue, document.id))
    },
  }
}

function createServerApplicationsKeywordSearchProvider(): ApplicationsKeywordSearchProvider {
  return async (tokens, limit) => {
    if (tokens.length === 0) return []
    const db = await getAdminDb()
    const snapshot = await applicationQueryFields(
      db.collection(APPLICATIONS_COLLECTION).orderBy("updatedAt", "desc"),
    )
      .limit(MAX_KEYWORD_OVERFETCH_APPLICATIONS)
      .get()
    const scored: ScoredMatch<ApplicationSummary>[] = snapshot.docs.map((document) => {
      const application = mapApplication(document.data() as RecordValue, document.id)
      return { record: application, score: scoreNameAgainstTokens(application.candidateName, tokens) }
    })
    return dedupeApplications(rerankByTokenScore(scored, tokens.length, limit))
  }
}

/**
 * Wraps a real `ApplicationsToolsProvider` so `findCandidatesByName` gets a
 * second, bounded chance via in-memory keyword search whenever the
 * exact/prefix path finds nothing — every other method passes through
 * unchanged.
 */
function createHybridApplicationsProvider(
  base: ApplicationsToolsProvider,
  keywordSearch: ApplicationsKeywordSearchProvider,
): ApplicationsToolsProvider {
  return {
    ...base,
    async findCandidatesByName(query, limit) {
      const primary = await base.findCandidatesByName(query, limit)
      if (primary.length > 0) return primary
      const tokens = tokenize(query)
      if (tokens.length === 0) return primary
      return keywordSearch(tokens, limit)
    },
  }
}

/**
 * The real provider with its keyword fallback already wired — exported so the
 * shared entity resolver reuses this exact candidate-search behavior instead
 * of re-implementing it.
 */
export function createServerApplicationsProviderWithFallback(): ApplicationsToolsProvider {
  return createHybridApplicationsProvider(createServerApplicationsProvider(), createServerApplicationsKeywordSearchProvider())
}

export function createApplicationsTools(
  deps: {
    resolver?: EntityResolver
    provider?: ApplicationsToolsProvider
    directoryProvider?: DirectoryDataProvider
    keywordSearchProvider?: ApplicationsKeywordSearchProvider
  } = {},
): SecretaryTool[] {
  const baseProvider = deps.provider ?? createServerApplicationsProvider()
  const keywordSearch = deps.keywordSearchProvider ?? createServerApplicationsKeywordSearchProvider()
  const provider = createHybridApplicationsProvider(baseProvider, keywordSearch)
  const directoryProvider = deps.directoryProvider ?? createServerDirectoryProviderWithKeywordFallback()
  const resolver = deps.resolver

  /**
   * Candidate search, job-scoped history and "list everything" were three
   * tools separated only by which filter they applied. One tool with optional
   * filters covers all three — and makes the combination expressible
   * ("submitted applications for North Ridge since Monday"), which the split
   * tools could not express at all.
   */
  const search: SecretaryTool<{ query?: string; status?: ApplicationStatus; jobRef?: string; jobName?: string; since?: string; until?: string; limit?: number }> = {
    name: "applications_search",
    module: "applications",
    description:
      "Search Applications. Filter by candidate name (`query`), by `status`, by job (`jobRef` from an earlier result, or `jobName`), and by last-updated date range (`since`/`until`). Omit every filter to list every application newest-updated first. Returns each candidate's details including phone, email, city/state, experience, document and intro-video status — share those directly with internal senders. The resume/documents/video content itself is never available, only status and filename.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: [],
      properties: {
        query: { type: "string", description: "Candidate name or a close guess. Omit to list all." },
        status: { type: "string", enum: APPLICATION_STATUS_ORDER, description: "Optional status filter." },
        jobRef: { type: "string", description: "Opaque job ref from an earlier result. Preferred over jobName." },
        jobName: { type: "string", description: "Only applications linked to this job." },
        since: { type: "string", description: "Only applications updated on/after this ISO date." },
        until: { type: "string", description: "Only applications updated on/before this ISO date." },
        limit: { type: "number", description: "Max applications to return (1-12)." },
      },
    },
    schema: z.object({
      query: z.string().min(1).max(160).optional(),
      status: z.enum(APPLICATION_STATUS_ORDER as [ApplicationStatus, ...ApplicationStatus[]]).optional(),
      jobRef: z.string().max(20).optional(),
      jobName: z.string().min(1).max(160).optional(),
      since: z.string().max(40).optional(),
      until: z.string().max(40).optional(),
      limit: z.number().int().min(1).max(12).optional(),
    }),
    async run(args, budget): Promise<SecretaryToolResult> {
      const limit = allowedPageSize(budget, args.limit, 12)
      if (limit <= 0) return { summary: "The retrieval budget for this question is used up.", empty: true }

      let jobEntityId: string | undefined
      let jobLabel = ""
      if (args.jobRef || args.jobName) {
        if (resolver) {
          const resolution = await resolver.resolveArg({ ref: args.jobRef, name: args.jobName }, "job")
          if (resolution.status !== "found") return describeUnresolved(resolution, "job", args.jobName ?? args.jobRef ?? "")
          jobEntityId = resolution.entity.sourceIds.directoryId
          jobLabel = resolution.entity.name
        } else {
          const jobMatches = await directoryProvider.findByName(args.jobName as string, { type: "job", limit: 5 })
          if (jobMatches.length === 0) return { summary: `No job matches "${args.jobName}".`, empty: true }
          if (jobMatches.length > 1) {
            return {
              summary: `More than one job matches "${args.jobName}". Ask which one.`,
              data: { candidates: jobMatches.map((job) => ({ name: job.name, location: job.location })) },
            }
          }
          jobEntityId = jobMatches[0].id
          jobLabel = jobMatches[0].name
        }
      }

      let matches: ApplicationSummary[]
      if (args.query) {
        matches = await provider.findCandidatesByName(args.query, Math.max(limit, MAX_CANDIDATE_MATCHES))
      } else if (jobEntityId) {
        matches = await provider.getApplicationsForJob(jobEntityId, { since: args.since, until: args.until, limit })
      } else {
        matches = await provider.listAllApplications({ status: args.status, limit })
      }

      // Filters the chosen query path could not express server-side are
      // applied in memory over its bounded page, the same "bounded slice,
      // refine in memory" pattern the other modules already use.
      if (args.status) matches = matches.filter((application) => application.status === args.status)
      if (jobEntityId && args.query) matches = matches.filter((application) => application.jobName === jobLabel)

      if (matches.length === 0) {
        return { summary: `No applications were retrieved${jobLabel ? ` for "${jobLabel}"` : ""}.`, empty: true }
      }
      const page = matches.slice(0, limit)
      budget.remainingRecords -= page.length
      return {
        summary: `${page.length} application(s)${jobLabel ? ` for "${jobLabel}"` : ""}${args.query ? " matched" : ""}.`,
        data: { applications: page.map(toModelApplication) },
        ...(page.length === 1 ? { responseFormat: applicationDetailFormat(page[0]!) } : {}),
        ...(matches.length > page.length ? { truncated: true, totalMatched: matches.length } : {}),
        presentation: singleApplicationPresentation(page),
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
        presentation: { cta: { buttonText: "Open Review Queue", url: buildApplicationsQueueDeepLink("ready_for_review") } },
      }
    },
  }

  return [search, getReviewQueue]
}
