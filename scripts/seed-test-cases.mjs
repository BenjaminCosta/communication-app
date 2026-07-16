#!/usr/bin/env node
/**
 * seed-test-cases.mjs
 *
 * Creates test users + test messages for all cases A–G in the Firebase Emulator.
 * Requires FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST to be set.
 *
 * Usage:
 *   FIRESTORE_EMULATOR_HOST=localhost:8080 FIREBASE_AUTH_EMULATOR_HOST=localhost:9099 \
 *     node scripts/seed-test-cases.mjs
 */

import { initializeApp } from "firebase-admin/app"
import { getAuth } from "firebase-admin/auth"
import { getFirestore, Timestamp } from "firebase-admin/firestore"

const EMULATOR_FS   = process.env.FIRESTORE_EMULATOR_HOST
const EMULATOR_AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST

if (!EMULATOR_FS || !EMULATOR_AUTH) {
  console.error("ERROR: Must set FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST")
  process.exit(1)
}

const app  = initializeApp({ projectId: "svc-comms" })
const auth = getAuth(app)
const db   = getFirestore(app)
db.settings({ host: EMULATOR_FS, ssl: false })

// ── Test users ───────────────────────────────────────────────────────────────

const USERS = [
  { uid: "user-alice", email: "alice@test.local", name: "Alice",   initials: "AL", color: "bg-emerald-600" },
  { uid: "user-bob",   email: "bob@test.local",   name: "Bob",     initials: "BO", color: "bg-red-600"     },
  { uid: "user-carol", email: "carol@test.local", name: "Carol",   initials: "CA", color: "bg-amber-600"   },
]

// Project/tag used in cases C & D
const PROJECT_ID  = "p-testproject-001"
const PROJECT_TAG = `project:${PROJECT_ID}`

// ── Helpers ──────────────────────────────────────────────────────────────────

async function clearAll() {
  // Clear auth users
  for (const u of USERS) {
    try { await auth.deleteUser(u.uid) } catch {}
  }
  // Clear Firestore collections
  for (const col of ["users", "projects", "messages"]) {
    const snap = await db.collection(col).get()
    if (!snap.empty) {
      const b = db.batch()
      snap.docs.forEach(d => b.delete(d.ref))
      await b.commit()
    }
  }
  console.log("Cleared all existing test data")
}

async function createUsers() {
  for (const u of USERS) {
    await auth.createUser({ uid: u.uid, email: u.email, emailVerified: true, displayName: u.name })
    await auth.updateUser(u.uid, { password: "test1234" })
    await db.collection("users").doc(u.uid).set({ id: u.uid, name: u.name, initials: u.initials, color: u.color })
    console.log(`  User created: ${u.name} (${u.email} / test1234)`)
  }
}

function msgBase(senderId, extra = {}) {
  const now = Timestamp.now()
  return {
    authorId:   senderId,
    senderId,
    text:       "Test message",
    content:    "Test message",
    type:       "none",
    participants:  [senderId],
    recipientIds:  [],
    peopleIds:     [],
    projectIds:    [],
    projectId:     null,
    tagIds:        [],
    isFavorited:   false,
    createdAt:  now,
    updatedAt:  now,
    timestamp:  now,
    ...extra,
  }
}

async function createMessages() {
  const alice = "user-alice"
  const bob   = "user-bob"
  const carol = "user-carol"

  const messages = {

    // ── Case A: no tag, no recipient → Unassigned, solo ve el autor ──────────
    "msg-case-a": msgBase(alice, {
      text:        "[Case A] No tag, no recipient — only Alice should see this",
      tagIds:      [],
      recipientIds: [],
      // participants corrupted (just alice — correct)
      participants: [alice],
    }),

    // ── Case B: recipient directo, sin tag → ícono people, lo ve autor+recipient
    "msg-case-b": msgBase(alice, {
      text:         "[Case B] Recipient Bob, no tag — Alice+Bob should see this",
      recipientIds: [bob],
      peopleIds:    [bob],
      participants: [alice, bob],
    }),

    // ── Case C: tag, sin recipient → el tag no concede visibilidad ───────────
    "msg-case-c": msgBase(alice, {
      text:        "[Case C] Tag only (project with Alice+Carol) — only Alice sees this",
      tagIds:      [PROJECT_TAG],
      projectId:   PROJECT_ID,
      projectIds:  [PROJECT_ID],
      participants: [alice, carol],
    }),

    // ── Case D: tag + recipient → autor+recipient explícito ─────────────────
    "msg-case-d": msgBase(alice, {
      text:         "[Case D] Tag (Alice+Carol) + Recipient Bob — Alice+Bob see this",
      tagIds:       [PROJECT_TAG],
      projectId:    PROJECT_ID,
      projectIds:   [PROJECT_ID],
      recipientIds: [bob],
      peopleIds:    [bob],
      participants: [alice, bob, carol],
    }),

    // ── Case E: viejo con participants roto (tiene todos los UIDs) ────────────
    "msg-case-e": msgBase(bob, {
      text:        "[Case E] Legacy msg — participants broken (has all UIDs). After migration visibleToUserIds=[bob]",
      tagIds:      [],
      recipientIds: [],
      // Simula el bug: participants tiene TODOS los usuarios (recovery script broke it)
      participants: [alice, bob, carol],
    }),

    // ── Case F: viejo, sin tags ni recipients → visibleToUserIds=[carol] ─────
    "msg-case-f": msgBase(carol, {
      text:        "[Case F] Old msg, no tags, no recipients — only Carol (author) should see",
      tagIds:      [],
      recipientIds: [],
      participants: [carol],
    }),

    // ── Case G: Tag Later applied — tag + explicit recipient Bob ──────────────
    // Simulates the state AFTER a Tag Later edit:
    // Alice sent it, then tagged with the Alice+Carol project and added Bob as recipient.
    "msg-case-g": msgBase(alice, {
      text:         "[Case G] Tag Later applied: project tag + explicit recipient Bob",
      tagIds:       [PROJECT_TAG],
      projectId:    PROJECT_ID,
      projectIds:   [PROJECT_ID],
      recipientIds: [bob],
      peopleIds:    [bob],
      participants: [alice, bob, carol],
    }),

  }

  const b = db.batch()
  Object.entries(messages).forEach(([id, data]) => {
    b.set(db.collection("messages").doc(id), data)
  })
  await b.commit()
  console.log(`  Created ${Object.keys(messages).length} test messages (cases A–G)`)
}

async function createProject() {
  await db.collection("projects").doc(PROJECT_ID).set({
    id:          PROJECT_ID,
    name:        "Test Project (Alice+Carol)",
    color:       "bg-emerald-600",
    members:     ["user-alice", "user-carol"],
    ownerId:     "user-alice",
    tagCategory: "project",
    isFavorited: false,
  })
  console.log(`  Project created: ${PROJECT_ID} (members: Alice, Carol)`)
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n══════════════════════════════════════════")
  console.log("  Seeding Test Cases A–G into Emulator")
  console.log("══════════════════════════════════════════")

  await clearAll()
  await createUsers()
  await createProject()
  await createMessages()

  console.log("\n══════════════════════════════════════════")
  console.log("  Seed complete!")
  console.log("")
  console.log("  Users:")
  for (const u of USERS) {
    console.log(`    ${u.name}: ${u.email} / test1234`)
  }
  console.log("")
  console.log("  Project: \"Test Project (Alice+Carol)\"")
  console.log("    Members: Alice, Carol")
  console.log("")
  console.log("  Messages: msg-case-a through msg-case-g")
  console.log("  Next: run migration → pnpm emulator:migrate")
  console.log("══════════════════════════════════════════\n")
}

main().catch(err => { console.error("Seed failed:", err.message); process.exit(1) })
