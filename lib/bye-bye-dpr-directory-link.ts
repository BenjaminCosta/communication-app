import "server-only"

/**
 * ByeByeDPR ↔ Directory linking (2026-08-10).
 *
 * Jobs a worker clocks into must be the same jobs that live in SVC
 * Directory, not a disconnected, freely-typed name — otherwise the two
 * modules drift apart over time. This file is the only place ByeByeDPR
 * touches Directory data.
 *
 * Reuses Directory's own bounded, index-backed read helpers
 * (`lib/ai/server/directory-data.ts`) instead of scanning `/contexts` —
 * that file's own docstring forbids unbounded collection scans, and this
 * follows the same discipline: every query here is a name search (already
 * indexed) or a point read by id, never a full listing.
 *
 * `/directoryIndex` (the bounded read path) stores a job's `location` but
 * not its full street `address` — only the raw `/contexts` doc has that
 * (see `normalizeJobContext()` in lib/directory-core.ts). So resolving a
 * job's real address is a single point read on `/contexts/{sourceId}`,
 * done only when a job is actually being linked/created — never during a
 * bulk listing.
 */

import { getFirebaseAdminApp } from "@/lib/ai/server/firebase-admin"
import { cleanValue, directoryId, getFieldValue, parseDirectoryId } from "@/lib/directory-core"
import { findByName, getEntitiesByIds } from "@/lib/ai/server/directory-data"

const CONTEXTS_COLLECTION = "contexts"

async function adminFirestore() {
  const { getFirestore } = await import("firebase-admin/firestore")
  return getFirestore(await getFirebaseAdminApp())
}

export interface DirectoryJobSearchResult {
  directoryContextId: string
  name: string
  location: string | null
}

/** Bounded name search over existing Directory job contexts — for "pick an existing job" UI. */
export async function searchDirectoryJobs(query: string, limit = 15): Promise<DirectoryJobSearchResult[]> {
  const trimmed = query.trim()
  if (trimmed.length < 2) return []
  const records = await findByName(trimmed, { type: "job", limit })
  return records.map((record) => ({
    directoryContextId: record.id,
    name: record.name,
    location: record.location || null,
  }))
}

export interface ResolvedDirectoryJob {
  directoryContextId: string
  name: string
  address: string | null
}

/**
 * Point-read the real `/contexts` doc a composite id resolves to, deriving
 * name/address the same way `normalizeJobContext()` does. Returns null if
 * the id is malformed, doesn't exist, or isn't a job context.
 */
export async function resolveDirectoryJob(directoryContextId: string): Promise<ResolvedDirectoryJob | null> {
  const parsed = parseDirectoryId(directoryContextId)
  if (!parsed || parsed.type !== "job") return null

  const db = await adminFirestore()
  const snap = await db.collection(CONTEXTS_COLLECTION).doc(parsed.sourceId).get()
  if (!snap.exists) return null
  const data = snap.data() ?? {}
  const master = (data.masterData ?? {}) as Record<string, unknown>
  const fields = Array.isArray(data.fields) ? data.fields : []

  const name = cleanValue(typeof master.canonicalName === "string" ? master.canonicalName : null) ?? cleanValue(typeof data.name === "string" ? data.name : null) ?? ""
  if (!name) return null
  const address = cleanValue(typeof master.address === "string" ? master.address : null) ?? getFieldValue(fields, "Address")

  return { directoryContextId, name, address }
}

/**
 * Create a brand-new Directory job context when the worker can't find their
 * job in the search — mirrors `handleCreateContext()`'s doc shape in
 * app/page.tsx exactly, plus an explicit `directoryType: "job"` stamp so
 * `classifyContext()` doesn't have to guess from field heuristics (a
 * freshly created ByeByeDPR job has none of the legacy Kind/sourceSheet
 * signals the heuristic otherwise relies on).
 */
export async function createDirectoryJobContext(name: string, createdBy: string): Promise<string> {
  const db = await adminFirestore()
  const now = new Date()
  const ref = db.collection(CONTEXTS_COLLECTION).doc()
  await ref.set({
    name,
    description: "",
    fields: [],
    directoryType: "job",
    createdBy,
    createdAt: now,
    updatedAt: now,
  })
  return directoryId("job", ref.id)
}

/** Live `directoryContextId -> current name` map, for keeping a job list fresh against Directory edits. */
export async function getLiveDirectoryJobNames(directoryContextIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(directoryContextIds.filter(Boolean))]
  if (ids.length === 0) return new Map()
  const records = await getEntitiesByIds(ids)
  return new Map(records.filter((record) => record.type === "job").map((record) => [record.id, record.name]))
}
