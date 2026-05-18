#!/usr/bin/env node
/**
 * verify-test-cases.mjs
 *
 * Verifies that visibleToUserIds is correct for all test cases A–G.
 * Run AFTER the migration script.
 *
 * Usage:
 *   FIRESTORE_EMULATOR_HOST=localhost:8080 node scripts/verify-test-cases.mjs
 */

import { initializeApp } from "firebase-admin/app"
import { getFirestore } from "firebase-admin/firestore"

const EMULATOR_FS = process.env.FIRESTORE_EMULATOR_HOST
if (!EMULATOR_FS) {
  console.error("ERROR: FIRESTORE_EMULATOR_HOST is not set")
  process.exit(1)
}

const app = initializeApp({ projectId: "svc-comms" })
const db  = getFirestore(app)
db.settings({ host: EMULATOR_FS, ssl: false })

const alice = "user-alice"
const bob   = "user-bob"
const carol = "user-carol"

// Expected visibleToUserIds for each case after migration
const EXPECTED = {
  "msg-case-a": {
    label: "Case A — no tag, no recipient",
    expected: [alice],
    note:  "Only Alice (author) should see it",
  },
  "msg-case-b": {
    label: "Case B — recipient Bob, no tag",
    expected: [alice, bob],
    note:  "Alice (author) + Bob (recipient)",
  },
  "msg-case-c": {
    label: "Case C — tag (Alice+Carol project), no recipient",
    expected: [alice, carol],
    note:  "Alice (author+member) + Carol (member)",
  },
  "msg-case-d": {
    label: "Case D — tag (Alice+Carol) + recipient Bob",
    expected: [alice, bob, carol],
    note:  "Alice (author+member) + Carol (member) + Bob (recipient)",
  },
  "msg-case-e": {
    label: "Case E — legacy broken participants (all UIDs), author=Bob, no tags/recipients",
    expected: [bob],
    note:  "Only Bob (author) — participants was corrupted to allUIDs but visibleToUserIds is correct",
  },
  "msg-case-f": {
    label: "Case F — old msg, no tags, no recipients, author=Carol",
    expected: [carol],
    note:  "Only Carol (author)",
  },
  "msg-case-g": {
    label: "Case G — edited via Tag Later (tag Alice+Carol + recipient Bob)",
    expected: [alice, bob, carol],
    note:  "After Tag Later: Alice (author+member) + Carol (member) + Bob (recipient)",
  },
}

function setEquals(a, b) {
  if (a.length !== b.length) return false
  const sa = new Set(a)
  return b.every(x => sa.has(x))
}

function fmtIds(ids) {
  const map = { "user-alice": "Alice", "user-bob": "Bob", "user-carol": "Carol" }
  return ids.map(id => map[id] ?? id).sort().join(", ")
}

async function verify() {
  console.log("\n══════════════════════════════════════════════════════")
  console.log("  Verifying Test Cases A–G")
  console.log("══════════════════════════════════════════════════════")

  let passed = 0
  let failed = 0

  for (const [msgId, { label, expected, note }] of Object.entries(EXPECTED)) {
    const doc = await db.collection("messages").doc(msgId).get()
    if (!doc.exists) {
      console.log(`\n  MISSING  ${label}`)
      console.log(`           Document ${msgId} not found — did you run the seed?`)
      failed++
      continue
    }

    const data = doc.data()
    const actual = Array.isArray(data.visibleToUserIds) ? data.visibleToUserIds : null

    if (!actual) {
      console.log(`\n  FAIL     ${label}`)
      console.log(`           visibleToUserIds is missing — did you run the migration?`)
      failed++
      continue
    }

    const ok = setEquals(actual, expected)
    if (ok) {
      console.log(`\n  PASS     ${label}`)
      console.log(`           visibleToUserIds: [${fmtIds(actual)}]`)
      console.log(`           ${note}`)
      passed++
    } else {
      console.log(`\n  FAIL     ${label}`)
      console.log(`           Expected:  [${fmtIds(expected)}]`)
      console.log(`           Got:       [${fmtIds(actual)}]`)
      console.log(`           ${note}`)
      failed++
    }
  }

  // ── Verify Firestore listener query would work ──────────────────────────────
  // Simulate: which messages would Alice, Bob, Carol each see?
  console.log("\n── Simulated listener results (who sees what) ─────────────────")

  const allMsgs = await db.collection("messages").get()
  const msgMap = {}
  allMsgs.docs.forEach(d => { msgMap[d.id] = d.data() })

  const users = [
    { name: "Alice", uid: alice },
    { name: "Bob",   uid: bob   },
    { name: "Carol", uid: carol },
  ]

  for (const { name, uid } of users) {
    const visible = allMsgs.docs
      .filter(d => {
        const ids = d.data().visibleToUserIds ?? []
        return ids.includes(uid)
      })
      .map(d => d.id.replace("msg-case-", "Case ").toUpperCase())
    console.log(`  ${name} sees: ${visible.join(", ") || "(none)"}`)
  }

  // ── Legacy participants query (shows why it was broken) ────────────────────
  console.log("\n── Legacy participants query (broken — shows the problem) ──────")
  for (const { name, uid } of users) {
    const visible = allMsgs.docs
      .filter(d => {
        const parts = d.data().participants ?? []
        return parts.includes(uid)
      })
      .map(d => d.id.replace("msg-case-", "Case ").toUpperCase())
    console.log(`  ${name} sees (via participants): ${visible.join(", ") || "(none)"}`)
  }
  console.log("  (Note: Case E is broken — Alice/Carol see Bob's private msg via participants)")

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log("\n══════════════════════════════════════════════════════")
  if (failed === 0) {
    console.log(`  ALL ${passed} CASES PASSED`)
  } else {
    console.log(`  ${passed} passed, ${failed} FAILED`)
    process.exitCode = 1
  }
  console.log("══════════════════════════════════════════════════════\n")
}

verify().catch(err => { console.error("Verify failed:", err.message); process.exit(1) })
