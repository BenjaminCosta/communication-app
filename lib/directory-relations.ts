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

import { collection, getDocs, query, where, type DocumentData } from "firebase/firestore/lite"
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

export async function loadDirectoryRelations(directoryId: string): Promise<DirectoryRelations> {
  const relationsRef = collection(directoryDb, "directoryRelations")
  let snapshots: DocumentData[]
  try {
    const [fromSnap, toSnap] = await Promise.all([
      getDocs(query(relationsRef, where("fromDirectoryId", "==", directoryId), where("active", "==", true))),
      getDocs(query(relationsRef, where("toDirectoryId", "==", directoryId), where("active", "==", true))),
    ])
    const byId = new Map<string, DocumentData>()
    for (const doc of [...fromSnap.docs, ...toSnap.docs]) byId.set(doc.id, doc.data())
    snapshots = [...byId.values()]
  } catch {
    // Missing index or denied read → degrade gracefully to no relations.
    return { ...EMPTY }
  }

  const edges = snapshots
    .map((data) => otherEndpoint(directoryId, data))
    .filter((edge): edge is RelationEntityRef => edge !== null)

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
  const people = dedupe(peopleEdges)

  return {
    company: companies[0] ?? null,
    companies,
    people,
    jobs,
    projectManager,
    projectLead,
    supervisors,
    contacts,
  }
}
