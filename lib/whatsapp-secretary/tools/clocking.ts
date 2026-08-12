import { z } from "zod"
import type { Firestore, Timestamp } from "firebase-admin/firestore"
import { getFirebaseAdminApp } from "@/lib/ai/server/firebase-admin"
import { findWhatsAppReportJobsByNameCandidates, type WhatsAppReportJob } from "@/lib/whatsapp-reports"
import type { SecretaryTool, SecretaryToolResult } from "@/lib/whatsapp-secretary/tool-registry"

/**
 * ByeByeDPR clock-in/out history tool for the WhatsApp Secretary orchestrator.
 *
 * Genuinely new capability — no prior WhatsApp reader touched `clockRecords`
 * at all. Built on the already-deployed-but-unused
 * `clockRecords(jobId ASC, clockInAt DESC)` composite index, so no new index
 * is needed; a date range on `clockInAt` (the same field the index sorts on)
 * needs nothing extra either. Job-name resolution reuses
 * `findWhatsAppReportJobsByNameCandidates` (ByeByeDPR's own `jobs`
 * collection), matching `lib/whatsapp-secretary/tools/reports.ts`. Per the
 * project's privacy posture, the compact result reports only *whether* a
 * location was recorded for a clock-in/out, never the raw coordinates.
 */

const CLOCK_RECORDS_COLLECTION = "clockRecords"
const USERS_COLLECTION = "users"
const MAX_HISTORY_ITEMS = 12

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

export interface ClockingToolsProvider {
  getClockHistoryForJob(
    jobId: string,
    options: { since?: string; until?: string; limit: number },
  ): Promise<ClockHistoryEntry[]>
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
  }
}

export function createClockingTools(
  deps: { provider?: ClockingToolsProvider; resolveJobsByName?: (name: string) => Promise<WhatsAppReportJob[]> } = {},
): SecretaryTool[] {
  const provider = deps.provider ?? createServerClockingToolsProvider()
  const resolveJobsByName = deps.resolveJobsByName ?? ((name: string) => findWhatsAppReportJobsByNameCandidates([name]))

  const getClockHistoryForJob: SecretaryTool<{ jobName: string; since?: string; until?: string; limit?: number }> = {
    name: "clocking_getClockHistoryForJob",
    module: "clocking",
    description:
      "List clock-in/out history for one ByeByeDPR job, newest first — who clocked in/out, when, and how long. Supports an optional date range (`since`/`until`, ISO dates). Never returns exact GPS coordinates, only whether a location was recorded.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["jobName"],
      properties: {
        jobName: { type: "string", description: "The job's name." },
        since: { type: "string", description: "Only clock-ins on/after this ISO date." },
        until: { type: "string", description: "Only clock-ins on/before this ISO date." },
        limit: { type: "number", description: "Max clock records to return (1-12)." },
      },
    },
    schema: z.object({
      jobName: z.string().min(1).max(160),
      since: z.string().max(40).optional(),
      until: z.string().max(40).optional(),
      limit: z.number().int().min(1).max(MAX_HISTORY_ITEMS).optional(),
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

      const history = await provider.getClockHistoryForJob(jobs[0].id, { since: args.since, until: args.until, limit })
      budget.remainingRecords -= history.length
      if (history.length === 0) return { summary: `No clock history was retrieved for "${jobs[0].name}" in that range.`, empty: true }
      return { summary: `${history.length} clock record(s) for "${jobs[0].name}", newest first.`, data: { history } }
    },
  }

  return [getClockHistoryForJob]
}
