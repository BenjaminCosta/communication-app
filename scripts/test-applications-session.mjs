#!/usr/bin/env node
/**
 * test-applications-session.mjs
 *
 * End-to-end integration test for the candidate session (phase 3), exercising
 * the real custom-token path — not fabricated claims:
 *
 *   admin.createCustomToken(cand_<id>, { applicationId })  ← what the server does
 *     → client signInWithCustomToken                       ← what the browser does
 *       → read/update/submit own application through RULES
 *
 * Needs the emulator with BOTH firestore and auth:
 *   pnpm emulator   (or: firebase emulators:start --only firestore,auth)
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
 *     node scripts/test-applications-session.mjs
 */

import { initializeApp as initAdmin } from "firebase-admin/app"
import { getAuth as getAdminAuth } from "firebase-admin/auth"
import { getFirestore as getAdminFirestore } from "firebase-admin/firestore"
import { initializeApp as initClient } from "firebase/app"
import { getAuth as getClientAuth, signInWithCustomToken, connectAuthEmulator } from "firebase/auth"
import {
  getFirestore as getClientFirestore,
  connectFirestoreEmulator,
  doc,
  getDoc,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore"

const FS = process.env.FIRESTORE_EMULATOR_HOST
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST
if (!FS || !AUTH) {
  console.error("ERROR: set FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST (need auth emulator too).")
  process.exit(1)
}

const APP_ID = "app-session-test"
const CAND_UID = `cand_${APP_ID}`

let passed = 0
let failed = 0
async function ok(name, run) {
  try {
    await run()
    passed += 1
    console.log(`  PASS  ${name}`)
  } catch (error) {
    failed += 1
    console.log(`  FAIL  ${name}\n        ${error.message}`)
  }
}
async function shouldReject(name, run) {
  try {
    await run()
    failed += 1
    console.log(`  FAIL  ${name}\n        expected a permission error but the write succeeded`)
  } catch {
    passed += 1
    console.log(`  PASS  ${name}`)
  }
}

async function main() {
  const admin = initAdmin({ projectId: "svc-comms" }, "session-admin")
  const adminDb = getAdminFirestore(admin)
  adminDb.settings({ host: FS, ssl: false })

  // Seed an application the candidate will open.
  await adminDb.collection("applications").doc(APP_ID).set({
    candidateName: "",
    status: "draft",
    jobEntityId: "job__ctx-test",
    jobName: "Test Job",
    general: { fullName: "" },
    video: { state: "not_started" },
    documents: [],
    agreement: { status: "locked" },
    updatedAt: new Date(),
  })

  // 1) The server side: mint a custom token with the applicationId claim.
  const customToken = await getAdminAuth(admin).createCustomToken(CAND_UID, { applicationId: APP_ID })
  console.log("\ncandidate session (real custom token)\n")
  await ok("server mints a custom token with the applicationId claim", async () => {
    if (!customToken || typeof customToken !== "string") throw new Error("no token")
  })

  // 2) The browser side: sign in with the custom token.
  const client = initClient({ projectId: "svc-comms", apiKey: "fake-emulator-key" }, "session-client")
  const clientAuth = getClientAuth(client)
  connectAuthEmulator(clientAuth, `http://${AUTH}`, { disableWarnings: true })
  const clientDb = getClientFirestore(client)
  const [fsHost, fsPort] = FS.split(":")
  connectFirestoreEmulator(clientDb, fsHost, Number(fsPort))

  await ok("browser signs in with the custom token", async () => {
    const credential = await signInWithCustomToken(clientAuth, customToken)
    if (credential.user.uid !== CAND_UID) throw new Error(`uid ${credential.user.uid}`)
    const claims = (await credential.user.getIdTokenResult()).claims
    if (claims.applicationId !== APP_ID) throw new Error(`claim ${claims.applicationId}`)
  })

  const ref = doc(clientDb, "applications", APP_ID)

  await ok("candidate reads their own application", async () => {
    const snapshot = await getDoc(ref)
    if (!snapshot.exists()) throw new Error("not found")
  })

  await ok("candidate autosaves their own fields", async () => {
    await updateDoc(ref, {
      general: { fullName: "Session Test", phone: "(555) 111-2222" },
      updatedAt: serverTimestamp(),
    })
  })

  await ok("candidate submits", async () => {
    await updateDoc(ref, { status: "submitted", submittedAt: serverTimestamp(), updatedAt: serverTimestamp() })
  })

  await shouldReject("candidate CANNOT approve themselves", () =>
    updateDoc(ref, { status: "approved", updatedAt: serverTimestamp() }))

  await shouldReject("candidate CANNOT unlock the agreement", () =>
    updateDoc(ref, { agreement: { status: "signed" }, updatedAt: serverTimestamp() }))

  // Cleanup.
  await adminDb.collection("applications").doc(APP_ID).delete()

  console.log(`\n${passed} passed, ${failed} failed\n`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error("Session test failed to run:", error)
  process.exit(1)
})
