#!/usr/bin/env node
/**
 * Mirrors existing Quest Coral Red Team Review activities into Communications.
 *
 * Each Red Team Review gets the same deterministic message id used by the
 * live `/api/quest-coral/red-team-review` route. Reruns are therefore safe:
 * a matching message is left alone, while a conflicting document stops the
 * migration before any write. Same shape as
 * `backfill-quest-coral-feedback-messages.mjs`, just for the sibling type.
 *
 * Production safeguards:
 * - dry-run is the default;
 * - the service account must belong to svc-comms;
 * - writes require CONFIRM_PROD_QUEST_CORAL_RED_TEAM_REVIEW_BACKFILL=true.
 */

import { cert, initializeApp } from "firebase-admin/app"
import { getFirestore, Timestamp } from "firebase-admin/firestore"
import { existsSync, readFileSync } from "node:fs"

const EXPECTED_PROJECT_ID = "svc-comms"
const DRY_RUN = process.env.DRY_RUN !== "false"
const PROJECTS_COLLECTION = "questCoralProjects"
const UPDATES_COLLECTION = "questCoralUpdates"
const CONTEXTS_COLLECTION = "contexts"
const MESSAGES_COLLECTION = "messages"
const USERS_COLLECTION = "users"
const SOURCE_MODULE = "quest-coral"
const RED_TEAM_REVIEW_TAG_ID = "type:red_team_review"
// The Communications "Project" tag the user created by hand to label Red
// Team Review activity — kept in sync with lib/quest-coral-communications.ts.
const RED_TEAM_REVIEW_COMMS_PROJECT_ID = "p1787155484276-nxhjd"
const RED_TEAM_REVIEW_COMMS_PROJECT_TAG_ID = `project:${RED_TEAM_REVIEW_COMMS_PROJECT_ID}`
const READ_CHUNK_SIZE = 400
const WRITE_CHUNK_SIZE = 450

function fail(message) {
  console.error(`ERROR: ${message}`)
  process.exit(1)
}

function asText(value) {
  return typeof value === "string" ? value.trim() : ""
}

function contextId(projectId) {
  return `quest-coral-${projectId}`
}

function messageId(redTeamReviewId) {
  return `quest-coral-red-team-review-${redTeamReviewId}`
}

function contextDescription(projectDescription) {
  const normalized = asText(projectDescription)
  return normalized ? `Quest Coral project: ${normalized}` : "This context is linked to a Quest Coral project."
}

function redTeamReviewText(projectName, body) {
  return `Red Team Review on ${asText(projectName) || "Untitled project"}\n\n${asText(body)}`
}

function redTeamReviewAudienceCandidates(project) {
  const people = Array.isArray(project.people) ? project.people : []
  return [...new Set([
    asText(project.ownerUserId),
    ...people.map((person) => asText(person?.id)),
  ].filter(Boolean))]
}

function stringArray(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string" && entry.length > 0) : []
}

function sameStringSet(left, right) {
  const normalize = (values) => [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort()
  const first = normalize(left)
  const second = normalize(right)
  return first.length === second.length && first.every((value, index) => value === second[index])
}

function mergedStringIds(...lists) {
  return [...new Set(lists.flatMap((list) => stringArray(list).map((value) => value.trim()).filter(Boolean)))]
}

function originalTimestamp(value) {
  if (value instanceof Timestamp) return value
  if (value && typeof value === "object" && typeof value.toDate === "function") {
    const date = value.toDate()
    if (date instanceof Date && Number.isFinite(date.getTime())) return Timestamp.fromDate(date)
  }
  if (value instanceof Date && Number.isFinite(value.getTime())) return Timestamp.fromDate(value)
  return Timestamp.now()
}

async function getAllInChunks(db, refs) {
  const result = []
  for (let start = 0; start < refs.length; start += READ_CHUNK_SIZE) {
    result.push(...await db.getAll(...refs.slice(start, start + READ_CHUNK_SIZE)))
  }
  return result
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
  if (!DRY_RUN && process.env.CONFIRM_PROD_QUEST_CORAL_RED_TEAM_REVIEW_BACKFILL !== "true") {
    fail("Refusing a production write without CONFIRM_PROD_QUEST_CORAL_RED_TEAM_REVIEW_BACKFILL=true.")
  }
  return serviceAccount
}

async function main() {
  const serviceAccount = validateProductionTarget()
  const app = initializeApp({ credential: cert(serviceAccount), projectId: EXPECTED_PROJECT_ID })
  const db = getFirestore(app)
  const reviewSnapshot = await db.collection(UPDATES_COLLECTION).where("type", "==", "red_team_review").get()
  const reviews = reviewSnapshot.docs.sort((left, right) => left.id.localeCompare(right.id))
  const projectIds = [...new Set(reviews.map((review) => asText(review.data().projectId)).filter(Boolean))]
  const projectSnapshots = await getAllInChunks(db, projectIds.map((id) => db.collection(PROJECTS_COLLECTION).doc(id)))
  const projectsById = new Map(projectSnapshots.filter((snapshot) => snapshot.exists).map((snapshot) => [snapshot.id, snapshot.data() ?? {}]))
  const contextSnapshots = await getAllInChunks(db, projectIds.map((id) => db.collection(CONTEXTS_COLLECTION).doc(contextId(id))))
  const contextsByProjectId = new Map(projectIds.map((id, index) => [id, contextSnapshots[index]]))
  const messageSnapshots = await getAllInChunks(db, reviews.map((review) => db.collection(MESSAGES_COLLECTION).doc(messageId(review.id))))
  const messagesByReviewId = new Map(reviews.map((review, index) => [review.id, messageSnapshots[index]]))
  const audienceCandidateIds = new Set()
  for (const project of projectsById.values()) {
    redTeamReviewAudienceCandidates(project).forEach((id) => audienceCandidateIds.add(id))
  }
  reviews.forEach((review) => audienceCandidateIds.add(asText(review.data().authorId)))
  const userSnapshots = await getAllInChunks(db, [...audienceCandidateIds].map((id) => db.collection(USERS_COLLECTION).doc(id)))
  const registeredUserIds = new Set(userSnapshots.filter((snapshot) => snapshot.exists).map((snapshot) => snapshot.id))

  const messagePlan = []
  const contextsToCreate = new Map()
  const skipped = []
  const conflicts = []
  for (const review of reviews) {
    const data = review.data()
    const projectId = asText(data.projectId)
    const authorId = asText(data.authorId)
    const body = asText(data.body)
    const project = projectsById.get(projectId)
    if (!project) {
      skipped.push({ redTeamReviewId: review.id, reason: "orphaned-project" })
      continue
    }
    if (!authorId || !body) {
      skipped.push({ redTeamReviewId: review.id, reason: "invalid-red-team-review" })
      continue
    }
    const existingContext = contextsByProjectId.get(projectId)
    if (existingContext?.exists) {
      const context = existingContext.data() ?? {}
      if (context.sourceModule !== SOURCE_MODULE || context.questCoralProjectId !== projectId) {
        conflicts.push(`${CONTEXTS_COLLECTION}/${contextId(projectId)} belongs to another source`)
        continue
      }
    } else if (!contextsToCreate.has(projectId)) {
      contextsToCreate.set(projectId, project)
    }
    const candidates = [...new Set([...redTeamReviewAudienceCandidates(project), authorId])]
    const recipientIds = candidates.filter((id) => registeredUserIds.has(id))
    const visibleToUserIds = [...new Set([authorId, ...recipientIds])]
    const existingMessage = messagesByReviewId.get(review.id)
    if (existingMessage?.exists) {
      const message = existingMessage.data() ?? {}
      if (message.sourceModule === SOURCE_MODULE && message.sourceQuestCoralRedTeamReviewId === review.id) {
        const mergedRecipientIds = mergedStringIds(message.recipientIds, recipientIds)
        const mergedPeopleIds = mergedStringIds(message.peopleIds, mergedRecipientIds)
        const mergedVisibleToUserIds = mergedStringIds(message.visibleToUserIds, message.participants, authorId, mergedRecipientIds)
        const mergedParticipants = mergedStringIds(message.participants, mergedVisibleToUserIds)
        const needsRecipientRepair = !sameStringSet(stringArray(message.recipientIds), mergedRecipientIds)
          || !sameStringSet(stringArray(message.peopleIds), mergedPeopleIds)
          || !sameStringSet(stringArray(message.participants), mergedParticipants)
          || !sameStringSet(stringArray(message.visibleToUserIds), mergedVisibleToUserIds)
        // Only the user's own "Red Team Review" Communications project tag —
        // strip any leftover type:red_team_review systemType tag (an earlier
        // version of this script also added that, producing a duplicate
        // "Red Team Review" chip) rather than just unioning tags in.
        const desiredTagIds = mergedStringIds(
          stringArray(message.tagIds).filter((id) => id !== RED_TEAM_REVIEW_TAG_ID),
          [RED_TEAM_REVIEW_COMMS_PROJECT_TAG_ID],
        )
        const mergedProjectIds = mergedStringIds(message.projectIds, [RED_TEAM_REVIEW_COMMS_PROJECT_ID])
        const needsTagRepair = !sameStringSet(stringArray(message.tagIds), desiredTagIds)
          || !sameStringSet(stringArray(message.projectIds), mergedProjectIds)
          || message.projectId !== RED_TEAM_REVIEW_COMMS_PROJECT_ID
          || message.type !== "none"
        const needsRepair = needsRecipientRepair || needsTagRepair
        messagePlan.push({
          redTeamReviewId: review.id,
          projectId,
          action: needsRepair ? "update" : "unchanged",
          recipientIds: mergedRecipientIds,
          ...(needsRepair
            ? { recipientPatch: {
              recipientIds: mergedRecipientIds,
              peopleIds: mergedPeopleIds,
              participants: mergedParticipants,
              visibleToUserIds: mergedVisibleToUserIds,
              tagIds: desiredTagIds,
              projectIds: mergedProjectIds,
              projectId: RED_TEAM_REVIEW_COMMS_PROJECT_ID,
              type: "none",
              updatedAt: Timestamp.now(),
            } }
            : {}),
        })
      } else {
        conflicts.push(`${MESSAGES_COLLECTION}/${messageId(review.id)} belongs to another source`)
      }
      continue
    }

    messagePlan.push({
      redTeamReviewId: review.id,
      projectId,
      action: "create",
      authorId,
      recipientIds,
      message: {
        authorId,
        senderId: authorId,
        recipientIds,
        peopleIds: recipientIds,
        participants: visibleToUserIds,
        visibleToUserIds,
        projectIds: [RED_TEAM_REVIEW_COMMS_PROJECT_ID],
        projectId: RED_TEAM_REVIEW_COMMS_PROJECT_ID,
        tagIds: [RED_TEAM_REVIEW_COMMS_PROJECT_TAG_ID],
        content: redTeamReviewText(project.name, body),
        text: redTeamReviewText(project.name, body),
        type: "none",
        contactIds: [],
        contextIds: [contextId(projectId)],
        createdAt: originalTimestamp(data.createdAt),
        updatedAt: originalTimestamp(data.createdAt),
        timestamp: originalTimestamp(data.createdAt),
        isFavorited: false,
        sourceModule: SOURCE_MODULE,
        sourceQuestCoralProjectId: projectId,
        sourceQuestCoralRedTeamReviewId: review.id,
      },
    })
  }

  console.log(JSON.stringify({
    target: `PRODUCTION (${EXPECTED_PROJECT_ID})`,
    mode: DRY_RUN ? "dry-run" : "write",
    redTeamReviews: reviews.length,
    messages: messagePlan.map(({ redTeamReviewId, projectId, action, recipientIds }) => ({
      redTeamReviewId,
      projectId,
      action,
      ...(recipientIds ? { recipientCount: recipientIds.length } : {}),
    })),
    contextsToCreate: [...contextsToCreate.keys()].map((projectId) => contextId(projectId)),
    skipped,
    conflicts,
  }, null, 2))
  if (conflicts.length > 0) fail("No writes were made because one or more deterministic message/context ids conflict.")
  if (DRY_RUN) return

  const creates = [
    ...[...contextsToCreate.entries()].map(([projectId, project]) => ({
      kind: "context",
      id: contextId(projectId),
      data: {
        name: asText(project.name) || "Untitled Quest Coral project",
        description: contextDescription(project.description),
        fields: [],
        createdBy: asText(project.ownerUserId) || "svc-system-context",
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        sourceModule: SOURCE_MODULE,
        questCoralProjectId: projectId,
      },
    })),
    ...messagePlan
      .filter((entry) => entry.action === "create")
      .map((entry) => ({ kind: "message", id: messageId(entry.redTeamReviewId), data: entry.message })),
  ]
  for (let start = 0; start < creates.length; start += WRITE_CHUNK_SIZE) {
    const batch = db.batch()
    for (const entry of creates.slice(start, start + WRITE_CHUNK_SIZE)) {
      batch.create(db.collection(entry.kind === "context" ? CONTEXTS_COLLECTION : MESSAGES_COLLECTION).doc(entry.id), entry.data)
    }
    await batch.commit()
  }
  const updates = messagePlan.filter((entry) => entry.action === "update")
  for (let start = 0; start < updates.length; start += WRITE_CHUNK_SIZE) {
    const batch = db.batch()
    for (const entry of updates.slice(start, start + WRITE_CHUNK_SIZE)) {
      batch.update(db.collection(MESSAGES_COLLECTION).doc(messageId(entry.redTeamReviewId)), entry.recipientPatch)
    }
    await batch.commit()
  }

  const changedMessages = messagePlan.filter((entry) => entry.action === "create" || entry.action === "update")
  const verificationSnapshots = await getAllInChunks(db, changedMessages.map((entry) => db.collection(MESSAGES_COLLECTION).doc(messageId(entry.redTeamReviewId))))
  const failed = verificationSnapshots.filter((snapshot) => {
    const data = snapshot.data()
    return !snapshot.exists || data?.sourceModule !== SOURCE_MODULE || data?.sourceQuestCoralRedTeamReviewId !== snapshot.id.slice("quest-coral-red-team-review-".length)
  })
  console.log(JSON.stringify({
    result: "complete",
    createdMessages: messagePlan.filter((entry) => entry.action === "create").length,
    updatedMessages: updates.length,
    unchangedMessages: messagePlan.filter((entry) => entry.action === "unchanged").length,
    createdContexts: contextsToCreate.size,
    skipped: skipped.length,
    verification: failed.length === 0 ? "passed" : "failed",
  }, null, 2))
  if (failed.length > 0) fail(`Post-write verification failed for: ${failed.map((snapshot) => snapshot.id).join(", ")}`)
}

main().catch((error) => {
  console.error("Quest Coral Red Team Review message backfill failed:", error.message)
  process.exit(1)
})
