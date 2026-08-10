#!/usr/bin/env node
/**
 * Creates the deterministic Communications context for every existing Quest
 * Coral project that does not already have one.
 *
 * Conservative by design:
 * - dry-run is the default;
 * - production requires a service account for exactly svc-comms;
 * - writes require CONFIRM_PROD_QUEST_CORAL_COMMS_CONTEXT_BACKFILL=true;
 * - existing linked contexts are left unchanged;
 * - an unrelated document at a deterministic id is reported as a conflict
 *   and prevents all writes.
 */

import { cert, initializeApp } from "firebase-admin/app"
import { getFirestore, Timestamp } from "firebase-admin/firestore"
import { existsSync, readFileSync } from "node:fs"

const EXPECTED_PROJECT_ID = "svc-comms"
const DRY_RUN = process.env.DRY_RUN !== "false"
const PROJECTS_COLLECTION = "questCoralProjects"
const CONTEXTS_COLLECTION = "contexts"
const SOURCE_MODULE = "quest-coral"

function fail(message) {
  console.error(`ERROR: ${message}`)
  process.exit(1)
}

function contextId(projectId) {
  if (!projectId || typeof projectId !== "string") fail("Quest Coral project ids must be non-empty strings.")
  return `quest-coral-${projectId}`
}

function description(value) {
  const normalized = typeof value === "string" ? value.trim() : ""
  return normalized ? `Quest Coral project: ${normalized}` : "This context is linked to a Quest Coral project."
}

function validateProductionTarget() {
  const expected = process.env.EXPECTED_FIREBASE_PROJECT ?? EXPECTED_PROJECT_ID
  if (expected !== EXPECTED_PROJECT_ID) {
    fail(`EXPECTED_FIREBASE_PROJECT must be ${EXPECTED_PROJECT_ID}; received ${expected}.`)
  }
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
  if (!DRY_RUN && process.env.CONFIRM_PROD_QUEST_CORAL_COMMS_CONTEXT_BACKFILL !== "true") {
    fail("Refusing a production write without CONFIRM_PROD_QUEST_CORAL_COMMS_CONTEXT_BACKFILL=true.")
  }
  return serviceAccount
}

async function main() {
  const serviceAccount = validateProductionTarget()
  const app = initializeApp({ credential: cert(serviceAccount), projectId: EXPECTED_PROJECT_ID })
  const db = getFirestore(app)
  const projectSnapshot = await db.collection(PROJECTS_COLLECTION).get()
  const projects = projectSnapshot.docs.sort((left, right) => left.id.localeCompare(right.id))
  const contextRefs = projects.map((project) => db.collection(CONTEXTS_COLLECTION).doc(contextId(project.id)))
  const contextSnapshots = contextRefs.length > 0 ? await db.getAll(...contextRefs) : []

  const plan = []
  const conflicts = []
  for (let index = 0; index < projects.length; index += 1) {
    const project = projects[index]
    const data = project.data()
    const existing = contextSnapshots[index]
    const id = contextId(project.id)
    if (!existing.exists) {
      plan.push({ projectId: project.id, contextId: id, action: "create" })
      continue
    }
    const context = existing.data() ?? {}
    if (context.sourceModule === SOURCE_MODULE && context.questCoralProjectId === project.id) {
      plan.push({ projectId: project.id, contextId: id, action: "unchanged" })
      continue
    }
    conflicts.push(`${CONTEXTS_COLLECTION}/${id} already exists without Quest Coral provenance`)
  }

  console.log(JSON.stringify({
    target: `PRODUCTION (${EXPECTED_PROJECT_ID})`,
    mode: DRY_RUN ? "dry-run" : "write",
    projects: projects.length,
    plan,
    conflicts,
  }, null, 2))
  if (conflicts.length > 0) fail("No writes were made because one or more linked context ids conflict.")
  if (DRY_RUN) return

  const writes = plan.filter((entry) => entry.action === "create")
  for (let start = 0; start < writes.length; start += 450) {
    const batch = db.batch()
    for (const entry of writes.slice(start, start + 450)) {
      const project = projects.find((candidate) => candidate.id === entry.projectId)
      if (!project) fail(`Could not resolve ${entry.projectId} while preparing the write batch.`)
      const data = project.data()
      batch.create(db.collection(CONTEXTS_COLLECTION).doc(entry.contextId), {
        name: typeof data.name === "string" && data.name.trim() ? data.name.trim() : "Untitled Quest Coral project",
        description: description(data.description),
        fields: [],
        createdBy: typeof data.ownerUserId === "string" && data.ownerUserId ? data.ownerUserId : "svc-system-context",
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        sourceModule: SOURCE_MODULE,
        questCoralProjectId: entry.projectId,
      })
    }
    await batch.commit()
  }

  const verificationRefs = writes.map((entry) => db.collection(CONTEXTS_COLLECTION).doc(entry.contextId))
  const verificationSnapshots = verificationRefs.length > 0 ? await db.getAll(...verificationRefs) : []
  const failed = verificationSnapshots.filter((snapshot) => {
    const data = snapshot.data()
    return !snapshot.exists || data?.sourceModule !== SOURCE_MODULE || data?.questCoralProjectId !== snapshot.id.slice("quest-coral-".length)
  })
  console.log(JSON.stringify({
    result: "complete",
    createdContexts: writes.length,
    unchangedContexts: plan.filter((entry) => entry.action === "unchanged").length,
    verification: failed.length === 0 ? "passed" : "failed",
  }, null, 2))
  if (failed.length > 0) fail(`Post-write verification failed for: ${failed.map((snapshot) => snapshot.id).join(", ")}`)
}

main().catch((error) => {
  console.error("Quest Coral Communications context backfill failed:", error.message)
  process.exit(1)
})
