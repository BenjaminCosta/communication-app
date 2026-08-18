import assert from "node:assert/strict"
import test from "node:test"
import {
  INTRO_REFRESH_INTERVAL_MS,
  buildCapabilitySignature,
  buildPrefixIntroduction,
  buildStandaloneIntroduction,
  decideIntroduction,
  type IntroductionDecision,
} from "../lib/whatsapp-secretary/onboarding"
import { resolveWhatsAppAccessPolicy } from "../lib/whatsapp-access-policy"
import { enabledSecretaryModules } from "../lib/whatsapp-secretary/tool-registry"
import type { SelfContextSnapshot } from "../lib/whatsapp-secretary/self-context"

const NOW = Date.parse("2026-08-14T12:00:00.000Z")

function signature(overrides: Partial<Parameters<typeof buildCapabilitySignature>[0]> = {}): string {
  return buildCapabilitySignature({
    level: "internal",
    modules: ["directory", "questCoral", "reports", "me"],
    role: "Site Supervisor",
    hasLinkedAccount: true,
    ...overrides,
  })
}

function snapshot(overrides: Partial<SelfContextSnapshot> = {}): SelfContextSnapshot {
  return {
    identity: { name: "Ben Acosta", role: "Site Supervisor", hasLinkedAccount: true, recognizedVia: "directory-contact" },
    profile: { phone: "+1 555 0100", email: "ben@svc.example", companyName: "SVC", location: "Miami, FL", directoryRole: "Site Supervisor" },
    jobs: [{ name: "North Ridge", relationship: "Supervisor", contextId: "ctx-north-ridge" }],
    companies: [{ name: "Turner", relationship: "Client" }],
    projects: [{ name: "Cool Breeze Rollout", status: "in_progress", involvement: "owner", nextStep: null, updatedAt: null }],
    reports: [{ jobName: "North Ridge", status: "submitted", createdAt: "2026-08-13T18:00:00.000Z" }],
    clock: null,
    outlooks: [],
    messages: null,
    application: null,
    gaps: [],
    ...overrides,
  }
}

function shown(decision: IntroductionDecision): Extract<IntroductionDecision, { show: true }> {
  assert.equal(decision.show, true)
  return decision as Extract<IntroductionDecision, { show: true }>
}

// --- When to introduce ---------------------------------------------------

test("introduces a genuinely new sender", () => {
  const decision = decideIntroduction({ state: null, signature: signature(), nowMs: NOW, hasConversationHistory: false })
  assert.deepEqual(decision, { show: true, reason: "first-contact", newModules: [] })
})

test("treats an existing conversation with no recorded intro as a refresher, not a first contact", () => {
  const decision = decideIntroduction({ state: null, signature: signature(), nowMs: NOW, hasConversationHistory: true })
  assert.equal(shown(decision).reason, "refresher")
})

test("stays quiet on every ordinary turn once introduced", () => {
  const current = signature()
  const decision = decideIntroduction({
    state: { lastIntroAtMs: NOW - 60_000, capabilitySignature: current },
    signature: current,
    nowMs: NOW,
    hasConversationHistory: true,
  })
  assert.deepEqual(decision, { show: false })
})

test("re-surfaces after the refresh interval, and not one turn before it", () => {
  const current = signature()
  const justUnder = decideIntroduction({
    state: { lastIntroAtMs: NOW - INTRO_REFRESH_INTERVAL_MS + 1, capabilitySignature: current },
    signature: current,
    nowMs: NOW,
    hasConversationHistory: true,
  })
  assert.equal(justUnder.show, false)

  const due = decideIntroduction({
    state: { lastIntroAtMs: NOW - INTRO_REFRESH_INTERVAL_MS, capabilitySignature: current },
    signature: current,
    nowMs: NOW,
    hasConversationHistory: true,
  })
  assert.equal(shown(due).reason, "refresher")
})

test("re-surfaces immediately when a new module becomes reachable, and names exactly what is new", () => {
  const before = signature({ modules: ["directory", "reports", "me"] })
  const after = signature({ modules: ["directory", "reports", "me", "messages", "outlooks"] })
  const decision = shown(
    decideIntroduction({ state: { lastIntroAtMs: NOW - 60_000, capabilitySignature: before }, signature: after, nowMs: NOW, hasConversationHistory: true }),
  )
  assert.equal(decision.reason, "capabilities-changed")
  assert.deepEqual(decision.newModules.sort(), ["messages", "outlooks"])
})

test("re-surfaces when the person gets linked to an SVC app account, or their role changes", () => {
  const unlinked = signature({ hasLinkedAccount: false })
  const linked = signature({ hasLinkedAccount: true })
  assert.equal(
    shown(decideIntroduction({ state: { lastIntroAtMs: NOW, capabilitySignature: unlinked }, signature: linked, nowMs: NOW, hasConversationHistory: true })).reason,
    "capabilities-changed",
  )

  const newRole = signature({ role: "Project Manager" })
  assert.equal(
    shown(decideIntroduction({ state: { lastIntroAtMs: NOW, capabilitySignature: signature() }, signature: newRole, nowMs: NOW, hasConversationHistory: true })).reason,
    "capabilities-changed",
  )
})

test("the signature ignores role casing/whitespace so cosmetic edits do not re-introduce", () => {
  assert.equal(signature({ role: "Site Supervisor" }), signature({ role: "  site supervisor " }))
})

test("the signature is derived from the real access policy's enabled modules", () => {
  const policy = resolveWhatsAppAccessPolicy({ personId: "contact-ben", userId: "user-ben", name: "Ben Acosta", role: "Site Supervisor" })
  const modules = enabledSecretaryModules(policy)
  assert.ok(modules.includes("me"))
  assert.ok(buildCapabilitySignature({ level: policy.level, modules, role: "Site Supervisor", hasLinkedAccount: true }).includes("me"))

  const publicPolicy = resolveWhatsAppAccessPolicy(null)
  assert.deepEqual(enabledSecretaryModules(publicPolicy), [])
})

// --- What the introduction says -----------------------------------------

test("the standalone card recognizes the person, states breadth, and offers runnable starters", () => {
  const card = buildStandaloneIntroduction(snapshot(), { show: true, reason: "first-contact", newModules: [] }, [
    "directory", "reports", "outlooks", "clocking", "messages", "knowledge", "svc",
  ])
  assert.match(card, /^Hey Ben — I'm Courtney Roberts, your SVC assistant\. I recognize you in SVC\./)
  assert.match(card, /I know you as Ben Acosta, Site Supervisor at SVC\./)
  // Breadth: it must show it reaches live operational data, not just say hello.
  assert.match(card, /live operational data/)
  // A recognized role reorders what it leads with.
  assert.match(card, /For Site Supervisor work, you'll probably use me most for/)
  assert.match(card, /A few good ways to start:/)
  assert.match(card, /What should I know today\?/)
  // The "you don't need commands" line is load-bearing: people assume syntax.
  assert.match(card, /No commands or exact names needed/)
  assert.match(card, /follow-ups work/)
})

test("the standalone card admits a missing role instead of inventing a title", () => {
  const card = buildStandaloneIntroduction(
    snapshot({ identity: { name: "Ben Acosta", role: null, hasLinkedAccount: false, recognizedVia: "directory-contact" } }),
    { show: true, reason: "first-contact", newModules: [] },
  )
  assert.match(card, /no role on file/)
  assert.doesNotMatch(card, /Supervisor/)
})

test("the standalone card claims no coverage at all for a sender with nothing on file", () => {
  const card = buildStandaloneIntroduction(
    snapshot({ jobs: [], companies: [], projects: [], reports: [], profile: null, gaps: ["No jobs are linked to them in the SVC Directory."] }),
    { show: true, reason: "first-contact", newModules: [] },
  )
  assert.doesNotMatch(card, /I can see/)
  assert.doesNotMatch(card, /North Ridge|Cool Breeze/)
  // With nothing linked, it must not invite them to ask about "my jobs".
  assert.doesNotMatch(card, /What's happening on my jobs\?/)
  // It still teaches how to use the Secretary — that part is always true.
  assert.match(card, /No commands or exact names needed/)
})

test("a capability-change card leads with what is newly available", () => {
  const card = buildStandaloneIntroduction(snapshot(), { show: true, reason: "capabilities-changed", newModules: ["messages"] })
  assert.match(card, /New since we last spoke: I can now read Communications\./)
})

test("a capability-change card with no nameable new module still reads sensibly", () => {
  const card = buildStandaloneIntroduction(snapshot(), { show: true, reason: "capabilities-changed", newModules: [] })
  assert.match(card, /quick refresher/i)
})

test("the prefix version stays short enough to sit above a real answer", () => {
  const prefix = buildPrefixIntroduction(snapshot(), { show: true, reason: "first-contact", newModules: [] })
  assert.ok(prefix.length <= 220, `prefix was ${prefix.length} characters`)
  assert.match(prefix, /I'm Courtney Roberts, your SVC assistant\./)
  assert.match(prefix, /I know you as Ben Acosta, Site Supervisor at SVC\./)
  assert.match(prefix, /what can you do\?/)
  assert.ok(!prefix.includes("\n"), "the prefix is one line so the answer stays the focus")
})

test("a returning sender's prefix does not greet them as new", () => {
  const prefix = buildPrefixIntroduction(snapshot(), { show: true, reason: "refresher", newModules: [] })
  assert.match(prefix, /Courtney Roberts here\./)
  assert.match(prefix, /I still have you as Ben Acosta/)
})
