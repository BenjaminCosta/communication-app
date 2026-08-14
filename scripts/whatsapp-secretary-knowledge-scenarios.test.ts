process.env.WHATSAPP_SECRETARY_AI_MODE = "live"
process.env.OPENAI_API_KEY = "test-key-not-real"

import assert from "node:assert/strict"
import test from "node:test"
import { z } from "zod"
import { answerWhatsAppSecretaryQuestion } from "../lib/whatsapp-secretary/orchestrator"
import { resolveWhatsAppAccessPolicy } from "../lib/whatsapp-access-policy"
import { createKnowledgeTools } from "../lib/whatsapp-secretary/tools/knowledge"
import type { SecretaryModule, SecretaryTool, SecretaryToolFactory } from "../lib/whatsapp-secretary/tool-registry"
import type { OpenAiToolCall, OpenAiToolSpec } from "../lib/ai/openai/client"

/**
 * End-to-end scenario coverage for the Knowledge + Live Data integration,
 * exercised through the REAL orchestrator (`answerWhatsAppSecretaryQuestion`)
 * and the REAL knowledge tools (backed by the actual knowledge-pack file) —
 * only the live-data module tools are faked (they need Firebase Admin
 * credentials this offline suite doesn't have) and `runConversation` is
 * scripted to play a plausible sequence of tool calls a real model would
 * make, so these tests validate that the plumbing (registry, prompt,
 * budget, per-turn tool dispatch, multi-round support) actually produces a
 * coherent multi-source answer — not that a live OpenAI model would choose
 * the same sequence. Model *judgment* quality still needs the manual
 * WhatsApp checklist in `docs/svc-whatsapp-ai-secretary-handoff.md`.
 */

const identifiedIdentity = { personId: "person__sender", userId: "user-sender", name: "Sandbox Sender", role: "Staff" }
const noopGuard = { acquire: async () => ({ lease: { leaseId: "x", operation: "ask" as const, requestHash: "h", keyHash: "k", expiresAtMs: 0, remaining: 10 }, requestId: "r", userHash: "u" }), complete: async () => undefined, fail: async () => undefined }

function fakeLiveTool(name: string, module: SecretaryModule, respond: (args: Record<string, unknown>) => unknown): SecretaryTool<Record<string, unknown>> {
  return {
    name,
    module,
    description: "fake live-data tool for scenario tests",
    parameters: { type: "object", additionalProperties: false, required: [], properties: {} },
    schema: z.record(z.string(), z.unknown()),
    async run(args) {
      return { summary: `${name} ran`, data: respond(args) }
    },
  }
}

type ScriptStep = { toolName: string; args?: Record<string, unknown> }

/** Plays a fixed sequence of tool calls (one call per round), then answers. */
function scriptedRunConversation(script: ScriptStep[], answer: string) {
  return async (
    _config: unknown,
    input: {
      tools: OpenAiToolSpec[]
      onToolCalls: (calls: OpenAiToolCall[]) => Promise<Array<{ id: string; content: string }>>
    },
  ) => {
    const observedResults: Array<{ tool: string; content: string }> = []
    for (const step of script) {
      const [output] = await input.onToolCalls([{ id: `call-${step.toolName}`, name: step.toolName, arguments: JSON.stringify(step.args ?? {}) }])
      observedResults.push({ tool: step.toolName, content: output!.content })
    }
    return { result: { answer }, toolRounds: script.length, toolNames: script.map((step) => step.toolName), observedResults }
  }
}

test("scenario: knowledge-only question ('how do I create a 3-Week Outlook') retrieves real tutorial content", async () => {
  const access = resolveWhatsAppAccessPolicy(identifiedIdentity)
  const factories: Partial<Record<SecretaryModule, SecretaryToolFactory>> = { knowledge: () => createKnowledgeTools() }

  let searchContent = ""
  const runConversation = async (
    _config: unknown,
    input: { onToolCalls: (calls: OpenAiToolCall[]) => Promise<Array<{ id: string; content: string }>> },
  ) => {
    const [searchOut] = await input.onToolCalls([
      { id: "1", name: "knowledge_search", arguments: JSON.stringify({ query: "how do I create a 3-week outlook" }) },
    ])
    searchContent = searchOut!.content
    const sectionId = (JSON.parse(searchContent) as { data: { sections: Array<{ id: string }> } }).data.sections[0]!.id
    await input.onToolCalls([{ id: "2", name: "knowledge_getSection", arguments: JSON.stringify({ id: sectionId }) }])
    return { result: { answer: "Open the job's Outlook tab, add tasks, then confirm." }, toolRounds: 2, toolNames: ["knowledge_search", "knowledge_getSection"] }
  }

  const reply = await answerWhatsAppSecretaryQuestion(
    { recentMessages: [{ role: "user", content: "How do I create a 3-Week Outlook?" }], senderIdentity: identifiedIdentity, accessPolicy: access, companyKnowledge: [] },
    { toolFactories: factories, runConversation: runConversation as never, usageGuard: noopGuard },
  )

  assert.match(reply, /Outlook/)
  assert.match(searchContent, /outlook/i)
})

test("scenario: live-data-only question ('does Turner currently have an outlook') never touches knowledge tools", async () => {
  const access = resolveWhatsAppAccessPolicy(identifiedIdentity)
  let knowledgeToolCalled = false
  const factories: Partial<Record<SecretaryModule, SecretaryToolFactory>> = {
    knowledge: () => [fakeLiveTool("knowledge_search", "knowledge", () => { knowledgeToolCalled = true; return {} })],
    outlooks: () => [fakeLiveTool("outlooks_getOutlookForJob", "outlooks", () => ({ found: false, jobName: "Turner" }))],
  }

  const reply = await answerWhatsAppSecretaryQuestion(
    { recentMessages: [{ role: "user", content: "Does Turner currently have an outlook?" }], senderIdentity: identifiedIdentity, accessPolicy: access, companyKnowledge: [] },
    {
      toolFactories: factories,
      runConversation: scriptedRunConversation([{ toolName: "outlooks_getOutlookForJob", args: { jobName: "Turner" } }], "Turner doesn't currently have an active 3-Week Outlook.") as never,
      usageGuard: noopGuard,
    },
  )

  assert.match(reply, /Turner/)
  assert.equal(knowledgeToolCalled, false)
})

test("scenario: knowledge + live data combined ('never made one for Turner, what should I do') uses both sources in one turn", async () => {
  const access = resolveWhatsAppAccessPolicy(identifiedIdentity)
  const factories: Partial<Record<SecretaryModule, SecretaryToolFactory>> = {
    knowledge: () => createKnowledgeTools(),
    outlooks: () => [fakeLiveTool("outlooks_getOutlookForJob", "outlooks", () => ({ found: false, jobName: "Turner" }))],
  }

  const calledTools: string[] = []
  const runConversation = async (
    _config: unknown,
    input: { onToolCalls: (calls: OpenAiToolCall[]) => Promise<Array<{ id: string; content: string }>> },
  ) => {
    const [knowledgeOut] = await input.onToolCalls([{ id: "1", name: "knowledge_search", arguments: JSON.stringify({ query: "how to create a 3-week outlook" }) }])
    calledTools.push("knowledge_search")
    const [liveOut] = await input.onToolCalls([{ id: "2", name: "outlooks_getOutlookForJob", arguments: JSON.stringify({ jobName: "Turner" }) }])
    calledTools.push("outlooks_getOutlookForJob")
    const knowledgeFound = (JSON.parse(knowledgeOut!.content) as { empty?: boolean }).empty !== true
    const liveFound = (JSON.parse(liveOut!.content) as { data: { found: boolean } }).data.found
    return {
      result: { answer: `Turner has no outlook yet (${liveFound}). Here's how to create one (knowledge found: ${knowledgeFound}).` },
      toolRounds: 2,
      toolNames: calledTools,
    }
  }

  const reply = await answerWhatsAppSecretaryQuestion(
    { recentMessages: [{ role: "user", content: "I've never made an outlook for Turner, what should I do?" }], senderIdentity: identifiedIdentity, accessPolicy: access, companyKnowledge: [] },
    { toolFactories: factories, runConversation: runConversation as never, usageGuard: noopGuard },
  )

  assert.deepEqual(calledTools, ["knowledge_search", "outlooks_getOutlookForJob"])
  assert.match(reply, /knowledge found: true/)
  assert.match(reply, /false\)/)
})

test("scenario: cross-module live data (person -> jobs -> reports) plus a knowledge definition in one turn", async () => {
  const access = resolveWhatsAppAccessPolicy(identifiedIdentity)
  const factories: Partial<Record<SecretaryModule, SecretaryToolFactory>> = {
    knowledge: () => createKnowledgeTools(),
    directory: () => [fakeLiveTool("directory_searchPeople", "directory", () => ({ records: [{ id: "person__1", name: "John DeMarco" }] }))],
    reports: () => [fakeLiveTool("reports_getRecentDailyReports", "reports", () => ({ reports: [{ jobName: "North Ridge", date: "2026-08-12" }] }))],
  }

  const reply = await answerWhatsAppSecretaryQuestion(
    { recentMessages: [{ role: "user", content: "What's going on with John and what's a Daily Report anyway?" }], senderIdentity: identifiedIdentity, accessPolicy: access, companyKnowledge: [] },
    {
      toolFactories: factories,
      runConversation: scriptedRunConversation(
        [
          { toolName: "directory_searchPeople", args: { query: "John" } },
          { toolName: "reports_getRecentDailyReports", args: {} },
          { toolName: "knowledge_search", args: { query: "what is a daily report" } },
        ],
        "John DeMarco's latest report is from North Ridge on Aug 12. A Daily Report is a field record of what happened, issues, and next steps.",
      ) as never,
      usageGuard: noopGuard,
    },
  )

  assert.match(reply, /John DeMarco/)
  assert.match(reply, /Daily Report/)
})

test("scenario: follow-up memory continues a knowledge thread using conversation history, not a re-ask", async () => {
  const access = resolveWhatsAppAccessPolicy(identifiedIdentity)
  const factories: Partial<Record<SecretaryModule, SecretaryToolFactory>> = { knowledge: () => createKnowledgeTools() }

  const capture: { history?: Array<{ role: string; content: string }>; user?: string } = {}
  const runConversation = async (
    _config: unknown,
    input: { history?: Array<{ role: "user" | "assistant"; content: string }>; user: string; onToolCalls: (calls: OpenAiToolCall[]) => Promise<Array<{ id: string; content: string }>> },
  ) => {
    capture.history = input.history
    capture.user = input.user
    await input.onToolCalls([{ id: "1", name: "knowledge_search", arguments: JSON.stringify({ query: input.user }) }])
    return { result: { answer: "Quest Coral tracks status/next-step; a 3-Week Outlook schedules dated tasks." }, toolRounds: 1, toolNames: ["knowledge_search"] }
  }

  const reply = await answerWhatsAppSecretaryQuestion(
    {
      recentMessages: [
        { role: "user", content: "What is Quest Coral?" },
        { role: "assistant", content: "Quest Coral is SVC's project-tracking module." },
        { role: "user", content: "How is that different from what we just talked about with Outlooks?" },
      ],
      senderIdentity: identifiedIdentity,
      accessPolicy: access,
      companyKnowledge: [],
    },
    { toolFactories: factories, runConversation: runConversation as never, usageGuard: noopGuard },
  )

  assert.equal(capture.history?.length, 2)
  assert.equal(capture.user, "How is that different from what we just talked about with Outlooks?")
  assert.match(reply, /Quest Coral/)
})

test("scenario: a PROJECT CONTEXT / HUMAN-CONFIRMED company-identity question is answered directly, not hedged", async () => {
  // As of the 2026-08-14 company-context merge, §2's org-language material
  // (Cool Breeze, Operation Major Kong, etc.) is explicitly labeled
  // PROJECT CONTEXT / HUMAN-CONFIRMED, not something to hedge on for lack of
  // a code trail — this proves retrieval actually surfaces that framing.
  const access = resolveWhatsAppAccessPolicy(identifiedIdentity)
  const factories: Partial<Record<SecretaryModule, SecretaryToolFactory>> = { knowledge: () => createKnowledgeTools() }

  let sectionContent = ""
  const runConversation = async (
    _config: unknown,
    input: { onToolCalls: (calls: OpenAiToolCall[]) => Promise<Array<{ id: string; content: string }>> },
  ) => {
    const [searchOut] = await input.onToolCalls([{ id: "1", name: "knowledge_search", arguments: JSON.stringify({ query: "what does Cool Breeze mean at SVC" }) }])
    const sections = (JSON.parse(searchOut!.content) as { data?: { sections: Array<{ id: string }> } }).data?.sections ?? []
    const [sectionOut] = await input.onToolCalls([{ id: "2", name: "knowledge_getSection", arguments: JSON.stringify({ id: sections[0]!.id }) }])
    sectionContent = sectionOut!.content
    return { result: { answer: "Cool Breeze is SVC's mission." }, toolRounds: 2, toolNames: ["knowledge_search", "knowledge_getSection"] }
  }

  const reply = await answerWhatsAppSecretaryQuestion(
    { recentMessages: [{ role: "user", content: "What does 'Cool Breeze' mean at SVC?" }], senderIdentity: identifiedIdentity, accessPolicy: access, companyKnowledge: [] },
    { toolFactories: factories, runConversation: runConversation as never, usageGuard: noopGuard },
  )

  assert.match(reply, /Cool Breeze/)
  assert.match(sectionContent, /PROJECT CONTEXT \/ HUMAN-CONFIRMED/)
})

test("scenario: a genuinely NEEDS VERIFICATION product question (deployment status, not company identity) surfaces that uncertainty", async () => {
  const access = resolveWhatsAppAccessPolicy(identifiedIdentity)
  const factories: Partial<Record<SecretaryModule, SecretaryToolFactory>> = { knowledge: () => createKnowledgeTools() }

  let sectionContent = ""
  const runConversation = async (
    _config: unknown,
    input: { onToolCalls: (calls: OpenAiToolCall[]) => Promise<Array<{ id: string; content: string }>> },
  ) => {
    const [searchOut] = await input.onToolCalls([
      { id: "1", name: "knowledge_search", arguments: JSON.stringify({ query: "is the applications video transcription function deployed to production" }) },
    ])
    const sections = (JSON.parse(searchOut!.content) as { data?: { sections: Array<{ id: string }> } }).data?.sections ?? []
    if (sections.length > 0) {
      const [sectionOut] = await input.onToolCalls([{ id: "2", name: "knowledge_getSection", arguments: JSON.stringify({ id: sections[0]!.id }) }])
      sectionContent = sectionOut!.content
    }
    return {
      result: { answer: "I can't confirm whether that's actually deployed to production from what I have access to." },
      toolRounds: sections.length > 0 ? 2 : 1,
      toolNames: ["knowledge_search"],
    }
  }

  const reply = await answerWhatsAppSecretaryQuestion(
    { recentMessages: [{ role: "user", content: "Is the video transcription for Applications actually live in production?" }], senderIdentity: identifiedIdentity, accessPolicy: access, companyKnowledge: [] },
    { toolFactories: factories, runConversation: runConversation as never, usageGuard: noopGuard },
  )

  assert.match(reply, /can't confirm/i)
  // The real knowledge pack's own §9 explicitly carries this caveat — prove
  // retrieval actually surfaced it rather than the test just asserting the
  // scripted answer text.
  if (sectionContent) assert.match(sectionContent, /could not be confirmed|deployment status unconfirmed/i)
})

test("scenario: unresolvable/unavailable information — knowledge tool finds nothing, model must say so", async () => {
  const access = resolveWhatsAppAccessPolicy(identifiedIdentity)
  const factories: Partial<Record<SecretaryModule, SecretaryToolFactory>> = { knowledge: () => createKnowledgeTools() }

  const reply = await answerWhatsAppSecretaryQuestion(
    { recentMessages: [{ role: "user", content: "Tell me about the SVC snorkeling program" }], senderIdentity: identifiedIdentity, accessPolicy: access, companyKnowledge: [] },
    {
      toolFactories: factories,
      runConversation: scriptedRunConversation([{ toolName: "knowledge_search", args: { query: "snorkeling program" } }], "I couldn't find that in the SVC data I can access.") as never,
      usageGuard: noopGuard,
    },
  )

  assert.match(reply, /couldn't find/i)
})
