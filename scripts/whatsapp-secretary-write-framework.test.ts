import assert from "node:assert/strict"
import test from "node:test"
import { z } from "zod"
import {
  assertWriteToolContract,
  isWriteTool,
  type SecretaryTool,
  type SecretaryToolBudget,
  type WriteCommitContext,
} from "../lib/whatsapp-secretary/tool-registry"
import {
  PENDING_WRITE_TTL_MS,
  formatPendingWriteReply,
  isPendingWriteExpired,
  matchesCancelPhrase,
  matchesConfirmPhrase,
  resolvePendingWrite,
  type PendingWriteEnvelope,
} from "../lib/whatsapp-secretary/pending-writes"
import { createReportWriteTools } from "../lib/whatsapp-secretary/tools/report-writes"
import type { WhatsAppDailyReportDraftStore } from "../lib/whatsapp-daily-report-drafts"
import { directoryRecord, fixtureResolver } from "./secretary-test-resolver"

const NOW = Date.parse("2026-08-15T12:00:00.000Z")

function budget(): SecretaryToolBudget {
  return { maxRecordsPerTool: 15, maxNotesPerTool: 5, maxNoteChars: 400, remainingRecords: 60 }
}

function envelope(overrides: Partial<PendingWriteEnvelope> = {}): PendingWriteEnvelope {
  return {
    toolName: "reports_createDailyReportDraft",
    args: { jobName: "North Ridge", reportText: "Framed the north wall." },
    summary: "Daily Report draft for North Ridge",
    confirmPhrase: "CONFIRM DRAFT",
    cancelPhrase: "CANCEL DRAFT",
    requestMessageId: "wamid.request",
    createdAtMs: NOW - 1_000,
    ...overrides,
  }
}

const commitContext: WriteCommitContext = {
  senderPhoneNumber: "15550000000",
  actorUserId: "user-ben",
  actorPersonId: "contact-ben",
  requestMessageId: "wamid.request",
  confirmationMessageId: "wamid.confirm",
}

function writeTool(commit: SecretaryTool["commit"]): Map<string, SecretaryTool> {
  const tool: SecretaryTool = {
    name: "reports_createDailyReportDraft",
    module: "reports",
    kind: "write",
    description: "test",
    parameters: { type: "object", additionalProperties: false, required: [], properties: {} },
    schema: z.object({}).passthrough(),
    async run() {
      return { summary: "preview" }
    },
    commit,
  }
  return new Map([[tool.name, tool]])
}

// --- The confirmation contract ------------------------------------------

test("only the exact phrase confirms — a bare yes never does", () => {
  const pending = envelope()
  assert.equal(matchesConfirmPhrase("CONFIRM DRAFT", pending), true)
  assert.equal(matchesConfirmPhrase("confirm draft", pending), true)
  assert.equal(matchesConfirmPhrase("  Confirm Draft. ", pending), true)

  for (const almost of ["yes", "yep", "ok", "go ahead", "confirm", "draft", "confirm the draft", "please confirm draft now"]) {
    assert.equal(matchesConfirmPhrase(almost, pending), false, `"${almost}" must not confirm`)
  }
  assert.equal(matchesCancelPhrase("CANCEL DRAFT", pending), true)
  assert.equal(matchesCancelPhrase("cancel", pending), false)
})

test("an unrelated message leaves the preview pending and falls through to the normal flow", async () => {
  const outcome = await resolvePendingWrite({
    text: "actually, who is on North Ridge today?",
    envelope: envelope(),
    tools: writeTool(async () => {
      throw new Error("commit must not run for an unrelated message")
    }),
    context: commitContext,
    nowMs: NOW,
  })
  assert.deepEqual(outcome, { kind: "none" })
})

test("no pending preview means nothing to resolve", async () => {
  const outcome = await resolvePendingWrite({ text: "CONFIRM DRAFT", envelope: null, tools: new Map(), context: commitContext, nowMs: NOW })
  assert.deepEqual(outcome, { kind: "none" })
})

test("cancelling never reaches commit", async () => {
  const outcome = await resolvePendingWrite({
    text: "CANCEL DRAFT",
    envelope: envelope(),
    tools: writeTool(async () => {
      throw new Error("commit must not run on cancel")
    }),
    context: commitContext,
    nowMs: NOW,
  })
  assert.equal(outcome.kind, "cancelled")
})

test("a stale preview expires instead of committing", async () => {
  const stale = envelope({ createdAtMs: NOW - PENDING_WRITE_TTL_MS })
  assert.equal(isPendingWriteExpired(stale, NOW), true)

  const outcome = await resolvePendingWrite({
    text: "CONFIRM DRAFT",
    envelope: stale,
    tools: writeTool(async () => {
      throw new Error("commit must not run on an expired preview")
    }),
    context: commitContext,
    nowMs: NOW,
  })
  assert.equal(outcome.kind, "expired")
})

test("a confirmation for a tool the sender can no longer reach fails closed", async () => {
  const outcome = await resolvePendingWrite({ text: "CONFIRM DRAFT", envelope: envelope(), tools: new Map(), context: commitContext, nowMs: NOW })
  assert.equal(outcome.kind, "unavailable")
  assert.match(outcome.kind === "unavailable" ? outcome.reply : "", /nothing was created/)
})

test("commit receives the ORIGINAL request message id, not the confirmation's", async () => {
  const seen: WriteCommitContext[] = []
  await resolvePendingWrite({
    text: "CONFIRM DRAFT",
    envelope: envelope({ requestMessageId: "wamid.original" }),
    tools: writeTool(async (_args, context) => {
      seen.push(context)
      return { kind: "created", reply: "done" }
    }),
    context: { ...commitContext, requestMessageId: "wamid.WRONG" },
    nowMs: NOW,
  })
  // The deterministic report id is derived from this, so taking it from the
  // confirmation message would break idempotency across a Meta retry.
  assert.equal(seen[0]?.requestMessageId, "wamid.original")
  assert.equal(seen[0]?.confirmationMessageId, "wamid.confirm")
})

test("the preview reply always states the exact confirmation contract, exactly once", () => {
  const appended = formatPendingWriteReply(envelope())
  assert.match(appended, /CONFIRM DRAFT to create it/)
  assert.match(appended, /CANCEL DRAFT to discard/)

  // A tool whose own preview already states the contract must not have it
  // appended again — on a phone that reads as a stutter.
  const selfStating = formatPendingWriteReply(
    envelope({ summary: "Daily Report draft preview\nReply exactly CONFIRM DRAFT to create it, or CANCEL DRAFT to discard this preview." }),
  )
  assert.equal(selfStating.match(/CONFIRM DRAFT/g)?.length, 1)
})

// --- The registry-level structural guarantee -----------------------------

test("a write tool without commit, or a read tool with one, is rejected at registry build", () => {
  const base = {
    module: "reports" as const,
    description: "x",
    parameters: { type: "object", additionalProperties: false, required: [], properties: {} },
    schema: z.object({}),
    async run() {
      return { summary: "x" }
    },
  }
  assert.throws(() => assertWriteToolContract([{ ...base, name: "reports_bad", kind: "write" }]), /must implement commit/)
  assert.throws(
    () => assertWriteToolContract([{ ...base, name: "reports_alsoBad", commit: async () => ({ kind: "created" as const, reply: "" }) }]),
    /must not implement commit/,
  )
  assert.doesNotThrow(() => assertWriteToolContract([{ ...base, name: "reports_fine" }]))
})

// --- The Daily Report write tool ----------------------------------------

const jobFixture = {
  jobs: [directoryRecord({ name: "North Ridge", type: "job", sourceId: "ctx-nr", id: "job__nr" })],
  linkedJobs: { "ctx-nr": { id: "job-nr", name: "North Ridge" } },
}

function draftTool(deps: { store?: WhatsAppDailyReportDraftStore; structure?: never } = {}) {
  const tools = createReportWriteTools({
    resolver: fixtureResolver(jobFixture),
    actorUserId: "user-ben",
    actorPersonId: "contact-ben",
    senderPhoneNumber: "15550000000",
    requestMessageId: "wamid.request",
    structure: async ({ rawText }) => ({ structuredData: { workCompleted: rawText, issuesOrDelays: null, nextSteps: null } as never }),
    ...deps,
  })
  return tools[0]
}

test("the draft tool is withheld entirely from a sender with no linked SVC account", () => {
  assert.deepEqual(createReportWriteTools({ actorUserId: undefined, actorPersonId: "contact-ben", senderPhoneNumber: "1", requestMessageId: "m" }), [])
  assert.deepEqual(createReportWriteTools({}), [])
})

test("the draft tool is declared a write and carries a commit", () => {
  const tool = draftTool()
  assert.equal(tool.name, "reports_createDailyReportDraft")
  assert.equal(isWriteTool(tool), true)
  assert.equal(typeof tool.commit, "function")
  assert.doesNotThrow(() => assertWriteToolContract([tool]))
})

test("run() previews only — it never touches the store", async () => {
  const store: WhatsAppDailyReportDraftStore = {
    async savePreview() {
      throw new Error("run() must not write")
    },
    async confirmPending() {
      throw new Error("run() must not write")
    },
    async cancelPending() {
      throw new Error("run() must not write")
    },
  }
  const result = await draftTool({ store }).run({ jobName: "North Ridge", reportText: "Framed the north wall." }, budget())

  assert.match(result.summary, /NOT created yet/)
  const data = result.data as { requiresConfirmation: boolean; confirmPhrase: string }
  assert.equal(data.requiresConfirmation, true)
  assert.equal(data.confirmPhrase, "CONFIRM DRAFT")

  const pending = (result.presentation as { pendingWrite: PendingWriteEnvelope }).pendingWrite
  assert.equal(pending.toolName, "reports_createDailyReportDraft")
  assert.equal(pending.confirmPhrase, "CONFIRM DRAFT")
  assert.equal(pending.requestMessageId, "wamid.request")
})

test("run() refuses to preview a job it cannot resolve, and never guesses", async () => {
  const tool = createReportWriteTools({
    resolver: fixtureResolver({ jobs: [] }),
    actorUserId: "user-ben",
    actorPersonId: "contact-ben",
    senderPhoneNumber: "15550000000",
    requestMessageId: "wamid.request",
    structure: async () => ({ structuredData: {} as never }),
  })[0]
  const result = await tool.run({ jobName: "Nowhere", reportText: "Did some work." }, budget())
  assert.equal(result.empty, true)
  assert.match(result.summary, /No job matches "Nowhere"/)
})

test("run() asks for detail rather than previewing an empty report", async () => {
  const tool = createReportWriteTools({
    resolver: fixtureResolver(jobFixture),
    actorUserId: "user-ben",
    actorPersonId: "contact-ben",
    senderPhoneNumber: "15550000000",
    requestMessageId: "wamid.request",
    structure: async () => ({ structuredData: { workCompleted: null, issuesOrDelays: null, nextSteps: null } as never }),
  })[0]
  const result = await tool.run({ jobName: "North Ridge", reportText: "hi" }, budget())
  assert.equal(result.empty, true)
  assert.match(result.summary, /doesn't contain enough report detail/)
  assert.equal(result.presentation, undefined, "no envelope, so nothing can be confirmed")
})

test("commit() goes through the proven store transaction and reports idempotently", async () => {
  const calls: string[] = []
  let created = false
  const store: WhatsAppDailyReportDraftStore = {
    async savePreview(input) {
      calls.push("savePreview")
      return { ...input, status: "previewed" }
    },
    async confirmPending() {
      calls.push("confirmPending")
      const draft = {
        status: created ? ("created" as const) : ("previewed" as const),
        actionKey: "k",
        reportId: "r",
        actorUserId: "user-ben",
        actorPersonId: "contact-ben",
        job: { id: "job-nr", name: "North Ridge" },
        rawText: "Framed the north wall.",
        structuredData: {} as never,
      }
      if (created) return { kind: "already-created", draft }
      created = true
      return { kind: "created", draft }
    },
    async cancelPending() {
      return { kind: "no-pending" }
    },
  }

  const tool = draftTool({ store })
  const first = await tool.commit!({ jobId: "job-nr", jobName: "North Ridge", reportText: "Framed the north wall." }, commitContext)
  assert.equal(first.kind, "created")
  assert.match(first.reply, /stays a draft/)

  const second = await tool.commit!({ jobId: "job-nr", jobName: "North Ridge", reportText: "Framed the north wall." }, commitContext)
  assert.equal(second.kind, "already-created")
  assert.match(second.reply, /didn't create another one/)
  assert.deepEqual(calls, ["savePreview", "confirmPending", "savePreview", "confirmPending"])
})

test("commit() writes against the job that was previewed, never a re-resolved one", async () => {
  let resolvedAtCommit = false
  const tool = createReportWriteTools({
    resolver: fixtureResolver(jobFixture),
    actorUserId: "user-ben",
    actorPersonId: "contact-ben",
    senderPhoneNumber: "15550000000",
    requestMessageId: "wamid.request",
    structure: async ({ rawText }) => ({ structuredData: { workCompleted: rawText } as never }),
    resolveJobsByName: async () => {
      resolvedAtCommit = true
      return [{ id: "job-DIFFERENT", name: "Some Other Job" }]
    },
    store: {
      async savePreview(input) {
        assert.equal(input.job.id, "job-nr", "the previewed job is what gets written")
        return { ...input, status: "previewed" }
      },
      async confirmPending() {
        return {
          kind: "created",
          draft: {
            status: "created",
            actionKey: "k",
            reportId: "r",
            actorUserId: "user-ben",
            actorPersonId: "contact-ben",
            job: { id: "job-nr", name: "North Ridge" },
            rawText: "x",
            structuredData: {} as never,
          },
        }
      },
      async cancelPending() {
        return { kind: "no-pending" }
      },
    },
  })[0]

  const result = await tool.commit!({ jobId: "job-nr", jobName: "North Ridge", reportText: "Framed the north wall." }, commitContext)
  assert.equal(result.kind, "created")
  assert.equal(resolvedAtCommit, false, "commit must not re-resolve the job name")
})

test("an envelope with no resolved job cannot be committed", async () => {
  const result = await draftTool().commit!({ jobName: "North Ridge", reportText: "Framed it." }, commitContext)
  assert.equal(result.kind, "failed")
  assert.match(result.reply, /nothing was created/)
})
