// Matches the *-orchestrator.test.ts offline-mode convention: a fake key lets
// canCallProvider() pass with no real network call, and the actual OpenAI turn
// is replaced by a scripted fake runConversation below.
process.env.WHATSAPP_SECRETARY_AI_MODE = "live"
process.env.OPENAI_API_KEY = "test-key-not-real"

import assert from "node:assert/strict"
import test from "node:test"
import { answerWhatsAppSecretaryQuestionWithPresentation } from "../lib/whatsapp-secretary/orchestrator"
import { resolveWhatsAppAccessPolicy } from "../lib/whatsapp-access-policy"
import { createMeTools } from "../lib/whatsapp-secretary/tools/me"
import { clearSelfContextSnapshotCache, type SelfContextProvider } from "../lib/whatsapp-secretary/self-context"
import { enabledSecretaryModules, type SecretaryToolFactory } from "../lib/whatsapp-secretary/tool-registry"
import {
  buildCapabilitySignature,
  buildPrefixIntroduction,
  buildStandaloneIntroduction,
  decideIntroduction,
} from "../lib/whatsapp-secretary/onboarding"
import { addSecretaryIntroduction } from "../lib/whatsapp-response-ux"
import { getSelfContextSnapshot, selfContextActorFromIdentity } from "../lib/whatsapp-secretary/self-context"
import type { OpenAiToolCall, OpenAiToolSpec } from "../lib/ai/openai/client"

/**
 * The realistic journeys this feature is meant to deliver, end to end:
 * first contact, a returning user, capability discovery, personalized
 * examples, and a recognized employee whose SVC record is nearly empty.
 *
 * Everything below the model boundary is real — the orchestrator's registry,
 * access policy, shared budget and tool dispatch, the real `me` tools, the
 * real introduction decision/copy, and the real reply composition. Only the
 * model turn and Firestore are fixtures, so a scenario failing here is a real
 * wiring failure, not a prompt-quality question.
 */

const NOW = Date.parse("2026-08-14T12:00:00.000Z")
const TODAY = "2026-08-14"

const supervisor = { personId: "contact-ben", userId: "user-ben", name: "Ben Acosta", role: "Site Supervisor" }
/** Recognized by phone, but with almost nothing linked to them in SVC. */
const newHire = { personId: "contact-new", name: "Dana Reyes" }

function richProvider(): SelfContextProvider {
  return {
    async getDirectoryProfile() {
      return {
        profile: { phone: "+1 555 0100", email: "ben@svc.example", companyName: "SVC", location: "Miami, FL", directoryRole: "Site Supervisor" },
        jobs: [{ name: "North Ridge", relationship: "Supervisor", contextId: "ctx-north-ridge" }],
        companies: [{ name: "Turner", relationship: "Client" }],
      }
    },
    async getQuestCoralInvolvement() {
      return [{ name: "Cool Breeze Rollout", status: "in_progress", involvement: "owner", nextStep: "Draft the plan", updatedAt: "2026-08-12T10:00:00.000Z" }]
    },
    async getRecentReports() {
      return [{ jobName: "North Ridge", status: "draft", createdAt: "2026-08-14T08:00:00.000Z" }]
    },
    async getActiveClock() {
      return { jobName: "North Ridge", clockInAt: "2026-08-14T11:00:00.000Z" }
    },
    async getOutlooksForJobs(jobs) {
      return jobs.map((job) => ({ jobName: job.name, windowStart: "2026-08-10", windowEnd: "2026-08-31", taskCount: 4, activeToday: true }))
    },
    async getVisibleMessageActivity() {
      return { visibleRecentCount: 5, latestAt: "2026-08-14T09:00:00.000Z" }
    },
    async findOwnApplication() {
      return null
    },
  }
}

function bareProvider(): SelfContextProvider {
  return {
    async getDirectoryProfile() {
      return { profile: { phone: null, email: null, companyName: null, location: null, directoryRole: null }, jobs: [], companies: [] }
    },
    async getQuestCoralInvolvement() {
      return []
    },
    async getRecentReports() {
      return []
    },
    async getActiveClock() {
      return null
    },
    async getOutlooksForJobs() {
      return []
    },
    async getVisibleMessageActivity() {
      return null
    },
    async findOwnApplication() {
      return null
    },
  }
}

type FakeRunConversationInput = {
  tools: OpenAiToolSpec[]
  user: string
  onToolCalls: (calls: OpenAiToolCall[]) => Promise<Array<{ id: string; content: string }>>
}

const guard = {
  acquire: async () => ({ lease: { leaseId: "x", operation: "ask" as const, requestHash: "h", keyHash: "k", expiresAtMs: 0, remaining: 10 }, requestId: "r", userHash: "u" }),
  complete: async () => undefined,
  fail: async () => undefined,
}

function meFactory(identity: typeof supervisor | typeof newHire, provider: SelfContextProvider): SecretaryToolFactory {
  const access = resolveWhatsAppAccessPolicy(identity)
  return () => createMeTools({ actor: selfContextActorFromIdentity(identity), enabledModules: enabledSecretaryModules(access), provider, today: TODAY })
}

/** Runs one real orchestrator turn where the model calls exactly the named me_* tool. */
async function askWithTool(input: {
  identity: typeof supervisor | typeof newHire
  provider: SelfContextProvider
  question: string
  toolName: string
  answerFrom: (toolResult: { summary: string; data?: unknown }) => string
}) {
  const access = resolveWhatsAppAccessPolicy(input.identity)
  const captured: { toolResult?: { summary: string; data?: unknown } } = {}
  const runConversation = async (_config: unknown, conversation: FakeRunConversationInput) => {
    const outputs = await conversation.onToolCalls([{ id: "call-1", name: input.toolName, arguments: "{}" }])
    captured.toolResult = JSON.parse(outputs[0]!.content) as { summary: string; data?: unknown }
    return { result: { answer: input.answerFrom(captured.toolResult) }, toolRounds: 1, toolNames: [input.toolName] }
  }

  const reply = await answerWhatsAppSecretaryQuestionWithPresentation(
    { recentMessages: [{ role: "user", content: input.question }], senderIdentity: input.identity, accessPolicy: access, companyKnowledge: [] },
    { runConversation: runConversation as never, usageGuard: guard, toolFactories: { me: meFactory(input.identity, input.provider) } },
  )
  return { reply, toolResult: captured.toolResult }
}

test("the me_* tools are really registered for an identified sender, and absent for a public one", async () => {
  const capture: { tools?: OpenAiToolSpec[] } = {}
  const runConversation = async (_config: unknown, conversation: FakeRunConversationInput) => {
    capture.tools = conversation.tools
    return { result: { answer: "ok" }, toolRounds: 0, toolNames: [] }
  }

  // Real DEFAULT_TOOL_FACTORIES wiring — no `me` override — so this proves the
  // per-request actor-injecting closure in the orchestrator actually fires.
  await answerWhatsAppSecretaryQuestionWithPresentation(
    { recentMessages: [{ role: "user", content: "what do you know about me?" }], senderIdentity: supervisor, accessPolicy: resolveWhatsAppAccessPolicy(supervisor), companyKnowledge: [] },
    { runConversation: runConversation as never, usageGuard: guard },
  )
  const names = capture.tools?.map((tool) => tool.function.name) ?? []
  assert.ok(names.includes("me_getMyProfile"), names.join(", "))
  assert.ok(names.includes("me_getMySvcContext"))
  assert.ok(names.includes("me_getSecretaryGuide"))

  await answerWhatsAppSecretaryQuestionWithPresentation(
    { recentMessages: [{ role: "user", content: "what do you know about me?" }], senderIdentity: null, accessPolicy: resolveWhatsAppAccessPolicy(null), companyKnowledge: [] },
    {
      runConversation: runConversation as never,
      usageGuard: { acquire: async () => { throw new Error("must not guard a public sender") }, complete: async () => undefined, fail: async () => undefined },
    },
  )
  assert.equal(capture.tools?.length, 0)
})

test('first contact: a recognized employee is introduced with who they are and what to ask', async () => {
  clearSelfContextSnapshotCache()
  const access = resolveWhatsAppAccessPolicy(supervisor)
  const decision = decideIntroduction({
    state: null,
    signature: buildCapabilitySignature({ level: access.level, modules: enabledSecretaryModules(access), role: supervisor.role, hasLinkedAccount: true }),
    nowMs: NOW,
    hasConversationHistory: false,
  })
  assert.equal(decision.show, true)

  const snapshot = await getSelfContextSnapshot(selfContextActorFromIdentity(supervisor), { provider: richProvider(), today: TODAY, nowMs: NOW })
  const shown = decision as Extract<typeof decision, { show: true }>
  const reply = addSecretaryIntroduction({ text: "unused greeting answer" }, {
    standalone: buildStandaloneIntroduction(snapshot, shown),
    prefix: buildPrefixIntroduction(snapshot, shown),
    message: "Hi",
  })

  assert.match(reply.text, /Hi Ben — I'm the SVC AI Secretary\./)
  assert.match(reply.text, /I know you as Ben Acosta, Site Supervisor at SVC\./)
  assert.match(reply.text, /North Ridge/)
  assert.doesNotMatch(reply.text, /unused greeting answer/)
  clearSelfContextSnapshotCache()
})

test("first contact with a real request: the answer survives, with one short line of context above it", async () => {
  clearSelfContextSnapshotCache()
  const snapshot = await getSelfContextSnapshot(selfContextActorFromIdentity(supervisor), { provider: richProvider(), today: TODAY, nowMs: NOW })
  const shown = { show: true as const, reason: "first-contact" as const, newModules: [] }
  const reply = addSecretaryIntroduction({ text: "Maya Lin owns Cool Breeze Rollout." }, {
    standalone: buildStandaloneIntroduction(snapshot, shown),
    prefix: buildPrefixIntroduction(snapshot, shown),
    message: "Who owns Cool Breeze Rollout?",
  })
  assert.match(reply.text, /Maya Lin owns Cool Breeze Rollout\./)
  assert.doesNotMatch(reply.text, /Try:/, "a substantive first request gets context, not a tutorial")
  clearSelfContextSnapshotCache()
})

test("returning user: an ordinary turn gets no introduction at all", () => {
  const access = resolveWhatsAppAccessPolicy(supervisor)
  const signature = buildCapabilitySignature({ level: access.level, modules: enabledSecretaryModules(access), role: supervisor.role, hasLinkedAccount: true })
  const decision = decideIntroduction({
    state: { lastIntroAtMs: NOW - 3 * 24 * 60 * 60 * 1_000, capabilitySignature: signature },
    signature,
    nowMs: NOW,
    hasConversationHistory: true,
  })
  assert.deepEqual(decision, { show: false })
})

test('capability discovery: "what can you do?" is answered from the sender\'s real capabilities and records', async () => {
  clearSelfContextSnapshotCache()
  const { reply, toolResult } = await askWithTool({
    identity: supervisor,
    provider: richProvider(),
    question: "what can you do for me?",
    toolName: "me_getSecretaryGuide",
    answerFrom: (result) => {
      const data = result.data as { capabilities: string[]; exampleQuestions: string[]; howToUse: string[] }
      return `I can help with ${data.capabilities.length} areas. Try: ${data.exampleQuestions[0]}`
    },
  })

  const data = toolResult?.data as { capabilities: string[]; exampleQuestions: string[]; personalContext: { jobNames: string[] } }
  assert.ok(data.capabilities.some((line) => line.startsWith("SVC Directory")))
  assert.deepEqual(data.personalContext.jobNames, ["North Ridge"])
  assert.ok(data.exampleQuestions.some((example) => example.includes("North Ridge")))
  assert.match(reply.text, /Try: /)
  clearSelfContextSnapshotCache()
})

test('"what do you know about me?" answers from the profile tool, gaps included', async () => {
  clearSelfContextSnapshotCache()
  const { toolResult } = await askWithTool({
    identity: supervisor,
    provider: richProvider(),
    question: "what do you know about me?",
    toolName: "me_getMyProfile",
    answerFrom: (result) => result.summary,
  })
  const profile = (toolResult?.data as { profile: { name: string; role: string; jobs: Array<{ name: string }>; gaps: string[] } }).profile
  assert.equal(profile.name, "Ben Acosta")
  assert.equal(profile.role, "Site Supervisor")
  assert.deepEqual(profile.jobs.map((job) => job.name), ["North Ridge"])
  assert.deepEqual(profile.gaps, [])
  clearSelfContextSnapshotCache()
})

test('"what should I check today?" surfaces what is genuinely live for that person', async () => {
  clearSelfContextSnapshotCache()
  const { toolResult } = await askWithTool({
    identity: supervisor,
    provider: richProvider(),
    question: "what should I check today?",
    toolName: "me_getMySvcContext",
    answerFrom: (result) => result.summary,
  })
  const context = toolResult?.data as { context: { clock: { jobName: string } | null; reports: Array<{ status: string }>; outlooks: Array<{ activeToday: boolean }> } }
  assert.equal(context.context.clock?.jobName, "North Ridge")
  assert.equal(context.context.reports[0]?.status, "draft")
  assert.equal(context.context.outlooks[0]?.activeToday, true)
  assert.match(toolResult?.summary ?? "", /currently clocked in at North Ridge/)
  clearSelfContextSnapshotCache()
})

test("missing profile data: a recognized employee with an empty record gets honesty, not invention", async () => {
  clearSelfContextSnapshotCache()
  const { toolResult } = await askWithTool({
    identity: newHire,
    provider: bareProvider(),
    question: "what jobs am I involved with?",
    toolName: "me_getMySvcContext",
    answerFrom: (result) => result.summary,
  })
  assert.equal(toolResult?.summary.includes("No SVC records are currently linked to Dana Reyes"), true)
  const context = (toolResult?.data as { context: { jobs: unknown[]; gaps: string[] } }).context
  assert.deepEqual(context.jobs, [])
  assert.ok(context.gaps.some((gap) => gap.includes("no linked SVC app account")))
  assert.ok(context.gaps.some((gap) => gap.includes("No jobs are linked")))
  clearSelfContextSnapshotCache()
})

test("missing profile data: the guide still works, offering only capability-level examples", async () => {
  clearSelfContextSnapshotCache()
  const { toolResult } = await askWithTool({
    identity: newHire,
    provider: bareProvider(),
    question: "how can you help me?",
    toolName: "me_getSecretaryGuide",
    answerFrom: (result) => result.summary,
  })
  const data = toolResult?.data as { capabilities: string[]; exampleQuestions: string[]; personalContext: { jobNames: string[]; projectNames: string[] } }
  assert.ok(data.capabilities.length > 0)
  assert.deepEqual(data.personalContext.jobNames, [])
  assert.deepEqual(data.personalContext.projectNames, [])
  assert.ok(data.exampleQuestions.every((example) => !/North Ridge|Cool Breeze/.test(example)))
  clearSelfContextSnapshotCache()
})
