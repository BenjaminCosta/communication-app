// Matches the *-orchestrator.test.ts offline-mode convention: a fake key
// lets canCallProvider() pass with no real network call, and the actual
// OpenAI turn is replaced by a scripted fake runConversation below.
process.env.WHATSAPP_SECRETARY_AI_MODE = "live"
process.env.OPENAI_API_KEY = "test-key-not-real"

import assert from "node:assert/strict"
import test from "node:test"
import { z } from "zod"
import { answerWhatsAppSecretaryQuestion } from "../lib/whatsapp-secretary/orchestrator"
import { resolveWhatsAppAccessPolicy } from "../lib/whatsapp-access-policy"
import { createFixtureProvider as createDirectoryFixtureProvider } from "./directory-fixture"
import { createMessagesTools, type HumanMessageSummary, type MessagesToolsProvider, type OperationalMessageSummary } from "../lib/whatsapp-secretary/tools/messages"
import type { SecretaryModule, SecretaryTool, SecretaryToolFactory } from "../lib/whatsapp-secretary/tool-registry"
import type { OpenAiToolCall, OpenAiToolSpec } from "../lib/ai/openai/client"

/**
 * End-to-end scenario coverage for the Messages read layer, run through the
 * real orchestrator's tool-calling loop (registry + access policy + shared
 * budget + concurrent dispatch) with a scripted fake model and a fixture
 * `MessagesToolsProvider` — never a real OpenAI or Firestore call. Mirrors
 * `whatsapp-secretary-orchestrator.test.ts`'s pattern; the tool-level
 * filtering/actor-scoping logic itself is covered in depth by
 * `whatsapp-secretary-messages-tools.test.ts` — this file is about proving
 * it's actually wired into a real multi-round conversation correctly.
 */

const identifiedIdentity = { personId: "person__sender", userId: "user-sender", name: "Sandbox Sender", role: "Staff" }
/** Identified by contact match only — no linked Firebase user id. */
const unlinkedIdentity = { personId: "person__unlinked", name: "Unlinked Contact", role: "Staff" }

function makeOperationalPost(overrides: Partial<OperationalMessageSummary> = {}): OperationalMessageSummary {
  return {
    category: "outlook",
    authorName: "Jordan Blake",
    jobName: "Appaloosa",
    text: "3-Week Outlook · Appaloosa\n2026-08-03 · Version 1\n\n5 scheduled tasks.",
    createdAt: "2026-08-03T00:00:00.000Z",
    ...overrides,
  }
}

function makeHumanMessage(overrides: Partial<HumanMessageSummary> = {}): HumanMessageSummary {
  return {
    authorName: "Sam Rivera",
    jobName: "Appaloosa",
    type: "progress",
    text: "Framing crew is on site today.",
    createdAt: "2026-08-04T00:00:00.000Z",
    ...overrides,
  }
}

function fixtureMessagesFactory(overrides: Partial<MessagesToolsProvider> = {}, actorUserId?: string): SecretaryToolFactory {
  const provider: MessagesToolsProvider = {
    async searchOperationalHistory() {
      return [makeOperationalPost()]
    },
    async searchMyCommunications() {
      return [makeHumanMessage()]
    },
    ...overrides,
  }
  return () => createMessagesTools({ provider, directoryProvider: createDirectoryFixtureProvider(), actorUserId })
}

function fakeTool(name: string, module: SecretaryModule): SecretaryTool<{ query: string }> {
  return {
    name,
    module,
    description: "fake",
    parameters: { type: "object", additionalProperties: false, required: ["query"], properties: { query: { type: "string" } } },
    schema: z.object({ query: z.string() }),
    async run(args) {
      return { summary: `${name} ran`, data: { echo: args.query } }
    },
  }
}

type FakeRunConversationInput = {
  tools: OpenAiToolSpec[]
  history?: Array<{ role: "user" | "assistant"; content: string }>
  user: string
  onToolCalls: (calls: OpenAiToolCall[]) => Promise<Array<{ id: string; content: string }>>
}

function fakeAcquiredRequest() {
  return {
    lease: { leaseId: "x", operation: "ask" as const, requestHash: "h", keyHash: "k", expiresAtMs: 0, remaining: 10 },
    requestId: "r",
    userHash: "u",
  }
}

const guard = { acquire: async () => fakeAcquiredRequest(), complete: async () => undefined, fail: async () => undefined }
const noopGuard = {
  acquire: async () => {
    throw new Error("guard.acquire must not be called for a public sender")
  },
  complete: async () => undefined,
  fail: async () => undefined,
}

test("permissions: a public sender's tool registry never includes the Messages tools", async () => {
  const access = resolveWhatsAppAccessPolicy(null)
  const capture: { input?: FakeRunConversationInput } = {}
  const runConversation = async (_config: unknown, input: FakeRunConversationInput) => {
    capture.input = input
    return { result: { answer: "ok" }, toolRounds: 0, toolNames: [] }
  }

  await answerWhatsAppSecretaryQuestion(
    { recentMessages: [{ role: "user", content: "what happened on Appaloosa this week" }], senderIdentity: null, accessPolicy: access, companyKnowledge: [] },
    { runConversation: runConversation as never, usageGuard: noopGuard },
  )

  assert.equal(capture.input?.tools.length, 0)
})

test("permissions: an internal sender's real tool registry includes both Messages tools", async () => {
  const access = resolveWhatsAppAccessPolicy(identifiedIdentity)
  const capture: { input?: FakeRunConversationInput } = {}
  const runConversation = async (_config: unknown, input: FakeRunConversationInput) => {
    capture.input = input
    return { result: { answer: "ok" }, toolRounds: 0, toolNames: [] }
  }

  // No toolFactories override: exercises the REAL orchestrator wiring
  // (DEFAULT_TOOL_FACTORIES + the actorUserId-injecting closure), proving
  // the module is actually reachable end-to-end, not just through a double.
  await answerWhatsAppSecretaryQuestion(
    { recentMessages: [{ role: "user", content: "what happened on Appaloosa this week" }], senderIdentity: identifiedIdentity, accessPolicy: access, companyKnowledge: [] },
    { runConversation: runConversation as never, usageGuard: guard },
  )

  const toolNames = capture.input?.tools.map((tool) => tool.function.name) ?? []
  assert.ok(toolNames.includes("messages_searchOperationalHistory"), toolNames.join(", "))
  assert.ok(toolNames.includes("messages_searchMyCommunications"), toolNames.join(", "))
})

test("automatic vs human: an operational-history question returns system-generated posts, not personal messages", async () => {
  const access = resolveWhatsAppAccessPolicy(identifiedIdentity)
  const runConversation = async (_config: unknown, input: FakeRunConversationInput) => {
    const outputs = await input.onToolCalls([
      { id: "call-1", name: "messages_searchOperationalHistory", arguments: JSON.stringify({ jobName: "Appaloosa" }) },
    ])
    const parsed = JSON.parse(outputs[0]!.content) as { data?: { posts?: OperationalMessageSummary[] } }
    assert.equal(parsed.data?.posts?.[0]?.category, "outlook")
    assert.equal(parsed.data?.posts?.[0]?.authorName, "Jordan Blake")
    return { result: { answer: "Appaloosa's latest Outlook was published Aug 3." }, toolRounds: 1, toolNames: ["messages_searchOperationalHistory"] }
  }

  const reply = await answerWhatsAppSecretaryQuestion(
    { recentMessages: [{ role: "user", content: "any Outlook activity on Appaloosa this week?" }], senderIdentity: identifiedIdentity, accessPolicy: access, companyKnowledge: [] },
    { runConversation: runConversation as never, toolFactories: { messages: fixtureMessagesFactory({}, access.actorUserId) }, usageGuard: guard },
  )
  assert.equal(reply, "Appaloosa's latest Outlook was published Aug 3.")
})

test("automatic vs human: a personal-messages question is scoped to the sender's own visibility", async () => {
  const access = resolveWhatsAppAccessPolicy(identifiedIdentity)
  const runConversation = async (_config: unknown, input: FakeRunConversationInput) => {
    const outputs = await input.onToolCalls([{ id: "call-1", name: "messages_searchMyCommunications", arguments: "{}" }])
    const parsed = JSON.parse(outputs[0]!.content) as { data?: { messages?: HumanMessageSummary[] } }
    assert.equal(parsed.data?.messages?.[0]?.authorName, "Sam Rivera")
    return { result: { answer: "Sam Rivera said the framing crew is on site today." }, toolRounds: 1, toolNames: ["messages_searchMyCommunications"] }
  }

  const reply = await answerWhatsAppSecretaryQuestion(
    { recentMessages: [{ role: "user", content: "what did people tell me today" }], senderIdentity: identifiedIdentity, accessPolicy: access, companyKnowledge: [] },
    { runConversation: runConversation as never, toolFactories: { messages: fixtureMessagesFactory({}, access.actorUserId) }, usageGuard: guard },
  )
  assert.equal(reply, "Sam Rivera said the framing crew is on site today.")
})

test("permissions: a contact-only sender with no linked Firebase user gets an explained empty result from the personal-messages tool", async () => {
  const access = resolveWhatsAppAccessPolicy(unlinkedIdentity)
  assert.equal(access.actorUserId, undefined)
  assert.equal(access.canReadMessages, true, "still internal — the operational history tool must remain usable")

  const runConversation = async (_config: unknown, input: FakeRunConversationInput) => {
    const outputs = await input.onToolCalls([{ id: "call-1", name: "messages_searchMyCommunications", arguments: "{}" }])
    const parsed = JSON.parse(outputs[0]!.content) as { empty?: boolean; summary?: string }
    assert.equal(parsed.empty, true)
    assert.match(parsed.summary ?? "", /isn't linked/)
    return { result: { answer: "I can't check personal messages for this number." }, toolRounds: 1, toolNames: ["messages_searchMyCommunications"] }
  }

  await answerWhatsAppSecretaryQuestion(
    { recentMessages: [{ role: "user", content: "what did people tell me today" }], senderIdentity: unlinkedIdentity, accessPolicy: access, companyKnowledge: [] },
    {
      runConversation: runConversation as never,
      toolFactories: { messages: fixtureMessagesFactory({ searchMyCommunications: async () => { throw new Error("must not be called without an actorUserId") } }, access.actorUserId) },
      usageGuard: guard,
    },
  )
})

test("job/date filtering: arguments survive the JSON tool-call boundary and reach the provider", async () => {
  const access = resolveWhatsAppAccessPolicy(identifiedIdentity)
  const captured: { contextId?: string; since?: string } = {}
  const runConversation = async (_config: unknown, input: FakeRunConversationInput) => {
    await input.onToolCalls([
      { id: "call-1", name: "messages_searchOperationalHistory", arguments: JSON.stringify({ jobName: "Appaloosa", since: "2026-08-01", category: "clocking" }) },
    ])
    return { result: { answer: "done" }, toolRounds: 1, toolNames: ["messages_searchOperationalHistory"] }
  }

  await answerWhatsAppSecretaryQuestion(
    { recentMessages: [{ role: "user", content: "clocking activity on Appaloosa since Aug 1" }], senderIdentity: identifiedIdentity, accessPolicy: access, companyKnowledge: [] },
    {
      runConversation: runConversation as never,
      toolFactories: {
        messages: fixtureMessagesFactory(
          {
            async searchOperationalHistory(options) {
              captured.contextId = options.contextId
              captured.since = options.since
              assert.equal(options.category, "clocking")
              return []
            },
          },
          access.actorUserId,
        ),
      },
      usageGuard: guard,
    },
  )
  assert.equal(captured.contextId, "appaloosa")
  assert.equal(captured.since, "2026-08-01")
})

test("follow-up: prior Messages exchange is preserved in conversation memory for the next turn", async () => {
  const access = resolveWhatsAppAccessPolicy(identifiedIdentity)
  const capture: { input?: FakeRunConversationInput } = {}
  const runConversation = async (_config: unknown, input: FakeRunConversationInput) => {
    capture.input = input
    return { result: { answer: "The framing crew started Monday." }, toolRounds: 0, toolNames: [] }
  }

  const reply = await answerWhatsAppSecretaryQuestion(
    {
      recentMessages: [
        { role: "user", content: "what did people tell me about Appaloosa" },
        { role: "assistant", content: "Sam Rivera said the framing crew is on site today." },
        { role: "user", content: "when did that start" },
      ],
      senderIdentity: identifiedIdentity,
      accessPolicy: access,
      companyKnowledge: [],
    },
    { runConversation: runConversation as never, toolFactories: { messages: fixtureMessagesFactory({}, access.actorUserId) }, usageGuard: guard },
  )

  assert.equal(reply, "The framing crew started Monday.")
  assert.equal(capture.input?.user, "when did that start")
  assert.equal(capture.input?.history?.length, 2)
  assert.equal(capture.input?.history?.[1]?.content, "Sam Rivera said the framing crew is on site today.")
})

test("cross-module: a Messages tool and another module's tool are dispatched together in one round", async () => {
  const access = resolveWhatsAppAccessPolicy(identifiedIdentity)
  const runConversation = async (_config: unknown, input: FakeRunConversationInput) => {
    const outputs = await input.onToolCalls([
      { id: "call-1", name: "directory_fakeSearch", arguments: JSON.stringify({ query: "Appaloosa" }) },
      { id: "call-2", name: "messages_searchOperationalHistory", arguments: JSON.stringify({ jobName: "Appaloosa" }) },
    ])
    const byId = new Map(outputs.map((output) => [output.id, JSON.parse(output.content) as Record<string, unknown>]))
    assert.equal((byId.get("call-1")?.data as { echo?: string } | undefined)?.echo, "Appaloosa")
    assert.equal(((byId.get("call-2")?.data as { posts?: OperationalMessageSummary[] } | undefined)?.posts)?.[0]?.category, "outlook")
    return { result: { answer: "Appaloosa is an active job with a recent Outlook publish." }, toolRounds: 1, toolNames: ["directory_fakeSearch", "messages_searchOperationalHistory"] }
  }

  const reply = await answerWhatsAppSecretaryQuestion(
    { recentMessages: [{ role: "user", content: "tell me about Appaloosa and any recent Outlook activity" }], senderIdentity: identifiedIdentity, accessPolicy: access, companyKnowledge: [] },
    {
      runConversation: runConversation as never,
      toolFactories: { directory: () => [fakeTool("directory_fakeSearch", "directory")], messages: fixtureMessagesFactory({}, access.actorUserId) },
      usageGuard: guard,
    },
  )
  assert.equal(reply, "Appaloosa is an active job with a recent Outlook publish.")
})
