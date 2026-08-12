import assert from "node:assert/strict"
import test from "node:test"
import {
  createWhatsAppDailyReportDraftAccess,
  handleWhatsAppDailyReportDraftAction,
  isWhatsAppDailyReportDraftCancellation,
  isWhatsAppDailyReportDraftConfirmation,
  isWhatsAppDailyReportDraftRequest,
  type WhatsAppDailyReportDraftStore,
  type WhatsAppPendingDailyReportDraft,
} from "../lib/whatsapp-daily-report-drafts"
import type { WhatsAppReportsDataProvider } from "../lib/whatsapp-reports"
import type { WhatsAppSenderIdentity } from "../lib/whatsapp-svc-identity"

const identifiedSender = {
  personId: "person__sender",
  userId: "user-sender",
  name: "Sandbox Sender",
  role: "Staff",
}

const unlinkedSender = {
  personId: "person__unlinked",
  name: "Unlinked Person",
  role: "Staff",
}

function createReportProvider(): WhatsAppReportsDataProvider & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    async findJobsByNameCandidates(candidates) {
      calls.push(`jobs:${candidates.join("|")}`)
      return candidates.some((candidate) => candidate === "North Ridge") ? [{ id: "job-north-ridge", name: "North Ridge" }] : []
    },
    async getRecentReportsForJob() { throw new Error("Draft creation must not retrieve existing reports") },
    async getRecentReports() { throw new Error("Draft creation must not retrieve existing reports") },
  }
}

function createDraftStore(): WhatsAppDailyReportDraftStore & { createCalls: number; previewCalls: number; status: string | null } {
  let pending: WhatsAppPendingDailyReportDraft | null = null
  let currentStatus: string | null = null
  let createCalls = 0
  let previewCalls = 0
  return {
    get createCalls() { return createCalls },
    get previewCalls() { return previewCalls },
    get status() { return currentStatus },
    async savePreview(input) {
      previewCalls += 1
      pending = { ...input, status: "previewed" }
      currentStatus = pending.status
      return pending
    },
    async confirmPending() {
      if (!pending || pending.status === "cancelled") return { kind: "no-pending" as const }
      if (pending.status === "created") return { kind: "already-created" as const, draft: pending }
      createCalls += 1
      pending = { ...pending, status: "created" }
      currentStatus = pending.status
      return { kind: "created" as const, draft: pending }
    },
    async cancelPending() {
      if (!pending || pending.status === "cancelled") return { kind: "no-pending" as const }
      if (pending.status === "created") return { kind: "already-created" as const, draft: pending }
      pending = { ...pending, status: "cancelled" }
      currentStatus = pending.status
      return { kind: "cancelled" as const, draft: pending }
    },
  }
}

const structured = async () => ({
  mode: "live" as const,
  structuredData: {
    workCompleted: "Installed the north wall framing.",
    issuesOrDelays: "Waiting on the permit inspection.",
    nextSteps: "Finish the east wall framing.",
  },
})

function actionInput(messageId: string, content: string, identity: WhatsAppSenderIdentity | null = identifiedSender) {
  return {
    senderPhoneNumber: "5491123793882",
    messageId,
    recentMessages: [{ role: "user" as const, content }],
    identity,
  }
}

test("recognizes only explicit create, confirm, and cancel commands", () => {
  assert.equal(isWhatsAppDailyReportDraftRequest("Create a Daily Report draft for North Ridge: Work completed: Installed framing."), true)
  assert.equal(isWhatsAppDailyReportDraftRequest("What are the latest reports for North Ridge?"), false)
  assert.equal(isWhatsAppDailyReportDraftConfirmation("CONFIRM DRAFT"), true)
  assert.equal(isWhatsAppDailyReportDraftConfirmation("yes"), false)
  assert.equal(isWhatsAppDailyReportDraftCancellation("CANCEL DRAFT"), true)
})

test("requires a linked SVC user for the first WhatsApp write action", () => {
  const linked = createWhatsAppDailyReportDraftAccess(identifiedSender)
  const unlinked = createWhatsAppDailyReportDraftAccess(unlinkedSender)
  assert.equal(linked.canCreateDailyReportDraft, true)
  assert.equal(unlinked.canCreateDailyReportDraft, false)
})

test("blocks an unknown number before job lookup, structuring, or draft storage", async () => {
  const forbiddenProvider: WhatsAppReportsDataProvider = {
    async findJobsByNameCandidates() { throw new Error("Job lookup must not run for public access") },
    async getRecentReportsForJob() { throw new Error("Report lookup must not run for public access") },
    async getRecentReports() { throw new Error("Report lookup must not run for public access") },
  }
  const result = await handleWhatsAppDailyReportDraftAction(
    actionInput("message-public", "Create a Daily Report draft for North Ridge: Work completed: Installed framing.", null),
    { reportProvider: forbiddenProvider, structure: async () => { throw new Error("Structuring must not run for public access") } },
  )
  assert.ok(result)
  assert.equal(result.kind, "access-denied")
})

test("shows a preview and makes no Firebase draft write before explicit confirmation", async () => {
  const reportProvider = createReportProvider()
  const draftStore = createDraftStore()
  const result = await handleWhatsAppDailyReportDraftAction(
    actionInput("message-preview", "Create a Daily Report draft for North Ridge: Work completed: Installed the north wall framing. Issues or delays: Waiting on the permit inspection. Next steps: Finish the east wall framing."),
    { reportProvider, draftStore, structure: structured },
  )
  assert.ok(result)
  assert.equal(result.kind, "preview")
  assert.match(result.reply, /Daily Report draft preview/)
  assert.match(result.reply, /CONFIRM DRAFT/)
  assert.equal(draftStore.previewCalls, 1)
  assert.equal(draftStore.createCalls, 0)
  assert.ok(reportProvider.calls[0]?.includes("North Ridge"))
})

test("creates one draft after confirmation and makes repeated confirmations idempotent", async () => {
  const reportProvider = createReportProvider()
  const draftStore = createDraftStore()
  await handleWhatsAppDailyReportDraftAction(
    actionInput("message-create", "Create a Daily Report draft for North Ridge: Work completed: Installed the north wall framing. Issues or delays: Waiting on the permit inspection. Next steps: Finish the east wall framing."),
    { reportProvider, draftStore, structure: structured },
  )

  const firstConfirmation = await handleWhatsAppDailyReportDraftAction(
    actionInput("message-confirm-1", "CONFIRM DRAFT"),
    { reportProvider, draftStore, structure: structured },
  )
  assert.ok(firstConfirmation)
  assert.equal(firstConfirmation.kind, "created")
  assert.equal(draftStore.createCalls, 1)
  assert.equal(draftStore.status, "created")

  const repeatedConfirmation = await handleWhatsAppDailyReportDraftAction(
    actionInput("message-confirm-2", "CONFIRM DRAFT"),
    { reportProvider, draftStore, structure: structured },
  )
  assert.ok(repeatedConfirmation)
  assert.equal(repeatedConfirmation.kind, "already-created")
  assert.equal(draftStore.createCalls, 1)
})

test("cancels a preview without creating a report", async () => {
  const reportProvider = createReportProvider()
  const draftStore = createDraftStore()
  await handleWhatsAppDailyReportDraftAction(
    actionInput("message-cancel-preview", "Create a Daily Report draft for North Ridge: Work completed: Installed the north wall framing."),
    { reportProvider, draftStore, structure: structured },
  )
  const cancelled = await handleWhatsAppDailyReportDraftAction(
    actionInput("message-cancel", "CANCEL DRAFT"),
    { reportProvider, draftStore, structure: structured },
  )
  assert.ok(cancelled)
  assert.equal(cancelled.kind, "cancelled")
  assert.equal(draftStore.createCalls, 0)
  assert.equal(draftStore.status, "cancelled")
})

test("does not preview a draft when the parser finds no report details", async () => {
  const reportProvider = createReportProvider()
  const draftStore = createDraftStore()
  const result = await handleWhatsAppDailyReportDraftAction(
    actionInput("message-empty", "Create a Daily Report draft for North Ridge: hello"),
    {
      reportProvider,
      draftStore,
      structure: async () => ({ mode: "live", structuredData: { workCompleted: null, issuesOrDelays: null, nextSteps: null } }),
    },
  )
  assert.ok(result)
  assert.equal(result.kind, "needs-details")
  assert.equal(draftStore.previewCalls, 0)
})
