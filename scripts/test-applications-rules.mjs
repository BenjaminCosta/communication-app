#!/usr/bin/env node
/**
 * test-applications-rules.mjs
 *
 * Exercises the /applications security rules against the emulator with real
 * auth contexts. The case that matters most is the last one: a candidate
 * session must NOT be able to approve its own application.
 *
 * Emulator only. Run the emulator first (pnpm emulator), then:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/test-applications-rules.mjs
 */

import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing"
import { doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, collection, serverTimestamp } from "firebase/firestore"
import { readFileSync } from "node:fs"

const HOST_PORT = (process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080").split(":")
const APPLICATION_ID = "app-rules-test"

let passed = 0
let failed = 0

async function check(name, run) {
  try {
    await run()
    passed += 1
    console.log(`  PASS  ${name}`)
  } catch (error) {
    failed += 1
    console.log(`  FAIL  ${name}`)
    console.log(`        ${error.message}`)
  }
}

async function main() {
  const testEnv = await initializeTestEnvironment({
    projectId: "svc-comms",
    firestore: {
      host: HOST_PORT[0],
      port: Number(HOST_PORT[1]),
      // The emulator config points at the secure ruleset.
      rules: readFileSync("firestore.rules.secure", "utf8"),
    },
  })

  // Seed one application with rules disabled.
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore()
    await setDoc(doc(db, "applications", APPLICATION_ID), {
      candidateName: "Rules Test",
      status: "submitted",
      jobEntityId: "job__ctx-test",
      jobName: "Test Job",
      general: { fullName: "Rules Test" },
      documents: [],
      agreement: { status: "locked" },
      updatedAt: new Date(),
    })
  })

  // Staff = authenticated, no applicationId claim.
  const staff = testEnv.authenticatedContext("user-staff").firestore()
  // Candidate = link session, identified by the custom-token claim.
  const candidate = testEnv
    .authenticatedContext("cand-app-rules-test", { applicationId: APPLICATION_ID })
    .firestore()
  const other = testEnv
    .authenticatedContext("cand-someone-else", { applicationId: "app-different" })
    .firestore()
  const anonymous = testEnv.unauthenticatedContext().firestore()

  console.log("\n/applications rules\n")

  await check("staff can read an application", () =>
    assertSucceeds(getDoc(doc(staff, "applications", APPLICATION_ID))))

  await check("staff can approve", () =>
    assertSucceeds(updateDoc(doc(staff, "applications", APPLICATION_ID), { status: "approved" })))

  await check("staff cannot write the agreement", () =>
    assertFails(
      updateDoc(doc(staff, "applications", APPLICATION_ID), { agreement: { status: "signed" } }),
    ))

  await check("staff activity must carry their own actorUid", () =>
    assertFails(
      addDoc(collection(staff, "applications", APPLICATION_ID, "activity"), {
        kind: "note",
        actor: "Someone",
        actorUid: "somebody-else",
        message: "spoofed",
        at: serverTimestamp(),
      }),
    ))

  await check("candidate can read their own application", () =>
    assertSucceeds(getDoc(doc(candidate, "applications", APPLICATION_ID))))

  await check("another candidate cannot read it", () =>
    assertFails(getDoc(doc(other, "applications", APPLICATION_ID))))

  await check("signed-out visitors cannot read it", () =>
    assertFails(getDoc(doc(anonymous, "applications", APPLICATION_ID))))

  // Put it back in a state the candidate is allowed to edit.
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await updateDoc(doc(context.firestore(), "applications", APPLICATION_ID), { status: "needs_information" })
  })

  await check("candidate can fill in their own fields", () =>
    assertSucceeds(
      updateDoc(doc(candidate, "applications", APPLICATION_ID), {
        general: { fullName: "Rules Test", phone: "(555) 000-0000" },
        updatedAt: new Date(),
      }),
    ))

  await check("candidate CANNOT approve themselves", () =>
    assertFails(updateDoc(doc(candidate, "applications", APPLICATION_ID), { status: "approved" })))

  await check("candidate cannot unlock the agreement", () =>
    assertFails(
      updateDoc(doc(candidate, "applications", APPLICATION_ID), {
        agreement: { status: "awaiting_signature" },
      }),
    ))

  await check("candidate cannot rewrite the candidate name", () =>
    assertFails(updateDoc(doc(candidate, "applications", APPLICATION_ID), { candidateName: "Someone Else" })))

  await check("nobody can delete an application", () =>
    assertFails(updateDoc(doc(staff, "applications", "does-not-exist"), { status: "archived" })))

  console.log("\n/applicationLinks rules\n")

  await check("clients cannot read links (server resolves tokens)", () =>
    assertFails(getDoc(doc(staff, "applicationLinks", "some-token"))))

  await check("staff can create a link", () =>
    assertSucceeds(
      setDoc(doc(staff, "applicationLinks", "token-abc"), {
        applicationId: APPLICATION_ID,
        purpose: "application",
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 86_400_000),
      }),
    ))

  await check("candidates cannot create links", () =>
    assertFails(
      setDoc(doc(candidate, "applicationLinks", "token-xyz"), { applicationId: APPLICATION_ID }),
    ))

  // Leave the emulator as we found it — this runs against the same instance
  // the seed script writes to.
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore()
    await deleteDoc(doc(db, "applications", APPLICATION_ID))
    await deleteDoc(doc(db, "applicationLinks", "token-abc"))
  })

  await testEnv.cleanup()

  console.log(`\n${passed} passed, ${failed} failed\n`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error("Rules test failed to run:", error)
  process.exit(1)
})
