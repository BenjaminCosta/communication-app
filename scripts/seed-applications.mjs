#!/usr/bin/env node
/**
 * seed-applications.mjs
 *
 * Seeds /applications (+ its activity subcollection) and /applicationLinks with
 * five sample candidates that demonstrate every status, so the dashboard can be
 * tested against the real backend.
 *
 * DRY RUN BY DEFAULT — nothing is written unless DRY_RUN=false.
 *
 * Two targets:
 *   EMULATOR: set FIRESTORE_EMULATOR_HOST.
 *     FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/seed-applications.mjs
 *     DRY_RUN=false FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/seed-applications.mjs
 *   PRODUCTION: set GOOGLE_APPLICATION_CREDENTIALS. A prod WRITE additionally
 *     requires CONFIRM_PROD_SEED=true, so it can never touch prod by accident.
 *     GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node scripts/seed-applications.mjs   # dry
 *     DRY_RUN=false CONFIRM_PROD_SEED=true GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node scripts/seed-applications.mjs
 *
 * Teardown (removes exactly these seeded ids): pass TEARDOWN=true.
 */

import { initializeApp, applicationDefault } from "firebase-admin/app"
import { getFirestore, Timestamp } from "firebase-admin/firestore"

const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST
const HAS_CREDENTIALS = Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS)
const DRY_RUN = process.env.DRY_RUN !== "false"
const TEARDOWN = process.env.TEARDOWN === "true"
const IS_PROD = !EMULATOR_HOST && HAS_CREDENTIALS

if (!EMULATOR_HOST && !HAS_CREDENTIALS) {
  console.error("ERROR: set FIRESTORE_EMULATOR_HOST (emulator) or GOOGLE_APPLICATION_CREDENTIALS (production).")
  process.exit(1)
}
if (IS_PROD && !DRY_RUN && process.env.CONFIRM_PROD_SEED !== "true") {
  console.error("ERROR: refusing to write to PRODUCTION without CONFIRM_PROD_SEED=true.")
  process.exit(1)
}

const app = IS_PROD
  ? initializeApp({ credential: applicationDefault(), projectId: "svc-comms" })
  : initializeApp({ projectId: "svc-comms" })
const db = getFirestore(app)
if (EMULATOR_HOST) db.settings({ host: EMULATOR_HOST, ssl: false })

// ── Helpers ──────────────────────────────────────────────────────────────────

function daysAgo(days) {
  const date = new Date()
  date.setDate(date.getDate() - days)
  date.setHours(9, 30, 0, 0)
  return Timestamp.fromDate(date)
}

function daysAhead(days) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return Timestamp.fromDate(date)
}

function generalOf(overrides) {
  return {
    fullName: "",
    phone: "",
    email: "",
    cityState: "",
    yearsExperience: "",
    primaryTrade: "",
    resumeFileName: "",
    workReference: "",
    ...overrides,
  }
}

function docOf(id, label, helper, status, uploadedDaysAgo, origin = "standard") {
  return {
    id,
    label,
    helper,
    required: true,
    status,
    fileName: status === "missing" ? null : `${id}.jpg`,
    uploadedAt: status === "missing" ? null : daysAgo(uploadedDaysAgo),
    origin,
  }
}

function lockedAgreement() {
  return { status: "locked", sentAt: null, signedAt: null, expiresAt: null, signedVersion: null, signedName: null }
}

const JOBS = {
  rwDake: {
    jobEntityId: "job__ctx-rw-dake",
    jobName: "RW Dake Construction",
    jobLocation: "Morrow, GA",
    companyName: "RW Dake Construction",
  },
  lakeview: {
    jobEntityId: "job__ctx-lakeview",
    jobName: "Lakeview Build",
    jobLocation: "Atlanta, GA",
    companyName: "Lakeview Partners",
  },
  pineRidge: {
    jobEntityId: "job__ctx-pine-ridge",
    jobName: "Pine Ridge Utilities",
    jobLocation: "Covington, GA",
    companyName: "Pine Ridge Utilities",
  },
}

// ── Seed data ────────────────────────────────────────────────────────────────

const APPLICATIONS = [
  {
    id: "app-benjamin-lopez",
    linkToken: "demo",
    candidateName: "Benjamin Lopez",
    trade: "Carpenter",
    ...JOBS.rwDake,
    status: "submitted",
    general: generalOf({
      fullName: "Benjamin Lopez",
      phone: "(770) 555-0142",
      email: "benjamin.lopez@email.com",
      cityState: "Morrow, GA",
      yearsExperience: "6",
      primaryTrade: "Carpenter",
      resumeFileName: "benjamin-lopez-resume.pdf",
      workReference: "Dale Whitman — Whitman Framing",
    }),
    video: {
      state: "ready",
      source: "record",
      fileName: "intro-benjamin.mp4",
      durationSeconds: 78,
      capturedAt: daysAgo(3),
      summary: null,
    },
    documents: [
      docOf("drivers-license", "Driver's license", "Front side, clearly readable.", "verified", 3),
      docOf("osha-card", "OSHA 10 card", "Front side of the card.", "uploaded", 3),
    ],
    agreement: lockedAgreement(),
    createdAt: daysAgo(4),
    updatedAt: daysAgo(3),
    submittedAt: daysAgo(3),
    pendingRequest: null,
    activity: [
      { kind: "created", actor: "Candidate", actorUid: "candidate", message: "Opened the application link", at: daysAgo(4) },
      { kind: "submitted", actor: "Candidate", actorUid: "candidate", message: "Submitted the application", at: daysAgo(3) },
    ],
  },
  {
    id: "app-marcus-johnson",
    linkToken: "marcus",
    candidateName: "Marcus Johnson",
    trade: "Concrete finisher",
    ...JOBS.lakeview,
    status: "needs_information",
    general: generalOf({
      fullName: "Marcus Johnson",
      phone: "(404) 555-0177",
      email: "marcus.johnson@email.com",
      cityState: "Atlanta, GA",
      yearsExperience: "11",
      primaryTrade: "Concrete finisher",
      workReference: "Ivy Contreras — Ridge Concrete",
    }),
    video: {
      state: "ready",
      source: "upload",
      fileName: "marcus-intro.mov",
      durationSeconds: 64,
      capturedAt: daysAgo(6),
      summary: null,
    },
    documents: [
      docOf("drivers-license", "Driver's license", "Front side, clearly readable.", "missing", 0),
      docOf("osha-card", "OSHA 10 card", "Front side of the card.", "verified", 6),
    ],
    agreement: lockedAgreement(),
    createdAt: daysAgo(8),
    updatedAt: daysAgo(2),
    submittedAt: daysAgo(6),
    pendingRequest: "Waiting on a readable driver's license photo",
    activity: [
      { kind: "created", actor: "Candidate", actorUid: "candidate", message: "Opened the application link", at: daysAgo(8) },
      { kind: "submitted", actor: "Candidate", actorUid: "candidate", message: "Submitted the application", at: daysAgo(6) },
      {
        kind: "info_requested",
        actor: "Sofia Ramirez",
        actorUid: "user-sofia",
        message: "Requested a readable photo of the driver's license",
        at: daysAgo(2),
      },
    ],
  },
  {
    id: "app-tasha-williams",
    linkToken: "tasha",
    candidateName: "Tasha Williams",
    trade: "Equipment operator",
    ...JOBS.pineRidge,
    status: "ready_for_review",
    general: generalOf({
      fullName: "Tasha Williams",
      phone: "(678) 555-0164",
      email: "tasha.williams@email.com",
      cityState: "Covington, GA",
      yearsExperience: "9",
      primaryTrade: "Equipment operator",
      resumeFileName: "tasha-williams-resume.pdf",
      workReference: "Ray Okafor — Pine Ridge Utilities",
    }),
    video: {
      state: "ready",
      source: "record",
      fileName: "tasha-intro.mp4",
      durationSeconds: 92,
      capturedAt: daysAgo(5),
      summary: null,
    },
    documents: [
      docOf("drivers-license", "Driver's license", "Front side, clearly readable.", "verified", 5),
      docOf("osha-card", "OSHA 10 card", "Front side of the card.", "verified", 5),
      docOf("cdl", "CDL Class A", "Required by Pine Ridge Utilities.", "uploaded", 2, "job"),
    ],
    agreement: lockedAgreement(),
    createdAt: daysAgo(7),
    updatedAt: daysAgo(1),
    submittedAt: daysAgo(5),
    pendingRequest: null,
    activity: [
      { kind: "created", actor: "Candidate", actorUid: "candidate", message: "Opened the application link", at: daysAgo(7) },
      { kind: "submitted", actor: "Candidate", actorUid: "candidate", message: "Submitted the application", at: daysAgo(5) },
      {
        kind: "note",
        actor: "Sofia Ramirez",
        actorUid: "user-sofia",
        message: "Strong equipment background, moved to review",
        at: daysAgo(1),
      },
    ],
  },
  {
    id: "app-jose-ramirez",
    linkToken: "jose",
    candidateName: "Jose Ramirez",
    trade: "Laborer",
    ...JOBS.rwDake,
    status: "agreement_pending",
    general: generalOf({
      fullName: "Jose Ramirez",
      phone: "(470) 555-0188",
      email: "jose.ramirez@email.com",
      cityState: "Jonesboro, GA",
      yearsExperience: "3",
      primaryTrade: "Laborer",
      workReference: "Hector Lima — RW Dake Construction",
    }),
    video: {
      state: "ready",
      source: "upload",
      fileName: "jose-intro.mp4",
      durationSeconds: 55,
      capturedAt: daysAgo(12),
      summary: null,
    },
    documents: [
      docOf("drivers-license", "Driver's license", "Front side, clearly readable.", "verified", 12),
      docOf("osha-card", "OSHA 10 card", "Front side of the card.", "verified", 12),
    ],
    agreement: {
      status: "awaiting_signature",
      sentAt: daysAgo(2),
      signedAt: null,
      expiresAt: daysAhead(1),
      signedVersion: null,
      signedName: null,
    },
    createdAt: daysAgo(14),
    updatedAt: daysAgo(2),
    submittedAt: daysAgo(12),
    pendingRequest: null,
    activity: [
      { kind: "submitted", actor: "Candidate", actorUid: "candidate", message: "Submitted the application", at: daysAgo(12) },
      { kind: "approved", actor: "Sofia Ramirez", actorUid: "user-sofia", message: "Approved the application", at: daysAgo(3) },
      { kind: "note", actor: "System", actorUid: "system", message: "Operating agreement sent for signature", at: daysAgo(2) },
    ],
  },
  {
    id: "app-dana-price",
    linkToken: "dana",
    candidateName: "Dana Price",
    trade: "Drywall / finishing",
    ...JOBS.lakeview,
    status: "draft",
    general: generalOf({
      fullName: "Dana Price",
      phone: "(678) 555-0102",
      cityState: "Decatur, GA",
      primaryTrade: "Drywall / finishing",
    }),
    video: { state: "not_started", source: null, fileName: null, durationSeconds: null, capturedAt: null, summary: null },
    documents: [
      docOf("drivers-license", "Driver's license", "Front side, clearly readable.", "missing", 0),
      docOf("osha-card", "OSHA 10 card", "Front side of the card.", "missing", 0),
    ],
    agreement: lockedAgreement(),
    createdAt: daysAgo(1),
    updatedAt: daysAgo(1),
    submittedAt: null,
    pendingRequest: null,
    activity: [
      { kind: "created", actor: "Candidate", actorUid: "candidate", message: "Opened the application link", at: daysAgo(1) },
    ],
  },
]

// One live link per candidate, matching the mock tokens.
const LINKS = APPLICATIONS.map((application) => ({
  token: application.linkToken,
  applicationId: application.id,
  purpose: "application",
  step: null,
  createdAt: application.createdAt,
  expiresAt: daysAhead(14),
  revokedAt: null,
  usedCount: 0,
}))

// ── Run ──────────────────────────────────────────────────────────────────────

async function teardown() {
  console.log(`\nTEARDOWN — removing seeded applications from ${IS_PROD ? "PRODUCTION (svc-comms)" : "the emulator"}`)
  console.log(DRY_RUN ? "MODE: DRY RUN\n" : "MODE: DELETE\n")
  for (const application of APPLICATIONS) {
    console.log(`  ${DRY_RUN ? "would delete" : "deleting"}  applications/${application.id} (+activity)`)
    if (!DRY_RUN) {
      const activity = await db.collection("applications").doc(application.id).collection("activity").get()
      for (const entry of activity.docs) await entry.ref.delete()
      await db.collection("applications").doc(application.id).delete()
    }
  }
  for (const link of LINKS) {
    console.log(`  ${DRY_RUN ? "would delete" : "deleting"}  applicationLinks/${link.token}`)
    if (!DRY_RUN) await db.collection("applicationLinks").doc(link.token).delete()
  }
  console.log(`\n${DRY_RUN ? "DRY RUN complete" : "Teardown done"}.\n`)
}

async function main() {
  if (TEARDOWN) return teardown()

  const target = IS_PROD ? "PRODUCTION (svc-comms)" : `the emulator at ${EMULATOR_HOST}`
  console.log(`\nSeeding /applications into ${target}`)
  console.log(DRY_RUN ? "MODE: DRY RUN (nothing will be written)\n" : "MODE: WRITE\n")

  for (const application of APPLICATIONS) {
    const { activity, ...document } = application
    const entityIds = [document.jobEntityId].filter(Boolean)
    console.log(
      `  ${DRY_RUN ? "would write" : "writing"}  applications/${document.id}  ` +
        `[${document.status}] ${document.candidateName} — ${document.jobName} (+${activity.length} activity)`,
    )
    if (DRY_RUN) continue

    await db.collection("applications").doc(document.id).set({ ...document, entityIds })
    const activityRef = db.collection("applications").doc(document.id).collection("activity")
    for (const event of activity) {
      await activityRef.add(event)
    }
  }

  for (const link of LINKS) {
    console.log(`  ${DRY_RUN ? "would write" : "writing"}  applicationLinks/${link.token} → ${link.applicationId}`)
    if (DRY_RUN) continue
    await db.collection("applicationLinks").doc(link.token).set(link)
  }

  const activityCount = APPLICATIONS.reduce((total, application) => total + application.activity.length, 0)
  console.log(
    `\n${DRY_RUN ? "DRY RUN complete" : "Done"}: ${APPLICATIONS.length} applications, ` +
      `${activityCount} activity events, ${LINKS.length} links.`,
  )
  if (DRY_RUN) console.log("Re-run with DRY_RUN=false to write.\n")
}

main().catch((error) => {
  console.error("Seed failed:", error)
  process.exit(1)
})
