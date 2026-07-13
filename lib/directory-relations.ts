/**
 * SVC Directory — safe relationship resolution.
 *
 * Reads the derived, pre-validated /directoryRelations collection (composite
 * IDs, confidence-gated at build time) and resolves the relationships around a
 * single entity into display-ready, typed buckets. Ambiguous/pending links are
 * NOT in this collection (they live in /directoryReviewQueue), so anything
 * returned here is safe to render as confirmed.
 *
 * Uses the Firestore Lite instance (`directoryDb`) for one-shot reads so it
 * never touches Communications' realtime watch stream. Two equality queries
 * (from / to) are merged client-side to avoid an `or()` composite index.
 */

import {
  collection,
  documentId,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
  type DocumentData,
} from "firebase/firestore/lite"
import { directoryDb } from "@/lib/firebase"
import { parseDirectoryId, type DirectoryType } from "@/lib/directory"

export interface RelationEntityRef {
  /** Composite directory id, e.g. "person__abc" — directly openable. */
  id: string
  type: DirectoryType
  name: string
  /** Relationship label (role), when meaningful. */
  role?: string
}

export interface DirectoryRelations {
  /** For a person or job: the related company (first safe one). */
  company: RelationEntityRef | null
  /** Companies (rare multi), people, jobs related to this entity. */
  companies: RelationEntityRef[]
  people: RelationEntityRef[]
  jobs: RelationEntityRef[]
  /** Job-specific team, bucketed from person edges by role text. */
  projectManager: RelationEntityRef | null
  projectLead: RelationEntityRef | null
  supervisors: RelationEntityRef[]
  contacts: RelationEntityRef[]
}

export interface DirectoryRelationsPage {
  relations: DirectoryRelations
  edges: RelationEntityRef[]
  nextCursor: string | null
  hasMore: boolean
}

const EMPTY: DirectoryRelations = {
  company: null,
  companies: [],
  people: [],
  jobs: [],
  projectManager: null,
  projectLead: null,
  supervisors: [],
  contacts: [],
}

export function directoryRelationPageWindow<T>(items: T[], pageSize: number): { items: T[]; hasMore: boolean } {
  const safePageSize = Math.max(1, pageSize)
  return { items: items.slice(0, safePageSize), hasMore: items.length > safePageSize }
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

/** Normalize a relation doc to an edge from `self`'s perspective → the other endpoint. */
function otherEndpoint(directoryId: string, data: DocumentData): RelationEntityRef | null {
  const fromId = str(data.fromDirectoryId)
  const toId = str(data.toDirectoryId)
  const role = str(data.role) || str(data.relationshipType)

  let otherId = ""
  let otherName = ""
  if (fromId === directoryId) {
    otherId = toId
    otherName = str(data.toName)
  } else if (toId === directoryId) {
    otherId = fromId
    otherName = str(data.fromName)
  } else {
    return null
  }

  const parsed = parseDirectoryId(otherId)
  if (!parsed) return null
  return { id: otherId, type: parsed.type, name: otherName || parsed.sourceId, role: role || undefined }
}

function dedupe(refs: RelationEntityRef[]): RelationEntityRef[] {
  const seen = new Set<string>()
  const out: RelationEntityRef[] = []
  for (const ref of refs) {
    if (seen.has(ref.id)) continue
    seen.add(ref.id)
    out.push(ref)
  }
  return out
}

export function directoryRelationsFromEdges(edges: RelationEntityRef[]): DirectoryRelations {
  const companies = dedupe(edges.filter((edge) => edge.type === "company"))
  const jobs = dedupe(edges.filter((edge) => edge.type === "job"))
  const peopleEdges = edges.filter((edge) => edge.type === "person")
  const projectManager = peopleEdges.find((edge) => /project\s*manager|(^|\W)pm(\W|$)/i.test(edge.role ?? "")) ?? null
  const projectLead = peopleEdges.find((edge) => /project\s*lead|(^|\W)pl(\W|$)/i.test(edge.role ?? "")) ?? null
  const supervisors = dedupe(peopleEdges.filter((edge) => /supervisor|foreman|super(\W|$)/i.test(edge.role ?? "")))
  const teamIds = new Set(
    [projectManager, projectLead, ...supervisors].filter(Boolean).map((ref) => (ref as RelationEntityRef).id),
  )
  const contacts = dedupe(peopleEdges.filter((edge) => !teamIds.has(edge.id)))
  return {
    company: companies[0] ?? null,
    companies,
    people: dedupe(peopleEdges),
    jobs,
    projectManager,
    projectLead,
    supervisors,
    contacts,
  }
}

async function loadLegacyRelations(directoryId: string): Promise<RelationEntityRef[]> {
  const relationsRef = collection(directoryDb, "directoryRelations")
  const [fromSnap, toSnap] = await Promise.all([
    getDocs(query(relationsRef, where("fromDirectoryId", "==", directoryId), where("active", "==", true))),
    getDocs(query(relationsRef, where("toDirectoryId", "==", directoryId), where("active", "==", true))),
  ])
  const byId = new Map<string, DocumentData>()
  for (const snapshot of [...fromSnap.docs, ...toSnap.docs]) byId.set(snapshot.id, snapshot.data())
  return [...byId.values()]
    .map((data) => otherEndpoint(directoryId, data))
    .filter((edge): edge is RelationEntityRef => edge !== null)
}

export async function loadDirectoryRelationsPage(
  directoryId: string,
  cursor: string | null = null,
  pageSize = 50,
): Promise<DirectoryRelationsPage> {
  const relationsRef = collection(directoryDb, "directoryRelations")
  try {
    const constraints = [
      where("entityIds", "array-contains", directoryId),
      where("active", "==", true),
      orderBy(documentId()),
      ...(cursor ? [startAfter(cursor)] : []),
      limit(pageSize + 1),
    ]
    const snapshot = await getDocs(query(relationsRef, ...constraints))
    if (!cursor && snapshot.empty) {
      const legacyEdges = await loadLegacyRelations(directoryId)
      return {
        relations: directoryRelationsFromEdges(legacyEdges),
        edges: legacyEdges,
        nextCursor: null,
        hasMore: false,
      }
    }
    const page = directoryRelationPageWindow(snapshot.docs, pageSize)
    const pageDocs = page.items
    const edges = pageDocs
      .map((entry) => otherEndpoint(directoryId, entry.data()))
      .filter((edge): edge is RelationEntityRef => edge !== null)
    return {
      relations: directoryRelationsFromEdges(edges),
      edges,
      nextCursor: page.hasMore ? pageDocs.at(-1)?.id ?? null : null,
      hasMore: page.hasMore,
    }
  } catch {
    if (!cursor) {
      try {
        const legacyEdges = await loadLegacyRelations(directoryId)
        return { relations: directoryRelationsFromEdges(legacyEdges), edges: legacyEdges, nextCursor: null, hasMore: false }
      } catch { /* degrade below */ }
    }
    return { relations: { ...EMPTY }, edges: [], nextCursor: null, hasMore: false }
  }
}

export async function loadDirectoryRelations(directoryId: string): Promise<DirectoryRelations> {
  return (await loadDirectoryRelationsPage(directoryId, null, 50)).relations
}
