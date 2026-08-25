import assert from "node:assert/strict"
import test from "node:test"
import { toDirectoryAdminAccessUserForTests } from "../lib/directory-admin-management"

test("toDirectoryAdminAccessUserForTests: reads the access field and falls back to email for a missing name", () => {
  assert.deepEqual(toDirectoryAdminAccessUserForTests("uid-1", { email: "j@supervisioncompany.com", directoryAdminAccess: true }), {
    uid: "uid-1",
    name: "j@supervisioncompany.com",
    email: "j@supervisioncompany.com",
    hasAccess: true,
    isLegacyAdmin: false,
  })
})

test("toDirectoryAdminAccessUserForTests: no access field or a non-true value both mean no access", () => {
  assert.equal(toDirectoryAdminAccessUserForTests("uid-1", { name: "Ben" }).hasAccess, false)
  assert.equal(toDirectoryAdminAccessUserForTests("uid-1", { name: "Ben", directoryAdminAccess: "true" }).hasAccess, false)
})

test("toDirectoryAdminAccessUserForTests: isLegacyAdmin reflects the global isAdmin flag independently of directoryAdminAccess", () => {
  // Legacy admin, never granted the new field — the UI needs this to explain why their toggle looks off but they still have access.
  const legacyOnly = toDirectoryAdminAccessUserForTests("uid-1", { name: "Ben", isAdmin: true })
  assert.equal(legacyOnly.hasAccess, false)
  assert.equal(legacyOnly.isLegacyAdmin, true)

  // Granted the new field, not a legacy admin.
  const delegatedOnly = toDirectoryAdminAccessUserForTests("uid-2", { name: "Kim", directoryAdminAccess: true })
  assert.equal(delegatedOnly.hasAccess, true)
  assert.equal(delegatedOnly.isLegacyAdmin, false)

  // Both — should never happen from the UI (it only ever writes directoryAdminAccess), but the mapping must not conflate them.
  const both = toDirectoryAdminAccessUserForTests("uid-3", { name: "Alex", isAdmin: true, directoryAdminAccess: true })
  assert.equal(both.hasAccess, true)
  assert.equal(both.isLegacyAdmin, true)
})
