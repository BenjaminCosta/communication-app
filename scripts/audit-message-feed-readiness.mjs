#!/usr/bin/env node
/**
 * Aggregated, read-only production audit for the canonical paginated feed.
 * It never prints message IDs, user IDs, text, or other document payloads.
 */

import { cert, initializeApp } from "firebase-admin/app"
import { getFirestore } from "firebase-admin/firestore"
import { existsSync, readFileSync } from "node:fs"

if (process.env.READ_ONLY_PRODUCTION_AUDIT !== "true") {
  throw new Error("Set READ_ONLY_PRODUCTION_AUDIT=true to confirm the read-only remote audit.")
}

const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
const expectedProject = process.env.EXPECTED_FIREBASE_PROJECT
if (!credentialsPath || !existsSync(credentialsPath)) {
  throw new Error("GOOGLE_APPLICATION_CREDENTIALS must point to an existing service account file.")
}
if (!expectedProject) throw new Error("EXPECTED_FIREBASE_PROJECT is required.")

const serviceAccount = JSON.parse(readFileSync(credentialsPath, "utf8"))
if (serviceAccount.project_id !== expectedProject) {
  throw new Error(`Credential project mismatch: expected ${expectedProject}.`)
}

const app = initializeApp({ credential: cert(serviceAccount), projectId: expectedProject })
const db = getFirestore(app)
db.settings({ preferRest: true })

const snapshot = await db.collection("messages").select(
  "authorId",
  "senderId",
  "recipientIds",
  "participants",
  "visibleToUserIds",
  "timestamp",
  "projectId",
).get()

const summary = {
  totalMessages: snapshot.size,
  queryEligibleMessages: 0,
  missingVisibleArray: 0,
  emptyVisibleArray: 0,
  missingTimestamp: 0,
  missingAuthor: 0,
  missingCanonicalRecipient: 0,
  extraVisibleRecipients: 0,
  participantOnlyRecipients: 0,
  messagesWithProject: 0,
}
let probeUserId = ""

for (const document of snapshot.docs) {
  const data = document.data()
  const authorId = string(data.authorId) || string(data.senderId)
  const recipientIds = strings(data.recipientIds)
  const participants = strings(data.participants)
  const visible = Array.isArray(data.visibleToUserIds) ? strings(data.visibleToUserIds) : null

  if (!authorId) summary.missingAuthor += 1
  if (string(data.projectId)) summary.messagesWithProject += 1
  if (data.timestamp === undefined || data.timestamp === null) summary.missingTimestamp += 1
  if (visible === null) summary.missingVisibleArray += 1
  else if (visible.length === 0) summary.emptyVisibleArray += 1
  else if (!probeUserId) probeUserId = visible[0]

  if (visible && visible.length > 0 && data.timestamp !== undefined && data.timestamp !== null) {
    summary.queryEligibleMessages += 1
  }

  const canonical = new Set([authorId, ...recipientIds].filter(Boolean))
  const visibleSet = new Set(visible ?? [])
  if ([...canonical].some((uid) => !visibleSet.has(uid))) summary.missingCanonicalRecipient += 1
  if ([...visibleSet].some((uid) => !canonical.has(uid))) summary.extraVisibleRecipients += 1
  if (participants.some((uid) => !visibleSet.has(uid))) summary.participantOnlyRecipients += 1
}

let canonicalQueryProbe = { attempted: false, ok: false, documentCount: 0 }
if (probeUserId) {
  canonicalQueryProbe = { attempted: true, ok: false, documentCount: 0 }
  try {
    const probe = await db
      .collection("messages")
      .where("visibleToUserIds", "array-contains", probeUserId)
      .orderBy("timestamp", "desc")
      .limit(75)
      .get()
    canonicalQueryProbe = { attempted: true, ok: true, documentCount: probe.size }
  } catch (error) {
    canonicalQueryProbe = {
      attempted: true,
      ok: false,
      documentCount: 0,
      errorCode: typeof error?.code === "number" || typeof error?.code === "string" ? error.code : "unknown",
    }
  }
}

const ready =
  summary.totalMessages === summary.queryEligibleMessages &&
  summary.missingVisibleArray === 0 &&
  summary.emptyVisibleArray === 0 &&
  summary.missingTimestamp === 0 &&
  summary.missingCanonicalRecipient === 0 &&
  canonicalQueryProbe.ok

console.log(JSON.stringify({
  mode: "production-read-only",
  projectId: expectedProject,
  readyForCanonicalQuery: ready,
  summary,
  canonicalQueryProbe,
}, null, 2))

if (!ready) process.exitCode = 2

function string(value) {
  return typeof value === "string" ? value.trim() : ""
}

function strings(value) {
  return Array.isArray(value) ? [...new Set(value.map(string).filter(Boolean))] : []
}
