#!/usr/bin/env node
/**
 * test-bye-bye-dpr-rules.mjs
 *
 * Exercises the /jobs, /clockRecords, /reports (+ attachments) and
 * /users/{uid}/recentJobs security rules against the emulator with real
 * auth contexts. Flat, single-org model (2026-08-10) — every signed-in user
 * can read every job/clock record/report; the only per-record restriction
 * left is ownership (a user can only create/update their own clock record
 * or report, and a submitted report is immutable to clients). Mirrors the
 * structure of test-quest-coral-rules.mjs.
 *
 * Emulator only. Run the emulator first (pnpm emulator), then:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/test-bye-bye-dpr-rules.mjs
 */

import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing"
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from "firebase/firestore"
import { readFileSync } from "node:fs"

const HOST_PORT = (process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080").split(":")

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
    await setDoc(doc(db, "users", "user-a"), { id: "user-a", name: "User A" })
    await setDoc(doc(db, "users", "user-b"), { id: "user-b", name: "User B" })

    await setDoc(doc(db, "jobs", "job-1"), { name: "Job One", isActive: true, createdBy: "user-a", createdAt: new Date(), updatedAt: new Date() })

    await setDoc(doc(db, "clockRecords", "clock-a1"), {
      userId: "user-a", jobId: "job-1", status: "active",
      clockInAt: new Date(), clockOutAt: null, durationMinutes: null,
      createdAt: new Date(), updatedAt: new Date(),
    })

    await setDoc(doc(db, "reports", "report-a1-draft"), {
      jobId: "job-1", authorId: "user-a", type: "daily_report", status: "draft",
      rawText: "", createdAt: new Date(), updatedAt: new Date(), submittedAt: null,
    })
    await setDoc(doc(db, "reports", "report-a1-submitted"), {
      jobId: "job-1", authorId: "user-a", type: "daily_report", status: "submitted",
      rawText: "Done.", createdAt: new Date(), updatedAt: new Date(), submittedAt: new Date(),
    })
  })

  const userA = testEnv.authenticatedContext("user-a").firestore()
  const userB = testEnv.authenticatedContext("user-b").firestore()
  const anon = testEnv.unauthenticatedContext().firestore()

  console.log("\n/jobs rules — flat, single-org: any signed-in user reads/creates\n")

  await check("any signed-in user can read a job", () => assertSucceeds(getDoc(doc(userB, "jobs", "job-1"))))
  await check("a signed-out request cannot read a job", () => assertFails(getDoc(doc(anon, "jobs", "job-1"))))
  await check("any signed-in user can create a job (no roles)", () =>
    assertSucceeds(setDoc(doc(userB, "jobs", "job-2"), {
      name: "New Job", isActive: true, createdBy: "user-b", createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    })))
  await check("a signed-out request cannot create a job", () =>
    assertFails(setDoc(doc(anon, "jobs", "job-3"), {
      name: "Sneaky", isActive: true, createdBy: "user-b", createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    })))

  console.log("\n/clockRecords rules — read is open, write is owner-only\n")

  await check("a user can create their own clock record", () =>
    assertSucceeds(setDoc(doc(userA, "clockRecords", "clock-a2"), {
      userId: "user-a", jobId: "job-1", status: "active",
      clockInAt: serverTimestamp(), createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    })))
  await check("a user cannot create a clock record for someone else", () =>
    assertFails(setDoc(doc(userA, "clockRecords", "clock-spoof"), {
      userId: "user-b", jobId: "job-1", status: "active",
      clockInAt: serverTimestamp(), createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    })))
  await check("a user can update their own clock record", () =>
    assertSucceeds(updateDoc(doc(userA, "clockRecords", "clock-a1"), { status: "closed", clockOutAt: serverTimestamp(), updatedAt: serverTimestamp() })))
  await check("another user cannot modify someone else's clock record", () =>
    assertFails(updateDoc(doc(userB, "clockRecords", "clock-a1"), { status: "active" })))
  await check("any signed-in user can read another user's clock record", () =>
    assertSucceeds(getDoc(doc(userB, "clockRecords", "clock-a1"))))

  console.log("\n/reports rules — read is open, write is author-only\n")

  await check("the author can update their own draft report", () =>
    assertSucceeds(updateDoc(doc(userA, "reports", "report-a1-draft"), { rawText: "Updated text", updatedAt: serverTimestamp() })))
  await check("someone else cannot update another author's draft report", () =>
    assertFails(updateDoc(doc(userB, "reports", "report-a1-draft"), { rawText: "Hacked" })))
  await check("a submitted report cannot be updated by the client", () =>
    assertFails(updateDoc(doc(userA, "reports", "report-a1-submitted"), { rawText: "trying to edit" })))
  await check("any signed-in user can read another user's report", () =>
    assertSucceeds(getDoc(doc(userB, "reports", "report-a1-draft"))))
  await check("creating a draft report as yourself succeeds", () =>
    assertSucceeds(setDoc(doc(userA, "reports", "report-a3"), {
      jobId: "job-1", authorId: "user-a", type: "daily_report", status: "draft",
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    })))
  await check("creating a report with status submitted directly is rejected", () =>
    assertFails(setDoc(doc(userA, "reports", "report-a4"), {
      jobId: "job-1", authorId: "user-a", type: "daily_report", status: "submitted",
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    })))

  console.log("\n/reports/{id}/attachments rules\n")

  await check("the report author can add an attachment while it's a draft", () =>
    assertSucceeds(setDoc(doc(userA, "reports", "report-a1-draft", "attachments", "att-1"), {
      storagePath: "x", fileName: "a.pdf", mimeType: "application/pdf", size: 100, uploadedBy: "user-a", createdAt: serverTimestamp(),
    })))
  await check("another user cannot add an attachment to someone else's report", () =>
    assertFails(setDoc(doc(userB, "reports", "report-a1-draft", "attachments", "att-2"), {
      storagePath: "x", fileName: "a.pdf", mimeType: "application/pdf", size: 100, uploadedBy: "user-b", createdAt: serverTimestamp(),
    })))
  await check("attachments cannot be added once the report is submitted", () =>
    assertFails(setDoc(doc(userA, "reports", "report-a1-submitted", "attachments", "att-3"), {
      storagePath: "x", fileName: "a.pdf", mimeType: "application/pdf", size: 100, uploadedBy: "user-a", createdAt: serverTimestamp(),
    })))

  console.log("\n/users/{uid}/recentJobs rules\n")

  await check("a user can record their own recent job", () =>
    assertSucceeds(setDoc(doc(userA, "users", "user-a", "recentJobs", "job-1"), { jobId: "job-1", viewedAt: serverTimestamp() })))
  await check("a user cannot read someone else's recent jobs", () =>
    assertFails(getDoc(doc(userB, "users", "user-a", "recentJobs", "job-1"))))
  await check("a user cannot write to someone else's recentJobs", () =>
    assertFails(setDoc(doc(userB, "users", "user-a", "recentJobs", "job-2"), { jobId: "job-2", viewedAt: serverTimestamp() })))

  await testEnv.cleanup()

  console.log(`\n${passed} passed, ${failed} failed\n`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error("Rules test failed to run:", error)
  process.exit(1)
})
