/**
 * SVC Directory — safe relationship resolution (browser loader).
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
 *
 * The pure edge normalization/bucketing lives in `directory-relations-core.ts`
 * so the server-side AI tools (Admin SDK) share one implementation.
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
import {
  directoryRelationPageWindow,
  directoryRelationsFromEdges,
  EMPTY_RELATIONS,
  otherEndpoint,
  type DirectoryRelations,
  type RelationEntityRef,
} from "@/lib/directory-relations-core"

export {
  directoryRelationPageWindow,
  directoryRelationsFromEdges,
  type DirectoryRelations,
  type RelationEntityRef,
}

export interface DirectoryRelationsPage {
  relations: DirectoryRelations
  edges: RelationEntityRef[]
  nextCursor: string | null
  hasMore: boolean
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
    return { relations: { ...EMPTY_RELATIONS }, edges: [], nextCursor: null, hasMore: false }
  }
}

export async function loadDirectoryRelations(directoryId: string): Promise<DirectoryRelations> {
  return (await loadDirectoryRelationsPage(directoryId, null, 50)).relations
}
