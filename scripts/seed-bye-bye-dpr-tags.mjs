#!/usr/bin/env node
/**
 * Seeds the fixed ByeByeDPR tag/project docs (see lib/bye-bye-dpr-tags.ts).
 *
 * This is the shared Time Tracking tag for automatic clock in/out Comms
 * messages. Daily Reports deliberately reuse the existing Daily Report tag
 * from Comms instead of creating a duplicate. Fixed ids + idempotent upserts
 * make reruns safe.
 *
 * Usage:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/seed-bye-bye-dpr-tags.mjs
 *
 *   DRY_RUN=false CONFIRM_PROD_BYE_BYE_DPR_TAG_SEED=true \
 *     GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     node scripts/seed-bye-bye-dpr-tags.mjs
 */

import { cert, initializeApp } from "firebase-admin/app"
import { getFirestore } from "firebase-admin/firestore"
import { existsSync, readFileSync } from "node:fs"

const EXPECTED_PROJECT_ID = "svc-comms"
const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST
const DRY_RUN = process.env.DRY_RUN !== "false"
const IS_PRODUCTION = !EMULATOR_HOST
const PROJECTS_COLLECTION = "projects"

// A fixed, synthetic owner — never a real Firebase Auth uid — so these system
// tags aren't misattributed to whichever operator happened to run the seed.
// Mirrors the SYSTEM_OWNER_ID convention in scripts/seed-quest-coral-project-contexts.mjs.
const SYSTEM_OWNER_ID = "svc-system-bye-bye-dpr"

const TAG_SEEDS = [
  { id: "byebye-dpr-time-tracking", name: "Time Tracking", color: "bg-progress" },
]

function fail(message) {
  console.error(`ERROR: ${message}`)
  process.exit(1)
}

function validateTarget() {
  const expected = process.env.EXPECTED_FIREBASE_PROJECT ?? EXPECTED_PROJECT_ID
  if (expected !== EXPECTED_PROJECT_ID) {
    fail(`EXPECTED_FIREBASE_PROJECT must be ${EXPECTED_PROJECT_ID}; received ${expected}.`)
  }
  if (!IS_PRODUCTION) return null

  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
  if (!credentialsPath || !existsSync(credentialsPath)) {
    fail("Set GOOGLE_APPLICATION_CREDENTIALS to the production service-account JSON file.")
  }
  let serviceAccount
  try {
    serviceAccount = JSON.parse(readFileSync(credentialsPath, "utf8"))
  } catch {
    fail("GOOGLE_APPLICATION_CREDENTIALS is not valid JSON.")
  }
  if (serviceAccount.project_id !== EXPECTED_PROJECT_ID) {
    fail(`Service account project_id must be ${EXPECTED_PROJECT_ID}; received ${serviceAccount.project_id ?? "(missing)"}.`)
  }
  if (!DRY_RUN && process.env.CONFIRM_PROD_BYE_BYE_DPR_TAG_SEED !== "true") {
    fail("Refusing a production write without CONFIRM_PROD_BYE_BYE_DPR_TAG_SEED=true.")
  }
  return serviceAccount
}

async function main() {
  const serviceAccount = validateTarget()
  const app = serviceAccount
    ? initializeApp({ credential: cert(serviceAccount), projectId: EXPECTED_PROJECT_ID })
    : initializeApp({ projectId: EXPECTED_PROJECT_ID })
  const db = getFirestore(app)
  if (EMULATOR_HOST) {
    const [host, port] = EMULATOR_HOST.split(":")
    db.settings({ host, ssl: false, port: Number(port) })
  }

  const target = IS_PRODUCTION ? `PRODUCTION (${EXPECTED_PROJECT_ID})` : `emulator (${EMULATOR_HOST})`
  console.log(`\nByeByeDPR tag seed → ${target}`)
  console.log(`Mode: ${DRY_RUN ? "DRY RUN — no writes" : "WRITE"}\n`)

  for (const seed of TAG_SEEDS) {
    const ref = db.collection(PROJECTS_COLLECTION).doc(seed.id)
    const existing = await ref.get()
    const action = existing.exists ? "update" : "create"
    console.log(`  ${action.padEnd(6)} projects/${seed.id}  (${seed.name})`)
    if (DRY_RUN) continue

    const payload = {
      id: seed.id,
      name: seed.name,
      color: seed.color,
      ownerId: SYSTEM_OWNER_ID,
      members: [SYSTEM_OWNER_ID],
      tagCategory: "byeByeDpr",
    }
    await ref.set(payload, { merge: true })
  }

  console.log(DRY_RUN ? "\nDry run complete — rerun with DRY_RUN=false to write." : "\nSeed complete.")
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
