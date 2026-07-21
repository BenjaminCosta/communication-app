import { DIRECTORY_AI_LIMITS } from "@/lib/ai/config-public"
import type { DirectorySearchDoc } from "@/lib/directory"
import type { DirectoryListItem, DirectoryScope } from "@/lib/directory-config"
import { searchDirectory, type DirectorySearchIndex } from "@/lib/directory-search"
import { loadDirectoryRelations, type RelationEntityRef } from "@/lib/directory-relations"
import type { DirectoryAskContext, DirectoryAskIntent, DirectoryAskRecord } from "@/features/directory/ai/directory-ask-contract"
import {
  buildAskRecordFromDoc,
  buildLookupAnswer,
  detectAskIntent,
  docToListItem,
  normalizeAskText,
} from "@/features/directory/ai/directory-retrieval-core"

/**
 * Client-side retrieval for the Ask SVC Directory assistant.
 *
 * All of this runs against data the user can already read (the loaded MiniSearch
 * index + /directoryRelations), so it is permission-safe. It detects the intent
 * and the named entity, pulls the smallest relevant set of records, and — for
 * simple exact lookups — can produce the answer with no model call at all.
 *
 * Only the resulting bounded records (≤ maxRecords) are ever sent to the server.
 * Firebase-free helpers live in `directory-retrieval-core.ts`.
 */

export {
  buildAskRecordFromDoc,
  detectAskIntent,
  docToListItem,
  type AskSuggestion,
} from "@/features/directory/ai/directory-retrieval-core"
export {
  buildDirectorySuggestions,
  type SuggestionInput,
  type SuggestionRecord,
} from "@/features/directory/ai/directory-suggestions"

const MAX_RECORDS = DIRECTORY_AI_LIMITS.maxRecords

export interface DirectoryRetrieval {
  intent: DirectoryAskIntent
  /** The single entity the question is about, when one was resolved. */
  primaryEntity: DirectoryListItem | null
  /** Records to ground the answer on (already bounded + truncated). */
  records: DirectoryAskRecord[]
  /** Display items backing `records`, for the answer cards. */
  items: DirectoryListItem[]
  /** Populated when a name matched several entities — ask the user to pick. */
  ambiguousMatches: DirectoryListItem[]
  /** A deterministic answer for trivial lookups (no model call needed). */
  localAnswer: string | null
}

interface Resolution {
  primary: DirectorySearchDoc | null
  ambiguous: DirectorySearchDoc[]
}

/** Resolve a name to one entity, or several strong matches to disambiguate. */
function resolveEntity(index: DirectorySearchIndex, hint: string, scope: DirectoryScope): Resolution {
  const normalizedHint = normalizeAskText(hint)
  if (!normalizedHint) return { primary: null, ambiguous: [] }
  const results = searchDirectory(index, hint, scope)
    .map((item) => index.byId.get(item.id))
    .filter((doc): doc is DirectorySearchDoc => Boolean(doc))
    .slice(0, 8)
  if (results.length === 0) return { primary: null, ambiguous: [] }

  const exact = results.filter((doc) => normalizeAskText(doc.name) === normalizedHint)
  if (exact.length === 1) return { primary: exact[0], ambiguous: [] }
  if (exact.length > 1) return { primary: null, ambiguous: exact.slice(0, 5) }

  const starts = results.filter((doc) => normalizeAskText(doc.name).startsWith(normalizedHint))
  if (starts.length === 1) return { primary: starts[0], ambiguous: [] }
  if (starts.length > 1) return { primary: null, ambiguous: starts.slice(0, 5) }

  return results.length === 1
    ? { primary: results[0], ambiguous: [] }
    : { primary: null, ambiguous: results.slice(0, 5) }
}

const RELATION_INTENTS = new Set<DirectoryAskIntent>(["who_works_at", "jobs_for", "related_to", "summarize"])

/**
 * Retrieve records for a question. Async because relation expansion reads
 * /directoryRelations. Returns everything the UI + server route need.
 */
export async function retrieveRecordsForQuestion(
  index: DirectorySearchIndex,
  question: string,
  context: DirectoryAskContext,
): Promise<DirectoryRetrieval> {
  const scope = context.scope ?? "all"
  const { intent, entityHint } = detectAskIntent(question)

  // A context chip pins the entity and skips fuzzy resolution.
  const pinned = context.entityRefs[0] ? index.byId.get(context.entityRefs[0].id) ?? null : null
  const resolution = pinned ? { primary: pinned, ambiguous: [] } : resolveEntity(index, entityHint, scope)

  if (!resolution.primary && resolution.ambiguous.length > 1) {
    return {
      intent,
      primaryEntity: null,
      records: [],
      items: [],
      ambiguousMatches: resolution.ambiguous.map(docToListItem),
      localAnswer: null,
    }
  }

  const primaryDoc = resolution.primary
  const records = new Map<string, DirectoryAskRecord>()
  const items: DirectoryListItem[] = []
  const pushDoc = (doc: DirectorySearchDoc, relation?: string) => {
    if (records.has(doc.id) || records.size >= MAX_RECORDS) return
    records.set(doc.id, buildAskRecordFromDoc(doc, relation))
    items.push(docToListItem(doc))
  }
  const pushRef = (ref: RelationEntityRef, relation?: string) => {
    if (records.has(ref.id) || records.size >= MAX_RECORDS) return
    const doc = index.byId.get(ref.id)
    if (doc) return pushDoc(doc, relation)
    records.set(ref.id, {
      id: ref.id,
      type: ref.type,
      name: ref.name,
      role: ref.role,
      relation: relation ?? ref.role,
    })
    items.push({
      id: ref.id,
      type: ref.type === "other" ? "person" : ref.type,
      name: ref.name,
      subtitle: ref.role ?? "",
      companyName: "",
      location: "",
      role: ref.role ?? "",
    })
  }

  if (primaryDoc) {
    pushDoc(primaryDoc)
    if (RELATION_INTENTS.has(intent) && primaryDoc.type !== "other") {
      try {
        const relations = await loadDirectoryRelations(primaryDoc.id)
        const roleFor = (ref: RelationEntityRef) => ref.role || undefined
        if (intent === "who_works_at") {
          relations.people.forEach((ref) => pushRef(ref, roleFor(ref) ?? `Contact at ${primaryDoc.name}`))
          relations.jobs.forEach((ref) => pushRef(ref, `Job at ${primaryDoc.name}`))
        } else if (intent === "jobs_for") {
          relations.jobs.forEach((ref) => pushRef(ref, `Job for ${primaryDoc.name}`))
          relations.people.forEach((ref) => pushRef(ref, roleFor(ref)))
        } else {
          relations.companies.forEach((ref) => pushRef(ref, roleFor(ref) ?? "Related company"))
          relations.jobs.forEach((ref) => pushRef(ref, "Related job"))
          relations.people.forEach((ref) => pushRef(ref, roleFor(ref) ?? "Related contact"))
        }
      } catch {
        // Relations are best-effort; a primary-only answer is still useful.
      }
    }
  } else {
    // No named entity — answer from a plain search over the whole question.
    for (const item of searchDirectory(index, entityHint || question, scope).slice(0, MAX_RECORDS)) {
      const doc = index.byId.get(item.id)
      if (doc) pushDoc(doc)
    }
  }

  const recordList = [...records.values()]
  const primaryEntity = primaryDoc ? docToListItem(primaryDoc) : items[0] ?? null
  const localAnswer =
    intent === "lookup" && primaryDoc && recordList.length === 1 ? buildLookupAnswer(primaryDoc) : null

  return { intent, primaryEntity, records: recordList, items, ambiguousMatches: [], localAnswer }
}
