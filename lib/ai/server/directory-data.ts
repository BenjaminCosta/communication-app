import { getFirebaseAdminApp } from "@/lib/ai/server/firebase-admin"
import type { DirectoryType } from "@/lib/directory"
import type { AskContextProjection } from "@/lib/directory-ask-context"
import {
  directoryRelationsFromEdges,
  otherEndpoint,
  type DirectoryRelations,
  type RelationEntityRef,
} from "@/lib/directory-relations-core"

/**
 * Server-side, read-only Directory access for the Ask tools.
 *
 * Per the Firestore audit this path issues **bounded structured queries** only.
 * It must never load the shard catalog or scan a collection: `/directoryIndex`
 * is queried by `normalizedName` (equality/prefix) and by the `askContext`
 * relation arrays, and `/directoryRelations` answers relationship questions
 * first. Every query carries an explicit limit.
 *
 * Repeated normalized names are rare in this dataset (5 groups, largest 5
 * records), so name equality is naturally bounded and needs no composite index.
 */

const RELATION_LIMIT = 60
const NOTE_LIMIT = 40
/** Max candidates pulled from the most selective query before intersecting. */
export const MAX_CANDIDATES = 30
const RELATION_CACHE_TTL_MS = 60_000
const RELATION_CACHE_MAX = 200

const relationCache = new Map<string, { relations: DirectoryRelations; edges: RelationEntityRef[]; atMs: number }>()

async function getDb() {
  const { getFirestore } = await import("firebase-admin/firestore")
  return getFirestore(await getFirebaseAdminApp())
}

/** Compact server-side view of a `/directoryIndex` document. */
export interface DirectoryIndexRecord {
  id: string
  type: DirectoryType
  sourceCollection: "contexts" | "contacts"
  sourceId: string
  name: string
  normalizedName: string
  companyName: string
  location: string
  role: string
  subtitle: string
  /** Canonical description from the index (NOT the broad `searchText`). */
  description: string
  status: string
  askContext: AskContextProjection | null
  sourceUpdatedAtMs: number | null
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function millis(value: unknown): number | null {
  if (value && typeof value === "object" && typeof (value as { toMillis?: unknown }).toMillis === "function") {
    return (value as { toMillis: () => number }).toMillis()
  }
  return null
}

/** Exported so other bounded, read-only consumers (e.g. the WhatsApp Secretary's
 * keyword-search fallback) can map a `directoryIndex` doc without duplicating
 * this projection logic. Purely additive — behavior for existing callers is unchanged. */
export function mapIndexDoc(id: string, data: Record<string, unknown>): DirectoryIndexRecord {
  const rawType = text(data.type)
  const askContext = data.askContext && typeof data.askContext === "object"
    ? (data.askContext as AskContextProjection)
    : null
  return {
    id,
    type: (rawType === "person" || rawType === "company" || rawType === "job" ? rawType : "other") as DirectoryType,
    sourceCollection: data.sourceCollection === "contacts" ? "contacts" : "contexts",
    sourceId: text(data.sourceId),
    name: text(data.name),
    normalizedName: text(data.normalizedName),
    companyName: text(data.companyName),
    location: text(data.location),
    role: text(data.role),
    subtitle: text(data.subtitle),
    description: text(data.description),
    status: text(data.status),
    askContext,
    sourceUpdatedAtMs: millis(data.sourceUpdatedAt),
  }
}

/** Punctuation-insensitive form used to compare a question phrase to a stored name. */
export function stripPunctuation(value: string): string {
  return value.replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim()
}

export function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

export async function getEntityById(directoryId: string): Promise<DirectoryIndexRecord | null> {
  const db = await getDb()
  const snapshot = await db.collection("directoryIndex").doc(directoryId).get()
  if (!snapshot.exists) return null
  return mapIndexDoc(snapshot.id, snapshot.data() as Record<string, unknown>)
}

export async function getEntitiesByIds(directoryIds: string[]): Promise<DirectoryIndexRecord[]> {
  const ids = [...new Set(directoryIds.filter(Boolean))].slice(0, MAX_CANDIDATES)
  if (ids.length === 0) return []
  const db = await getDb()
  const refs = ids.map((id) => db.collection("directoryIndex").doc(id))
  const snapshots = await db.getAll(...refs)
  return snapshots
    .filter((snapshot) => snapshot.exists)
    .map((snapshot) => mapIndexDoc(snapshot.id, snapshot.data() as Record<string, unknown>))
}

/**
 * Resolve a name to records: exact `normalizedName` first, then a bounded
 * prefix range. Both use Firestore's automatic single-field index.
 */
export async function findByName(
  name: string,
  options: { type?: DirectoryType; limit?: number } = {},
): Promise<DirectoryIndexRecord[]> {
  const normalized = normalizeName(name)
  if (normalized.length < 2) return []
  const limit = Math.min(options.limit ?? MAX_CANDIDATES, MAX_CANDIDATES)
  const db = await getDb()
  const collection = db.collection("directoryIndex")

  const exact = await collection.where("normalizedName", "==", normalized).limit(limit).get()
  let records = exact.docs.map((doc) => mapIndexDoc(doc.id, doc.data() as Record<string, unknown>))

  if (records.length === 0) {
    // Stored names keep their punctuation ("story: construction ltd."), while a
    // question does not, so an exact match often misses. Anchor a bounded
    // prefix query on the first token and compare punctuation-insensitively in
    // memory \u2014 this is what keeps "Story: Construction Ltd." from collapsing
    // onto a shorter record merely named "Construction".
    const anchor = normalized.split(" ")[0]
    const prefix = await collection
      .where("normalizedName", ">=", anchor)
      .where("normalizedName", "<", `${anchor}\uf8ff`)
      .limit(MAX_CANDIDATES)
      .get()
    const candidates = prefix.docs.map((doc) => mapIndexDoc(doc.id, doc.data() as Record<string, unknown>))
    const target = stripPunctuation(normalized)
    const scored = candidates
      .map((record) => {
        const plain = stripPunctuation(record.normalizedName)
        if (plain === target) return { record, score: 3 }
        if (plain.startsWith(target)) return { record, score: 2 }
        if (target.startsWith(plain) && plain.length >= 4) return { record, score: 1 }
        return { record, score: 0 }
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
    records = scored.slice(0, limit).map((entry) => entry.record)
  }

  // Type is applied in memory: the candidate set is already tiny, so this
  // avoids a composite index for a filter that rarely changes the outcome.
  return options.type ? records.filter((record) => record.type === options.type) : records
}

export type AskContextRelationField = "personIds" | "companyIds" | "jobIds"

/**
 * Query the derived `askContext` relation arrays. One array filter per query —
 * callers intersect multiple filters in memory (see `intersectRecords`).
 */
export async function findByAskContextRelation(
  field: AskContextRelationField,
  entityId: string,
  options: { type?: DirectoryType; limit?: number } = {},
): Promise<DirectoryIndexRecord[]> {
  const db = await getDb()
  // ONE array filter and nothing else: Firestore indexes nested array fields
  // automatically, so this needs no composite index. `type` is applied in
  // memory over the already-bounded candidate set.
  const snapshot = await db
    .collection("directoryIndex")
    .where(`askContext.${field}`, "array-contains", entityId)
    .limit(Math.min(options.limit ?? MAX_CANDIDATES, MAX_CANDIDATES))
    .get()
  const records = snapshot.docs.map((doc) => mapIndexDoc(doc.id, doc.data() as Record<string, unknown>))
  return options.type ? records.filter((record) => record.type === options.type) : records
}

/**
 * Intersect candidate sets from several bounded queries, then keep the best
 * `keep` records. This is how multi-filter questions stay within budget: at
 * most `MAX_CANDIDATES` from the most selective query, intersected in memory.
 */
export function intersectRecords(sets: DirectoryIndexRecord[][], keep: number): DirectoryIndexRecord[] {
  const nonEmpty = sets.filter((set) => set.length > 0)
  if (nonEmpty.length === 0) return []
  // Most selective first so the intersection shrinks immediately.
  nonEmpty.sort((a, b) => a.length - b.length)
  const [smallest, ...rest] = nonEmpty
  const filtered = smallest.filter((record) => rest.every((set) => set.some((other) => other.id === record.id)))
  return filtered.slice(0, keep)
}

/** Relationship edges around one entity, deduped and bucketed. Cached briefly. */
export async function getRelations(
  directoryId: string,
): Promise<{ relations: DirectoryRelations; edges: RelationEntityRef[] }> {
  const cached = relationCache.get(directoryId)
  if (cached && Date.now() - cached.atMs < RELATION_CACHE_TTL_MS) {
    return { relations: cached.relations, edges: cached.edges }
  }

  const db = await getDb()
  let edges: RelationEntityRef[] = []
  try {
    const snapshot = await db
      .collection("directoryRelations")
      .where("entityIds", "array-contains", directoryId)
      .where("active", "==", true)
      .limit(RELATION_LIMIT)
      .get()
    edges = snapshot.docs
      .map((entry) => otherEndpoint(directoryId, entry.data() as Record<string, unknown>))
      .filter((edge): edge is RelationEntityRef => edge !== null)
  } catch {
    edges = []
  }

  const result = { relations: directoryRelationsFromEdges(edges), edges }
  if (relationCache.size >= RELATION_CACHE_MAX) relationCache.clear()
  relationCache.set(directoryId, { ...result, atMs: Date.now() })
  return result
}

export interface DirectoryNoteRecord {
  id: string
  entityIds: string[]
  text: string
  noteType: string
  createdAtMs: number | null
}

function mapNote(id: string, data: Record<string, unknown>): DirectoryNoteRecord {
  return {
    id,
    entityIds: Array.isArray(data.entityIds) ? (data.entityIds as unknown[]).filter((v): v is string => typeof v === "string") : [],
    text: typeof data.text === "string" ? data.text : "",
    noteType: typeof data.noteType === "string" ? data.noteType : "general",
    createdAtMs: millis(data.createdAt),
  }
}

/** Notes attached to any of the given entities (Firestore caps the IN list at 10). */
export async function getNotesForEntities(entityIds: string[], limit = NOTE_LIMIT): Promise<DirectoryNoteRecord[]> {
  const ids = [...new Set(entityIds.filter(Boolean))].slice(0, 10)
  if (ids.length === 0) return []
  const db = await getDb()
  try {
    const snapshot = await db
      .collection("directoryNotes")
      .where("entityIds", "array-contains-any", ids)
      .limit(limit)
      .get()
    return snapshot.docs.map((entry) => mapNote(entry.id, entry.data() as Record<string, unknown>))
  } catch {
    return []
  }
}

/**
 * Nearest-neighbour search over `askContext.aiText` embeddings, used as a
 * bounded reranker/fallback — never as the primary structured lookup. Returns
 * null when vector search is unavailable (backfill not run yet).
 */
export async function findByVector(queryVector: number[], limit: number): Promise<DirectoryIndexRecord[] | null> {
  try {
    const db = await getDb()
    const collection = db.collection("directoryIndex") as unknown as {
      findNearest: (options: {
        vectorField: string
        queryVector: number[]
        limit: number
        distanceMeasure: "COSINE" | "EUCLIDEAN" | "DOT_PRODUCT"
      }) => { get: () => Promise<{ docs: Array<{ id: string; data: () => Record<string, unknown> }> }> }
    }
    if (typeof collection.findNearest !== "function") return null
    const snapshot = await collection
      .findNearest({ vectorField: "askContext.embedding", queryVector, limit, distanceMeasure: "COSINE" })
      .get()
    return snapshot.docs.map((entry) => mapIndexDoc(entry.id, entry.data()))
  } catch {
    return null
  }
}

/** Test seam: drop warm caches. */
export function resetServerDirectoryCaches(): void {
  relationCache.clear()
}
