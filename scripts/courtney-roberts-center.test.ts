import assert from "node:assert/strict"
import test from "node:test"
import { createHash } from "node:crypto"
import { hashWhatsAppPhoneNumber, identitySnapshotFromSenderIdentity, identitySnapshotWriteFields, reconcileIdentitySnapshot } from "../lib/courtney-roberts-center/identity"
import { toConversationSummaryForTests, toMessageForTests } from "../lib/courtney-roberts-center/read-api"
import { toCourtneyRobertsCenterAccessUserForTests } from "../lib/courtney-roberts-center/admin-management"
import { CourtneyRobertsCenterLinkError, normalizeLinkEmail } from "../lib/courtney-roberts-center/link-identity"
import type { WhatsAppSenderIdentity } from "../lib/whatsapp-svc-identity"

test("hashWhatsAppPhoneNumber matches the sha256(phone) convention lib/whatsapp-conversation-memory.ts uses", () => {
  const phone = "15551234567"
  assert.equal(hashWhatsAppPhoneNumber(phone), createHash("sha256").update(phone).digest("hex"))
})

test("identitySnapshotFromSenderIdentity: unresolved sender is public with a placeholder name", () => {
  assert.deepEqual(identitySnapshotFromSenderIdentity(null), {
    identityStatus: "public",
    displayName: "Unknown sender",
  })
})

test("identitySnapshotFromSenderIdentity: resolved sender is internal and carries through ids", () => {
  const identity: WhatsAppSenderIdentity = {
    personId: "contact-1",
    userId: "user-1",
    name: "Ben Acosta",
    role: "Site Supervisor",
    resolvedVia: "explicit",
  }
  assert.deepEqual(identitySnapshotFromSenderIdentity(identity), {
    identityStatus: "internal",
    displayName: "Ben Acosta",
    resolvedUserId: "user-1",
    resolvedPersonId: "contact-1",
    resolvedVia: "explicit",
  })
})

test("identitySnapshotFromSenderIdentity: resolved sender with no linked account omits resolvedUserId", () => {
  const identity: WhatsAppSenderIdentity = { personId: "contact-2", name: "Someone", resolvedVia: "fallback" }
  const snapshot = identitySnapshotFromSenderIdentity(identity)
  assert.equal(snapshot.identityStatus, "internal")
  assert.equal("resolvedUserId" in snapshot, false)
  assert.equal(snapshot.resolvedVia, "fallback")
})

test("toCourtneyRobertsCenterAccessUserForTests: reads the access field and falls back to email for a missing name", () => {
  assert.deepEqual(toCourtneyRobertsCenterAccessUserForTests("uid-1", { email: "j@supervisioncompany.com", courtneyRobertsCenterAccess: true }), {
    uid: "uid-1",
    name: "j@supervisioncompany.com",
    email: "j@supervisioncompany.com",
    hasAccess: true,
  })
})

test("toCourtneyRobertsCenterAccessUserForTests: no access field or a non-true value both mean no access", () => {
  assert.equal(toCourtneyRobertsCenterAccessUserForTests("uid-1", { name: "Ben" }).hasAccess, false)
  assert.equal(toCourtneyRobertsCenterAccessUserForTests("uid-1", { name: "Ben", courtneyRobertsCenterAccess: "true" }).hasAccess, false)
})

test("toCourtneyRobertsCenterAccessUserForTests: a doc with neither name nor email still gets a displayable label", () => {
  assert.equal(toCourtneyRobertsCenterAccessUserForTests("uid-1", {}).name, "Unknown")
})

test("toConversationSummaryForTests: defaults a malformed/legacy doc rather than throwing", () => {
  const summary = toConversationSummaryForTests("abc123", {})
  assert.ok(summary)
  assert.equal(summary?.displayName, "Unknown sender")
  assert.equal(summary?.identityStatus, "public")
  assert.equal(summary?.phoneHash, "abc123")
  assert.equal(summary?.phoneNumber, "")
  assert.equal(summary?.messageCount, 0)
})

test("toConversationSummaryForTests: reads a well-formed internal conversation doc", () => {
  const summary = toConversationSummaryForTests("abc123", {
    displayName: "Ben Acosta",
    identityStatus: "internal",
    resolvedUserId: "user-1",
    resolvedPersonId: "contact-1",
    resolvedVia: "explicit",
    phoneHash: "abc123",
    phoneNumber: "15551234567",
    messageCount: 3,
    lastMessageAtMs: 1000,
    lastMessagePreview: "Hello",
    lastMessageRole: "assistant",
    createdAtMs: 500,
    updatedAtMs: 1000,
  })
  assert.deepEqual(summary, {
    id: "abc123",
    displayName: "Ben Acosta",
    identityStatus: "internal",
    resolvedUserId: "user-1",
    resolvedPersonId: "contact-1",
    resolvedVia: "explicit",
    phoneHash: "abc123",
    phoneNumber: "15551234567",
    messageCount: 3,
    lastMessageAtMs: 1000,
    lastMessagePreview: "Hello",
    lastMessageRole: "assistant",
    createdAtMs: 500,
    updatedAtMs: 1000,
  })
})

test("toConversationSummaryForTests: returns null for a non-object doc", () => {
  assert.equal(toConversationSummaryForTests("abc123", null), null)
  assert.equal(toConversationSummaryForTests("abc123", "not an object"), null)
})

test("toMessageForTests: requires role, text and createdAtMs", () => {
  assert.equal(toMessageForTests("m1", { role: "user", text: "hi" }), null)
  assert.equal(toMessageForTests("m1", { role: "not-a-role", text: "hi", createdAtMs: 1 }), null)
  assert.deepEqual(toMessageForTests("m1", { role: "user", text: "hi", createdAtMs: 1 }), {
    id: "m1",
    role: "user",
    text: "hi",
    createdAtMs: 1,
  })
})

test("toMessageForTests: reads assistant presentation kind and attachment metadata, never a bare url", () => {
  const message = toMessageForTests("assistant:wamid.1", {
    role: "assistant",
    text: "Here is the report.",
    createdAtMs: 2,
    presentationKind: "cta_url",
    attachments: [{ kind: "document", filename: "report.pdf", url: "https://example.com/should-not-appear" }],
  })
  assert.deepEqual(message, {
    id: "assistant:wamid.1",
    role: "assistant",
    text: "Here is the report.",
    createdAtMs: 2,
    presentationKind: "cta_url",
    attachments: [{ kind: "document", filename: "report.pdf" }],
  })
})

test("toMessageForTests: drops an attachment entry with no recognizable kind", () => {
  const message = toMessageForTests("assistant:wamid.2", {
    role: "assistant",
    text: "ok",
    createdAtMs: 3,
    attachments: [{ kind: "video" }],
  })
  assert.deepEqual(message, { id: "assistant:wamid.2", role: "assistant", text: "ok", createdAtMs: 3 })
})

// ── Admin manual identity linking ──────────────────────────────────────────

test("normalizeLinkEmail accepts a single well-formed address and lower-cases it", () => {
  assert.equal(normalizeLinkEmail("  Joe@SuperVisionCompany.com "), "joe@supervisioncompany.com")
})

test("normalizeLinkEmail rejects anything that is not exactly one address", () => {
  for (const value of ["", "   ", "not-an-email", "joe@", "@supervisioncompany.com", "joe@svc", "a@b.com c@d.com", null, 42]) {
    assert.throws(() => normalizeLinkEmail(value), CourtneyRobertsCenterLinkError, JSON.stringify(value))
  }
})

test("a link failure carries the HTTP status the route should return", () => {
  try {
    normalizeLinkEmail("nope")
    assert.fail("should have thrown")
  } catch (error) {
    assert.ok(error instanceof CourtneyRobertsCenterLinkError)
    assert.equal(error.status, 400)
  }
})

// ── The Center must follow identity in the direction it really moves ───────

test("a claimed or admin-linked sender flips the thread from public to internal", () => {
  const snapshot = reconcileIdentitySnapshot(
    { identityStatus: "public", displayName: "Unknown sender" },
    { identityStatus: "internal", displayName: "Joe Haddad", resolvedUserId: "user-joe", resolvedPersonId: "contact-joe", resolvedVia: "explicit" },
  )

  assert.equal(snapshot.identityStatus, "internal")
  assert.equal(snapshot.displayName, "Joe Haddad")
  assert.equal(snapshot.resolvedUserId, "user-joe")
})

test("a failed resolution never downgrades an already-identified thread back to Unknown sender", () => {
  const existing = {
    identityStatus: "internal" as const,
    displayName: "Joe Haddad",
    resolvedUserId: "user-joe",
    resolvedPersonId: "contact-joe",
    resolvedVia: "explicit" as const,
  }
  const snapshot = reconcileIdentitySnapshot(existing, { identityStatus: "public", displayName: "Unknown sender" })

  assert.deepEqual(snapshot, existing)
})

test("re-linking a number to a different person is reflected immediately", () => {
  const snapshot = reconcileIdentitySnapshot(
    { identityStatus: "internal", displayName: "Joe Haddad", resolvedUserId: "user-joe" },
    { identityStatus: "internal", displayName: "Mary Ruiz", resolvedUserId: "user-mary", resolvedPersonId: "contact-mary" },
  )

  assert.equal(snapshot.displayName, "Mary Ruiz")
  assert.equal(snapshot.resolvedUserId, "user-mary")
  // The previous person's ids must not survive as merge leftovers.
  assert.equal(snapshot.resolvedPersonId, "contact-mary")
})

test("a brand-new conversation with no prior document takes the incoming snapshot as-is", () => {
  const incoming = { identityStatus: "public" as const, displayName: "Unknown sender" }
  assert.deepEqual(reconcileIdentitySnapshot(undefined, incoming), incoming)
  assert.deepEqual(reconcileIdentitySnapshot(null, incoming), incoming)
})

test("a malformed prior document (internal with no name) is not preserved over a fresh snapshot", () => {
  const incoming = { identityStatus: "public" as const, displayName: "Unknown sender" }
  assert.deepEqual(reconcileIdentitySnapshot({ identityStatus: "internal" }, incoming), incoming)
})

test("identitySnapshotWriteFields always writes every key, so a merge cannot leave the previous person's ids behind", () => {
  assert.deepEqual(identitySnapshotWriteFields({ identityStatus: "public", displayName: "Unknown sender" }), {
    identityStatus: "public",
    displayName: "Unknown sender",
    resolvedUserId: null,
    resolvedPersonId: null,
    resolvedVia: null,
  })
  assert.deepEqual(
    identitySnapshotWriteFields({ identityStatus: "internal", displayName: "Directory Only", resolvedPersonId: "contact-x" }),
    {
      identityStatus: "internal",
      displayName: "Directory Only",
      resolvedUserId: null,
      resolvedPersonId: "contact-x",
      resolvedVia: null,
    },
  )
})
