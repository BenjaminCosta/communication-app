import type { Firestore } from "firebase-admin/firestore"
import { getFirebaseAdminApp } from "@/lib/ai/server/firebase-admin"
import type { WhatsAppSecretaryConversationMessage } from "@/lib/whatsapp-secretary/types"

// Keep these collection names aligned with lib/bye-bye-dpr-store.ts. The
// reader below selects structured report fields only: it never reads report
// attachments, raw message references, Communications Messages, or writes.
//
// This file now only owns job-name resolution — used by the WhatsApp Daily
// Report draft action (`lib/whatsapp-daily-report-drafts.ts`) and by the
// Secretary's `reports_*`/`clocking_*` tools
// (`lib/whatsapp-secretary/tools/reports.ts`). The old fixed-slice report
// listing/context-building (`retrieveWhatsAppReportsContext`) was replaced by
// the orchestrator's bounded, date-range-capable report tools.
const JOBS_COLLECTION = "jobs"
const REPORTS_COLLECTION = "reports"
const MAX_JOB_NAME_CANDIDATES = 5
const MAX_JOB_MATCHES = 3
const MAX_RECENT_REPORTS = 4
const MAX_REPORT_SECTION_CHARACTERS = 440

type RecordValue = Record<string, unknown>

export type WhatsAppReportJob = {
  id: string
  name: string
}

export type WhatsAppReportRecord = {
  jobId: string
  jobName: string
  status: "draft" | "submitted"
  createdAt: string | null
  submittedAt: string | null
  workCompleted: string | null
  issuesOrDelays: string | null
  nextSteps: string | null
}

/** Test seam and narrow contract for all ByeByeDPR report reads used by WhatsApp. */
export type WhatsAppReportsDataProvider = {
  findJobsByNameCandidates(candidates: string[]): Promise<WhatsAppReportJob[]>
  getRecentReportsForJob(jobId: string, limit: number): Promise<WhatsAppReportRecord[]>
  getRecentReports(limit: number): Promise<WhatsAppReportRecord[]>
}

function asRecord(value: unknown): RecordValue | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as RecordValue) : null
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function toIso(value: unknown): string | null {
  if (value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function") {
    const date = value.toDate()
    if (date instanceof Date && !Number.isNaN(date.getTime())) return date.toISOString()
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString()
  return typeof value === "string" && value ? value : null
}

function compactSection(value: unknown): string | null {
  const result = asString(value)
  return result ? result.slice(0, MAX_REPORT_SECTION_CHARACTERS) : null
}

function mapReport(data: RecordValue, jobName = ""): WhatsAppReportRecord {
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

function titleCaseFirstWord(value: string): string {
  return value.replace(/^\p{L}/u, (letter) => letter.toLocaleUpperCase())
}

function dedupeJobs(jobs: WhatsAppReportJob[]): WhatsAppReportJob[] {
  const unique = new Map<string, WhatsAppReportJob>()
  for (const job of jobs) unique.set(job.id, job)
  return [...unique.values()]
}

/** Extracts a visibly named job for a report lookup, never a jobs collection scan. */
export function extractWhatsAppReportJobNameCandidates(messages: WhatsAppSecretaryConversationMessage[]): string[] {
  const candidates: string[] = []
  const seen = new Set<string>()
  const add = (value: string) => {
    const cleaned = value
      .replace(/^[\s"'“”`]+|[\s"'“”`?.!,;:]+$/g, "")
      .replace(/\b(?:daily\s+)?reports?$/i, "")
      .replace(/\b(?:please|right now|currently|today)\b$/i, "")
      .replace(/^the\s+/i, "")
      .replace(/\s+/g, " ")
      .trim()
    const normalized = cleaned.toLocaleLowerCase()
    if (
      cleaned.length < 3 ||
      cleaned.length > 140 ||
      /^(?:report|reports|daily report|it|this|that|latest|recent|missing)$/i.test(cleaned) ||
      /^(?:what|which|who|how|when|where)\b/i.test(cleaned) ||
      seen.has(normalized)
    ) return
    seen.add(normalized)
    candidates.push(cleaned)
  }

  const userMessages = messages.filter((message) => message.role === "user").slice(-5).reverse()
  for (const message of userMessages) {
    const text = message.content.slice(0, 500)
    for (const match of text.matchAll(/["“]([^"”]{3,140})["”]/g)) add(match[1])
    for (const match of text.matchAll(/\b(?:daily\s+)?reports?(?:\s+draft)?\s+(?:status\s+)?(?:for|of|from|on|about)\s+([^?!.,;:]+)/gi)) add(match[1])
    for (const match of text.matchAll(/\b(?:daily\s+)?reports?\s+(?:are\s+)?missing\s+(?:for|on|at)\s+([^?!.,;:]+)/gi)) add(match[1])
    for (const match of text.matchAll(/\bmissing\s+(?:daily\s+)?reports?\s+(?:for|on|at)\s+([^?!.,;:]+)/gi)) add(match[1])
    for (const match of text.matchAll(/\b(?:work completed|issues(?:\s+or\s+delays)?|next steps?)\s+(?:for|on|at)\s+([^?!.,;:]+)/gi)) add(match[1])
    if (candidates.length >= MAX_JOB_NAME_CANDIDATES) break
  }
  return candidates.slice(0, MAX_JOB_NAME_CANDIDATES)
}

async function getAdminDb(): Promise<Firestore> {
  const { getFirestore } = await import("firebase-admin/firestore")
  return getFirestore(await getFirebaseAdminApp())
}

function reportQueryFields<T extends { select: (...fieldPaths: string[]) => T }>(query: T): T {
  return query.select(
    "jobId",
    "type",
    "status",
    "structuredData.workCompleted",
    "structuredData.issuesOrDelays",
    "structuredData.nextSteps",
    "createdAt",
    "submittedAt",
  )
}

async function attachJobNames(db: Firestore, reports: WhatsAppReportRecord[]): Promise<WhatsAppReportRecord[]> {
  const jobIds = [...new Set(reports.map((report) => report.jobId).filter(Boolean))].slice(0, MAX_RECENT_REPORTS)
  const snapshots = jobIds.length > 0
    ? await db.getAll(...jobIds.map((jobId) => db.collection(JOBS_COLLECTION).doc(jobId)))
    : []
  const names = new Map(snapshots.filter((snapshot) => snapshot.exists).map((snapshot) => [snapshot.id, asString((snapshot.data() as RecordValue | undefined)?.name)]))
  return reports.map((report) => ({ ...report, jobName: names.get(report.jobId) || "Unnamed job" }))
}

function createServerReportsProvider(): WhatsAppReportsDataProvider {
  return {
    async findJobsByNameCandidates(candidates) {
      const db = await getAdminDb()
      const found: WhatsAppReportJob[] = []
      for (const candidate of candidates.slice(0, MAX_JOB_NAME_CANDIDATES)) {
        const exact = await db.collection(JOBS_COLLECTION).where("name", "==", candidate).select("name").limit(MAX_JOB_MATCHES).get()
        const exactJobs = exact.docs
          .map((document) => ({ id: document.id, name: asString((document.data() as RecordValue).name) }))
          .filter((job) => job.name)
        if (exactJobs.length > 0) {
          found.push(...exactJobs)
          continue
        }

        const firstWord = candidate.split(/\s+/, 1)[0]
        if (firstWord.length < 3) continue
        const prefix = titleCaseFirstWord(firstWord)
        const snapshot = await db.collection(JOBS_COLLECTION)
          .where("name", ">=", prefix)
          .where("name", "<", `${prefix}\uf8ff`)
          .select("name")
          .limit(MAX_JOB_MATCHES)
          .get()
        const normalizedCandidate = candidate.toLocaleLowerCase()
        found.push(
          ...snapshot.docs
            .map((document) => ({ id: document.id, name: asString((document.data() as RecordValue).name) }))
            .filter((job) => {
              const normalizedName = job.name.toLocaleLowerCase()
              return normalizedName === normalizedCandidate || normalizedName.startsWith(normalizedCandidate) || normalizedCandidate.startsWith(normalizedName)
            }),
        )
      }
      return dedupeJobs(found).slice(0, MAX_JOB_MATCHES)
    },
    async getRecentReportsForJob(jobId, requestedLimit) {
      const db = await getAdminDb()
      const snapshot = await reportQueryFields(
        db.collection(REPORTS_COLLECTION)
          .where("jobId", "==", jobId)
          .where("type", "==", "daily_report")
          .orderBy("createdAt", "desc")
          .limit(Math.min(Math.max(requestedLimit, 1), MAX_RECENT_REPORTS)),
      ).get()
      return snapshot.docs.map((document) => mapReport(document.data() as RecordValue))
    },
    async getRecentReports(requestedLimit) {
      const db = await getAdminDb()
      const snapshot = await reportQueryFields(
        db.collection(REPORTS_COLLECTION)
          .orderBy("createdAt", "desc")
          .limit(Math.min(Math.max(requestedLimit, 1), MAX_RECENT_REPORTS)),
      ).get()
      return attachJobNames(db, snapshot.docs.map((document) => mapReport(document.data() as RecordValue)))
    },
  }
}

/**
 * Shared, bounded job resolver for the report read path and the confirmed
 * WhatsApp draft action. Callers must enforce their access policy before
 * invoking it; this helper deliberately does not broaden that policy.
 */
export async function findWhatsAppReportJobsByNameCandidates(
  candidates: string[],
  deps: { provider?: WhatsAppReportsDataProvider } = {},
): Promise<WhatsAppReportJob[]> {
  const provider = deps.provider ?? createServerReportsProvider()
  return provider.findJobsByNameCandidates(candidates)
}

