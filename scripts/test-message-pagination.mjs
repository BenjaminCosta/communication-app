#!/usr/bin/env node
/** Exercises the canonical message query and cursor only against Firestore Emulator. */

import { initializeApp } from "firebase-admin/app"
import { getFirestore } from "firebase-admin/firestore"

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST
if (!emulatorHost) {
  console.error("ERROR: FIRESTORE_EMULATOR_HOST is required")
  process.exit(1)
}

const app = initializeApp({ projectId: "svc-comms" })
const db = getFirestore(app)
db.settings({ host: emulatorHost, ssl: false })

const expectedByUser = {
  "user-alice": ["msg-case-a", "msg-case-b", "msg-case-c", "msg-case-d", "msg-case-g"],
  "user-bob": ["msg-case-b", "msg-case-d", "msg-case-e", "msg-case-g"],
  "user-carol": ["msg-case-f"],
}

for (const [userId, expected] of Object.entries(expectedByUser)) {
  const received = []
  let cursor = null

  for (let pageNumber = 0; pageNumber < 20; pageNumber += 1) {
    let pageQuery = db
      .collection("messages")
      .where("visibleToUserIds", "array-contains", userId)
      .orderBy("timestamp", "desc")
      .limit(2)
    if (cursor) pageQuery = pageQuery.startAfter(cursor)

    const page = await pageQuery.get()
    for (const document of page.docs) {
      if (received.includes(document.id)) {
        throw new Error(`${userId}: duplicate document across pages: ${document.id}`)
      }
      received.push(document.id)
    }
    if (page.size < 2) break
    cursor = page.docs.at(-1)
  }

  const actual = [...received].sort()
  const wanted = [...expected].sort()
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new Error(`${userId}: expected ${wanted.join(", ")}; got ${actual.join(", ")}`)
  }
  console.log(`PASS ${userId}: ${received.length} messages without duplicates`)
}

console.log("Canonical message pagination passed in Firestore Emulator.")
