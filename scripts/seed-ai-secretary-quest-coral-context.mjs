#!/usr/bin/env node
/**
 * Creates or refreshes the verified product context for the existing
 * Quest Coral "AI Secretary" project.
 *
 * Conservative production behavior:
 * - dry-run by default;
 * - requires a service account for exactly svc-comms;
 * - checks the fixed project id and expected project name;
 * - fills the project description only when it is blank;
 * - creates or refreshes only this script's own context record;
 * - refuses to overwrite a human/foreign Project Context.
 *
 * Usage:
 *   EXPECTED_FIREBASE_PROJECT=svc-comms \
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *   node scripts/seed-ai-secretary-quest-coral-context.mjs
 *
 *   DRY_RUN=false CONFIRM_PROD_AI_SECRETARY_CONTEXT=true \
 *   EXPECTED_FIREBASE_PROJECT=svc-comms \
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *   node scripts/seed-ai-secretary-quest-coral-context.mjs
 */

import { cert, initializeApp } from "firebase-admin/app"
import { getFirestore, Timestamp } from "firebase-admin/firestore"
import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const EXPECTED_FIREBASE_PROJECT = "svc-comms"
const AI_SECRETARY_PROJECT_ID = "NCQHiXNSt0yWYDuWGjCQ"
const AI_SECRETARY_PROJECT_NAME = "AI Secretary"
const CONTEXT_SEED_KEY = "svc-product-context:ai-secretary"
const SOURCE_FILE = "docs/svc-ai-secretary-product-context.md"
const PROJECT_DESCRIPTION = "SVC's WhatsApp AI Secretary: one authorized conversational entry point for company knowledge and live operational information."
const CONTEXT_MAX_CHARS = 12_000
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPOSITORY_ROOT = join(SCRIPT_DIR, "..")
const DRY_RUN = process.env.DRY_RUN !== "false"

function fail(message) {
  console.error(`ERROR: ${message}`)
  process.exit(1)
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex")
}

function isoDateFromSource(markdown) {
  const match = markdown.match(/^Updated:\s*(\d{4}-\d{2}-\d{2})$/m)
  if (!match) fail(`${SOURCE_FILE} must contain “Updated: YYYY-MM-DD”.`)
  return match[1]
}

function validateProductionAccess() {
  if ((process.env.EXPECTED_FIREBASE_PROJECT ?? EXPECTED_FIREBASE_PROJECT) !== EXPECTED_FIREBASE_PROJECT) {
    fail(`EXPECTED_FIREBASE_PROJECT must be ${EXPECTED_FIREBASE_PROJECT}.`)
  }
  if (process.env.AI_SECRETARY_PROJECT_ID && process.env.AI_SECRETARY_PROJECT_ID !== AI_SECRETARY_PROJECT_ID) {
    fail(`AI_SECRETARY_PROJECT_ID must be the verified project ${AI_SECRETARY_PROJECT_ID}.`)
  }
  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
  if (!credentialsPath || !existsSync(credentialsPath)) {
    fail("Set GOOGLE_APPLICATION_CREDENTIALS to the svc-comms production service-account JSON file.")
  }
  let serviceAccount
  try {
    serviceAccount = JSON.parse(readFileSync(credentialsPath, "utf8"))
  } catch {
    fail("GOOGLE_APPLICATION_CREDENTIALS is not valid JSON.")
  }
  if (serviceAccount.project_id !== EXPECTED_FIREBASE_PROJECT) {
    fail(`Service account project_id must be ${EXPECTED_FIREBASE_PROJECT}.`)
  }
  if (!DRY_RUN && process.env.CONFIRM_PROD_AI_SECRETARY_CONTEXT !== "true") {
    fail("Refusing a production write without CONFIRM_PROD_AI_SECRETARY_CONTEXT=true.")
  }
  return serviceAccount
}

function buildContext() {
  const sourcePath = join(REPOSITORY_ROOT, SOURCE_FILE)
  if (!existsSync(sourcePath)) fail(`Missing source document: ${SOURCE_FILE}`)
  const sourceMarkdown = readFileSync(sourcePath, "utf8").trim()
  const requiredSections = [
    "Problem it solves",
    "Who uses it",
    "How it works",
    "Main flows and screens",
    "Current functionality",
    "Key decisions",
    "Current service channel",
    "How it connects to other modules",
    "Current status, open items and risks",
  ]
  const missing = requiredSections.filter((heading) => !sourceMarkdown.includes(`## ${heading}`))
  if (missing.length > 0) fail(`${SOURCE_FILE} is missing: ${missing.join(", ")}`)

  const sourceDate = isoDateFromSource(sourceMarkdown)
  const markdown = [
    "## Context record",
    "",
    `- **Name:** ${AI_SECRETARY_PROJECT_NAME}`,
    `- **Description:** ${PROJECT_DESCRIPTION}`,
    "- **Purpose:** Give SVC one trustworthy WhatsApp entry point for questions across company knowledge and authorized live operational data.",
    "- **Current channel:** Meta WhatsApp Cloud API test/sandbox number; no dedicated SVC production number yet.",
    "- **Meta Phone Number ID:** 1165212860018618 (configuration identifier, not a user-facing telephone number).",
    "- **Display phone number:** Not retained in this repository; confirm it in Meta before publishing it as a staff contact number.",
    `- **Context date:** ${sourceDate}`,
    `- **Context source:** ${SOURCE_FILE} and the Secretary operational handoff.`,
    "",
    sourceMarkdown,
  ].join("\n")
  if (markdown.length > CONTEXT_MAX_CHARS) {
    fail(`Project Context is ${markdown.length} characters; limit is ${CONTEXT_MAX_CHARS}.`)
  }
  return { markdown, sourceDate, contentHash: hash(markdown) }
}

async function main() {
  const serviceAccount = validateProductionAccess()
  const context = buildContext()
  const app = initializeApp({ credential: cert(serviceAccount), projectId: EXPECTED_FIREBASE_PROJECT })
  const db = getFirestore(app)
  const projectRef = db.collection("questCoralProjects").doc(AI_SECRETARY_PROJECT_ID)
  const contextRef = db.collection("questCoralProjectContexts").doc(AI_SECRETARY_PROJECT_ID)

  const [projectSnapshot, contextSnapshot] = await Promise.all([projectRef.get(), contextRef.get()])
  if (!projectSnapshot.exists) fail(`Missing Quest Coral project ${AI_SECRETARY_PROJECT_ID}.`)
  const project = projectSnapshot.data() ?? {}
  if (project.name !== AI_SECRETARY_PROJECT_NAME) {
    fail(`Project ${AI_SECRETARY_PROJECT_ID} is “${project.name ?? "(unnamed)"}”, not “${AI_SECRETARY_PROJECT_NAME}”.`)
  }
  const existingContext = contextSnapshot.data() ?? null
  if (existingContext && existingContext.seedKey !== CONTEXT_SEED_KEY) {
    fail("The AI Secretary Project Context is human-authored or owned by another seed; no overwrite was made.")
  }

  const descriptionAction = typeof project.description !== "string" || !project.description.trim()
    ? "fill-blank"
    : project.description === PROJECT_DESCRIPTION ? "unchanged"
      : "preserve-existing"
  const contextAction = !existingContext
    ? "create"
    : existingContext.contentHash === context.contentHash ? "unchanged" : "update"

  console.log(JSON.stringify({
    target: `PRODUCTION (${EXPECTED_FIREBASE_PROJECT})`,
    mode: DRY_RUN ? "dry-run" : "write",
    project: { id: AI_SECRETARY_PROJECT_ID, name: AI_SECRETARY_PROJECT_NAME, description: descriptionAction },
    projectContext: { action: contextAction, sourceFile: SOURCE_FILE, sourceDate: context.sourceDate, chars: context.markdown.length },
  }, null, 2))
  if (DRY_RUN) return

  const now = Timestamp.now()
  await db.runTransaction(async (transaction) => {
    const [freshProject, freshContext] = await Promise.all([transaction.get(projectRef), transaction.get(contextRef)])
    if (!freshProject.exists || freshProject.data()?.name !== AI_SECRETARY_PROJECT_NAME) {
      throw new Error("The verified AI Secretary project changed before the write could complete.")
    }
    const freshProjectData = freshProject.data() ?? {}
    const freshContextData = freshContext.data() ?? null
    if (freshContextData && freshContextData.seedKey !== CONTEXT_SEED_KEY) {
      throw new Error("The Project Context became human-authored or foreign before the write; refusing to overwrite it.")
    }
    if (typeof freshProjectData.description !== "string" || !freshProjectData.description.trim()) {
      transaction.update(projectRef, { description: PROJECT_DESCRIPTION, updatedAt: now })
    }
    const payload = {
      projectId: AI_SECRETARY_PROJECT_ID,
      markdown: context.markdown,
      updatedAt: now,
      updatedBy: "SVC",
      source: "upload",
      fileName: SOURCE_FILE.split("/").at(-1),
      seedKey: CONTEXT_SEED_KEY,
      seedVersion: 1,
      contentHash: context.contentHash,
      contextSourcePath: SOURCE_FILE,
      contextSourceDate: context.sourceDate,
      seededAt: now,
    }
    if (!freshContext.exists) {
      transaction.create(contextRef, { ...payload, createdAt: now })
    } else if (freshContextData.contentHash !== context.contentHash) {
      transaction.update(contextRef, payload)
    }
  })

  const [verifiedProject, verifiedContext] = await Promise.all([projectRef.get(), contextRef.get()])
  const verifiedProjectData = verifiedProject.data() ?? {}
  const verifiedContextData = verifiedContext.data() ?? {}
  const verified = verifiedProject.exists
    && verifiedProjectData.name === AI_SECRETARY_PROJECT_NAME
    && typeof verifiedProjectData.description === "string"
    && verifiedProjectData.description.trim().length > 0
    && verifiedContext.exists
    && verifiedContextData.projectId === AI_SECRETARY_PROJECT_ID
    && verifiedContextData.seedKey === CONTEXT_SEED_KEY
    && verifiedContextData.contentHash === context.contentHash
  console.log(JSON.stringify({ verification: { projectId: AI_SECRETARY_PROJECT_ID, contextCurrent: verified } }, null, 2))
  if (!verified) fail("Post-write verification failed.")
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)))
