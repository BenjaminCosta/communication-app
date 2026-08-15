import assert from "node:assert/strict"
import test from "node:test"
import { audienceForRole, buildCapabilityProfile, capabilityFocusLine } from "../lib/whatsapp-secretary/capability-profiles"
import { buildGuidedTourReply, isShowMeAroundRequest, tourStops } from "../lib/whatsapp-secretary/guided-tour"
import { CAPABILITY_NUDGE_INTERVAL_MS, buildCapabilityNudge } from "../lib/whatsapp-secretary/onboarding"
import { addCapabilityHint, isCapabilityQuestion, isGreetingOnly } from "../lib/whatsapp-response-ux"
import type { SelfContextSnapshot } from "../lib/whatsapp-secretary/self-context"
import type { SecretaryModule } from "../lib/whatsapp-secretary/tool-registry"

const NOW = Date.parse("2026-08-15T12:00:00.000Z")
const ALL: SecretaryModule[] = ["directory", "questCoral", "applications", "reports", "clocking", "outlooks", "messages", "knowledge", "me", "svc"]

function snapshot(overrides: Partial<SelfContextSnapshot> = {}): SelfContextSnapshot {
  return {
    identity: { name: "Ben Acosta", role: "Site Supervisor", hasLinkedAccount: true, recognizedVia: "directory-contact" },
    profile: { phone: null, email: null, companyName: "SVC", location: null, directoryRole: "Site Supervisor" },
    jobs: [{ name: "North Ridge", relationship: "Supervisor", contextId: "ctx-nr" }],
    companies: [],
    projects: [],
    reports: [],
    clock: null,
    outlooks: [],
    messages: null,
    application: null,
    gaps: [],
    ...overrides,
  }
}

// --- Who the person is decides what they see first -----------------------

test("a recognized role reorders capabilities without ever widening them", () => {
  const supervisor = buildCapabilityProfile(snapshot(), ALL)
  assert.equal(supervisor.audience, "field-supervision")
  assert.equal(supervisor.fromRole, true)
  assert.equal(supervisor.modules[0], "reports")

  const recruiter = buildCapabilityProfile(
    snapshot({ identity: { name: "Dana", role: "Recruiting Coordinator", hasLinkedAccount: true, recognizedVia: "directory-contact" } }),
    ALL,
  )
  assert.equal(recruiter.audience, "recruiting")
  assert.equal(recruiter.modules[0], "applications")

  // The hard boundary: a role can only reorder what access already allowed.
  const narrow = buildCapabilityProfile(snapshot(), ["directory", "knowledge"])
  assert.deepEqual(narrow.modules, ["directory", "knowledge"])
  assert.ok(!narrow.modules.includes("reports"), "a role must never surface an unreachable module")
})

test("an unrecognized or missing role falls back to real relationships, never a guess", () => {
  assert.equal(audienceForRole("Chief Vibes Officer"), null)
  assert.equal(audienceForRole(null), null)
  assert.equal(audienceForRole("   "), null)

  const byJobs = buildCapabilityProfile(
    snapshot({ identity: { name: "X", role: null, hasLinkedAccount: true, recognizedVia: "directory-contact" } }),
    ALL,
  )
  assert.equal(byJobs.fromRole, false)
  assert.equal(byJobs.audience, "field-supervision", "derived from having linked jobs")

  const byApplication = buildCapabilityProfile(
    snapshot({
      identity: { name: "X", role: null, hasLinkedAccount: false, recognizedVia: "directory-contact" },
      jobs: [],
      application: { candidateName: "X", jobName: "North Ridge", status: "submitted", updatedAt: null },
    }),
    ALL,
  )
  assert.equal(byApplication.audience, "recruiting")

  const nothing = buildCapabilityProfile(
    snapshot({ identity: { name: "X", role: null, hasLinkedAccount: false, recognizedVia: "directory-contact" }, jobs: [], projects: [] }),
    ALL,
  )
  assert.equal(nothing.audience, "general")
})

test("the focus line only claims a role when there really is one", () => {
  assert.match(capabilityFocusLine(buildCapabilityProfile(snapshot(), ALL), snapshot()), /^For Site Supervisor work/)

  const roleless = snapshot({ identity: { name: "X", role: null, hasLinkedAccount: true, recognizedVia: "directory-contact" } })
  const line = capabilityFocusLine(buildCapabilityProfile(roleless, ALL), roleless)
  assert.match(line, /^Based on what's linked to you in SVC/)
  assert.doesNotMatch(line, /work,/)

  const bare = snapshot({ identity: { name: "X", role: null, hasLinkedAccount: false, recognizedVia: "directory-contact" }, jobs: [], projects: [] })
  assert.match(capabilityFocusLine(buildCapabilityProfile(bare, ALL), bare), /^You can use me for/)
})

// --- Show me around ------------------------------------------------------

test("recognizes the ways people ask to be shown around, without swallowing real questions", () => {
  for (const phrase of ["show me around", "Show me around!", "give me a tour", "walk me through this", "get me started", "onboard me"]) {
    assert.equal(isShowMeAroundRequest(phrase), true, phrase)
  }
  for (const phrase of ["show me around North Ridge", "show me the reports", "what can you do?", "hi"]) {
    assert.equal(isShowMeAroundRequest(phrase), false, phrase)
  }
})

test("the tour ends in runnable questions, not documentation", () => {
  const reply = buildGuidedTourReply(snapshot({ clock: { jobName: "North Ridge", clockInAt: null } }), ALL)
  assert.equal(reply.presentation?.kind, "list")
  const rows = reply.presentation?.kind === "list" ? reply.presentation.rows : []

  assert.ok(rows.length >= 2)
  // The description carries the real question, because the selection comes back
  // as "Selected: <title> — <description>" and that is what gets answered.
  assert.equal(rows[0]?.description, "What should I know today?")
  assert.ok(rows.every((row) => (row.description?.length ?? 0) > 0))
  assert.match(reply.text, /four things/)
  assert.match(reply.text, /I'll actually run it now/)
})

test("the tour never offers a stop the person's data cannot back", () => {
  const bare = snapshot({ jobs: [], projects: [], clock: null })
  const stops = tourStops(bare)
  assert.ok(!stops.some((stop) => /my jobs|What should I know today/i.test(stop.question)))
  // But it still has somewhere to send them.
  assert.ok(stops.length > 0)
  assert.ok(stops.some((stop) => /How SVC works/i.test(stop.label)))
})

// --- Dynamic capability questions ----------------------------------------

test("separates a bare greeting from a capability question, and both from a real request", () => {
  assert.equal(isGreetingOnly("hey"), true)
  assert.equal(isGreetingOnly("what can you do?"), false)

  for (const phrase of [
    "what can you do?",
    "What can you do for me",
    "how can you help me?",
    "what can I ask you?",
    "what can i ask you about my work",
    "how should I use you?",
    "give me some examples",
  ]) {
    assert.equal(isCapabilityQuestion(phrase), true, phrase)
  }
  for (const phrase of ["what can you tell me about North Ridge?", "who is Courtney?", "show me around"]) {
    assert.equal(isCapabilityQuestion(phrase), false, phrase)
  }
})

// --- Progressive discovery ----------------------------------------------

test("teaches one adjacent capability after a real entity answer, and only occasionally", () => {
  const nudge = buildCapabilityNudge({
    usedModules: ["reports"],
    enabledModules: ALL,
    state: null,
    nowMs: NOW,
    answeredAboutEntity: true,
  })
  assert.ok(nudge)
  assert.match(nudge.line, /^I can also check /)
  assert.ok(!nudge.modules.includes("reports"), "never suggests what the turn already used")
  assert.ok(nudge.modules.length <= 3)
})

test("stays quiet when the turn wasn't about a record, or when it nudged recently", () => {
  assert.equal(
    buildCapabilityNudge({ usedModules: ["knowledge"], enabledModules: ALL, state: null, nowMs: NOW, answeredAboutEntity: false }),
    null,
  )
  assert.equal(
    buildCapabilityNudge({
      usedModules: ["reports"],
      enabledModules: ALL,
      state: { lastIntroAtMs: 0, capabilitySignature: "", lastCapabilityNudgeAtMs: NOW - 1_000 },
      nowMs: NOW,
      answeredAboutEntity: true,
    }),
    null,
  )
  // Past the interval it may teach again.
  assert.ok(
    buildCapabilityNudge({
      usedModules: ["reports"],
      enabledModules: ALL,
      state: { lastIntroAtMs: 0, capabilitySignature: "", lastCapabilityNudgeAtMs: NOW - CAPABILITY_NUDGE_INTERVAL_MS },
      nowMs: NOW,
      answeredAboutEntity: true,
    }),
  )
})

test("never suggests a capability the sender cannot reach", () => {
  const nudge = buildCapabilityNudge({
    usedModules: ["directory"],
    enabledModules: ["directory", "knowledge"],
    state: null,
    nowMs: NOW,
    answeredAboutEntity: true,
  })
  assert.equal(nudge, null, "nothing adjacent is reachable, so nothing is taught")
})

test("a hint is appended to an answer, but never at the cost of the answer", () => {
  const hinted = addCapabilityHint({ text: "North Ridge had a report yesterday." }, "I can also check its 3-Week Outlook — just ask.")
  assert.match(hinted.text, /report yesterday\.\n\nI can also check/)

  // Never on a disambiguation list — that turn is a question, not an answer.
  const list = addCapabilityHint(
    { text: "Pick one.", presentation: { kind: "list", body: "Pick one.", buttonText: "Select", sectionTitle: "Matches", rows: [{ id: "1", title: "A" }] } },
    "I can also check its reports — just ask.",
  )
  assert.doesNotMatch(list.text, /I can also check/)

  // Never when it would push the reply past the send cap.
  const long = addCapabilityHint({ text: "x".repeat(995) }, "I can also check its reports — just ask.")
  assert.equal(long.text.length, 995)
})
