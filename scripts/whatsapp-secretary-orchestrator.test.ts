// Force a "live" config with a fake key so canCallProvider() passes without a
// real network call — the actual OpenAI call is replaced by an injected fake
// runConversation below, matching the *-eval.test.ts offline-mode convention.
process.env.WHATSAPP_SECRETARY_AI_MODE = "live"
process.env.OPENAI_API_KEY = "test-key-not-real"

import assert from "node:assert/strict"
import test from "node:test"
import { z } from "zod"
import { answerWhatsAppSecretaryQuestion } from "../lib/whatsapp-secretary/orchestrator"
import { resolveWhatsAppAccessPolicy } from "../lib/whatsapp-access-policy"
import type { SecretaryModule, SecretaryTool, SecretaryToolFactory } from "../lib/whatsapp-secretary/tool-registry"
import type { OpenAiToolCall, OpenAiToolSpec } from "../lib/ai/openai/client"
import { AiError } from "../lib/ai/errors"

const identifiedIdentity = { personId: "person__sender", userId: "user-sender", name: "Sandbox Sender", role: "Staff" }

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

const fakeFactories: Partial<Record<SecretaryModule, SecretaryToolFactory>> = {
  directory: () => [fakeTool("directory_fakeSearch", "directory")],
  questCoral: () => [fakeTool("questCoral_fakeSearch", "questCoral")],
}

type FakeRunConversationInput = {
  tools: OpenAiToolSpec[]
  history?: Array<{ role: "user" | "assistant"; content: string }>
  user: string
  onToolCalls: (calls: OpenAiToolCall[]) => Promise<Array<{ id: string; content: string }>>
}

function fakeRunConversation(answer: string, capture?: { input?: FakeRunConversationInput }) {
  return async (_config: unknown, input: FakeRunConversationInput) => {
    if (capture) capture.input = input
    return { result: { answer }, toolRounds: 0, toolNames: [] }
  }
}

function fakeAcquiredRequest() {
  return {
    lease: { leaseId: "x", operation: "ask" as const, requestHash: "h", keyHash: "k", expiresAtMs: 0, remaining: 10 },
    requestId: "r",
    userHash: "u",
  }
}

const noopGuard = {
  acquire: async () => {
    throw new Error("guard.acquire must not be called for a public sender")
  },
  complete: async () => undefined,
  fail: async () => undefined,
}

test("throws synchronously when the last message is not the current user turn", async () => {
  const access = resolveWhatsAppAccessPolicy(null)
  await assert.rejects(
    answerWhatsAppSecretaryQuestion(
      { recentMessages: [{ role: "assistant", content: "hi" }], senderIdentity: null, accessPolicy: access, companyKnowledge: [] },
      { runConversation: fakeRunConversation("unused") as never, toolFactories: fakeFactories },
    ),
    /current WhatsApp user message/,
  )
})

test("public sender gets an empty tool registry and skips the usage guard entirely", async () => {
  const access = resolveWhatsAppAccessPolicy(null)
  const capture: { input?: FakeRunConversationInput } = {}
  const reply = await answerWhatsAppSecretaryQuestion(
    {
      recentMessages: [{ role: "user", content: "What is SVC?" }],
      senderIdentity: null,
      accessPolicy: access,
      companyKnowledge: [],
    },
    { runConversation: fakeRunConversation("SVC is a construction operations platform.", capture) as never, toolFactories: fakeFactories, usageGuard: noopGuard },
  )
  assert.equal(reply, "SVC is a construction operations platform.")
  assert.equal(capture.input?.tools.length, 0)
})

test("internal sender gets the access-policy-matching tool registry and the guard is acquired/completed", async () => {
  const access = resolveWhatsAppAccessPolicy(identifiedIdentity)
  const capture: { input?: FakeRunConversationInput } = {}
  let acquireCalls = 0
  let completeCalls = 0
  const guard = {
    acquire: async () => {
      acquireCalls += 1
      return fakeAcquiredRequest()
    },
    complete: async () => {
      completeCalls += 1
    },
    fail: async () => undefined,
  }

  const reply = await answerWhatsAppSecretaryQuestion(
    {
      recentMessages: [
        { role: "user", content: "who is the PM on North Ridge" },
        { role: "assistant", content: "John DeMarco is the PM." },
        { role: "user", content: "what is their phone" },
      ],
      senderIdentity: identifiedIdentity,
      accessPolicy: access,
      companyKnowledge: [],
    },
    { runConversation: fakeRunConversation("Their phone number is on file but I can't share it here.", capture) as never, toolFactories: fakeFactories, usageGuard: guard },
  )

  assert.equal(reply, "Their phone number is on file but I can't share it here.")
  const toolNames = capture.input?.tools.map((tool) => tool.function.name) ?? []
  assert.ok(toolNames.includes("directory_fakeSearch"))
  assert.ok(toolNames.includes("questCoral_fakeSearch"))
  assert.equal(capture.input?.user, "what is their phone")
  assert.equal(capture.input?.history?.length, 2)
  assert.equal(capture.input?.history?.[0]?.content, "who is the PM on North Ridge")
  assert.equal(acquireCalls, 1)
  assert.equal(completeCalls, 1)
})

test("dispatches a simulated tool round to the correct fake tool and returns valid JSON", async () => {
  const access = resolveWhatsAppAccessPolicy(identifiedIdentity)
  const capture: { input?: FakeRunConversationInput } = {}
  const runConversation = async (_config: unknown, input: FakeRunConversationInput) => {
    capture.input = input
    const outputs = await input.onToolCalls([{ id: "call-1", name: "directory_fakeSearch", arguments: JSON.stringify({ query: "North Ridge" }) }])
    const parsed = JSON.parse(outputs[0]!.content) as { data?: { echo?: string } }
    assert.equal(parsed.data?.echo, "North Ridge")
    return { result: { answer: "done" }, toolRounds: 1, toolNames: ["directory_fakeSearch"] }
  }

  const reply = await answerWhatsAppSecretaryQuestion(
    { recentMessages: [{ role: "user", content: "find North Ridge" }], senderIdentity: identifiedIdentity, accessPolicy: access, companyKnowledge: [] },
    { runConversation: runConversation as never, toolFactories: fakeFactories, usageGuard: { acquire: async () => (fakeAcquiredRequest()), complete: async () => undefined, fail: async () => undefined } },
  )
  assert.equal(reply, "done")
})

test("truncates an overlong answer to 700 characters", async () => {
  const access = resolveWhatsAppAccessPolicy(null)
  const longAnswer = "a".repeat(1500)
  const reply = await answerWhatsAppSecretaryQuestion(
    { recentMessages: [{ role: "user", content: "hi" }], senderIdentity: null, accessPolicy: access, companyKnowledge: [] },
    { runConversation: fakeRunConversation(longAnswer) as never, toolFactories: fakeFactories, usageGuard: noopGuard },
  )
  assert.equal(reply.length, 700)
})

test("returns the AiError's user-safe message instead of throwing, and fails the guard lease", async () => {
  const access = resolveWhatsAppAccessPolicy(identifiedIdentity)
  let failCalls = 0
  const guard = {
    acquire: async () => (fakeAcquiredRequest()),
    complete: async () => undefined,
    fail: async () => {
      failCalls += 1
    },
  }
  const runConversation = async () => {
    throw new AiError("rate-limited", "AI is busy right now. Please try again shortly.")
  }

  const reply = await answerWhatsAppSecretaryQuestion(
    { recentMessages: [{ role: "user", content: "hi" }], senderIdentity: identifiedIdentity, accessPolicy: access, companyKnowledge: [] },
    { runConversation: runConversation as never, toolFactories: fakeFactories, usageGuard: guard },
  )
  assert.equal(reply, "AI is busy right now. Please try again shortly.")
  assert.equal(failCalls, 1)
})

test("real default tool factories construct successfully and include the knowledge tools for an internal sender", async () => {
  const access = resolveWhatsAppAccessPolicy(identifiedIdentity)
  const capture: { input?: FakeRunConversationInput } = {}
  const guard = { acquire: async () => fakeAcquiredRequest(), complete: async () => undefined, fail: async () => undefined }

  // Deliberately omits `toolFactories` so every module's REAL factory
  // (`DEFAULT_TOOL_FACTORIES` in orchestrator.ts) is exercised, proving the
  // knowledge module is actually wired in end-to-end, not just reachable
  // through a test double. `runConversation` is still faked so no real
  // OpenAI/Firestore call happens — only tool *construction* (name/schema),
  // never `.run()`, is exercised here.
  await answerWhatsAppSecretaryQuestion(
    { recentMessages: [{ role: "user", content: "how does clocking work" }], senderIdentity: identifiedIdentity, accessPolicy: access, companyKnowledge: [] },
    { runConversation: fakeRunConversation("ok", capture) as never, usageGuard: guard },
  )

  const toolNames = capture.input?.tools.map((tool) => tool.function.name) ?? []
  assert.ok(toolNames.includes("knowledge_search"), `expected knowledge_search among: ${toolNames.join(", ")}`)
  assert.ok(toolNames.includes("knowledge_getSection"))
})

test("re-throws an unexpected (non-AiError) failure after failing the guard lease", async () => {
  const access = resolveWhatsAppAccessPolicy(identifiedIdentity)
  let failCalls = 0
  const guard = {
    acquire: async () => (fakeAcquiredRequest()),
    complete: async () => undefined,
    fail: async () => {
      failCalls += 1
    },
  }
  const runConversation = async () => {
    throw new Error("unexpected network failure")
  }

  await assert.rejects(
    answerWhatsAppSecretaryQuestion(
      { recentMessages: [{ role: "user", content: "hi" }], senderIdentity: identifiedIdentity, accessPolicy: access, companyKnowledge: [] },
      { runConversation: runConversation as never, toolFactories: fakeFactories, usageGuard: guard },
    ),
    /unexpected network failure/,
  )
  assert.equal(failCalls, 1)
})
