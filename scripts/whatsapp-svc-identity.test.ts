import assert from "node:assert/strict"
import test from "node:test"
import {
  classifyWhatsAppIdentityMatches,
  resolveWhatsAppIdentityFromMatches,
  type WhatsAppIdentityDocument,
  type WhatsAppIdentityMatchSet,
} from "../lib/whatsapp-svc-identity"

function contactDoc(id: string, name: string, opts: { linkedUserId?: string; visibility?: string; role?: string } = {}): WhatsAppIdentityDocument {
  return {
    id,
    data: {
      name,
      visibility: opts.visibility ?? "global",
      linkedUserId: opts.linkedUserId ?? null,
      ...(opts.role ? { role: opts.role } : {}),
    },
  }
}

function userDoc(id: string, name: string, opts: { role?: string } = {}): WhatsAppIdentityDocument {
  return { id, data: { name, ...(opts.role ? { role: opts.role } : {}) } }
}

function emptyMatches(): WhatsAppIdentityMatchSet {
  return { contactsByPhone: [], contactsByWhatsApp: [], usersByPhone: [], usersByWhatsApp: [] }
}

// ── Joseph's exact production scenario ──────────────────────────────────────
// Reconstructed from the real audit (2026-08-16, fictional names/ids): one
// phone number shared by three /contacts docs, none of which ever had
// whatsappPhoneNormalized set (nobody ran the admin link script), and no
// /users.phoneNormalized backfill yet either — so both tiers rely entirely on
// the fallback (contactsByPhone) query, exactly like production before any
// backfill runs.

test("a single linked contact wins over any number of unlinked duplicate contacts sharing its phone (Joseph's case)", () => {
  const matches: WhatsAppIdentityMatchSet = {
    ...emptyMatches(),
    contactsByPhone: [
      contactDoc("contact-linked", "Joe Testman", { linkedUserId: "user-joe" }),
      contactDoc("contact-dup-1", "J Testman", {}), // unlinked vcf-import duplicate
      contactDoc("contact-dup-2", "Yvonne Unrelated", {}), // unlinked, mislabeled import artifact
    ],
  }

  const identity = resolveWhatsAppIdentityFromMatches(matches)
  assert.ok(identity)
  assert.equal(identity.userId, "user-joe")
  assert.equal(identity.name, "Joe Testman")
  assert.equal(identity.resolvedVia, "fallback")
})

test("still resolves the linked identity regardless of how many unlinked duplicates match", () => {
  const matches: WhatsAppIdentityMatchSet = {
    ...emptyMatches(),
    contactsByPhone: [
      contactDoc("dup-1", "Someone", {}),
      contactDoc("dup-2", "Someone Else", {}),
      contactDoc("dup-3", "Another One", {}),
      contactDoc("contact-linked", "Real Person", { linkedUserId: "user-real" }),
    ],
  }

  const identity = resolveWhatsAppIdentityFromMatches(matches)
  assert.equal(identity?.userId, "user-real")
})

test("two contacts linked to the SAME account collapse into one resolved identity, not a conflict", () => {
  const matches: WhatsAppIdentityMatchSet = {
    ...emptyMatches(),
    contactsByPhone: [
      contactDoc("contact-a", "Joe Testman", { linkedUserId: "user-joe" }),
      contactDoc("contact-b", "J. Testman (duplicate entry)", { linkedUserId: "user-joe" }),
      contactDoc("dup", "Unrelated", {}),
    ],
  }

  const identity = resolveWhatsAppIdentityFromMatches(matches)
  assert.equal(identity?.userId, "user-joe")
})

// ── Genuine ambiguity must stay conservative ────────────────────────────────

test("two DIFFERENT linked accounts sharing a phone stays ambiguous (returns null)", () => {
  const matches: WhatsAppIdentityMatchSet = {
    ...emptyMatches(),
    contactsByPhone: [
      contactDoc("contact-a", "Person A", { linkedUserId: "user-a" }),
      contactDoc("contact-b", "Person B", { linkedUserId: "user-b" }),
    ],
  }

  assert.equal(resolveWhatsAppIdentityFromMatches(matches), null)
})

test("two unlinked contacts with no registered account to break the tie stays ambiguous (returns null)", () => {
  const matches: WhatsAppIdentityMatchSet = {
    ...emptyMatches(),
    contactsByPhone: [
      contactDoc("contact-a", "Robert Somebody", {}),
      contactDoc("contact-b", "Mary Someone Else", {}),
    ],
  }

  assert.equal(resolveWhatsAppIdentityFromMatches(matches), null)
})

// ── Baseline behavior, unchanged ────────────────────────────────────────────

test("a single unlinked contact match resolves fine", () => {
  const matches: WhatsAppIdentityMatchSet = {
    ...emptyMatches(),
    contactsByPhone: [contactDoc("contact-only", "Solo Person", {})],
  }

  const identity = resolveWhatsAppIdentityFromMatches(matches)
  assert.equal(identity?.name, "Solo Person")
  assert.equal(identity?.userId, undefined)
  assert.equal(identity?.resolvedVia, "fallback")
})

test("no matches at all resolves to null", () => {
  assert.equal(resolveWhatsAppIdentityFromMatches(emptyMatches()), null)
})

test("a private contact is excluded from matching entirely", () => {
  const matches: WhatsAppIdentityMatchSet = {
    ...emptyMatches(),
    contactsByPhone: [contactDoc("private-contact", "Hidden Person", { visibility: "private" })],
  }

  assert.equal(resolveWhatsAppIdentityFromMatches(matches), null)
})

// ── /users and explicit WhatsApp links are the strongest source of truth ───

test("an explicit WhatsApp-link match wins outright and never even considers the fallback tier", () => {
  const matches: WhatsAppIdentityMatchSet = {
    contactsByPhone: [contactDoc("fallback-contact", "Wrong Fallback Person", { linkedUserId: "user-fallback" })],
    contactsByWhatsApp: [],
    usersByPhone: [],
    usersByWhatsApp: [userDoc("user-real", "Real Verified Person")],
  }

  const identity = resolveWhatsAppIdentityFromMatches(matches)
  assert.equal(identity?.userId, "user-real")
  assert.equal(identity?.name, "Real Verified Person")
  assert.equal(identity?.resolvedVia, "explicit")
})

test("a registered user's own profile phone (usersByPhone) alone resolves the identity", () => {
  const matches: WhatsAppIdentityMatchSet = {
    ...emptyMatches(),
    usersByPhone: [userDoc("user-profile-phone", "Profile Phone Person")],
  }

  const identity = resolveWhatsAppIdentityFromMatches(matches)
  assert.equal(identity?.userId, "user-profile-phone")
  assert.equal(identity?.resolvedVia, "explicit")
})

test("an explicit-tier link on a /contacts doc (contactsByWhatsApp) counts as explicit too", () => {
  const matches: WhatsAppIdentityMatchSet = {
    ...emptyMatches(),
    contactsByWhatsApp: [contactDoc("contact-linked-whatsapp", "Linked Via Contact", { linkedUserId: "user-x" })],
  }

  const identity = resolveWhatsAppIdentityFromMatches(matches)
  assert.equal(identity?.userId, "user-x")
  assert.equal(identity?.resolvedVia, "explicit")
})

test("an ambiguous explicit tier stays null and does NOT fall through to a resolvable fallback tier", () => {
  const matches: WhatsAppIdentityMatchSet = {
    contactsByPhone: [contactDoc("resolvable-fallback", "Would-Be Answer", {})], // would resolve on its own
    contactsByWhatsApp: [],
    usersByPhone: [],
    usersByWhatsApp: [
      userDoc("user-a", "Account A"),
      userDoc("user-b", "Account B"),
    ],
  }

  // A conflict at the trusted tier must stay unresolved, not be quietly
  // overridden by a weaker (Directory) signal.
  assert.equal(resolveWhatsAppIdentityFromMatches(matches), null)
})

// ── Merge semantics across tiers' own duplicate matches ─────────────────────

test("merges a /users doc match and its linked /contacts doc match under one identity, filling in role from whichever has it", () => {
  const matches: WhatsAppIdentityMatchSet = {
    contactsByPhone: [],
    contactsByWhatsApp: [contactDoc("contact-linked", "Contact Name", { linkedUserId: "user-merge", role: "Foreman" })],
    usersByPhone: [],
    usersByWhatsApp: [userDoc("user-merge", "User Doc Name")],
  }

  const identity = resolveWhatsAppIdentityFromMatches(matches)
  assert.equal(identity?.userId, "user-merge")
  assert.equal(identity?.role, "Foreman")
})

// ── Tri-state classification (distinguishes "ambiguous" from "not found") ──
// resolveWhatsAppIdentityFromMatches collapses both to null; the identity
// claim flow (lib/whatsapp-identity-claim.ts) needs to tell them apart.

test("classify: two different linked accounts is 'ambiguous', not 'not_found'", () => {
  const matches: WhatsAppIdentityMatchSet = {
    ...emptyMatches(),
    contactsByPhone: [
      contactDoc("contact-a", "Person A", { linkedUserId: "user-a" }),
      contactDoc("contact-b", "Person B", { linkedUserId: "user-b" }),
    ],
  }
  assert.deepEqual(classifyWhatsAppIdentityMatches(matches), { status: "ambiguous" })
})

test("classify: two unlinked contacts with no tiebreaker is 'ambiguous'", () => {
  const matches: WhatsAppIdentityMatchSet = {
    ...emptyMatches(),
    contactsByPhone: [contactDoc("a", "A", {}), contactDoc("b", "B", {})],
  }
  assert.deepEqual(classifyWhatsAppIdentityMatches(matches), { status: "ambiguous" })
})

test("classify: an ambiguous explicit tier is 'ambiguous' even with a resolvable fallback tier underneath", () => {
  const matches: WhatsAppIdentityMatchSet = {
    contactsByPhone: [contactDoc("resolvable", "Would Resolve", {})],
    contactsByWhatsApp: [],
    usersByPhone: [],
    usersByWhatsApp: [userDoc("user-a", "A"), userDoc("user-b", "B")],
  }
  assert.deepEqual(classifyWhatsAppIdentityMatches(matches), { status: "ambiguous" })
})

test("classify: no matches at all is 'not_found', not 'ambiguous'", () => {
  assert.deepEqual(classifyWhatsAppIdentityMatches(emptyMatches()), { status: "not_found" })
})

test("classify: a resolved identity carries resolvedVia", () => {
  const matches: WhatsAppIdentityMatchSet = {
    ...emptyMatches(),
    contactsByPhone: [
      contactDoc("linked", "Joe Testman", { linkedUserId: "user-joe" }),
      contactDoc("dup", "Duplicate", {}),
    ],
  }
  const result = classifyWhatsAppIdentityMatches(matches)
  assert.equal(result.status, "resolved")
  assert.equal(result.status === "resolved" && result.identity.resolvedVia, "fallback")
})
