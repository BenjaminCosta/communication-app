#!/usr/bin/env node
/**
 * Backfill embeddings for existing /directoryNotes.
 *
 * The Cloud Function embeds notes going forward; this fills in the ones written
 * before it existed. Dry-run by default — it reports how many notes need
 * embedding and the estimated cost, and writes nothing until you pass --write.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *   OPENAI_API_KEY=sk-... node scripts/backfill-directory-note-embeddings.mjs            # dry run
 *   ... node scripts/backfill-directory-note-embeddings.mjs --write                      # execute
 *   ... node scripts/backfill-directory-note-embeddings.mjs --write --limit=500          # bounded
 *
 * Resumable: notes already carrying a matching embeddingHash are skipped, so
 * re-running only processes what is still missing.
 */

import { createHash } from "node:crypto"
import { initializeApp, applicationDefault, cert } from "firebase-admin/app"
import { getFirestore, FieldValue } from "firebase-admin/firestore"

const args = process.argv.slice(2)
const WRITE = args.includes("--write")
const LIMIT = Number((args.find((arg) => arg.startsWith("--limit=")) ?? "").split("=")[1] || 0) || Infinity
const MODEL = (process.env.DIRECTORY_AI_EMBED_MODEL ?? "").trim() || "text-embedding-3-small"
const BASE_URL = (process.env.OPENAI_BASE_URL ?? "").trim() || "https://api.openai.com/v1"
const API_KEY = (process.env.OPENAI_API_KEY ?? "").trim()
const BATCH = 64
const MAX_EMBED_CHARS = 2000
/** text-embedding-3-small list price, USD per 1M tokens (for the estimate only). */
const USD_PER_MILLION_TOKENS = 0.02

function contentHash(value) {
  return createHash("sha256").update(value).digest("base64url").slice(0, 22)
}

function initAdmin() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY
  initializeApp({ credential: raw ? cert(JSON.parse(raw)) : applicationDefault() })
  return getFirestore()
}

async function embedBatch(inputs) {
  const response = await fetch(`${BASE_URL}/embeddings`, {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, input: inputs }),
  })
  if (!response.ok) {
    throw new Error(`Embedding request failed: ${response.status} ${await response.text()}`)
  }
  const data = await response.json()
  return data.data.map((entry) => entry.embedding)
}

async function main() {
  const db = initAdmin()
  console.log(`[embeddings-backfill] mode=${WRITE ? "WRITE" : "DRY RUN"} model=${MODEL}`)

  const snapshot = await db.collection("directoryNotes").get()
  const pending = []
  let alreadyDone = 0
  let empty = 0

  for (const doc of snapshot.docs) {
    const data = doc.data()
    const text = typeof data.text === "string" ? data.text.trim() : ""
    if (!text) { empty += 1; continue }
    const hash = contentHash(text)
    if (data.embeddingHash === hash && data.embedding) { alreadyDone += 1; continue }
    pending.push({ ref: doc.ref, id: doc.id, text: text.slice(0, MAX_EMBED_CHARS), hash })
  }

  const targets = pending.slice(0, LIMIT === Infinity ? pending.length : LIMIT)
  const totalChars = targets.reduce((sum, item) => sum + item.text.length, 0)
  // ~4 chars per token is the usual rule of thumb for English prose.
  const estimatedTokens = Math.ceil(totalChars / 4)
  const estimatedCost = (estimatedTokens / 1_000_000) * USD_PER_MILLION_TOKENS

  console.log(`[embeddings-backfill] notes total=${snapshot.size} already-embedded=${alreadyDone} empty=${empty}`)
  console.log(`[embeddings-backfill] to embed=${targets.length} (~${estimatedTokens} tokens, ~$${estimatedCost.toFixed(4)})`)

  if (!WRITE) {
    console.log("[embeddings-backfill] dry run — nothing written. Re-run with --write to execute.")
    return
  }
  if (!API_KEY) {
    console.error("[embeddings-backfill] OPENAI_API_KEY is required to write embeddings.")
    process.exit(1)
  }
  if (targets.length === 0) {
    console.log("[embeddings-backfill] nothing to do.")
    return
  }

  let written = 0
  let failed = 0
  for (let index = 0; index < targets.length; index += BATCH) {
    const slice = targets.slice(index, index + BATCH)
    let vectors
    try {
      vectors = await embedBatch(slice.map((item) => item.text))
    } catch (error) {
      failed += slice.length
      console.error(`[embeddings-backfill] batch at ${index} failed: ${error.message}`)
      continue
    }
    const batch = db.batch()
    slice.forEach((item, position) => {
      batch.update(item.ref, {
        embedding: FieldValue.vector(vectors[position]),
        embeddingHash: item.hash,
        embeddingModel: MODEL,
        embeddedAt: FieldValue.serverTimestamp(),
      })
    })
    await batch.commit()
    written += slice.length
    console.log(`[embeddings-backfill] ${written}/${targets.length} embedded`)
  }

  console.log(`[embeddings-backfill] done. written=${written} failed=${failed}`)
  if (written > 0) {
    console.log(
      "[embeddings-backfill] NOTE: nearest-neighbour queries need a Firestore vector index:\n" +
        "  gcloud firestore indexes composite create \\\n" +
        "    --collection-group=directoryNotes --query-scope=COLLECTION \\\n" +
        `    --field-config=vector-config='{"dimension":${vectorDimension(written)},"flat":{}}',field-path=embedding`,
    )
  }
}

/** text-embedding-3-small is 1536-dimensional; kept explicit for the index hint. */
function vectorDimension() {
  return 1536
}

main().catch((error) => {
  console.error("[embeddings-backfill] failed:", error)
  process.exit(1)
})
