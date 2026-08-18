import assert from "node:assert/strict"
import test from "node:test"
import {
  IdentityClaimConflictError,
  isIdentityEmailOnlyMessage,
  isPendingIdentityClaimExpired,
  resolveIdentityClaim,
  shouldOfferIdentityEnrollment,
  type IdentityClaimLookupProvider,
  type IdentityClaimedUser,
  type PendingIdentityClaim,
} from "../lib/whatsapp-identity-claim"

function createProvider(overrides: Partial<IdentityClaimLookupProvider> = {}): IdentityClaimLookupProvider & { linkedCalls: { userId: string; phoneNormalized: string }[] } {
  const linkedCalls: { userId: string; phoneNormalized: string }[] = []
  return {
    linkedCalls,
    async findUserByEmail() {
      return null
    },
    async linkWhatsAppNumberToUser(userId, phoneNormalized) {
      linkedCalls.push({ userId, phoneNormalized })
    },
    ...overrides,
  }
}

test("no pending claim yet: asks the question and starts one", async () => {
  const outcome = await resolveIdentityClaim({
    text: "hey what's going on with the job",
    pendingClaim: null,
    senderPhoneNumber: "19085551279",
    provider: createProvider(),
    nowMs: 1000,
  })
  assert.equal(outcome.kind, "asked")
  assert.ok(outcome.kind === "asked" && outcome.pendingClaim.askedAtMs === 1000)
})

test("an expired pending claim with no email asks fresh instead of guessing", async () => {
  const stale: PendingIdentityClaim = { askedAtMs: 0 }
  const outcome = await resolveIdentityClaim({
    text: "sorry, been a while",
    pendingClaim: stale,
    senderPhoneNumber: "19085551279",
    provider: createProvider({ async findUserByEmail() { throw new Error("must not be called without an email") } }),
    nowMs: 48 * 60 * 60 * 1_000, // 48h later
  })
  assert.equal(outcome.kind, "asked")
})

test("an email is honored even when the pending prompt has gone stale — the TTL governs re-asking, not intent", async () => {
  const user: IdentityClaimedUser = { id: "user-joe", name: "Joe Haddad" }
  const outcome = await resolveIdentityClaim({
    text: "j@supervisioncompany.com",
    pendingClaim: { askedAtMs: 0 },
    senderPhoneNumber: "19085551279",
    provider: createProvider({ async findUserByEmail() { return user } }),
    nowMs: 48 * 60 * 60 * 1_000,
  })
  assert.equal(outcome.kind, "linked")
})

test("an email volunteered before any prompt links immediately instead of costing a round-trip", async () => {
  const user: IdentityClaimedUser = { id: "user-joe", name: "Joe Haddad" }
  const outcome = await resolveIdentityClaim({
    text: "hi, it's joe — j@supervisioncompany.com",
    pendingClaim: null,
    senderPhoneNumber: "19085551279",
    provider: createProvider({ async findUserByEmail() { return user } }),
    nowMs: 1000,
  })
  assert.equal(outcome.kind, "linked")
})

// ── "unrecognized" mode: enrollment for a number with NO SVC match at all ──

test("unrecognized mode with no email skips entirely, so the public answer is never replaced by an interrogation", async () => {
  const outcome = await resolveIdentityClaim({
    text: "what is the status on the wonder job in canton connecticut",
    pendingClaim: null,
    senderPhoneNumber: "19082945228",
    provider: createProvider({ async findUserByEmail() { throw new Error("must not be called without an email") } }),
    mode: "unrecognized",
    nowMs: 1000,
  })
  assert.equal(outcome.kind, "skipped")
})

test("unrecognized mode never issues the ambiguous 'more than one profile' prompt", async () => {
  const outcome = await resolveIdentityClaim({
    text: "this is the number that i use with svc",
    pendingClaim: { askedAtMs: 500 },
    senderPhoneNumber: "19082945228",
    provider: createProvider(),
    mode: "unrecognized",
    nowMs: 600,
  })
  assert.equal(outcome.kind, "skipped")
})

test("unrecognized mode links an unknown number once the sender supplies a matching SVC email", async () => {
  const user: IdentityClaimedUser = { id: "user-new", name: "New Person", role: "Superintendent" }
  const provider = createProvider({ async findUserByEmail() { return user } })
  const outcome = await resolveIdentityClaim({
    text: "sure, it's new@supervisioncompany.com",
    pendingClaim: { askedAtMs: 500 },
    senderPhoneNumber: "19082945228",
    provider,
    mode: "unrecognized",
    nowMs: 600,
  })
  assert.equal(outcome.kind, "linked")
  assert.ok(outcome.kind === "linked" && outcome.identity.userId === "user-new")
  assert.ok(outcome.kind === "linked" && outcome.identity.resolvedTier === "whatsapp-link")
  assert.deepEqual(provider.linkedCalls, [{ userId: "user-new", phoneNormalized: "9082945228" }])
})

test("unrecognized mode with an unmatched email still reports the failure rather than skipping silently", async () => {
  const outcome = await resolveIdentityClaim({
    text: "nobody@nowhere.com",
    pendingClaim: null,
    senderPhoneNumber: "19082945228",
    provider: createProvider(),
    mode: "unrecognized",
    nowMs: 1000,
  })
  assert.equal(outcome.kind, "not-matched")
})

// ── The enrollment offer is made once per TTL, not on every public reply ───

test("shouldOfferIdentityEnrollment: offered when nothing is pending, and again once the previous offer went stale", () => {
  assert.equal(shouldOfferIdentityEnrollment(null, 1000), true)
  assert.equal(shouldOfferIdentityEnrollment({ askedAtMs: 1000 }, 2000), false)
  assert.equal(shouldOfferIdentityEnrollment({ askedAtMs: 0 }, 48 * 60 * 60 * 1_000), true)
})

test("a reply with no email-shaped text does not attempt a lookup", async () => {
  const provider = createProvider({ async findUserByEmail() { throw new Error("must not be called without an email in the text") } })
  const outcome = await resolveIdentityClaim({
    text: "I don't have my email handy",
    pendingClaim: { askedAtMs: 500 },
    senderPhoneNumber: "19085551279",
    provider,
    nowMs: 600,
  })
  assert.equal(outcome.kind, "not-matched")
})

test("an email that matches no /users account re-prompts, keeping the pending claim alive", async () => {
  const outcome = await resolveIdentityClaim({
    text: "nobody@nowhere.com",
    pendingClaim: { askedAtMs: 500 },
    senderPhoneNumber: "19085551279",
    provider: createProvider(),
    nowMs: 600,
  })
  assert.equal(outcome.kind, "not-matched")
  assert.ok(outcome.kind === "not-matched" && outcome.pendingClaim.askedAtMs === 500)
})

test("extracts the email even when the sender adds surrounding words", async () => {
  const user: IdentityClaimedUser = { id: "user-joe", name: "Joe Haddad" }
  const provider = createProvider({ async findUserByEmail(email) { return email === "j@supervisioncompany.com" ? user : null } })
  const outcome = await resolveIdentityClaim({
    text: "it's j@supervisioncompany.com !",
    pendingClaim: { askedAtMs: 500 },
    senderPhoneNumber: "19085551279",
    provider,
    nowMs: 600,
  })
  assert.equal(outcome.kind, "linked")
})

test("an unambiguous email match links the number and returns an explicit-tier identity", async () => {
  const user: IdentityClaimedUser = { id: "user-joe", name: "Joe Haddad", role: "Foreman" }
  const provider = createProvider({ async findUserByEmail() { return user } })
  const outcome = await resolveIdentityClaim({
    text: "j@supervisioncompany.com",
    pendingClaim: { askedAtMs: 500 },
    senderPhoneNumber: "+1 (908) 555-1279",
    provider,
    nowMs: 600,
  })
  assert.equal(outcome.kind, "linked")
  assert.ok(outcome.kind === "linked" && outcome.identity.userId === "user-joe")
  assert.ok(outcome.kind === "linked" && outcome.identity.resolvedVia === "explicit")
  assert.ok(outcome.kind === "linked" && outcome.identity.role === "Foreman")
  assert.deepEqual(provider.linkedCalls, [{ userId: "user-joe", phoneNormalized: "9085551279" }])
  // The confirmation is a prefix for the real answer, so it must not tell the
  // sender to send their question again — the webhook answers it this turn.
  assert.ok(outcome.kind === "linked" && !/again/i.test(outcome.reply))
})

test("a conflicting link (number already claimed by someone else) declines instead of overwriting", async () => {
  const user: IdentityClaimedUser = { id: "user-joe", name: "Joe Haddad" }
  const provider = createProvider({
    async findUserByEmail() { return user },
    async linkWhatsAppNumberToUser() { throw new IdentityClaimConflictError("already linked elsewhere") },
  })
  const outcome = await resolveIdentityClaim({
    text: "j@supervisioncompany.com",
    pendingClaim: { askedAtMs: 500 },
    senderPhoneNumber: "19085551279",
    provider,
    nowMs: 600,
  })
  assert.equal(outcome.kind, "not-matched")
})

test("isPendingIdentityClaimExpired", () => {
  assert.equal(isPendingIdentityClaimExpired({ askedAtMs: 0 }, 1000), false)
  assert.equal(isPendingIdentityClaimExpired({ askedAtMs: 0 }, 25 * 60 * 60 * 1_000), true)
})

// ── Is there a question to carry forward past the link? ────────────────────

test("a message that is only the email (however it's phrased) has no question to answer", () => {
  for (const text of [
    "j@supervisioncompany.com",
    "  J@SuperVisionCompany.com  ",
    "it's j@supervisioncompany.com",
    "my email is j@supervisioncompany.com",
    "sure — j@supervisioncompany.com, thanks!",
    "hi, this is my svc email: j@supervisioncompany.com",
  ]) {
    assert.equal(isIdentityEmailOnlyMessage(text), true, text)
  }
})

test("an email sent alongside a real request keeps the request, so the turn still answers it", () => {
  for (const text of [
    "what's the status on the wonder job? j@supervisioncompany.com",
    "j@supervisioncompany.com — who is the foreman on Canton?",
    "clock me in, j@supervisioncompany.com",
  ]) {
    assert.equal(isIdentityEmailOnlyMessage(text), false, text)
  }
})

test("a message with no email at all is never treated as email-only", () => {
  assert.equal(isIdentityEmailOnlyMessage("this is the number that i use with svc"), false)
  assert.equal(isIdentityEmailOnlyMessage(""), false)
})
