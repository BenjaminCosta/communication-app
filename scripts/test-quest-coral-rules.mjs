#!/usr/bin/env node
/**
 * test-quest-coral-rules.mjs
 *
 * Exercises the /questCoralProjects, /questCoralUpdates,
 * /questCoralProjectContexts and /questCoralProjectUnreadStates security rules
 * against the emulator with real auth contexts. Quest Coral has no
 * candidate-link concept, so the cases are simpler than Applications':
 * every authenticated user is "staff" here.
 *
 * Emulator only. Run the emulator first (pnpm emulator), then:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/test-quest-coral-rules.mjs
 */

import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing"
import { doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc, collection, query, serverTimestamp, where } from "firebase/firestore"
import { readFileSync } from "node:fs"

const HOST_PORT = (process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080").split(":")
const PROJECT_ID = "qc-rules-test"

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

  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore()
    await setDoc(doc(db, "questCoralProjects", PROJECT_ID), {
      name: "Rules Test Project",
      description: "Seeded for rules testing.",
      status: "on_track",
      progress: 40,
      missionFitScore: 3,
      ownerUserId: "user-owner",
      ownerName: "Owner Person",
      people: [{ id: "user-owner", name: "Owner Person", initials: "OP" }],
      nextStep: null,
      nextStepDue: null,
      timeline: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  })

  const owner = testEnv.authenticatedContext("user-owner").firestore()
  const teammate = testEnv.authenticatedContext("user-teammate").firestore()
  const anonymous = testEnv.unauthenticatedContext().firestore()

  console.log("\n/questCoralProjects rules\n")

  await check("any authenticated user can read a project", () =>
    assertSucceeds(getDoc(doc(teammate, "questCoralProjects", PROJECT_ID))))

  await check("signed-out visitors cannot read a project", () =>
    assertFails(getDoc(doc(anonymous, "questCoralProjects", PROJECT_ID))))

  await check("a teammate (not the owner) can update progress/status", () =>
    assertSucceeds(
      updateDoc(doc(teammate, "questCoralProjects", PROJECT_ID), { progress: 55, status: "at_risk" }),
    ))

  await check("a teammate cannot delete the project", () =>
    assertFails(deleteDoc(doc(teammate, "questCoralProjects", PROJECT_ID))))

  await check("the owner can delete their own project", () =>
    assertSucceeds(deleteDoc(doc(owner, "questCoralProjects", PROJECT_ID))))

  await check("creating a project requires ownerUserId to match the caller", () =>
    assertFails(
      setDoc(doc(teammate, "questCoralProjects", "spoofed-project"), {
        name: "Spoofed",
        ownerUserId: "someone-else",
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ))

  await check("creating a project as yourself succeeds", () =>
    assertSucceeds(
      setDoc(doc(teammate, "questCoralProjects", "teammate-project"), {
        name: "Teammate Project",
        ownerUserId: "user-teammate",
        status: "planning",
        progress: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ))

  console.log("\n/questCoralUpdates rules\n")

  await check("creating an update requires authorId to match the caller", () =>
    assertFails(
      addDoc(collection(teammate, "questCoralUpdates"), {
        projectId: "teammate-project",
        type: "update",
        authorId: "someone-else",
        authorName: "Spoofed",
        body: "spoofed update",
        isBlocker: false,
        createdAt: serverTimestamp(),
      }),
    ))

  const ownUpdateRef = doc(collection(teammate, "questCoralUpdates"))
  await check("creating an update as yourself succeeds", () =>
    assertSucceeds(
      setDoc(ownUpdateRef, {
        projectId: "teammate-project",
        type: "update",
        authorId: "user-teammate",
        authorName: "Teammate",
        body: "Real update",
        isBlocker: false,
        createdAt: serverTimestamp(),
      }),
    ))

  await check("any authenticated user can read updates", () =>
    assertSucceeds(getDoc(doc(owner, "questCoralUpdates", ownUpdateRef.id))))

  await check("updates are never editable once posted", () =>
    assertFails(updateDoc(ownUpdateRef, { body: "edited after the fact" })))

  await check("the author can delete their own update", () => assertSucceeds(deleteDoc(ownUpdateRef)))

  console.log("\n/questCoralProjectContexts rules\n")

  const ownContextRef = doc(teammate, "questCoralProjectContexts", "teammate-project")
  await check("signed-out visitors cannot read project context", () =>
    assertFails(getDoc(doc(anonymous, "questCoralProjectContexts", "teammate-project"))))

  await check("a context must belong to its document/project id", () =>
    assertFails(
      setDoc(doc(teammate, "questCoralProjectContexts", "wrong-context-id"), {
        projectId: "teammate-project",
        markdown: "## Purpose\n\nWrong document id.",
        updatedBy: "Teammate",
        source: "manual",
      }),
    ))

  await check("a context requires an existing project", () =>
    assertFails(
      setDoc(doc(teammate, "questCoralProjectContexts", "missing-project"), {
        projectId: "missing-project",
        markdown: "## Purpose\n\nNo parent project.",
        updatedBy: "Teammate",
        source: "manual",
      }),
    ))

  await check("an authenticated teammate can create a valid project context", () =>
    assertSucceeds(
      setDoc(ownContextRef, {
        projectId: "teammate-project",
        markdown: "## Purpose\n\nKeep the team aligned.",
        updatedBy: "Teammate",
        source: "manual",
        fileName: null,
      }),
    ))

  await check("any authenticated teammate can read project context", () =>
    assertSucceeds(getDoc(doc(owner, "questCoralProjectContexts", "teammate-project"))))

  await check("an authenticated teammate can keep shared context current", () =>
    assertSucceeds(updateDoc(doc(owner, "questCoralProjectContexts", "teammate-project"), {
      markdown: "## Purpose\n\nKeep the team aligned with current facts.",
      updatedBy: "Owner",
    })))

  await check("a context cannot be reassigned to another project", () =>
    assertFails(updateDoc(doc(owner, "questCoralProjectContexts", "teammate-project"), { projectId: PROJECT_ID })))

  await check("project context cannot exceed the Markdown safety limit", () =>
    assertFails(updateDoc(doc(owner, "questCoralProjectContexts", "teammate-project"), { markdown: "x".repeat(12_001) })))

  await check("project context cannot be deleted from the client", () =>
    assertFails(deleteDoc(doc(owner, "questCoralProjectContexts", "teammate-project"))))

  console.log("\n/questCoralProjectUnreadStates rules\n")

  const ownUnreadRef = doc(teammate, "questCoralProjectUnreadStates", "user-teammate__teammate-project")
  await check("signed-out visitors cannot read a private unread state", () =>
    assertFails(getDoc(doc(anonymous, "questCoralProjectUnreadStates", "user-teammate__teammate-project"))))

  await check("an unread state must use the deterministic user/project id", () =>
    assertFails(
      setDoc(doc(teammate, "questCoralProjectUnreadStates", "wrong-unread-id"), {
        userId: "user-teammate",
        projectId: "teammate-project",
        unreadCount: 1,
        lastReadAt: null,
        updatedAt: serverTimestamp(),
      }),
    ))

  await check("an authenticated user can create their own non-negative unread state", () =>
    assertSucceeds(
      setDoc(ownUnreadRef, {
        userId: "user-teammate",
        projectId: "teammate-project",
        unreadCount: 2,
        lastReadAt: null,
        updatedAt: serverTimestamp(),
      }),
    ))

  await check("another authenticated user cannot read someone else's unread state", () =>
    assertFails(getDoc(doc(owner, "questCoralProjectUnreadStates", "user-teammate__teammate-project"))))

  await check("a user can query only their own unread states", () =>
    assertSucceeds(getDocs(query(collection(teammate, "questCoralProjectUnreadStates"), where("userId", "==", "user-teammate")))))

  await check("a user cannot query another person's unread states", () =>
    assertFails(getDocs(query(collection(owner, "questCoralProjectUnreadStates"), where("userId", "==", "user-teammate")))))

  await check("an unread state rejects negative counts", () =>
    assertFails(updateDoc(ownUnreadRef, { unreadCount: -1 })))

  await check("a user can mark their own project state read", () =>
    assertSucceeds(updateDoc(ownUnreadRef, { unreadCount: 0, lastReadAt: serverTimestamp(), updatedAt: serverTimestamp() })))

  await check("a user cannot reassign their unread state", () =>
    assertFails(updateDoc(ownUnreadRef, { projectId: PROJECT_ID })))

  await check("a user cannot delete their unread state", () =>
    assertFails(deleteDoc(ownUnreadRef)))

  // Leave the emulator as we found it.
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore()
    await deleteDoc(doc(db, "questCoralProjects", "teammate-project")).catch(() => {})
    await deleteDoc(doc(db, "questCoralProjectContexts", "teammate-project")).catch(() => {})
    await deleteDoc(doc(db, "questCoralProjectUnreadStates", "user-teammate__teammate-project")).catch(() => {})
  })

  await testEnv.cleanup()

  console.log(`\n${passed} passed, ${failed} failed\n`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error("Rules test failed to run:", error)
  process.exit(1)
})
