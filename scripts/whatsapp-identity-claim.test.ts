import assert from "node:assert/strict"
import test from "node:test"
import {
  IdentityClaimConflictError,
  isPendingIdentityClaimExpired,
  resolveIdentityClaim,
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

test("an expired pending claim is treated as if none existed — asks fresh instead of guessing", async () => {
  const stale: PendingIdentityClaim = { askedAtMs: 0 }
  const outcome = await resolveIdentityClaim({
    text: "j@supervisioncompany.com",
    pendingClaim: stale,
    senderPhoneNumber: "19085551279",
    provider: createProvider({ async findUserByEmail() { throw new Error("must not be called for an expired claim") } }),
    nowMs: 48 * 60 * 60 * 1_000, // 48h later
  })
  assert.equal(outcome.kind, "asked")
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
