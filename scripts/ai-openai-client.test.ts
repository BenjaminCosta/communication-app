import assert from "node:assert/strict"
import test from "node:test"
import { runToolConversation, type OpenAiToolCall, type OpenAiToolSpec } from "../lib/ai/openai/client"
import { AiError } from "../lib/ai/errors"

/**
 * Regression coverage for a real production incident (2026-08-14): every
 * WhatsApp Secretary message failed identically ("The outlook could not be
 * generated. Please try again.") because `runToolConversation` sent `tools`
 * together with `reasoning_effort` on every round. gpt-5.6-terra (and
 * potentially other reasoning models) rejects that combination on
 * /v1/chat/completions with a 400 — and simply omitting `reasoning_effort`
 * is NOT enough, since the model's own non-"none" default still applies and
 * still gets rejected; it must be explicitly forced to "none" whenever
 * `tools` are present. This file existed with zero coverage before the
 * incident; these tests exist so a future change to this request-building
 * logic can't silently reintroduce it.
 */

const fakeToolSpec: OpenAiToolSpec = {
  type: "function",
  function: { name: "fake_tool", description: "fake", parameters: { type: "object", properties: {} } },
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

test("a tool-bearing round always sends reasoning_effort: 'none', regardless of the caller's requested effort", async () => {
  const originalFetch = globalThis.fetch
  const bodies: Array<Record<string, unknown>> = []
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse((init?.body as string) ?? "{}") as Record<string, unknown>
    bodies.push(body)
    return jsonResponse({ choices: [{ message: { content: JSON.stringify({ answer: "done" }) } }] })
  }) as typeof fetch

  try {
    await runToolConversation(
      { apiKey: "test-key", baseUrl: "https://api.example.test", timeoutMs: 5000 },
      {
        model: "gpt-5.6-terra",
        system: "sys",
        user: "hello",
        tools: [fakeToolSpec],
        schema: { name: "answer", schema: { type: "object", properties: {} } },
        maxToolRounds: 2,
        reasoningEffort: "low",
        verbosity: "low",
        onToolCalls: async (calls) => calls.map((call) => ({ id: call.id, content: "{}" })),
      },
    )
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.equal(bodies.length, 1)
  assert.ok("tools" in bodies[0]!, "the first (only) round included tools")
  assert.equal(bodies[0]!.reasoning_effort, "none")
  assert.equal("verbosity" in bodies[0]!, false, "verbosity is also withheld on a tool-bearing round")
})

test("the final, tool-less round uses the caller's actual requested reasoning effort and verbosity", async () => {
  const originalFetch = globalThis.fetch
  const bodies: Array<Record<string, unknown>> = []
  let round = 0
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse((init?.body as string) ?? "{}") as Record<string, unknown>
    bodies.push(body)
    round += 1
    // First round: request one tool call. Second (final) round: answer.
    if (round === 1) {
      return jsonResponse({
        choices: [{ message: { content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "fake_tool", arguments: "{}" } }] } }],
      })
    }
    return jsonResponse({ choices: [{ message: { content: JSON.stringify({ answer: "done" }) } }] })
  }) as typeof fetch

  try {
    await runToolConversation(
      { apiKey: "test-key", baseUrl: "https://api.example.test", timeoutMs: 5000 },
      {
        model: "gpt-5.6-terra",
        system: "sys",
        user: "hello",
        tools: [fakeToolSpec],
        schema: { name: "answer", schema: { type: "object", properties: {} } },
        maxToolRounds: 1,
        reasoningEffort: "low",
        verbosity: "low",
        onToolCalls: async (calls) => calls.map((call) => ({ id: call.id, content: "{}" })),
      },
    )
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.equal(bodies.length, 2)
  // Round 1 (tools included): forced to "none", per the bug above.
  assert.ok("tools" in bodies[0]!)
  assert.equal(bodies[0]!.reasoning_effort, "none")
  // Round 2 (final, tools withheld): the caller's real requested effort/verbosity.
  assert.ok(!("tools" in bodies[1]!))
  assert.equal(bodies[1]!.reasoning_effort, "low")
  assert.equal(bodies[1]!.verbosity, "low")
})

test("a call with no reasoningEffort at all never sends the field, on any round", async () => {
  const originalFetch = globalThis.fetch
  const bodies: Array<Record<string, unknown>> = []
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse((init?.body as string) ?? "{}") as Record<string, unknown>
    bodies.push(body)
    return jsonResponse({ choices: [{ message: { content: JSON.stringify({ answer: "done" }) } }] })
  }) as typeof fetch

  try {
    await runToolConversation(
      { apiKey: "test-key", baseUrl: "https://api.example.test", timeoutMs: 5000 },
      {
        model: "gpt-5-mini",
        system: "sys",
        user: "hello",
        tools: [fakeToolSpec],
        schema: { name: "answer", schema: { type: "object", properties: {} } },
        maxToolRounds: 2,
        onToolCalls: async (calls) => calls.map((call) => ({ id: call.id, content: "{}" })),
      },
    )
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.equal("reasoning_effort" in bodies[0]!, false)
})

test("a non-ok, non-429/401/403/413 response on a tool-calling call surfaces as a generic provider AiError", async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () =>
    jsonResponse({ error: { message: "Function tools with reasoning_effort are not supported...", type: "invalid_request_error" } }, 400)) as typeof fetch

  try {
    await assert.rejects(
      runToolConversation(
        { apiKey: "test-key", baseUrl: "https://api.example.test", timeoutMs: 5000 },
        {
          model: "gpt-5.6-terra",
          system: "sys",
          user: "hello",
          tools: [fakeToolSpec],
          schema: { name: "answer", schema: { type: "object", properties: {} } },
          maxToolRounds: 1,
          onToolCalls: async (calls) => calls.map((call) => ({ id: call.id, content: "{}" })),
        },
      ),
      (error: unknown) => error instanceof AiError && error.code === "provider-error",
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})
