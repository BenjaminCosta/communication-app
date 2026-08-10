#!/usr/bin/env node
/**
 * test-quest-coral-rules.mjs
 *
 * Exercises the /questCoralProjects, /questCoralUpdates,
 * /questCoralFeedbackReplies, /questCoralProjectContexts and
 * /questCoralProjectUnreadStates security rules
 * against the emulator with real auth contexts. Quest Coral has no
 * candidate-link concept, so the cases are simpler than Applications':
 * every authenticated user is "staff" here.
 *
 * Emulator only. Run the emulator first (pnpm emulator), then:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/test-quest-coral-rules.mjs
 */

import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing"
import { doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc, collection, query, serverTimestamp, where, writeBatch } from "firebase/firestore"
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

  await check("creating a project and its Communications context succeeds atomically", () =>
    assertSucceeds((async () => {
      const linkedProjectRef = doc(teammate, "questCoralProjects", "linked-project")
      const linkedContextRef = doc(teammate, "contexts", "quest-coral-linked-project")
      const batch = writeBatch(teammate)
      batch.set(linkedProjectRef, {
        name: "Linked Project",
        ownerUserId: "user-teammate",
        status: "planning",
        progress: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      batch.set(linkedContextRef, {
        name: "Linked Project",
        description: "Quest Coral project: linked to Communications.",
        fields: [],
        createdBy: "user-teammate",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        sourceModule: "quest-coral",
        questCoralProjectId: "linked-project",
      })
      await batch.commit()
    })()))

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

  await check("a client cannot create feedback without the Communications mirror", () =>
    assertFails(
      addDoc(collection(teammate, "questCoralUpdates"), {
        projectId: "teammate-project",
        type: "feedback",
        authorId: "user-teammate",
        authorName: "Teammate",
        body: "This must go through the secure feedback publisher.",
        isBlocker: false,
        createdAt: serverTimestamp(),
      }),
    ))

  await check("any authenticated user can read updates", () =>
    assertSucceeds(getDoc(doc(owner, "questCoralUpdates", ownUpdateRef.id))))

  await check("updates are never editable once posted", () =>
    assertFails(updateDoc(ownUpdateRef, { body: "edited after the fact" })))

  await check("the author can delete their own update", () => assertSucceeds(deleteDoc(ownUpdateRef)))

  console.log("\n/questCoralFeedbackReplies rules\n")

  const feedbackReplyRef = doc(teammate, "questCoralFeedbackReplies", "reply-test")
  await check("clients cannot create a feedback reply outside the secure bridge", () =>
    assertFails(
      setDoc(feedbackReplyRef, {
        projectId: "teammate-project",
        feedbackId: "feedback-test",
        authorId: "user-teammate",
        body: "This must go through the secure reply publisher.",
        createdAt: serverTimestamp(),
      }),
    ))

  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "questCoralFeedbackReplies", "reply-test"), {
      projectId: "teammate-project",
      feedbackId: "feedback-test",
      authorId: "user-owner",
      authorName: "Owner Person",
      body: "Server-created reply.",
      communicationMessageId: "quest-coral-feedback-reply-reply-test",
      replyToCommunicationMessageId: "quest-coral-feedback-feedback-test",
      createdAt: new Date(),
    })
  })

  await check("any authenticated user can read a server-created feedback reply", () =>
    assertSucceeds(getDoc(doc(owner, "questCoralFeedbackReplies", "reply-test"))))

  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "messages", "quest-coral-source-message"), {
      authorId: "user-owner",
      senderId: "user-owner",
      participants: ["user-owner"],
      visibleToUserIds: ["user-owner"],
      text: "Server-created Quest Coral Feedback.",
      sourceModule: "quest-coral",
      sourceQuestCoralProjectId: "teammate-project",
      sourceQuestCoralFeedbackId: "feedback-test",
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  })

  await check("a client cannot mutate a source-linked Quest Coral message", () =>
    assertFails(updateDoc(doc(owner, "messages", "quest-coral-source-message"), { isFavorited: true })))

  await check("a client cannot delete a source-linked Quest Coral message", () =>
    assertFails(deleteDoc(doc(owner, "messages", "quest-coral-source-message"))))

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

  // Regression: the first time a user opens a project, the client does a
  // transactional get() on its own read-marker doc before it has ever been
  // created. `resource` is null for a non-existent doc, so the rule must not
  // dereference `resource.data` unconditionally here.
  await check("an authenticated user can read their own unread state before it is ever created", () =>
    assertSucceeds(getDoc(ownUnreadRef)))

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
    await deleteDoc(doc(db, "questCoralProjects", "linked-project")).catch(() => {})
    await deleteDoc(doc(db, "contexts", "quest-coral-linked-project")).catch(() => {})
    await deleteDoc(doc(db, "questCoralProjectContexts", "teammate-project")).catch(() => {})
    await deleteDoc(doc(db, "questCoralFeedbackReplies", "reply-test")).catch(() => {})
    await deleteDoc(doc(db, "messages", "quest-coral-source-message")).catch(() => {})
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
