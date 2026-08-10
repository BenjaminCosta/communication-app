#!/usr/bin/env node
/**
 * Registers existing Communications replies to mirrored Quest Coral Feedback
 * as Quest Coral thread replies. It never creates a second Communications
 * message: it adds provenance to the original reply and creates its linked
 * `questCoralFeedbackReplies` record with a deterministic `legacy-` id.
 *
 * Dry-run is the default. Production writes require an svc-comms service
 * account and CONFIRM_PROD_QUEST_CORAL_FEEDBACK_REPLY_BACKFILL=true.
 */

import { cert, initializeApp } from "firebase-admin/app"
import { getFirestore, Timestamp } from "firebase-admin/firestore"
import { existsSync, readFileSync } from "node:fs"

const EXPECTED_PROJECT_ID = "svc-comms"
const DRY_RUN = process.env.DRY_RUN !== "false"
const SOURCE_MODULE = "quest-coral"
const MESSAGES_COLLECTION = "messages"
const PROJECTS_COLLECTION = "questCoralProjects"
const REPLIES_COLLECTION = "questCoralFeedbackReplies"
const USERS_COLLECTION = "users"
const READ_CHUNK_SIZE = 400
const WRITE_CHUNK_SIZE = 400

function fail(message) {
  console.error(`ERROR: ${message}`)
  process.exit(1)
}

function text(value) {
  return typeof value === "string" ? value.trim() : ""
}

function stringArray(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string" && entry.trim()).map((entry) => entry.trim()) : []
}

function unique(...lists) {
  return [...new Set(lists.flatMap((list) => list.filter(Boolean)))]
}

function sameSet(left, right) {
  const a = [...new Set(left)].sort()
  const b = [...new Set(right)].sort()
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function timestamp(value) {
  if (value instanceof Timestamp) return value
  if (value && typeof value === "object" && typeof value.toDate === "function") {
    const date = value.toDate()
    if (date instanceof Date && Number.isFinite(date.getTime())) return Timestamp.fromDate(date)
  }
  if (value instanceof Date && Number.isFinite(value.getTime())) return Timestamp.fromDate(value)
  return Timestamp.now()
}

function timestampMs(value) {
  return timestamp(value).toMillis()
}

function sourceLink(data) {
  if (data.sourceModule !== SOURCE_MODULE) return null
  const projectId = text(data.sourceQuestCoralProjectId)
  const feedbackId = text(data.sourceQuestCoralFeedbackId)
  return projectId && feedbackId ? { projectId, feedbackId } : null
}

function replyIdForMessage(messageId) {
  return `legacy-${messageId}`
}

async function getAllInChunks(db, refs) {
  const result = []
  for (let start = 0; start < refs.length; start += READ_CHUNK_SIZE) {
    result.push(...await db.getAll(...refs.slice(start, start + READ_CHUNK_SIZE)))
  }
  return result
}

function validateTarget() {
  const expected = process.env.EXPECTED_FIREBASE_PROJECT ?? EXPECTED_PROJECT_ID
  if (expected !== EXPECTED_PROJECT_ID) fail(`EXPECTED_FIREBASE_PROJECT must be ${EXPECTED_PROJECT_ID}; received ${expected}.`)
  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
  if (!credentialsPath || !existsSync(credentialsPath)) fail("Set GOOGLE_APPLICATION_CREDENTIALS to the production service-account JSON file.")
  let serviceAccount
  try {
    serviceAccount = JSON.parse(readFileSync(credentialsPath, "utf8"))
  } catch {
    fail("GOOGLE_APPLICATION_CREDENTIALS is not valid JSON.")
  }
  if (serviceAccount.project_id !== EXPECTED_PROJECT_ID) fail(`Service account project_id must be ${EXPECTED_PROJECT_ID}; received ${serviceAccount.project_id ?? "(missing)"}.`)
  if (!DRY_RUN && process.env.CONFIRM_PROD_QUEST_CORAL_FEEDBACK_REPLY_BACKFILL !== "true") {
    fail("Refusing a production write without CONFIRM_PROD_QUEST_CORAL_FEEDBACK_REPLY_BACKFILL=true.")
  }
  return serviceAccount
}

async function main() {
  const serviceAccount = validateTarget()
  const app = initializeApp({ credential: cert(serviceAccount), projectId: EXPECTED_PROJECT_ID })
  const db = getFirestore(app)
  const messageSnapshot = await db.collection(MESSAGES_COLLECTION).get()
  const messages = messageSnapshot.docs
    .map((entry) => ({ id: entry.id, data: entry.data() ?? {} }))
    .sort((left, right) => timestampMs(left.data.createdAt ?? left.data.timestamp) - timestampMs(right.data.createdAt ?? right.data.timestamp) || left.id.localeCompare(right.id))
  const messageById = new Map(messages.map((message) => [message.id, message]))

  // Seed the graph with already-linked Feedback mirrors and reply messages.
  // Then repeatedly resolve regular replies whose parent is in that graph,
  // which handles nested reply chains regardless of their query ordering.
  const links = new Map()
  for (const message of messages) {
    const link = sourceLink(message.data)
    if (link) links.set(message.id, link)
  }
  const candidates = []
  const unresolved = messages.filter((message) => !sourceLink(message.data) && text(message.data.replyToId))
  let madeProgress = true
  while (madeProgress) {
    madeProgress = false
    for (const message of unresolved) {
      if (links.has(message.id)) continue
      const parent = links.get(text(message.data.replyToId))
      if (!parent) continue
      links.set(message.id, parent)
      candidates.push({ ...message, ...parent, parentId: text(message.data.replyToId) })
      madeProgress = true
    }
  }

  const projectIds = unique(candidates.map((candidate) => candidate.projectId))
  const projectSnapshots = await getAllInChunks(db, projectIds.map((id) => db.collection(PROJECTS_COLLECTION).doc(id)))
  const projects = new Map(projectSnapshots.filter((entry) => entry.exists).map((entry) => [entry.id, entry.data() ?? {}]))
  const userIds = new Set()
  for (const candidate of candidates) {
    const project = projects.get(candidate.projectId)
    userIds.add(text(candidate.data.authorId) || text(candidate.data.senderId))
    stringArray(candidate.data.recipientIds).forEach((id) => userIds.add(id))
    stringArray(candidate.data.peopleIds).forEach((id) => userIds.add(id))
    const parent = messageById.get(candidate.parentId)?.data ?? {}
    stringArray(parent.recipientIds).forEach((id) => userIds.add(id))
    stringArray(parent.peopleIds).forEach((id) => userIds.add(id))
    if (project) {
      userIds.add(text(project.ownerUserId))
      for (const person of Array.isArray(project.people) ? project.people : []) userIds.add(text(person?.id))
    }
  }
  userIds.delete("")
  const userSnapshots = await getAllInChunks(db, [...userIds].map((id) => db.collection(USERS_COLLECTION).doc(id)))
  const users = new Map(userSnapshots.filter((entry) => entry.exists).map((entry) => [entry.id, entry.data() ?? {}]))
  const replySnapshots = await getAllInChunks(db, candidates.map((candidate) => db.collection(REPLIES_COLLECTION).doc(replyIdForMessage(candidate.id))))

  const plan = []
  const conflicts = []
  const skipped = []
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index]
    const project = projects.get(candidate.projectId)
    const authorId = text(candidate.data.authorId) || text(candidate.data.senderId)
    const existingReply = replySnapshots[index]
    if (!project) {
      skipped.push({ messageId: candidate.id, reason: "orphaned-project" })
      continue
    }
    if (!authorId) {
      skipped.push({ messageId: candidate.id, reason: "missing-author" })
      continue
    }
    const replyId = replyIdForMessage(candidate.id)
    if (existingReply.exists) {
      const data = existingReply.data() ?? {}
      if (data.communicationMessageId !== candidate.id || data.projectId !== candidate.projectId || data.feedbackId !== candidate.feedbackId) {
        conflicts.push(`${REPLIES_COLLECTION}/${replyId} belongs to another reply`)
      }
      continue
    }
    const parent = messageById.get(candidate.parentId)?.data ?? {}
    const projectPeople = Array.isArray(project.people) ? project.people.map((person) => text(person?.id)) : []
    const currentRecipientIds = unique(
      stringArray(candidate.data.recipientIds),
      stringArray(parent.recipientIds),
      [text(project.ownerUserId)],
      projectPeople,
    ).filter((id) => users.has(id))
    const peopleIds = unique(stringArray(candidate.data.peopleIds), stringArray(parent.peopleIds), currentRecipientIds)
    const visibleToUserIds = unique(
      stringArray(candidate.data.visibleToUserIds),
      stringArray(candidate.data.participants),
      stringArray(parent.visibleToUserIds),
      stringArray(parent.participants),
      [authorId],
      currentRecipientIds,
    )
    const participants = unique(stringArray(candidate.data.participants), stringArray(parent.participants), visibleToUserIds)
    const audienceChanged = !sameSet(stringArray(candidate.data.recipientIds), currentRecipientIds)
      || !sameSet(stringArray(candidate.data.peopleIds), peopleIds)
      || !sameSet(stringArray(candidate.data.visibleToUserIds), visibleToUserIds)
      || !sameSet(stringArray(candidate.data.participants), participants)
    const authorName = text(users.get(authorId)?.name) || text(candidate.data.authorName) || "Someone"
    const media = {
      ...(text(candidate.data.imageUrl) ? {
        imageUrl: candidate.data.imageUrl,
        ...(text(candidate.data.imageName) ? { imageName: candidate.data.imageName } : {}),
      } : {}),
      ...(text(candidate.data.fileUrl) ? {
        fileUrl: candidate.data.fileUrl,
        ...(text(candidate.data.fileName) ? { fileName: candidate.data.fileName } : {}),
      } : {}),
    }
    plan.push({
      messageId: candidate.id,
      replyId,
      projectId: candidate.projectId,
      feedbackId: candidate.feedbackId,
      authorId,
      reply: {
        projectId: candidate.projectId,
        feedbackId: candidate.feedbackId,
        authorId,
        authorName,
        body: typeof candidate.data.content === "string" ? candidate.data.content : (typeof candidate.data.text === "string" ? candidate.data.text : ""),
        communicationMessageId: candidate.id,
        replyToCommunicationMessageId: candidate.parentId,
        createdAt: timestamp(candidate.data.createdAt ?? candidate.data.timestamp),
        ...media,
      },
      messagePatch: {
        sourceModule: SOURCE_MODULE,
        sourceQuestCoralProjectId: candidate.projectId,
        sourceQuestCoralFeedbackId: candidate.feedbackId,
        sourceQuestCoralFeedbackReplyId: replyId,
        ...(audienceChanged ? { recipientIds: currentRecipientIds, peopleIds, visibleToUserIds, participants } : {}),
        updatedAt: Timestamp.now(),
      },
      audienceChanged,
    })
  }

  console.log(JSON.stringify({
    target: `PRODUCTION (${EXPECTED_PROJECT_ID})`,
    mode: DRY_RUN ? "dry-run" : "write",
    messagesScanned: messages.length,
    linkedReplies: plan.length,
    audienceRepairs: plan.filter((entry) => entry.audienceChanged).length,
    skipped,
    conflicts,
  }, null, 2))
  if (conflicts.length > 0) fail("No writes were made because one or more deterministic reply ids conflict.")
  if (DRY_RUN) return

  for (let start = 0; start < plan.length; start += WRITE_CHUNK_SIZE) {
    const batch = db.batch()
    for (const entry of plan.slice(start, start + WRITE_CHUNK_SIZE)) {
      batch.create(db.collection(REPLIES_COLLECTION).doc(entry.replyId), entry.reply)
      batch.update(db.collection(MESSAGES_COLLECTION).doc(entry.messageId), entry.messagePatch)
    }
    await batch.commit()
  }
  const verification = await getAllInChunks(db, plan.map((entry) => db.collection(REPLIES_COLLECTION).doc(entry.replyId)))
  const failed = verification.filter((snapshot, index) => {
    const entry = plan[index]
    const data = snapshot.data()
    return !snapshot.exists || data?.communicationMessageId !== entry.messageId || data?.feedbackId !== entry.feedbackId
  })
  console.log(JSON.stringify({
    result: "complete",
    createdReplies: plan.length,
    updatedMessages: plan.length,
    audienceRepairs: plan.filter((entry) => entry.audienceChanged).length,
    verification: failed.length === 0 ? "passed" : "failed",
  }, null, 2))
  if (failed.length > 0) fail(`Post-write verification failed for: ${failed.map((entry) => entry.id).join(", ")}`)
}

main().catch((error) => {
  console.error("Quest Coral feedback reply backfill failed:", error.message)
  process.exit(1)
})
