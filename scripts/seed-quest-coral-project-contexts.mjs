#!/usr/bin/env node
/**
 * Seeds the SVC module-context projects and their Markdown briefs.
 *
 * This script is deliberately conservative:
 * - dry-run is the default;
 * - production requires a service account for exactly `svc-comms`;
 * - writes require CONFIRM_PROD_QUEST_CORAL_CONTEXT_SEED=true;
 * - fixed ids + seed keys make reruns idempotent;
 * - a project/context not owned by this seed is never overwritten.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     node scripts/seed-quest-coral-project-contexts.mjs
 *
 *   DRY_RUN=false CONFIRM_PROD_QUEST_CORAL_CONTEXT_SEED=true \
 *     GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     node scripts/seed-quest-coral-project-contexts.mjs
 */

import { cert, initializeApp } from "firebase-admin/app"
import { getFirestore, Timestamp } from "firebase-admin/firestore"
import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const EXPECTED_PROJECT_ID = "svc-comms"
const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST
const DRY_RUN = process.env.DRY_RUN !== "false"
const IS_PRODUCTION = !EMULATOR_HOST
const CONTEXT_MAX_CHARS = 12_000
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(SCRIPT_DIR, "..")
const PROJECTS_COLLECTION = "questCoralProjects"
const CONTEXTS_COLLECTION = "questCoralProjectContexts"
const SYSTEM_OWNER_ID = "svc-system-context"
const SYSTEM_OWNER_NAME = "SVC"
const SELECTED_MODULE_KEYS = process.env.SEED_MODULE_KEYS
  ? new Set(process.env.SEED_MODULE_KEYS.split(",").map((key) => key.trim()).filter(Boolean))
  : null

const MODULES = [
  {
    key: "communications",
    projectId: "svc-module-context-communications",
    name: "Communications",
    description: "Product context for SVC Stream: directed operational communication, calendar and follow-up.",
    purpose: "Keep the team aligned on what was communicated, to whom, and what needs follow-up.",
    sourceFile: "docs/svc-communications-product-context.md",
  },
  {
    key: "directory",
    projectId: "svc-module-context-directory",
    name: "Directory",
    description: "Product context for the shared SVC directory of people, companies, jobs and operational knowledge.",
    purpose: "Help the team find the right person, company or job and understand the relationships around it.",
    sourceFile: "docs/svc-directory-product-context.md",
  },
  {
    key: "applications",
    projectId: "svc-module-context-applications",
    name: "Applications",
    description: "Product context for SVC's candidate hiring, agreement and onboarding workflow.",
    purpose: "Show where each candidate is in the hiring pipeline and what is needed to move forward.",
    sourceFile: "docs/svc-applications-product-context.md",
  },
  {
    key: "quest-coral",
    projectId: "svc-module-context-quest-coral",
    name: "Quest Coral",
    description: "Product context for SVC's project tracker, operational signals and portfolio follow-up.",
    purpose: "Show which projects need attention, what blocks them and what happens next.",
    sourceFile: "docs/svc-quest-coral-product-context.md",
  },
  {
    key: "bye-bye-dpr",
    projectId: "svc-module-context-bye-bye-dpr",
    name: "ByeByeDPR",
    description: "Product context for SVC's mobile field workflow for job-site clocking and AI-assisted daily reports.",
    purpose: "Help field crews record time and daily job progress quickly, while giving SVC a reviewable operational record.",
    sourceFile: "docs/svc-bye-bye-dpr-product-context.md",
  },
]

function fail(message) {
  console.error(`ERROR: ${message}`)
  process.exit(1)
}

function seedKey(module) {
  return `svc-module-context:${module.key}`
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

function normalizeName(value) {
  return String(value ?? "").trim().toLocaleLowerCase()
}

function validateProjectId(projectId) {
  if (!/^[a-z][a-z0-9-]{2,99}$/.test(projectId)) {
    fail(`Invalid deterministic Project Context project id: ${projectId}`)
  }
}

function sourceDate(markdown, sourceFile) {
  const match = markdown.match(/Updated:\s*(\d{4}-\d{2}-\d{2})/)
  if (!match) fail(`${sourceFile} must declare an “Updated: YYYY-MM-DD” date.`)
  return match[1]
}

function requireSections(markdown, sourceFile) {
  const required = [
    "Problem it solves",
    "Who uses it",
    "How it works",
    "Main flows and screens",
    "Current functionality",
    "Key decisions",
    "How it connects to other modules",
    "Current status, open items and risks",
  ]
  const missing = required.filter((heading) => !markdown.includes(`## ${heading}`))
  if (missing.length > 0) fail(`${sourceFile} is missing required sections: ${missing.join(", ")}`)
}

function buildContext(module) {
  const absolutePath = join(REPO_ROOT, module.sourceFile)
  if (!existsSync(absolutePath)) fail(`Missing context source: ${module.sourceFile}`)
  const sourceMarkdown = readFileSync(absolutePath, "utf8").trim()
  requireSections(sourceMarkdown, module.sourceFile)
  const date = sourceDate(sourceMarkdown, module.sourceFile)
  const markdown = [
    "## Context record",
    "",
    `- **Name:** ${module.name}`,
    `- **Description:** ${module.description}`,
    `- **Purpose:** ${module.purpose}`,
    `- **Context date:** ${date}`,
    `- **Context source:** ${module.sourceFile}`,
    "",
    sourceMarkdown,
  ].join("\n")
  if (markdown.length > CONTEXT_MAX_CHARS) {
    fail(`${module.sourceFile} produces ${markdown.length} characters; Project Context limit is ${CONTEXT_MAX_CHARS}.`)
  }
  return { ...module, contextDate: date, markdown, contentHash: sha256(markdown) }
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
  if (!DRY_RUN && process.env.CONFIRM_PROD_QUEST_CORAL_CONTEXT_SEED !== "true") {
    fail("Refusing a production write without CONFIRM_PROD_QUEST_CORAL_CONTEXT_SEED=true.")
  }
  return serviceAccount
}

async function verifyPersisted(db, contexts) {
  const checks = await Promise.all(contexts.map(async (context) => {
    const [project, projectContext] = await Promise.all([
      db.collection(PROJECTS_COLLECTION).doc(context.projectId).get(),
      db.collection(CONTEXTS_COLLECTION).doc(context.projectId).get(),
    ])
    const projectData = project.data()
    const contextData = projectContext.data()
    return {
      projectId: context.projectId,
      project: project.exists && projectData?.seedKey === seedKey(context),
      context: projectContext.exists
        && contextData?.projectId === context.projectId
        && contextData?.seedKey === seedKey(context)
        && contextData?.contentHash === context.contentHash,
    }
  }))
  const failed = checks.filter((check) => !check.project || !check.context)
  console.log(JSON.stringify({ verification: checks }, null, 2))
  if (failed.length > 0) fail(`Post-write verification failed for: ${failed.map((check) => check.projectId).join(", ")}`)
}

async function main() {
  const serviceAccount = validateTarget()
  const selectedModules = SELECTED_MODULE_KEYS
    ? MODULES.filter((module) => SELECTED_MODULE_KEYS.has(module.key))
    : MODULES
  if (SELECTED_MODULE_KEYS) {
    const availableKeys = new Set(MODULES.map((module) => module.key))
    const unknownKeys = [...SELECTED_MODULE_KEYS].filter((key) => !availableKeys.has(key))
    if (unknownKeys.length > 0) fail(`Unknown SEED_MODULE_KEYS value(s): ${unknownKeys.join(", ")}.`)
  }
  if (selectedModules.length === 0) fail("SEED_MODULE_KEYS did not select any module contexts.")
  const contexts = selectedModules.map((module) => {
    validateProjectId(module.projectId)
    return buildContext(module)
  })

  const app = serviceAccount
    ? initializeApp({ credential: cert(serviceAccount), projectId: EXPECTED_PROJECT_ID })
    : initializeApp({ projectId: EXPECTED_PROJECT_ID })
  const db = getFirestore(app)
  if (EMULATOR_HOST) {
    const [host, port] = EMULATOR_HOST.split(":")
    db.settings({ host, ssl: false, port: Number(port) })
  }

  const target = IS_PRODUCTION ? `PRODUCTION (${EXPECTED_PROJECT_ID})` : `emulator (${EMULATOR_HOST})`
  console.log(`\nQuest Coral Project Context seed → ${target}`)
  console.log(`Mode: ${DRY_RUN ? "DRY RUN — no writes" : "WRITE"}\n`)

  const existingProjects = await db.collection(PROJECTS_COLLECTION).get()
  const projectsById = new Map(existingProjects.docs.map((entry) => [entry.id, entry.data()]))
  const projectsBySeedKey = new Map(
    existingProjects.docs
      .map((entry) => [entry.data().seedKey, entry])
      .filter(([key]) => typeof key === "string"),
  )
  const projectsByName = new Map(
    existingProjects.docs.map((entry) => [normalizeName(entry.data().name), entry]),
  )
  const contextSnapshots = await Promise.all(contexts.map((context) => db.collection(CONTEXTS_COLLECTION).doc(context.projectId).get()))
  const contextsById = new Map(contextSnapshots.map((entry) => [entry.id, entry.data()]))

  const conflicts = []
  const plan = []
  for (const context of contexts) {
    const key = seedKey(context)
    const existingProject = projectsById.get(context.projectId)
    const seededElsewhere = projectsBySeedKey.get(key)
    const sameName = projectsByName.get(normalizeName(context.name))
    if (existingProject && existingProject.seedKey !== key) {
      conflicts.push(`${PROJECTS_COLLECTION}/${context.projectId} already exists without seed key ${key}`)
      continue
    }
    if (seededElsewhere && seededElsewhere.id !== context.projectId) {
      conflicts.push(`seed key ${key} already belongs to ${PROJECTS_COLLECTION}/${seededElsewhere.id}`)
      continue
    }
    if (!existingProject && sameName && sameName.id !== context.projectId) {
      conflicts.push(`a non-seed project named “${context.name}” already exists at ${PROJECTS_COLLECTION}/${sameName.id}`)
      continue
    }
    const existingContext = contextsById.get(context.projectId)
    if (existingContext && existingContext.seedKey !== key) {
      conflicts.push(`${CONTEXTS_COLLECTION}/${context.projectId} contains a human or foreign context and will not be overwritten`)
      continue
    }
    const projectAction = existingProject ? "unchanged" : "create"
    const contextAction = !existingContext
      ? "create"
      : existingContext.contentHash === context.contentHash ? "unchanged" : "update"
    plan.push({ context, projectAction, contextAction })
  }

  console.log(JSON.stringify({
    target,
    mode: DRY_RUN ? "dry-run" : "write",
    sourceDocuments: contexts.map(({ projectId, sourceFile, contextDate, contentHash, markdown }) => ({
      projectId,
      sourceFile,
      contextDate,
      chars: markdown.length,
      contentHash,
    })),
    plan: plan.map(({ context, projectAction, contextAction }) => ({
      projectId: context.projectId,
      project: projectAction,
      context: contextAction,
    })),
    conflicts,
  }, null, 2))

  if (conflicts.length > 0) {
    fail("No writes were made because a conflicting project/context already exists.")
  }
  if (DRY_RUN) return

  let createdProjects = 0
  let createdContexts = 0
  let updatedContexts = 0
  const now = Timestamp.now()
  for (const { context, projectAction, contextAction } of plan) {
    const key = seedKey(context)
    if (projectAction === "create") {
      await db.collection(PROJECTS_COLLECTION).doc(context.projectId).create({
        name: context.name,
        description: context.description,
        status: "on_track",
        progress: 100,
        missionFitScore: 5,
        ownerUserId: SYSTEM_OWNER_ID,
        ownerName: SYSTEM_OWNER_NAME,
        people: [{ id: SYSTEM_OWNER_ID, name: SYSTEM_OWNER_NAME, initials: "SVC" }],
        nextStep: "Keep the product context current as the module evolves.",
        nextStepDue: null,
        timeline: null,
        isFavorited: false,
        seedKey: key,
        seedVersion: 1,
        createdAt: now,
        updatedAt: now,
      })
      createdProjects += 1
    }
    if (contextAction !== "unchanged") {
      const contextRef = db.collection(CONTEXTS_COLLECTION).doc(context.projectId)
      const payload = {
        projectId: context.projectId,
        markdown: context.markdown,
        updatedAt: now,
        updatedBy: SYSTEM_OWNER_NAME,
        source: "upload",
        fileName: context.sourceFile.split("/").at(-1),
        seedKey: key,
        seedVersion: 1,
        contentHash: context.contentHash,
        contextSourcePath: context.sourceFile,
        contextSourceDate: context.contextDate,
        seededAt: now,
      }
      if (contextAction === "create") {
        await contextRef.create({ ...payload, createdAt: now })
        createdContexts += 1
      } else {
        await contextRef.update(payload)
        updatedContexts += 1
      }
    }
  }

  await verifyPersisted(db, contexts)
  console.log(JSON.stringify({
    result: "complete",
    createdProjects,
    createdContexts,
    updatedContexts,
    unchangedProjects: plan.filter((entry) => entry.projectAction === "unchanged").length,
    unchangedContexts: plan.filter((entry) => entry.contextAction === "unchanged").length,
  }, null, 2))
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)))
