import { z } from "zod"
import { structureDailyReportDraft } from "@/features/bye-bye-dpr/ai/server/daily-report-structuring-service"
import type { DailyReportStructuredData } from "@/lib/bye-bye-dpr-core"
import {
  actionKey as buildActionKey,
  createServerDraftStore,
  formatPreview,
  hasReportContent,
  reportIdForAction,
  senderHash,
  type WhatsAppDailyReportDraftStore,
} from "@/lib/whatsapp-daily-report-drafts"
import { findWhatsAppReportJobsByNameCandidates, type WhatsAppReportJob } from "@/lib/whatsapp-reports"
import { describeUnresolved, type EntityResolver } from "@/lib/whatsapp-secretary/entity-resolver"
import type { SecretaryTool, SecretaryToolResult, WriteCommitContext, WriteCommitResult } from "@/lib/whatsapp-secretary/tool-registry"

/**
 * The ByeByeDPR Daily Report draft — the system's only write — as a real tool.
 *
 * It was previously a regex branch that ran *ahead* of the orchestrator: the
 * inbound message had to literally match "create a daily report draft for…",
 * the job name was pulled out with another regex, and because the whole thing
 * happened before the tool loop the model could never combine it with a read.
 * Asking "prepare a report for the job Courtney was on yesterday" was
 * structurally impossible.
 *
 * As a write tool it resolves the job through the same shared resolver every
 * read tool uses, so all of that composes. **None of the safety properties
 * moved**:
 *
 * - `run()` is a pure preview. It touches no Firestore collection at all —
 *   not even the pending-action record — so a model that calls it
 *   speculatively, repeatedly, or with bad arguments cannot create anything.
 * - The confirmation is an exact phrase (`CONFIRM DRAFT`), matched
 *   deterministically outside the model. A bare "yes" still does not satisfy
 *   it, and the model has no way to self-confirm.
 * - `commit()` delegates to the **existing, unmodified** store transaction
 *   (`savePreview` → `confirmPending` in `lib/whatsapp-daily-report-drafts.ts`),
 *   keyed by the same `sha256(sender)` document and the same deterministic
 *   `actionKey`/`reportId` derived from the original request message. So the
 *   `/reports` document written is byte-identical to what the legacy path
 *   wrote, a repeat confirmation still returns "already created" instead of
 *   duplicating, and any preview left pending by the legacy path is still
 *   honored by this one.
 *
 * The report's text is deliberately structured from the sender's **own words**
 * by the existing ByeByeDPR parser rather than from fields the model composed.
 * A Daily Report is a record of what a person said happened on a job; letting
 * the model paraphrase it into `workCompleted`/`issuesOrDelays` would quietly
 * change whose account it is.
 */

const CONFIRM_PHRASE = "CONFIRM DRAFT"
const CANCEL_PHRASE = "CANCEL DRAFT"
const MAX_REPORT_TEXT_CHARACTERS = 4_000

export interface DailyReportWriteArgs {
  jobRef?: string
  jobName?: string
  reportText: string
  /**
   * The resolved ByeByeDPR job id, written into the envelope by `run()` after
   * it resolved the job the sender was actually shown.
   *
   * Deliberately absent from both the JSON schema and the Zod schema, so the
   * model can neither supply nor influence it — and so `commit()` writes
   * against *the job in the preview*, not against whatever a name would
   * re-resolve to hours later. Re-resolving at commit time would be both an
   * extra round-trip and a real drift risk: the record created must be the
   * record that was confirmed.
   */
  jobId?: string
}

export interface DailyReportDraftDeps {
  resolver?: EntityResolver
  store?: WhatsAppDailyReportDraftStore
  /** Test seam for the ByeByeDPR structuring service. */
  structure?: (input: { rawText: string }) => Promise<{ structuredData: DailyReportStructuredData }>
  /** Test seam for the legacy ByeByeDPR-only job fallback. */
  resolveJobsByName?: (name: string) => Promise<WhatsAppReportJob[]>
  /** Server-resolved. A draft needs a real author, so this gates the tool entirely. */
  actorUserId?: string
  actorPersonId?: string
  senderPhoneNumber?: string
  /** The inbound message this turn — seeds the deterministic action/report ids. */
  requestMessageId?: string
}

async function resolveJob(
  args: DailyReportWriteArgs,
  deps: DailyReportDraftDeps,
): Promise<{ job: WhatsAppReportJob } | { failure: SecretaryToolResult }> {
  if (deps.resolver && (args.jobRef || args.jobName)) {
    const resolution = await deps.resolver.resolveArg({ ref: args.jobRef, name: args.jobName }, "job")
    if (resolution.status !== "found") {
      return { failure: describeUnresolved(resolution, "job", args.jobName ?? args.jobRef ?? "") }
    }
    const jobId = resolution.entity.sourceIds.byeByeDprJobId
    if (!jobId) {
      return { failure: { summary: `"${resolution.entity.name}" has no linked ByeByeDPR job, so a Daily Report can't be created for it.`, empty: true } }
    }
    return { job: { id: jobId, name: resolution.entity.name } }
  }

  if (!args.jobName) return { failure: { summary: "A job name is required to prepare a Daily Report draft.", empty: true } }
  const fallback = deps.resolveJobsByName ?? ((name: string) => findWhatsAppReportJobsByNameCandidates([name]))
  const jobs = await fallback(args.jobName)
  if (jobs.length === 0) return { failure: { summary: `No ByeByeDPR job matches "${args.jobName}".`, empty: true } }
  if (jobs.length > 1) {
    return {
      failure: {
        summary: `More than one job matches "${args.jobName}". Ask which one.`,
        data: { candidates: jobs.map((job) => ({ name: job.name })) },
      },
    }
  }
  return { job: jobs[0] }
}

export function createReportWriteTools(deps: DailyReportDraftDeps = {}): SecretaryTool[] {
  // Without a linked SVC account there is no valid author, so the capability
  // is withheld entirely rather than failing at confirmation time.
  if (!deps.actorUserId || !deps.actorPersonId || !deps.senderPhoneNumber || !deps.requestMessageId) return []

  const store = deps.store ?? createServerDraftStore()
  const structure = deps.structure ?? ((input: { rawText: string }) => structureDailyReportDraft(input.rawText))

  const createDailyReportDraft: SecretaryTool<DailyReportWriteArgs> = {
    name: "reports_createDailyReportDraft",
    module: "reports",
    kind: "write",
    description:
      "Prepare a ByeByeDPR Daily Report DRAFT for one job. This only builds a preview — nothing is created until the sender replies with the exact phrase CONFIRM DRAFT, which happens outside your control, so never claim a report was created and never try to confirm it yourself. Pass the sender's own description of the work verbatim as `reportText`; do not paraphrase, summarize, or invent report content, because the draft records what they said happened. The draft always stays a draft — submitting it happens in the SVC app.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["reportText"],
      properties: {
        jobRef: { type: "string", description: "Opaque job ref from an earlier result. Preferred over jobName." },
        jobName: { type: "string", description: "The job's name." },
        reportText: { type: "string", description: "The sender's own words describing the work, issues and next steps. Verbatim — never your paraphrase." },
      },
    },
    schema: z.object({
      jobRef: z.string().max(20).optional(),
      jobName: z.string().min(1).max(160).optional(),
      reportText: z.string().min(1).max(MAX_REPORT_TEXT_CHARACTERS),
    }),

    /** Pure preview — reads only, writes nothing, not even the pending record. */
    async run(args): Promise<SecretaryToolResult> {
      const resolved = await resolveJob(args, deps)
      if ("failure" in resolved) return resolved.failure

      const structured = await structure({ rawText: args.reportText })
      if (!hasReportContent(structured.structuredData)) {
        return {
          summary: "That message doesn't contain enough report detail yet — ask for work completed, any issues or delays, and next steps.",
          empty: true,
        }
      }

      const key = buildActionKey(deps.senderPhoneNumber as string, deps.requestMessageId as string)
      const preview = formatPreview({
        status: "previewed",
        actionKey: key,
        reportId: reportIdForAction(key),
        actorUserId: deps.actorUserId as string,
        actorPersonId: deps.actorPersonId as string,
        job: resolved.job,
        rawText: args.reportText,
        structuredData: structured.structuredData,
      })

      return {
        summary: `Prepared a Daily Report draft preview for "${resolved.job.name}". It is NOT created yet — the sender must reply ${CONFIRM_PHRASE}.`,
        data: { jobName: resolved.job.name, structuredData: structured.structuredData, requiresConfirmation: true, confirmPhrase: CONFIRM_PHRASE },
        // Server-only: the model never sees this, and the deterministic layer
        // is what persists it and states the confirmation contract.
        presentation: {
          pendingWrite: {
            toolName: "reports_createDailyReportDraft",
            // Server-built: the resolved job, never the model's raw name/ref.
            args: { jobId: resolved.job.id, jobName: resolved.job.name, reportText: args.reportText },
            summary: preview,
            confirmPhrase: CONFIRM_PHRASE,
            cancelPhrase: CANCEL_PHRASE,
            requestMessageId: deps.requestMessageId,
            createdAtMs: Date.now(),
          },
        },
      }
    },

    /**
     * The only write. Reuses the legacy store's two transactions unchanged, so
     * the `/reports` document, its `idempotencyKey`, and the repeat-confirmation
     * behavior are all exactly what they were before this became a tool.
     */
    async commit(args, context: WriteCommitContext): Promise<WriteCommitResult> {
      // The envelope always carries the job `run()` resolved and previewed.
      // Anything else means a hand-built or corrupted envelope, not a
      // confirmable preview.
      if (!args.jobId || !args.jobName) {
        return { kind: "failed", reply: "That preview is no longer valid, so nothing was created." }
      }
      const resolved = { job: { id: args.jobId, name: args.jobName } }

      const structured = await structure({ rawText: args.reportText })
      if (!hasReportContent(structured.structuredData)) {
        return { kind: "failed", reply: "That draft no longer has enough detail to create, so nothing was created." }
      }

      const key = buildActionKey(context.senderPhoneNumber, context.requestMessageId)
      const hash = senderHash(context.senderPhoneNumber)
      await store.savePreview({
        senderHash: hash,
        status: "previewed",
        actionKey: key,
        reportId: reportIdForAction(key),
        actorUserId: context.actorUserId,
        actorPersonId: context.actorPersonId,
        job: resolved.job,
        rawText: args.reportText,
        structuredData: structured.structuredData,
      })

      const outcome = await store.confirmPending({ senderHash: hash, confirmationMessageId: context.confirmationMessageId })
      if (outcome.kind === "created") {
        return { kind: "created", reply: `Created the Daily Report draft for ${outcome.draft.job.name}. It stays a draft — submit it in the SVC app when you're ready.` }
      }
      if (outcome.kind === "already-created") {
        return { kind: "already-created", reply: `That Daily Report draft for ${outcome.draft.job.name} was already created — I didn't create another one.` }
      }
      return { kind: "failed", reply: "There was no pending draft to create." }
    },
  }

  return [createDailyReportDraft]
}
