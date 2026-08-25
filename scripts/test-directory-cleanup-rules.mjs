#!/usr/bin/env node
/**
 * test-directory-cleanup-rules.mjs
 *
 * Exercises the /contacts security rule change made for the Directory
 * cleanup flow: update is now open to any authenticated user (previously
 * owner-only), while delete stays owner-scoped for direct client writes —
 * and ownerUserId itself must stay fixed across an update, otherwise a
 * non-owner could reassign ownership to themselves and then pass the
 * owner-scoped delete rule, defeating it entirely.
 * Admin-gated merge/delete goes through app/api/directory/* (Admin SDK,
 * bypasses these rules entirely), so it is not exercised here.
 *
 * Emulator only. Run the emulator first (pnpm emulator), then:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/test-directory-cleanup-rules.mjs
 */

import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing"
import { doc, getDoc, updateDoc, deleteDoc, setDoc } from "firebase/firestore"
import { readFileSync } from "node:fs"

const HOST_PORT = (process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080").split(":")
const CONTACT_ID = "rules-test-contact"

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
    projectId: "directory-rules-test",
    firestore: {
      host: HOST_PORT[0],
      port: Number(HOST_PORT[1]),
      // The emulator config points at the secure ruleset.
      rules: readFileSync("firestore.rules.secure", "utf8"),
    },
  })

  async function seedContact() {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "contacts", CONTACT_ID), {
        ownerUserId: "user-owner",
        name: "Rules Test Contact",
        company: "",
        role: "",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    })
  }

  const owner = testEnv.authenticatedContext("user-owner").firestore()
  const teammate = testEnv.authenticatedContext("user-teammate").firestore()
  const anonymous = testEnv.unauthenticatedContext().firestore()

  console.log("\n/contacts rules (Directory cleanup change)\n")

  await seedContact()

  await check("any authenticated user can read a contact", () =>
    assertSucceeds(getDoc(doc(teammate, "contacts", CONTACT_ID))))

  await check("signed-out visitors cannot read a contact", () =>
    assertFails(getDoc(doc(anonymous, "contacts", CONTACT_ID))))

  await check("a non-owner teammate CAN now update the contact (was owner-only)", () =>
    assertSucceeds(updateDoc(doc(teammate, "contacts", CONTACT_ID), { role: "Foreman" })))

  await check("the owner can still update the contact", () =>
    assertSucceeds(updateDoc(doc(owner, "contacts", CONTACT_ID), { role: "Supervisor" })))

  await check("signed-out visitors cannot update the contact", () =>
    assertFails(updateDoc(doc(anonymous, "contacts", CONTACT_ID), { role: "Nope" })))

  await check("a non-owner teammate CANNOT reassign ownerUserId to themselves (would defeat the owner-scoped delete rule below)", () =>
    assertFails(updateDoc(doc(teammate, "contacts", CONTACT_ID), { ownerUserId: "user-teammate" })))

  await check("a non-owner teammate CANNOT change ownerUserId even alongside an otherwise-legal field edit", () =>
    assertFails(updateDoc(doc(teammate, "contacts", CONTACT_ID), { role: "Sneaky", ownerUserId: "user-teammate" })))

  await check("a non-owner teammate still CANNOT delete the contact", () =>
    assertFails(deleteDoc(doc(teammate, "contacts", CONTACT_ID))))

  await check("the owner can still delete their own contact", () =>
    assertSucceeds(deleteDoc(doc(owner, "contacts", CONTACT_ID))))

  await check("creating a contact requires ownerUserId to match the caller", () =>
    assertFails(
      setDoc(doc(teammate, "contacts", "spoofed-contact"), {
        ownerUserId: "someone-else",
        name: "Spoofed",
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ))

  await testEnv.cleanup()

  console.log(`\n${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
