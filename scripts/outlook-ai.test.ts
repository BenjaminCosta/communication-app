import assert from "node:assert/strict"
import test from "node:test"
import {
  parseOutlookResultSchema,
  parseOutlookRequestSchema,
  parsedOutlookTaskSuggestionSchema,
  type ParseOutlookContext,
  type ParsedOutlookTaskSuggestion,
} from "../features/outlooks/ai/outlook-parser-contract"
import { normalizeOutlookSuggestions } from "../features/outlooks/ai/normalize-outlook-suggestions"
import { mockParseOutlookText } from "../features/outlooks/ai/server/mock-parser"
import { parseOutlookText } from "../features/outlooks/ai/server/parse-service"
import { buildParseUserPrompt } from "../features/outlooks/ai/server/prompt"
import { validateOutlookAudio } from "../features/outlooks/ai/server/audio-validation"
import { authenticateOutlookRequest } from "../lib/ai/server/auth-guard"
import {
  acquireOutlookAiGuardState,
  completeOutlookAiGuardState,
  emptyOutlookAiGuardState,
  failOutlookAiGuardState,
} from "../lib/ai/server/request-guard-core"
import { AiError } from "../lib/ai/errors"
import { OUTLOOK_AI_LIMITS } from "../lib/ai/config-public"
import { createStructuredJson } from "../lib/ai/openai/client"
import { outlookWindow, scheduleOutlookTasks } from "../lib/outlook-core"

const WINDOW = outlookWindow("2026-07-13")

function context(overrides: Partial<ParseOutlookContext> = {}): ParseOutlookContext {
  return {
    windowStart: WINDOW.start,
    windowEnd: WINDOW.end,
    today: "2026-07-16",
    jobName: "Test Job",
    location: null,
    companies: [],
    existingTasks: [],
    ...overrides,
  }
}

function suggestion(partial: Partial<ParsedOutlookTaskSuggestion> & Pick<ParsedOutlookTaskSuggestion, "clientSuggestionId" | "title">): ParsedOutlookTaskSuggestion {
  return parsedOutlookTaskSuggestionSchema.parse({
    completionPercent: 0,
    status: "not_started",
    ...partial,
  })
}

test("contract fills confidence defaults and rejects malformed suggestions", () => {
  const parsed = parsedOutlookTaskSuggestionSchema.parse({ clientSuggestionId: "s1", title: "Framing" })
  assert.equal(parsed.confidence.title, 0.5)
  assert.deepEqual(parsed.warnings, [])
  assert.throws(() => parsedOutlookTaskSuggestionSchema.parse({ title: "no id" }))
})

test("parse contract enforces the 2,000-character server limit", () => {
  const valid = { text: "x".repeat(OUTLOOK_AI_LIMITS.maxTextChars), context: context() }
  assert.equal(parseOutlookRequest(valid).success, true)
  assert.equal(parseOutlookRequest({ ...valid, text: `${valid.text}x` }).success, false)
})

test("normalize confirms an exact company match and mints real task ids", () => {
  const [entry] = normalizeOutlookSuggestions(
    [suggestion({ clientSuggestionId: "s1", title: "Pour footings", companyName: "74 Construction", startDate: "2026-07-16", durationDays: 3 })],
    { companies: [{ id: "co-74", name: "74 Construction" }], existingTasks: [] },
  )
  assert.equal(entry.companyMatch, "confirmed")
  assert.equal(entry.task.companyContextId, "co-74")
  assert.ok(entry.task.id.length > 0)
})

test("normalize flags ambiguous and unmatched companies without linking", () => {
  const ambiguous = normalizeOutlookSuggestions(
    [suggestion({ clientSuggestionId: "s1", title: "Grading", companyName: "Acme", startDate: "2026-07-16" })],
    { companies: [{ id: "a1", name: "Acme" }, { id: "a2", name: "acme" }], existingTasks: [] },
  )[0]
  assert.equal(ambiguous.companyMatch, "ambiguous")
  assert.equal(ambiguous.task.companyContextId, null)

  const unmatched = normalizeOutlookSuggestions(
    [suggestion({ clientSuggestionId: "s1", title: "Grading", companyName: "Unknown Co", startDate: "2026-07-16" })],
    { companies: [{ id: "a1", name: "Acme" }], existingTasks: [] },
  )[0]
  assert.equal(unmatched.companyMatch, "unmatched")
  assert.ok(unmatched.notes.some((note) => note.includes("Unknown Co")))
})

test("normalize resolves a dependency to a sibling and ignores model endDate", () => {
  const entries = normalizeOutlookSuggestions(
    [
      suggestion({ clientSuggestionId: "s1", title: "Foundation", startDate: "2026-07-16", durationDays: 2 }),
      suggestion({ clientSuggestionId: "s2", title: "Framing", durationDays: 3, dependencyReference: "Foundation" }),
    ],
    { companies: [], existingTasks: [] },
  )
  // endDate is never taken from the model — it stays null until the scheduler runs.
  assert.equal(entries[0].task.endDate, null)
  // The sibling dependency resolves to the first task's minted id.
  assert.equal(entries[1].task.dependencyTaskId, entries[0].task.id)
  assert.equal(entries[1].dependencyMatch, "confirmed")

  // The drafts must schedule cleanly through the deterministic core.
  const scheduled = scheduleOutlookTasks(entries.map((entry) => entry.task), WINDOW)
  assert.equal(scheduled.tasks[0].endDate, "2026-07-17")
  assert.equal(scheduled.tasks[1].startDate, "2026-07-18")
})

test("normalize resolves a dependency to an existing task by title", () => {
  const [entry] = normalizeOutlookSuggestions(
    [suggestion({ clientSuggestionId: "s1", title: "Inspection", dependencyReference: "Rough-in" })],
    { companies: [], existingTasks: [{ id: "task-existing", title: "Rough-in" }] },
  )
  assert.equal(entry.task.dependencyTaskId, "task-existing")
})

test("mock parser splits activities and extracts duration and dates", () => {
  const result = mockParseOutlookText(
    "Pour the foundation today for 3 days. Then framing for a week.",
    context(),
  )
  const validated = parseOutlookResultSchema.parse(result)
  assert.ok(validated.suggestions.length >= 2)
  const foundation = validated.suggestions[0]
  assert.equal(foundation.startDate, "2026-07-16")
  assert.equal(foundation.durationDays, 3)
  const framing = validated.suggestions[1]
  assert.equal(framing.durationDays, 7)
  assert.equal(framing.dependencyReference, foundation.title)
})

test("live prompt keeps relevant context and drops unrelated workspace data", () => {
  const prompt = buildParseUserPrompt(
    "Acme Electric starts rough-in after Foundation Complete.",
    context({
      companies: [
        { id: "acme", name: "Acme Electric" },
        { id: "delta", name: "Delta Drywall" },
      ],
      existingTasks: [
        { id: "foundation", title: "Foundation Complete", startDate: "2026-07-13", endDate: "2026-07-15" },
        { id: "roof", title: "Roof Inspection", startDate: "2026-07-20", endDate: "2026-07-20" },
      ],
    }),
  )

  assert.match(prompt, /Acme Electric/)
  assert.match(prompt, /Foundation Complete/)
  assert.doesNotMatch(prompt, /Delta Drywall/)
  assert.doesNotMatch(prompt, /Roof Inspection/)
})

test("parse-service returns schema-valid suggestions in mock mode when no key is set", async () => {
  delete process.env.OPENAI_API_KEY
  delete process.env.OUTLOOK_AI_MODE
  const response = await parseOutlookText("Excavate footings tomorrow for 2 days.", context())
  assert.equal(response.mode, "mock")
  const validated = parseOutlookResultSchema.parse(response)
  assert.ok(validated.suggestions.length >= 1)
})

test("auth guard fails closed when live AI has no Firebase Admin credentials", async () => {
  const previous = {
    apiKey: process.env.OPENAI_API_KEY,
    mode: process.env.OUTLOOK_AI_MODE,
    serviceAccount: process.env.FIREBASE_SERVICE_ACCOUNT_KEY,
    applicationCredentials: process.env.GOOGLE_APPLICATION_CREDENTIALS,
  }

  process.env.OPENAI_API_KEY = "sk-test-only"
  delete process.env.OUTLOOK_AI_MODE
  delete process.env.FIREBASE_SERVICE_ACCOUNT_KEY
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS

  const fakeToken = "e30.eyJzdWIiOiJ1bnZlcmlmaWVkIn0.c2ln"
  const request = new Request("http://localhost/api/outlooks/parse", {
    headers: { Authorization: `Bearer ${fakeToken}` },
  })

  try {
    await assert.rejects(
      () => authenticateOutlookRequest(request),
      (error: unknown) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "not-configured",
    )

    process.env.OUTLOOK_AI_MODE = "mock"
    const mockUser = await authenticateOutlookRequest(request)
    assert.equal(mockUser.uid, "unverified")
    assert.equal(mockUser.verified, false)
  } finally {
    restoreEnv("OPENAI_API_KEY", previous.apiKey)
    restoreEnv("OUTLOOK_AI_MODE", previous.mode)
    restoreEnv("FIREBASE_SERVICE_ACCOUNT_KEY", previous.serviceAccount)
    restoreEnv("GOOGLE_APPLICATION_CREDENTIALS", previous.applicationCredentials)
  }
})

test(`generation guard allows ${OUTLOOK_AI_LIMITS.generationRequestsPerWindow} requests per window`, () => {
  let state = emptyOutlookAiGuardState()
  const nowMs = Date.UTC(2026, 6, 18, 12)

  for (let index = 0; index < OUTLOOK_AI_LIMITS.generationRequestsPerWindow; index += 1) {
    const acquired = acquireOutlookAiGuardState(state, {
      operation: "generation",
      requestHash: `request-${index}`,
      keyHash: `key-${index}`,
      leaseId: `lease-${index}`,
      nowMs: nowMs + index,
    })
    state = failOutlookAiGuardState(acquired.state, acquired.lease)
  }

  assertAiErrorCode(() => acquireOutlookAiGuardState(state, {
    operation: "generation",
    requestHash: "request-over-limit",
    keyHash: "key-over-limit",
    leaseId: "lease-over-limit",
    nowMs: nowMs + 20,
  }), "rate-limited")
})

test(`transcription guard allows ${OUTLOOK_AI_LIMITS.transcriptionRequestsPerWindow} requests and shares the active lock`, () => {
  let state = emptyOutlookAiGuardState()
  const nowMs = Date.UTC(2026, 6, 18, 12)
  const active = acquireOutlookAiGuardState(state, {
    operation: "generation",
    requestHash: "generation-active",
    keyHash: "generation-key",
    leaseId: "generation-lease",
    nowMs,
  })
  state = active.state

  assertAiErrorCode(() => acquireOutlookAiGuardState(state, {
    operation: "transcription",
    requestHash: "voice-concurrent",
    keyHash: "voice-concurrent-key",
    leaseId: "voice-concurrent-lease",
    nowMs: nowMs + 1,
  }), "request-in-progress")

  state = failOutlookAiGuardState(state, active.lease)
  for (let index = 0; index < OUTLOOK_AI_LIMITS.transcriptionRequestsPerWindow; index += 1) {
    const acquired = acquireOutlookAiGuardState(state, {
      operation: "transcription",
      requestHash: `voice-${index}`,
      keyHash: `voice-key-${index}`,
      leaseId: `voice-lease-${index}`,
      nowMs: nowMs + 10 + index,
    })
    state = failOutlookAiGuardState(acquired.state, acquired.lease)
  }

  assertAiErrorCode(() => acquireOutlookAiGuardState(state, {
    operation: "transcription",
    requestHash: "voice-over-limit",
    keyHash: "voice-key-over-limit",
    leaseId: "voice-lease-over-limit",
    nowMs: nowMs + 20,
  }), "rate-limited")
})

test("guard blocks completed duplicate payloads and idempotency-key reuse", () => {
  const nowMs = Date.UTC(2026, 6, 18, 12)
  const first = acquireOutlookAiGuardState(emptyOutlookAiGuardState(), {
    operation: "generation",
    requestHash: "same-payload",
    keyHash: "same-key",
    leaseId: "first-lease",
    nowMs,
  })

  assertAiErrorCode(() => acquireOutlookAiGuardState(first.state, {
    operation: "generation",
    requestHash: "different-payload",
    keyHash: "same-key",
    leaseId: "second-lease",
    nowMs: nowMs + 1,
  }), "invalid-request")

  const completed = completeOutlookAiGuardState(first.state, first.lease, nowMs + 100)
  assertAiErrorCode(() => acquireOutlookAiGuardState(completed, {
    operation: "generation",
    requestHash: "same-payload",
    keyHash: "new-key",
    leaseId: "third-lease",
    nowMs: nowMs + 101,
  }), "duplicate-request")
})

test("audio validation checks actual duration and declared media type", async () => {
  const validAudio = new File([wavBytes(1)], "voice.wav", { type: "audio/wav" })
  const metadata = await validateOutlookAudio(validAudio)
  assert.ok(metadata.durationMs >= 990 && metadata.durationMs <= 1010)
  assert.equal(metadata.durationSource, "metadata")

  const tooLong = new File([wavBytes(181)], "long.wav", { type: "audio/wav" })
  await assert.rejects(() => validateOutlookAudio(tooLong), hasAiErrorCode("payload-too-large"))

  const wrongType = new File([wavBytes(1)], "voice.txt", { type: "text/plain" })
  await assert.rejects(() => validateOutlookAudio(wrongType), hasAiErrorCode("invalid-audio"))
})

test("audio validation accepts Safari fragmented MP4 duration measured by the recorder", async () => {
  const fragmentedMp4 = new File([new Uint8Array([
    0, 0, 0, 12, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20,
  ])], "voice.m4a", {
    type: "audio/mp4",
  })

  const metadata = await validateOutlookAudio(fragmentedMp4, 4_250)
  assert.equal(metadata.durationMs, 4_250)
  assert.equal(metadata.durationSource, "recorder")

  await assert.rejects(
    () => validateOutlookAudio(fragmentedMp4),
    hasAiErrorCode("invalid-audio"),
  )
  await assert.rejects(
    () => validateOutlookAudio(fragmentedMp4, (OUTLOOK_AI_LIMITS.maxAudioSeconds + 2) * 1000),
    hasAiErrorCode("payload-too-large"),
  )
})

test("OpenAI 429 retries with backoff but insufficient credit never retries", async () => {
  const originalFetch = globalThis.fetch
  const schema = { name: "test", schema: { type: "object", properties: {}, additionalProperties: false } }
  let calls = 0

  try {
    globalThis.fetch = async () => {
      calls += 1
      if (calls === 1) {
        return Response.json({ error: { code: "rate_limit_exceeded" } }, { status: 429 })
      }
      return Response.json({ choices: [{ message: { content: "{}" } }] })
    }
    const result = await createStructuredJson(
      {
        apiKey: "test-key",
        baseUrl: "https://example.invalid",
        timeoutMs: 1000,
        maxRateLimitRetries: 2,
        retryBaseDelayMs: 1,
      },
      { model: "gpt-test", system: "system", user: "user", schema },
    )
    assert.deepEqual(result, {})
    assert.equal(calls, 2)

    calls = 0
    globalThis.fetch = async () => {
      calls += 1
      return Response.json({ error: { code: "insufficient_quota" } }, { status: 429 })
    }
    await assert.rejects(
      () => createStructuredJson(
        {
          apiKey: "test-key",
          baseUrl: "https://example.invalid",
          timeoutMs: 1000,
          maxRateLimitRetries: 2,
          retryBaseDelayMs: 1,
        },
        { model: "gpt-test", system: "system", user: "user", schema },
      ),
      hasAiErrorCode("provider-credit"),
    )
    assert.equal(calls, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

function parseOutlookRequest(value: unknown) {
  return parseOutlookRequestSchema.safeParse(value)
}

function assertAiErrorCode(run: () => unknown, code: string): void {
  assert.throws(run, hasAiErrorCode(code))
}

function hasAiErrorCode(code: string): (error: unknown) => boolean {
  return (error) => error instanceof AiError && error.code === code
}

function wavBytes(seconds: number): Uint8Array {
  const sampleRate = 8000
  const dataLength = sampleRate * seconds
  const buffer = new ArrayBuffer(44 + dataLength)
  const view = new DataView(buffer)
  const write = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index))
  }
  write(0, "RIFF")
  view.setUint32(4, 36 + dataLength, true)
  write(8, "WAVE")
  write(12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate, true)
  view.setUint16(32, 1, true)
  view.setUint16(34, 8, true)
  write(36, "data")
  view.setUint32(40, dataLength, true)
  return new Uint8Array(buffer)
}
