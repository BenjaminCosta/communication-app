#!/usr/bin/env node
/**
 * backup-firestore.mjs
 *
 * Exports all Firestore production collections to a local JSON file.
 * Read-only — never writes to Firestore.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node scripts/backup-firestore.mjs
 */

import { initializeApp, cert } from "firebase-admin/app"
import { getFirestore } from "firebase-admin/firestore"
import { createWriteStream } from "fs"
import { readFileSync } from "fs"

const SA = process.env.GOOGLE_APPLICATION_CREDENTIALS
if (!SA) { console.error("Set GOOGLE_APPLICATION_CREDENTIALS"); process.exit(1) }

const serviceAccount = JSON.parse(readFileSync(SA, "utf8"))
initializeApp({ credential: cert(serviceAccount) })
const db = getFirestore()

const COLLECTIONS = ["users", "projects", "messages"]

async function backup() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
  const outPath = `./backups/firestore-backup-${timestamp}.json`

  const { mkdirSync } = await import("fs")
  mkdirSync("./backups", { recursive: true })

  const backup = { exportedAt: new Date().toISOString(), projectId: serviceAccount.project_id, collections: {} }

  console.log("\n══════════════════════════════════════════")
  console.log("  Firestore Production Backup")
  console.log("══════════════════════════════════════════")
  console.log(`  Project: ${serviceAccount.project_id}`)
  console.log(`  Output:  ${outPath}`)
  console.log("")

  let total = 0
  for (const col of COLLECTIONS) {
    process.stdout.write(`  Reading ${col}... `)
    const snap = await db.collection(col).get()
    backup.collections[col] = {}
    snap.docs.forEach(d => { backup.collections[col][d.id] = d.data() })
    console.log(`${snap.size} docs`)
    total += snap.size
  }

  const { writeFileSync } = await import("fs")
  writeFileSync(outPath, JSON.stringify(backup, null, 2))

  console.log("")
  console.log(`  Total docs backed up: ${total}`)
  console.log(`  Saved to: ${outPath}`)
  console.log("══════════════════════════════════════════\n")
  return outPath
}

backup().catch(err => { console.error("Backup failed:", err.message); process.exit(1) })
