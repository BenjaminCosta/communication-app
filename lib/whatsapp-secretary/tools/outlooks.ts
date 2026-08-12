import { z } from "zod"
import type { Firestore } from "firebase-admin/firestore"
import { createServerDirectoryProvider } from "@/features/directory/ai/server/tools/provider"
import type { DirectoryDataProvider } from "@/features/directory/ai/server/tools/types"
import { getFirebaseAdminApp } from "@/lib/ai/server/firebase-admin"
import { buildOutlookDeepLink } from "@/lib/whatsapp-secretary/guidance"
import type { SecretaryTool, SecretaryToolResult } from "@/lib/whatsapp-secretary/tool-registry"

/**
 * 3-Week Outlook tool for the WhatsApp Secretary orchestrator — per-job reads
 * only, as scoped by the plan. Outlooks are stored per-job
 * (`contexts/{jobId}/outlooks/{windowStart}`, a normal single-collection
 * read), so no new index is needed. Cross-job listing ("which jobs have an
 * outlook this week") is explicitly out of scope for this phase — it would
 * need a new `collectionGroup("outlooks")` composite index, which needs its
 * own explicit deploy approval later; `guidance.ts` points that kind of
 * question at the web app instead. There is no Outlooks query/search
 * capability anywhere else in the repo to reuse — this is a new, bounded
 * Admin SDK reader.
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

function toModelOutlook({ deepLink: _deepLink, ...outlook }: OutlookSummary): Omit<OutlookSummary, "deepLink"> {
  return outlook
}

export interface OutlooksToolsProvider {
  getOutlookForJob(jobId: string, windowStart?: string): Promise<{ windowStart: string; windowEnd: string; tasks: OutlookTaskSummary[] } | null>
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
  }
}

export function createOutlooksTools(
  deps: { provider?: OutlooksToolsProvider; directoryProvider?: DirectoryDataProvider } = {},
): SecretaryTool[] {
  const provider = deps.provider ?? createServerOutlooksToolsProvider()
  const directoryProvider = deps.directoryProvider ?? createServerDirectoryProvider()

  const getOutlookForJob: SecretaryTool<{ jobName: string; windowStart?: string }> = {
    name: "outlooks_getOutlookForJob",
    module: "outlooks",
    description:
      "Get one job's 3-Week Outlook (scheduled tasks: trade, company, dates, status, completion). Without `windowStart`, returns the most recent week. Only works per-job — there is no cross-job Outlook listing available yet.",
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

  return [getOutlookForJob]
}
