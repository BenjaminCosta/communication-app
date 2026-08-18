import assert from "node:assert/strict"
import test from "node:test"
import { createHash } from "node:crypto"
import { hashWhatsAppPhoneNumber, identitySnapshotFromSenderIdentity, phoneReference } from "../lib/courtney-roberts-center/identity"
import {
  isApprovedCourtneyRobertsCenterAdminEmailForTests,
  parseCourtneyRobertsCenterAdminEmailsForTests,
} from "../lib/courtney-roberts-center/access"
import { toConversationSummaryForTests, toMessageForTests } from "../lib/courtney-roberts-center/read-api"
import type { WhatsAppSenderIdentity } from "../lib/whatsapp-svc-identity"

test("hashWhatsAppPhoneNumber matches the sha256(phone) convention lib/whatsapp-conversation-memory.ts uses", () => {
  const phone = "15551234567"
  assert.equal(hashWhatsAppPhoneNumber(phone), createHash("sha256").update(phone).digest("hex"))
})

test("phoneReference keeps only the last 4 normalized digits", () => {
  assert.equal(phoneReference("+1 (555) 123-4567"), "4567")
  assert.equal(phoneReference("5491122334455"), "4455")
})

test("phoneReference falls back to whatever digits exist for a too-short number", () => {
  assert.equal(phoneReference("123"), "123")
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

test("admin allowlist: case- and whitespace-insensitive match", () => {
  const allowlist = parseCourtneyRobertsCenterAdminEmailsForTests(" Ben@Example.com , j@supervisioncompany.com")
  assert.equal(isApprovedCourtneyRobertsCenterAdminEmailForTests("ben@example.com", allowlist), true)
  assert.equal(isApprovedCourtneyRobertsCenterAdminEmailForTests("  J@SUPERVISIONCOMPANY.COM  ", allowlist), true)
  assert.equal(isApprovedCourtneyRobertsCenterAdminEmailForTests("someone-else@example.com", allowlist), false)
})

test("admin allowlist: fails closed with no configured emails or no email on the token", () => {
  const empty = parseCourtneyRobertsCenterAdminEmailsForTests(undefined)
  assert.equal(empty.size, 0)
  assert.equal(isApprovedCourtneyRobertsCenterAdminEmailForTests("anyone@example.com", empty), false)
  const allowlist = parseCourtneyRobertsCenterAdminEmailsForTests("ben@example.com")
  assert.equal(isApprovedCourtneyRobertsCenterAdminEmailForTests(null, allowlist), false)
  assert.equal(isApprovedCourtneyRobertsCenterAdminEmailForTests(undefined, allowlist), false)
})

test("toConversationSummaryForTests: defaults a malformed/legacy doc rather than throwing", () => {
  const summary = toConversationSummaryForTests("abc123", {})
  assert.ok(summary)
  assert.equal(summary?.displayName, "Unknown sender")
  assert.equal(summary?.identityStatus, "public")
  assert.equal(summary?.phoneHash, "abc123")
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
    phoneLast4: "4567",
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
    phoneLast4: "4567",
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
