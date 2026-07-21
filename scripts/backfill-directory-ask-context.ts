#!/usr/bin/env tsx
/**
 * Backfill the derived `askContext` projection onto context-backed
 * `/directoryIndex` documents (audit migration step 3).
 *
 * Writes ONLY derived fields on `/directoryIndex`. It never writes `/contexts`.
 * Dry-run by default; `--write` executes in checkpointed batches. Idempotent:
 * a document is skipped when `sourceId + updatedAt + aiTextHash` all match, so
 * re-running only processes what actually changed.
 *
 *   pnpm backfill:ask-context:dry            # report only
 *   pnpm backfill:ask-context                # write projections
 *   pnpm backfill:ask-context -- --embed     # + embeddings for eligible records
 */
import { createHash } from "node:crypto"
import { initializeApp, applicationDefault, cert } from "firebase-admin/app"
import { getFirestore, FieldValue, type Firestore } from "firebase-admin/firestore"
import { buildAskContext, ASK_CONTEXT_VERSION } from "../lib/directory-ask-context"

const args = process.argv.slice(2)
const WRITE = args.includes("--write")
const EMBED = args.includes("--embed")
const BATCH = 300
const EMBED_BATCH = 64
const MODEL = (process.env.DIRECTORY_AI_EMBED_MODEL ?? "").trim() || "text-embedding-3-small"
const BASE_URL = (process.env.OPENAI_BASE_URL ?? "").trim() || "https://api.openai.com/v1"
const API_KEY = (process.env.OPENAI_API_KEY ?? "").trim()

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex")

function initAdmin(): Firestore {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY
  initializeApp({ credential: raw ? cert(JSON.parse(raw)) : applicationDefault() })
  return getFirestore()
}

async function embedBatch(inputs: string[]): Promise<number[][]> {
  const response = await fetch(`${BASE_URL}/embeddings`, {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, input: inputs }),
  })
  if (!response.ok) throw new Error(`Embedding request failed: ${response.status} ${await response.text()}`)
  const data = (await response.json()) as { data: Array<{ embedding: number[] }> }
  return data.data.map((entry) => entry.embedding)
}

async function main() {
  const db = initAdmin()
  console.log(`[ask-context-backfill] mode=${WRITE ? "WRITE" : "DRY RUN"} embed=${EMBED} version=${ASK_CONTEXT_VERSION}`)

  const contexts = await db.collection("contexts").get()
  const index = await db.collection("directoryIndex").where("sourceCollection", "==", "contexts").get()
  const indexBySourceId = new Map(index.docs.map((doc) => [doc.data().sourceId as string, doc]))

  interface Pending {
    ref: FirebaseFirestore.DocumentReference
    projection: ReturnType<typeof buildAskContext>
    updatedAt: unknown
    contextId: string
  }
  const pending: Pending[] = []
  let unchanged = 0
  let missingIndex = 0
  let eligible = 0

  for (const doc of contexts.docs) {
    const data = doc.data()
    const projection = buildAskContext(doc.id, data, sha256)
    if (projection.aiEligible) eligible += 1

    const indexDoc = indexBySourceId.get(doc.id)
    if (!indexDoc) { missingIndex += 1; continue }

    const existing = indexDoc.data().askContext
    const same =
      existing &&
      existing.version === projection.version &&
      existing.aiTextHash === projection.aiTextHash &&
      typeof existing.updatedAt?.isEqual === "function" &&
      existing.updatedAt.isEqual(data.updatedAt)
    if (same) { unchanged += 1; continue }

    pending.push({ ref: indexDoc.ref, projection, updatedAt: data.updatedAt, contextId: doc.id })
  }

  console.log(`\ncontexts: ${contexts.size}  index docs: ${index.size}`)
  console.log(`AI-eligible: ${eligible}`)
  console.log(`would write: ${pending.length}   already current: ${unchanged}   no index doc: ${missingIndex}`)

  if (!WRITE) {
    console.log("\nDry run — nothing written. Re-run with --write to execute.")
    return
  }

  let written = 0
  for (let start = 0; start < pending.length; start += BATCH) {
    const slice = pending.slice(start, start + BATCH)
    const batch = db.batch()
    for (const item of slice) {
      batch.set(
        item.ref,
        {
          askContext: { ...item.projection, updatedAt: item.updatedAt },
          source: { collection: "contexts", id: item.contextId, updatedAt: item.updatedAt },
        },
        { merge: true },
      )
    }
    await batch.commit()
    written += slice.length
    console.log(`[ask-context-backfill] ${written}/${pending.length} projections written`)
  }

  if (!EMBED) {
    console.log(`\nDone. ${written} projections written. No contexts were modified.`)
    return
  }
  if (!API_KEY) {
    console.error("[ask-context-backfill] OPENAI_API_KEY required for --embed")
    process.exit(1)
  }

  // Embed only AI-eligible records whose embedding is missing or stale.
  const fresh = await db.collection("directoryIndex").where("askContext.aiEligible", "==", true).get()
  const toEmbed = fresh.docs.filter((doc) => {
    const ask = doc.data().askContext
    return ask?.aiText && ask.embeddingHash !== ask.aiTextHash
  })
  console.log(`\nembedding ${toEmbed.length} eligible records…`)

  let embedded = 0
  for (let start = 0; start < toEmbed.length; start += EMBED_BATCH) {
    const slice = toEmbed.slice(start, start + EMBED_BATCH)
    const vectors = await embedBatch(slice.map((doc) => doc.data().askContext.aiText as string))
    const batch = db.batch()
    slice.forEach((doc, position) => {
      batch.set(
        doc.ref,
        {
          askContext: {
            embedding: FieldValue.vector(vectors[position]),
            embeddingHash: doc.data().askContext.aiTextHash,
            embeddingModel: MODEL,
            embeddedAt: FieldValue.serverTimestamp(),
          },
        },
        { merge: true },
      )
    })
    await batch.commit()
    embedded += slice.length
    console.log(`[ask-context-backfill] ${embedded}/${toEmbed.length} embedded`)
  }

  console.log(`\nDone. ${written} projections, ${embedded} embeddings. No contexts were modified.`)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[ask-context-backfill] failed:", error)
    process.exit(1)
  })
