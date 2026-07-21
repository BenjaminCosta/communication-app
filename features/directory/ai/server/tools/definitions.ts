import { z } from "zod"
import type { RelationEntityRef } from "@/lib/directory-relations-core"
import type { DirectoryIndexRecord } from "@/lib/ai/server/directory-data"
import { extractJobStatus } from "@/features/directory/ai/directory-retrieval-core"
import type { DirectoryAskRecord } from "@/features/directory/ai/directory-ask-contract"
import type {
  CompactNote,
  DirectoryDataProvider,
  DirectoryNoteRecord,
  DirectoryTool,
  DirectoryToolResult,
  PathHop,
  ToolBudget,
} from "@/features/directory/ai/server/tools/types"

/**
 * The Directory tool set.
 *
 * Every tool is read-only, argument-validated, and returns a compact bounded
 * result. Together they give the model logical access to all people, companies,
 * jobs, relationships and notes while only ever transmitting a handful of
 * records per call.
 */

const idSchema = z.string().min(1).max(200)
const querySchema = z.string().min(1).max(200)
const limitSchema = z.number().int().min(1).max(15).optional()

/**
 * Project an index record for the model. The AI text comes from the derived
 * `askContext.aiText` (sanitized canonical description + operational notes) —
 * never from the deliberately broad `searchText`.
 */
export function buildAskRecordFromIndex(record: DirectoryIndexRecord, relation?: string): DirectoryAskRecord {
  const aiText = record.askContext?.aiText ?? ""
  // Job status lives inside the subtitle/description text, not a status field
  // (the index `status` column is person registration state).
  const status = record.type === "job"
    ? extractJobStatus({ subtitle: record.subtitle, description: record.description })
    : record.status || undefined
  return {
    id: record.id,
    type: record.type,
    name: record.name,
    companyName: record.companyName || undefined,
    location: record.location || undefined,
    role: record.role || undefined,
    subtitle: record.subtitle || undefined,
    description: aiText || record.description || undefined,
    status,
    relation: relation || undefined,
  }
}

/** Trim a tool's record list to what the shared budget still allows. */
function takeRecords(records: DirectoryIndexRecord[], budget: ToolBudget, relation?: (record: DirectoryIndexRecord) => string | undefined): DirectoryAskRecord[] {
  const allowed = Math.max(0, Math.min(budget.maxRecordsPerTool, budget.remainingRecords))
  const slice = records.slice(0, allowed)
  budget.remainingRecords -= slice.length
  return slice.map((record) => buildAskRecordFromIndex(record, relation?.(record)))
}

function refsToRecords(refs: RelationEntityRef[], budget: ToolBudget, relationLabel: (ref: RelationEntityRef) => string): DirectoryAskRecord[] {
  const allowed = Math.max(0, Math.min(budget.maxRecordsPerTool, budget.remainingRecords))
  const slice = refs.slice(0, allowed)
  budget.remainingRecords -= slice.length
  return slice.map((ref) => ({
    id: ref.id,
    type: ref.type,
    name: ref.name,
    role: ref.role,
    relation: relationLabel(ref),
  }))
}

function compactNotes(notes: DirectoryNoteRecord[], budget: ToolBudget): CompactNote[] {
  return notes.slice(0, budget.maxNotesPerTool).map((note) => ({
    id: note.id,
    noteType: note.noteType,
    entityIds: note.entityIds.slice(0, 3),
    text: note.text.length > budget.maxNoteChars ? `${note.text.slice(0, budget.maxNoteChars - 1)}…` : note.text,
  }))
}

/** Join a name and a period without doubling it ("Story: Construction Ltd." ). */
function sentence(value: string): string {
  const trimmed = value.trim()
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`
}

function emptyResult(summary: string): DirectoryToolResult {
  return { summary, empty: true }
}

// ── Search tools ─────────────────────────────────────────────────────────────

function searchTool(
  name: string,
  scope: "person" | "company" | "job",
  label: string,
): DirectoryTool<{ query: string; limit?: number }> {
  return {
    name,
    description: `Search SVC Directory ${label} by name, alias, role, company or location. Returns compact matching records.`,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: {
        query: { type: "string", description: `Name or keywords for the ${label} to find.` },
        limit: { type: "number", description: "Max records to return (1-15)." },
      },
    },
    schema: z.object({ query: querySchema, limit: limitSchema }),
    async run(args, provider, budget) {
      // Bounded name lookup (exact then prefix) — never a collection scan.
      const found = await provider.findByName(args.query, {
        type: scope,
        limit: args.limit ?? budget.maxRecordsPerTool,
      })
      // Summaries never echo the raw query back — it wastes tokens and the
      // model already has its own arguments.
      if (found.length === 0) return emptyResult(`No ${label} matched that search.`)
      const records = takeRecords(found, budget)
      return { summary: `${found.length} ${label} matched.`, records, counts: { matches: found.length } }
    },
  }
}

const searchPeople = searchTool("searchPeople", "person", "people")
const searchCompanies = searchTool("searchCompanies", "company", "companies")
const searchJobs = searchTool("searchJobs", "job", "jobs")

const getEntityDetails: DirectoryTool<{ directoryId: string }> = {
  name: "getEntityDetails",
  description: "Get the full compact record for one Directory entity by its id, plus a count of how many people/companies/jobs it is linked to.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["directoryId"],
    properties: { directoryId: { type: "string", description: "Composite Directory id, e.g. company__abc." } },
  },
  schema: z.object({ directoryId: idSchema }),
  async run(args, provider, budget) {
    const doc = await provider.getEntity(args.directoryId)
    if (!doc) return emptyResult(`No Directory record exists with id ${args.directoryId}.`)
    const { relations } = await provider.getRelations(args.directoryId)
    return {
      summary: sentence(`Details for ${doc.name}`),
      records: takeRecords([doc], budget),
      counts: {
        linkedPeople: relations.people.length,
        linkedCompanies: relations.companies.length,
        linkedJobs: relations.jobs.length,
      },
    }
  },
}

// ── Relationship tools ───────────────────────────────────────────────────────

function relationshipTool(
  name: string,
  label: string,
  pick: (relations: Awaited<ReturnType<DirectoryDataProvider["getRelations"]>>["relations"]) => Array<{ refs: RelationEntityRef[]; kind: string }>,
): DirectoryTool<{ directoryId: string }> {
  return {
    name,
    description: `List the Directory records related to a ${label}, with the relationship label for each.`,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["directoryId"],
      properties: { directoryId: { type: "string", description: `Composite Directory id of the ${label}.` } },
    },
    schema: z.object({ directoryId: idSchema }),
    async run(args, provider, budget) {
      const entity = await provider.getEntity(args.directoryId)
      const { relations } = await provider.getRelations(args.directoryId)
      const groups = pick(relations)
      const records: DirectoryAskRecord[] = []
      const counts: Record<string, number> = {}
      for (const group of groups) {
        counts[group.kind] = group.refs.length
        records.push(...refsToRecords(group.refs, budget, (ref) => ref.role ?? group.kind))
      }
      if (records.length === 0) {
        return emptyResult(sentence(`${entity?.name ?? args.directoryId} has no linked records in the Directory`))
      }
      return { summary: sentence(`Records linked to ${entity?.name ?? args.directoryId}`), records, counts }
    },
  }
}

const getCompanyRelationships = relationshipTool("getCompanyRelationships", "company", (relations) => [
  { refs: relations.people, kind: "contact" },
  { refs: relations.jobs, kind: "job" },
])

const getJobRelationships = relationshipTool("getJobRelationships", "job", (relations) => [
  { refs: [relations.projectManager, relations.projectLead].filter((ref): ref is RelationEntityRef => Boolean(ref)), kind: "team lead" },
  { refs: relations.supervisors, kind: "supervisor" },
  { refs: relations.contacts, kind: "contact" },
  { refs: relations.companies, kind: "company" },
])

const getPersonRelationships = relationshipTool("getPersonRelationships", "person", (relations) => [
  { refs: relations.companies, kind: "company" },
  { refs: relations.jobs, kind: "job" },
])

// ── Intersection tools ───────────────────────────────────────────────────────

function intersectionTool(
  name: string,
  type: "person" | "job",
  label: string,
): DirectoryTool<{ entityIdA: string; entityIdB: string }> {
  return {
    name,
    description: `Find the ${label} linked to BOTH Directory entities. Use this for "shared/common ${label}" questions across two records.`,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["entityIdA", "entityIdB"],
      properties: {
        entityIdA: { type: "string", description: "First composite Directory id." },
        entityIdB: { type: "string", description: "Second composite Directory id." },
      },
    },
    schema: z.object({ entityIdA: idSchema, entityIdB: idSchema }),
    async run(args, provider, budget) {
      const [a, b, relA, relB] = await Promise.all([
        provider.getEntity(args.entityIdA),
        provider.getEntity(args.entityIdB),
        provider.getRelations(args.entityIdA),
        provider.getRelations(args.entityIdB),
      ])
      const nameA = a?.name ?? args.entityIdA
      const nameB = b?.name ?? args.entityIdB
      const bIds = new Set(relB.edges.filter((edge) => edge.type === type).map((edge) => edge.id))
      const shared = relA.edges.filter((edge) => edge.type === type && bIds.has(edge.id))
      if (shared.length === 0) {
        return emptyResult(sentence(`${nameA} and ${nameB} have no ${label} in common in the Directory`))
      }
      // Naming them in the summary keeps the grounded answer specific.
      const named = shared.slice(0, 5).map((ref) => ref.name).join(", ")
      return {
        summary: `${shared.length} ${label} linked to both ${nameA} and ${nameB}: ${named}.`,
        records: refsToRecords(shared, budget, () => `linked to both ${nameA} and ${nameB}`),
        counts: { shared: shared.length },
      }
    },
  }
}

const findSharedContacts = intersectionTool("findSharedContacts", "person", "contacts")
const findSharedJobs = intersectionTool("findSharedJobs", "job", "jobs")

// ── Path finding ─────────────────────────────────────────────────────────────

const MAX_EXPANSIONS = 24

const findConnectingPaths: DirectoryTool<{ fromId: string; toId: string; maxDepth?: number }> = {
  name: "findConnectingPaths",
  description:
    "Find how two Directory entities are connected, walking relationships (e.g. company → job → person → company). Returns the actual path(s) so the answer can cite the chain.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["fromId", "toId"],
    properties: {
      fromId: { type: "string", description: "Starting composite Directory id." },
      toId: { type: "string", description: "Target composite Directory id." },
      maxDepth: { type: "number", description: "Maximum hops to traverse (1-3, default 3)." },
    },
  },
  schema: z.object({ fromId: idSchema, toId: idSchema, maxDepth: z.number().int().min(1).max(3).optional() }),
  async run(args, provider) {
    const maxDepth = args.maxDepth ?? 3
    const [from, to] = await Promise.all([provider.getEntity(args.fromId), provider.getEntity(args.toId)])
    const fromName = from?.name ?? args.fromId
    const toName = to?.name ?? args.toId

    const start: PathHop = { id: args.fromId, name: fromName, type: from?.type ?? "other" }
    const queue: PathHop[][] = [[start]]
    const visited = new Set<string>([args.fromId])
    const paths: PathHop[][] = []
    let expansions = 0

    while (queue.length > 0 && paths.length < 3 && expansions < MAX_EXPANSIONS) {
      const path = queue.shift()
      if (!path) break
      if (path.length > maxDepth) continue
      const tail = path[path.length - 1]
      expansions += 1
      const { edges } = await provider.getRelations(tail.id)
      for (const edge of edges) {
        if (edge.id === args.toId) {
          paths.push([...path, { id: edge.id, name: edge.name || toName, type: edge.type, role: edge.role }])
          if (paths.length >= 3) break
          continue
        }
        if (visited.has(edge.id) || path.length >= maxDepth) continue
        visited.add(edge.id)
        queue.push([...path, { id: edge.id, name: edge.name, type: edge.type, role: edge.role }])
      }
    }

    if (paths.length === 0) {
      return emptyResult(`No relationship path of up to ${maxDepth} hops connects ${fromName} and ${toName} in the Directory.`)
    }
    return {
      summary: `${paths.length} path(s) connect ${fromName} and ${toName}.`,
      paths,
      counts: { paths: paths.length, shortestHops: Math.min(...paths.map((path) => path.length - 1)) },
    }
  },
}

// ── Notes (hybrid: semantic when available, lexical otherwise) ───────────────

function lexicalScore(text: string, terms: string[]): number {
  const haystack = text.toLowerCase()
  return terms.reduce((total, term) => (haystack.includes(term) ? total + term.length : total), 0)
}

const searchRelevantNotes: DirectoryTool<{ query: string; entityIds?: string[]; limit?: number }> = {
  name: "searchRelevantNotes",
  description:
    "Search free-text Directory notes for relevant context (experience, issues, history). Optionally scope to specific entity ids. Returns short note excerpts only.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["query"],
    properties: {
      query: { type: "string", description: "What to look for in the notes." },
      entityIds: { type: "array", items: { type: "string" }, description: "Optional Directory ids to scope the search to." },
      limit: { type: "number", description: "Max notes to return (1-15)." },
    },
  },
  schema: z.object({
    query: querySchema,
    entityIds: z.array(idSchema).max(10).optional(),
    limit: limitSchema,
  }),
  async run(args, provider, budget) {
    const limit = Math.min(args.limit ?? budget.maxNotesPerTool, budget.maxNotesPerTool)

    // Semantic first when embeddings exist; otherwise bounded lexical scoring.
    let notes: DirectoryNoteRecord[] | null = null
    if (provider.searchNotesSemantic) {
      notes = await provider.searchNotesSemantic(args.query, limit)
    }
    if (notes && args.entityIds?.length) {
      const scope = new Set(args.entityIds)
      notes = notes.filter((note) => note.entityIds.some((id) => scope.has(id)))
    }
    if (!notes) {
      const pool = await provider.getNotes(args.entityIds ?? [], 40)
      const terms = args.query.toLowerCase().split(/\s+/).filter((term) => term.length >= 3)
      notes = pool
        .map((note) => ({ note, score: lexicalScore(note.text, terms) }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(({ note }) => note)
    }

    if (notes.length === 0) return emptyResult("No Directory notes matched that search.")
    return { summary: `${notes.length} relevant note(s) found.`, notes: compactNotes(notes, budget) }
  },
}

export const DIRECTORY_TOOLS: DirectoryTool<never>[] = [
  searchPeople,
  searchCompanies,
  searchJobs,
  getEntityDetails,
  getCompanyRelationships,
  getJobRelationships,
  getPersonRelationships,
  findSharedContacts,
  findSharedJobs,
  findConnectingPaths,
  searchRelevantNotes,
] as unknown as DirectoryTool<never>[]

export const DIRECTORY_TOOLS_BY_NAME = new Map(DIRECTORY_TOOLS.map((tool) => [tool.name, tool]))

/** OpenAI `tools` payload built from the registry. */
export function directoryToolSpecs(): Array<{ type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } }> {
  return DIRECTORY_TOOLS.map((tool) => ({
    type: "function" as const,
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  }))
}

/**
 * Validate + execute one tool call. Unknown names and invalid arguments return a
 * structured error the model can recover from, rather than throwing.
 */
export async function runDirectoryTool(
  name: string,
  rawArgs: unknown,
  provider: DirectoryDataProvider,
  budget: ToolBudget,
): Promise<DirectoryToolResult> {
  const tool = DIRECTORY_TOOLS_BY_NAME.get(name)
  if (!tool) return emptyResult(`Unknown tool "${name}".`)
  const parsed = tool.schema.safeParse(rawArgs)
  if (!parsed.success) {
    return emptyResult(`Invalid arguments for ${name}. Check the required fields and try again.`)
  }
  try {
    return await tool.run(parsed.data as never, provider, budget)
  } catch {
    return emptyResult(`${name} could not complete.`)
  }
}
