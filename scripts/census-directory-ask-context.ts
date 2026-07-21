#!/usr/bin/env tsx
/**
 * READ-ONLY census for the `askContext` projection (audit migration step 2).
 *
 * Reports what a backfill WOULD change: eligibility counts, text stats, index
 * write volume and embedding token estimate. There is deliberately no --write
 * flag in this script; it never mutates anything.
 *
 * Usage: pnpm census:ask-context
 */
import { createHash } from "node:crypto"
import { initializeApp, applicationDefault, cert } from "firebase-admin/app"
import { getFirestore } from "firebase-admin/firestore"
import {
  buildAskContext,
  ASK_CONTEXT_MIN_TEXT_CHARS,
  ASK_CONTEXT_VERSION,
} from "../lib/directory-ask-context"

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex")
const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY
initializeApp({ credential: raw ? cert(JSON.parse(raw)) : applicationDefault() })
const db = getFirestore()

async function main() {
  console.log(`[ask-context-census] READ-ONLY · projection version ${ASK_CONTEXT_VERSION}`)

  const contexts = await db.collection("contexts").get()
  const index = await db.collection("directoryIndex").where("sourceCollection", "==", "contexts").get()
  const indexBySourceId = new Map(index.docs.map((doc) => [doc.data().sourceId as string, doc]))

  let eligible = 0
  let withAnyText = 0
  let wouldChange = 0
  let missingIndex = 0
  let totalChars = 0
  let maxChars = 0
  const byType = new Map<string, number>()
  const lengths: number[] = []

  for (const doc of contexts.docs) {
    const data = doc.data()
    const projection = buildAskContext(doc.id, data, sha256)
    if (projection.aiText.length > 0) withAnyText += 1
    if (projection.aiEligible) {
      eligible += 1
      totalChars += projection.aiText.length
      maxChars = Math.max(maxChars, projection.aiText.length)
      lengths.push(projection.aiText.length)
      const type = String(data.directoryType ?? "(none)")
      byType.set(type, (byType.get(type) ?? 0) + 1)
    }

    const indexDoc = indexBySourceId.get(doc.id)
    if (!indexDoc) { missingIndex += 1; continue }
    const existing = indexDoc.data().askContext
    // Idempotency guard: sourceId + updatedAt + aiTextHash.
    const unchanged =
      existing &&
      existing.version === projection.version &&
      existing.aiTextHash === projection.aiTextHash &&
      typeof existing.updatedAt?.isEqual === "function" &&
      existing.updatedAt.isEqual(data.updatedAt)
    if (!unchanged) wouldChange += 1
  }

  lengths.sort((a, b) => a - b)
  const median = lengths.length ? lengths[Math.floor(lengths.length / 2)] : 0
  const average = eligible ? Math.round(totalChars / eligible) : 0
  const estTokens = Math.ceil(totalChars / 4)

  console.log(`\ncontexts scanned:              ${contexts.size}`)
  console.log(`context-backed index docs:     ${index.size}`)
  console.log(`contexts with ANY useful text: ${withAnyText}`)
  console.log(`AI-ELIGIBLE (>= ${ASK_CONTEXT_MIN_TEXT_CHARS} chars deduped): ${eligible}`)
  console.log(`  by type: ${JSON.stringify(Object.fromEntries(byType))}`)
  console.log(`  chars total=${totalChars} avg=${average} median=${median} max=${maxChars}`)
  console.log(`\nbackfill impact (derived directoryIndex fields only, NO contexts writes):`)
  console.log(`  index docs that would change: ${wouldChange}`)
  console.log(`  contexts with no index doc:   ${missingIndex}`)
  console.log(`\nembedding estimate (eligible only): ~${estTokens} tokens → ~$${((estTokens / 1e6) * 0.02).toFixed(4)}`)
  console.log("\nNothing was written.")
}

main().then(() => process.exit(0)).catch((error) => {
  console.error("[ask-context-census] failed:", error)
  process.exit(1)
})
