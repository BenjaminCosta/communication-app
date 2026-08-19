#!/usr/bin/env node
/**
 * backfill-directory-relations-from-live-edits.mjs
 *
 * One-time catch-up for /directoryRelations. Historically that collection was
 * only populated by the import-time matching scripts (enrich-directory-from-*),
 * so any Job/Company "People involved" edit or person "Company" edit made
 * through the app UI before the sync.ts fix (2026-08-19) never produced an
 * edge — the source doc updated, but the other side's profile never found
 * out. functions/src/directory/sync.ts now keeps this live going forward;
 * this script applies the exact same logic once, retroactively, to every
 * existing /contexts and /contacts doc so already-made edits show up too.
 *
 * Writes edges tagged source: "context-sync" with deterministic doc ids
 * (rel__{fromDirectoryId}__{toDirectoryId}) — identical scheme to the live
 * sync and to add-directory-relation.mjs, so re-running this is idempotent
 * and never touches edges from another source (imports, manual adds).
 *
 * SAFETY: dry-run by default (writes NOTHING, just prints counts).
 * Pass --write to actually create/update/deactivate edges.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node scripts/backfill-directory-relations-from-live-edits.mjs           # dry-run
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node scripts/backfill-directory-relations-from-live-edits.mjs --write    # apply
 */

import { initializeApp, cert } from "firebase-admin/app"
import { getFirestore, FieldValue } from "firebase-admin/firestore"
import { readFileSync, existsSync } from "node:fs"

const WRITE = process.argv.includes("--write")
const SA = process.env.GOOGLE_APPLICATION_CREDENTIALS || "./service-account.json"
if (!existsSync(SA)) throw new Error(`Service account file not found: ${SA}. Set GOOGLE_APPLICATION_CREDENTIALS.`)
const serviceAccount = JSON.parse(readFileSync(SA, "utf8"))
initializeApp({ credential: cert(serviceAccount), projectId: serviceAccount.project_id })
const db = getFirestore()
db.settings({ preferRest: true })

const RELATION_SYNC_SOURCE = "context-sync"
const log = (...a) => console.log(...a)
const relationDocId = (fromId, toId) => `rel__${fromId}__${toId}`

const plan = { upserts: new Map(), deactivations: [] }

function planUpsert(fromId, fromName, toId, toName) {
  if (!fromId || !toId) return
  plan.upserts.set(relationDocId(fromId, toId), {
    fromDirectoryId: fromId,
    fromName: fromName ?? "",
    toDirectoryId: toId,
    toName: toName ?? "",
    entityIds: [fromId, toId],
    active: true,
    confidence: 1,
    source: RELATION_SYNC_SOURCE,
  })
}

async function main() {
  log(`\n=== backfill-directory-relations-from-live-edits — ${WRITE ? "WRITE (PRODUCTION)" : "DRY-RUN (no writes)"} ===`)
  log(`Firestore project: ${serviceAccount.project_id}\n`)

  // 1) Person → resolved Company, from directoryIndex's already-computed companyEntityId.
  const peopleSnap = await db.collection("directoryIndex").where("type", "==", "person").get()
  let peopleWithCompany = 0
  for (const doc of peopleSnap.docs) {
    const d = doc.data()
    if (typeof d.companyEntityId === "string" && d.companyEntityId) {
      planUpsert(d.companyEntityId, d.companyName ?? "", doc.id, d.name ?? "")
      peopleWithCompany += 1
    }
  }
  log(`People scanned: ${peopleSnap.size} (${peopleWithCompany} with a resolved company)`)

  // 2) Job/Company → each selected "People involved" contact, and Job → Company.
  const jobsAndCompaniesSnap = await db.collection("directoryIndex")
    .where("type", "in", ["job", "company"]).get()
  log(`Jobs/Companies scanned: ${jobsAndCompaniesSnap.size}`)

  let involvedEdges = 0
  let jobCompanyEdges = 0
  for (const indexDoc of jobsAndCompaniesSnap.docs) {
    const indexData = indexDoc.data()
    const sourceId = indexData.sourceId
    if (typeof sourceId !== "string" || !sourceId) continue
    const contextSnap = await db.collection("contexts").doc(sourceId).get()
    if (!contextSnap.exists) continue
    const contextData = contextSnap.data() ?? {}

    const involvedPeople = Array.isArray(contextData.involvedPeople) ? contextData.involvedPeople : []
    for (const person of involvedPeople) {
      const rawId = typeof person?.id === "string" ? person.id.trim() : ""
      if (!rawId) continue
      planUpsert(indexDoc.id, indexData.name ?? "", `person__${rawId}`, typeof person.name === "string" ? person.name : "")
      involvedEdges += 1
    }

    if (indexData.type === "job" && typeof indexData.companyEntityId === "string" && indexData.companyEntityId) {
      planUpsert(indexDoc.id, indexData.name ?? "", indexData.companyEntityId, indexData.companyName ?? "")
      jobCompanyEdges += 1
    }
  }
  log(`Involved-people edges: ${involvedEdges}`)
  log(`Job→Company edges: ${jobCompanyEdges}`)
  log(`\nTotal distinct edges to upsert: ${plan.upserts.size}`)

  // 3) Existing "context-sync" edges that are no longer justified by current
  //    data — this is a fresh backfill, so any prior context-sync edge not in
  //    this run's plan is stale (the underlying link was removed since).
  const existingSyncEdgesSnap = await db.collection("directoryRelations")
    .where("source", "==", RELATION_SYNC_SOURCE).where("active", "==", true).get()
  for (const doc of existingSyncEdgesSnap.docs) {
    if (!plan.upserts.has(doc.id)) plan.deactivations.push(doc.ref)
  }
  log(`Stale context-sync edges to deactivate: ${plan.deactivations.length}`)

  if (!WRITE) {
    log(`\nDRY-RUN complete. Nothing was written. Re-run with --write to apply.\n`)
    return
  }

  const entries = [...plan.upserts.entries()]
  for (let i = 0; i < entries.length; i += 400) {
    const batch = db.batch()
    for (const [docId, data] of entries.slice(i, i + 400)) {
      batch.set(db.collection("directoryRelations").doc(docId), {
        ...data,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
    }
    await batch.commit()
    log(`upserted ${Math.min(i + 400, entries.length)} / ${entries.length}`)
  }
  for (let i = 0; i < plan.deactivations.length; i += 400) {
    const batch = db.batch()
    for (const ref of plan.deactivations.slice(i, i + 400)) {
      batch.update(ref, { active: false, updatedAt: FieldValue.serverTimestamp() })
    }
    await batch.commit()
    log(`deactivated ${Math.min(i + 400, plan.deactivations.length)} / ${plan.deactivations.length}`)
  }
  log(`\n✓ Backfill complete.\n`)
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1) })
