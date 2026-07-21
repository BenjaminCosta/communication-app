import { parseDirectoryId, type DirectoryType } from "@/lib/directory"

/**
 * SVC Directory — framework-free relationship helpers.
 *
 * Pure edge normalization + bucketing shared by the browser loader
 * (`lib/directory-relations.ts`, Firestore Lite) and the server-side AI tools
 * (`lib/ai/server/directory-data.ts`, Admin SDK). Kept free of any Firebase
 * import so both runtimes — and unit tests — can use exactly one implementation.
 */

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

export const EMPTY_RELATIONS: DirectoryRelations = {
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
export function otherEndpoint(directoryId: string, data: Record<string, unknown>): RelationEntityRef | null {
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

export function dedupeRefs(refs: RelationEntityRef[]): RelationEntityRef[] {
  const seen = new Set<string>()
  const out: RelationEntityRef[] = []
  for (const ref of refs) {
    if (seen.has(ref.id)) continue
    seen.add(ref.id)
    out.push(ref)
  }
  return out
}

export function directoryRelationPageWindow<T>(items: T[], pageSize: number): { items: T[]; hasMore: boolean } {
  const safePageSize = Math.max(1, pageSize)
  return { items: items.slice(0, safePageSize), hasMore: items.length > safePageSize }
}

export function directoryRelationsFromEdges(edges: RelationEntityRef[]): DirectoryRelations {
  const companies = dedupeRefs(edges.filter((edge) => edge.type === "company"))
  const jobs = dedupeRefs(edges.filter((edge) => edge.type === "job"))
  const peopleEdges = edges.filter((edge) => edge.type === "person")
  const projectManager = peopleEdges.find((edge) => /project\s*manager|(^|\W)pm(\W|$)/i.test(edge.role ?? "")) ?? null
  const projectLead = peopleEdges.find((edge) => /project\s*lead|(^|\W)pl(\W|$)/i.test(edge.role ?? "")) ?? null
  const supervisors = dedupeRefs(peopleEdges.filter((edge) => /supervisor|foreman|super(\W|$)/i.test(edge.role ?? "")))
  const teamIds = new Set(
    [projectManager, projectLead, ...supervisors].filter(Boolean).map((ref) => (ref as RelationEntityRef).id),
  )
  const contacts = dedupeRefs(peopleEdges.filter((edge) => !teamIds.has(edge.id)))
  return {
    company: companies[0] ?? null,
    companies,
    people: dedupeRefs(peopleEdges),
    jobs,
    projectManager,
    projectLead,
    supervisors,
    contacts,
  }
}
