import { z } from "zod"
import type { Firestore, Timestamp } from "firebase-admin/firestore"
import { getFirebaseAdminApp } from "@/lib/ai/server/firebase-admin"
import { tokenize } from "@/lib/directory-core"
import {
  PROJECT_STATUS_ORDER,
  PROJECT_STATUS_META,
  UPDATE_TYPE_ORDER,
  UPDATE_TYPE_META,
  clampProgress,
  type ProjectPerson,
  type ProjectStatus,
  type ProjectTimeline,
  type ProjectTimelinePhase,
  type UpdateType,
} from "@/lib/quest-coral-core"
import { allowedPageSize, type SecretaryTool, type SecretaryToolResult } from "@/lib/whatsapp-secretary/tool-registry"
import { describeUnresolved, entityArgSchema, type EntityResolver } from "@/lib/whatsapp-secretary/entity-resolver"
import { detailCard } from "@/lib/whatsapp-secretary/response-format"
import { buildQuestCoralProjectDeepLink } from "@/lib/whatsapp-secretary/guidance"
import { rerankByTokenScore, scoreNameAgainstTokens, type ScoredMatch } from "@/lib/whatsapp-secretary/tools/keyword-match"

/**
 * Quest Coral tools for the WhatsApp Secretary orchestrator.
 *
 * Ported and extended from the old `lib/whatsapp-quest-coral.ts` fixed-slice
 * reader: project name resolution is now a single argument the model
 * supplies (no more regex candidate-extraction from free text), and updates
 * gain real date-range/cursor pagination instead of always the newest four —
 * both on the existing `questCoralUpdates(projectId ASC, createdAt DESC)`
 * composite index, so no new index is needed. `listRecentActivity` is new: a
 * global newest-first feed with no project filter, which Firestore serves off
 * its automatic single-field index on `createdAt`.
 *
 * Data access goes through {@link QuestCoralToolsProvider} so tests can swap
 * in an in-memory fixture, matching the Directory tool tests' pattern.
 *
 * Keyword-search fallback: `findProjectsByName`'s exact/prefix path (like
 * Directory's own pre-fallback `findByName`) only anchors on the query's
 * first word, so "Beach" alone won't find a project actually named "Miami
 * Beach Renovation". Unlike Directory, Quest Coral projects have no derived
 * `keywords` index field to query — but the collection is small (confirmed
 * single digits in production, nowhere near ByeByeDPR's own already-treated-
 * as-small `jobs` collection), so `createHybridQuestCoralProvider()` simply
 * fetches a capped page of every project when the exact/prefix path finds
 * nothing, and reranks in memory with the same token-overlap logic Directory
 * uses (`rerankByTokenScore` in `keyword-match.ts`).
 */

const PROJECTS_COLLECTION = "questCoralProjects"
const UPDATES_COLLECTION = "questCoralUpdates"
const PROJECT_CONTEXTS_COLLECTION = "questCoralProjectContexts"

const MAX_PROJECT_MATCHES = 5
const MAX_CONTEXT_CHARACTERS = 1_400
const MAX_UPDATE_BODY_CHARACTERS = 480
/** Bounded "scan every project" cap for the keyword fallback — generous
 * relative to the collection's real size, but still a hard bound, not an
 * unbounded read. */
const MAX_KEYWORD_OVERFETCH_PROJECTS = 200

type RecordValue = Record<string, unknown>

export interface QuestCoralProjectSummary {
  id: string
  name: string
  description: string
  status: ProjectStatus
  progress: number
  ownerName: string
  peopleNames: string[]
  nextStep: string | null
  nextStepDue: string | null
  timeline: ProjectTimeline | null
  updatedAt: string | null
}

export interface QuestCoralUpdateSummary {
  projectId: string
  projectName?: string
  type: UpdateType
  authorName: string
  body: string
  status?: ProjectStatus
  progress?: number
  nextStep?: string
  isBlocker: boolean
  createdAt: string | null
}

export interface QuestCoralToolsProvider {
  findProjectsByName(query: string, limit: number): Promise<QuestCoralProjectSummary[]>
  getProjectContext(projectId: string): Promise<string | null>
  getProjectUpdates(
    projectId: string,
    options: { since?: string; until?: string; cursor?: string; limit: number },
  ): Promise<{ updates: QuestCoralUpdateSummary[]; nextCursor: string | null }>
  listRecentActivity(options: { since?: string; limit: number }): Promise<QuestCoralUpdateSummary[]>
  /** Every project, newest-updated first — for "what projects are there" without naming one. */
  listAllProjects(options: { status?: ProjectStatus; limit: number }): Promise<QuestCoralProjectSummary[]>
}

/** Test seam: swap for a fixture in offline tests instead of hitting Firestore. */
export type QuestCoralKeywordSearchProvider = (tokens: string[], limit: number) => Promise<QuestCoralProjectSummary[]>

/** Internal identifiers are reserved for the response-presentation layer. */
function toModelProject({ id: _id, ...project }: QuestCoralProjectSummary): Omit<QuestCoralProjectSummary, "id"> {
  return project
}

function toModelUpdate({ projectId: _projectId, ...update }: QuestCoralUpdateSummary): Omit<QuestCoralUpdateSummary, "projectId"> {
  return update
}

function projectDetailFormat(project: QuestCoralProjectSummary, updates: QuestCoralUpdateSummary[]) {
  const people = project.peopleNames.filter(Boolean)
  const updateItems = updates.slice(0, 2).map((update) => {
    const prefix = update.isBlocker ? "Blocker" : UPDATE_TYPE_META[update.type].label
    const author = update.authorName ? ` — ${update.authorName}` : ""
    return `${prefix}: ${update.body}${author}`
  })
  return detailCard({
    title: project.name,
    fields: [
      { label: "Status", value: `${PROJECT_STATUS_META[project.status].label} · ${project.progress}%` },
      project.ownerName ? { label: "Owner", value: project.ownerName } : null,
      people.length > 0 ? { label: "Team", value: people.slice(0, 4).join(", ") } : null,
      project.nextStep ? { label: "Next step", value: project.nextStep } : null,
      project.nextStepDue ? { label: "Due", value: project.nextStepDue } : null,
      project.updatedAt ? { label: "Updated", value: project.updatedAt } : null,
    ],
    sections: [
      project.description ? { label: "Overview", items: [project.description] } : null,
      updateItems.length > 0 ? { label: "Latest updates", items: updateItems } : null,
    ],
  })
}

function asRecord(value: unknown): RecordValue | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as RecordValue) : null
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function asNullableString(value: unknown): string | null {
  const result = asString(value)
  return result || null
}

function toIso(value: unknown): string | null {
  if (value && typeof value === "object" && "toDate" in value && typeof (value as { toDate?: unknown }).toDate === "function") {
    const date = (value as { toDate: () => Date }).toDate()
    if (date instanceof Date && !Number.isNaN(date.getTime())) return date.toISOString()
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString()
  return typeof value === "string" && value ? value : null
}

function mapStatus(value: unknown): ProjectStatus {
  return (PROJECT_STATUS_ORDER as string[]).includes(value as string) ? (value as ProjectStatus) : "planning"
}

function mapUpdateType(value: unknown): UpdateType {
  return (UPDATE_TYPE_ORDER as string[]).includes(value as string) ? (value as UpdateType) : "update"
}

function mapPeople(value: unknown): ProjectPerson[] {
  if (!Array.isArray(value)) return []
  return value
    .map(asRecord)
    .filter((person): person is RecordValue => person !== null)
    .map((person) => ({ id: asString(person.id), name: asString(person.name), initials: asString(person.initials) }))
    .filter((person) => person.id && person.name)
    .slice(0, 30)
}

function mapTimelinePhase(value: unknown): ProjectTimelinePhase {
  const record = asRecord(value)
  return {
    range: asString(record?.range),
    items: Array.isArray(record?.items)
      ? record.items.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean).slice(0, 6)
      : [],
  }
}

function mapTimeline(value: unknown): ProjectTimeline | null {
  const record = asRecord(value)
  if (!record) return null
  return { past: mapTimelinePhase(record.past), present: mapTimelinePhase(record.present), future: mapTimelinePhase(record.future) }
}

function mapProject(id: string, data: RecordValue): QuestCoralProjectSummary {
  return {
    id,
    name: asString(data.name),
    description: asString(data.description).slice(0, 600),
    status: mapStatus(data.status),
    progress: typeof data.progress === "number" ? clampProgress(data.progress) : 0,
    ownerName: asString(data.ownerName),
    peopleNames: mapPeople(data.people).map((person) => person.name),
    nextStep: asNullableString(data.nextStep),
    nextStepDue: asNullableString(data.nextStepDue),
    timeline: mapTimeline(data.timeline),
    updatedAt: toIso(data.updatedAt),
  }
}

function mapUpdate(data: RecordValue, projectName?: string): QuestCoralUpdateSummary {
  const rawStatus = asString(data.status)
  return {
    projectId: asString(data.projectId),
    ...(projectName ? { projectName } : {}),
    type: mapUpdateType(data.type),
    authorName: asString(data.authorName) || "SVC teammate",
    body: asString(data.body).slice(0, MAX_UPDATE_BODY_CHARACTERS),
    ...(rawStatus ? { status: mapStatus(rawStatus) } : {}),
    ...(typeof data.progress === "number" ? { progress: clampProgress(data.progress) } : {}),
    ...(asString(data.nextStep) ? { nextStep: asString(data.nextStep).slice(0, 300) } : {}),
    isBlocker: data.isBlocker === true,
    createdAt: toIso(data.createdAt),
  }
}

async function getAdminDb(): Promise<Firestore> {
  const { getFirestore } = await import("firebase-admin/firestore")
  return getFirestore(await getFirebaseAdminApp())
}

function titleCaseFirstWord(value: string): string {
  return value.replace(/^\p{L}/u, (letter) => letter.toLocaleUpperCase())
}

const PREFIX_UPPER_BOUND_SUFFIX = String.fromCharCode(0xf8ff)

function createServerQuestCoralProvider(): QuestCoralToolsProvider {
  return {
    async findProjectsByName(query, limit) {
      const db = await getAdminDb()
      const exact = await db.collection(PROJECTS_COLLECTION).where("name", "==", query).limit(limit).get()
      const exactProjects = exact.docs.map((document) => mapProject(document.id, document.data() as RecordValue)).filter((project) => project.name)
      if (exactProjects.length > 0) return exactProjects

      const firstWord = query.split(/\s+/, 1)[0]
      if (firstWord.length < 3) return []
      const prefix = titleCaseFirstWord(firstWord)
      const snapshot = await db
        .collection(PROJECTS_COLLECTION)
        .where("name", ">=", prefix)
        .where("name", "<", `${prefix}${PREFIX_UPPER_BOUND_SUFFIX}`)
        .limit(limit)
        .get()
      const normalizedQuery = query.toLocaleLowerCase()
      return snapshot.docs
        .map((document) => mapProject(document.id, document.data() as RecordValue))
        .filter((project) => {
          const normalizedName = project.name.toLocaleLowerCase()
          return normalizedName === normalizedQuery || normalizedName.startsWith(normalizedQuery) || normalizedQuery.startsWith(normalizedName)
        })
    },
    async getProjectContext(projectId) {
      const db = await getAdminDb()
      const snapshot = await db.collection(PROJECT_CONTEXTS_COLLECTION).doc(projectId).get()
      if (!snapshot.exists) return null
      return asNullableString((snapshot.data() as RecordValue | undefined)?.markdown)?.slice(0, MAX_CONTEXT_CHARACTERS) ?? null
    },
    async getProjectUpdates(projectId, options) {
      const db = await getAdminDb()
      let query = db.collection(UPDATES_COLLECTION).where("projectId", "==", projectId).orderBy("createdAt", "desc")
      if (options.until) query = query.where("createdAt", "<=", new Date(options.until))
      if (options.since) query = query.where("createdAt", ">=", new Date(options.since))
      if (options.cursor) {
        const cursorMs = Number(options.cursor)
        if (Number.isFinite(cursorMs)) query = query.startAfter(new Date(cursorMs))
      }
      const snapshot = await query.limit(options.limit).get()
      const updates = snapshot.docs.map((document) => mapUpdate(document.data() as RecordValue))
      const last = snapshot.docs.at(-1)?.get("createdAt") as Timestamp | undefined
      const nextCursor = snapshot.docs.length === options.limit && last ? String(last.toMillis()) : null
      return { updates, nextCursor }
    },
    async listRecentActivity(options) {
      const db = await getAdminDb()
      let query = db.collection(UPDATES_COLLECTION).orderBy("createdAt", "desc")
      if (options.since) query = query.where("createdAt", ">=", new Date(options.since))
      const snapshot = await query.limit(options.limit).get()
      if (snapshot.empty) return []

      const projectIds = [...new Set(snapshot.docs.map((document) => asString((document.data() as RecordValue).projectId)).filter(Boolean))].slice(0, 12)
      const projectRefs = projectIds.map((id) => db.collection(PROJECTS_COLLECTION).doc(id))
      const projectSnapshots = projectRefs.length > 0 ? await db.getAll(...projectRefs) : []
      const namesById = new Map(
        projectSnapshots.filter((snap) => snap.exists).map((snap) => [snap.id, asString((snap.data() as RecordValue | undefined)?.name)]),
      )
      return snapshot.docs.map((document) => {
        const data = document.data() as RecordValue
        return mapUpdate(data, namesById.get(asString(data.projectId)) || "Unnamed project")
      })
    },
    async listAllProjects(options) {
      // No composite (status, updatedAt) index exists for this collection, and
      // — per this file's own keyword-fallback precedent above — it doesn't
      // need one: the collection is confirmed small in production, so a
      // status filter is applied in memory over the same bounded overfetch
      // rather than adding a new index for a rarely-combined filter.
      const db = await getAdminDb()
      const snapshot = await db.collection(PROJECTS_COLLECTION).orderBy("updatedAt", "desc").limit(MAX_KEYWORD_OVERFETCH_PROJECTS).get()
      const projects = snapshot.docs.map((document) => mapProject(document.id, document.data() as RecordValue))
      const filtered = options.status ? projects.filter((project) => project.status === options.status) : projects
      return filtered.slice(0, options.limit)
    },
  }
}

function createServerQuestCoralKeywordSearchProvider(): QuestCoralKeywordSearchProvider {
  return async (tokens, limit) => {
    if (tokens.length === 0) return []
    const db = await getAdminDb()
    const snapshot = await db.collection(PROJECTS_COLLECTION).orderBy("updatedAt", "desc").limit(MAX_KEYWORD_OVERFETCH_PROJECTS).get()
    const scored: ScoredMatch<QuestCoralProjectSummary>[] = snapshot.docs.map((document) => {
      const project = mapProject(document.id, document.data() as RecordValue)
      return { record: project, score: scoreNameAgainstTokens(project.name, tokens) }
    })
    return rerankByTokenScore(scored, tokens.length, limit)
  }
}

/**
 * Wraps a real `QuestCoralToolsProvider` so `findProjectsByName` gets a
 * second, bounded chance via in-memory keyword search whenever the
 * exact/prefix path finds nothing — every other method passes through
 * unchanged.
 */
function createHybridQuestCoralProvider(
  base: QuestCoralToolsProvider,
  keywordSearch: QuestCoralKeywordSearchProvider,
): QuestCoralToolsProvider {
  return {
    ...base,
    async findProjectsByName(query, limit) {
      const primary = await base.findProjectsByName(query, limit)
      if (primary.length > 0) return primary
      const tokens = tokenize(query)
      if (tokens.length === 0) return primary
      return keywordSearch(tokens, limit)
    },
  }
}

/**
 * The real provider with its keyword fallback already wired — exported so the
 * shared entity resolver reuses this exact search behavior (exact/prefix, then
 * bounded in-memory token rerank) instead of re-implementing project lookup.
 */
export function createServerQuestCoralProviderWithFallback(): QuestCoralToolsProvider {
  return createHybridQuestCoralProvider(createServerQuestCoralProvider(), createServerQuestCoralKeywordSearchProvider())
}

/** Resolves exactly one project by name, or returns a compact ambiguous/not-found result. */
async function resolveOneProject(
  provider: QuestCoralToolsProvider,
  projectName: string,
): Promise<{ kind: "found"; project: QuestCoralProjectSummary } | { kind: "ambiguous"; matches: QuestCoralProjectSummary[] } | { kind: "not-found" }> {
  const matches = await provider.findProjectsByName(projectName, MAX_PROJECT_MATCHES)
  if (matches.length === 0) return { kind: "not-found" }
  if (matches.length > 1) return { kind: "ambiguous", matches }
  return { kind: "found", project: matches[0] }
}

export function createQuestCoralTools(
  deps: { resolver?: EntityResolver; provider?: QuestCoralToolsProvider; keywordSearchProvider?: QuestCoralKeywordSearchProvider } = {},
): SecretaryTool[] {
  const baseProvider = deps.provider ?? createServerQuestCoralProvider()
  const keywordSearch = deps.keywordSearchProvider ?? createServerQuestCoralKeywordSearchProvider()
  const provider = createHybridQuestCoralProvider(baseProvider, keywordSearch)
  const resolver = deps.resolver

  /**
   * Searching by name and listing everything were two tools apart only in
   * whether `query` was supplied — so `query` is optional now, and a status
   * filter works in both cases.
   */
  const searchProjects: SecretaryTool<{ query?: string; status?: ProjectStatus; limit?: number }> = {
    name: "questCoral_searchProjects",
    module: "questCoral",
    description:
      "Find Quest Coral projects. With `query`, searches by name; without it, lists every project newest-updated first — so it answers both 'how's the Beach project going' and 'what projects are there'. Optional `status` filter applies either way. Returns compact records (status, progress, owner) plus a `ref` you can pass to questCoral_getProject or svc_getEntityDossier.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: [],
      properties: {
        query: { type: "string", description: "Project name or a close guess. Omit to list all projects." },
        status: { type: "string", enum: PROJECT_STATUS_ORDER, description: "Optional: only projects in this status." },
        limit: { type: "number", description: "Max projects to return (1-12)." },
      },
    },
    schema: z.object({
      query: z.string().min(1).max(160).optional(),
      status: z.enum(PROJECT_STATUS_ORDER as [ProjectStatus, ...ProjectStatus[]]).optional(),
      limit: z.number().int().min(1).max(12).optional(),
    }),
    async run(args, budget): Promise<SecretaryToolResult> {
      const limit = allowedPageSize(budget, args.limit, 12)
      if (limit <= 0) return { summary: "The retrieval budget for this question is used up.", empty: true }

      const matches = args.query
        ? (await provider.findProjectsByName(args.query, Math.max(limit, MAX_PROJECT_MATCHES))).filter(
            (project) => !args.status || project.status === args.status,
          )
        : await provider.listAllProjects({ status: args.status, limit })

      if (matches.length === 0) {
        return { summary: args.query ? "No Quest Coral project matched that search." : "No Quest Coral projects were retrieved.", empty: true }
      }
      const page = matches.slice(0, limit)
      budget.remainingRecords -= page.length

      const refs = resolver
        ? (await Promise.all(page.map(async (project) => {
            const resolution = await resolver.resolve(project.name, "project")
            return resolution.status === "found" ? { ref: resolution.entity.ref, name: project.name } : null
          }))).filter(Boolean)
        : []

      return {
        summary: `${page.length} Quest Coral project(s)${args.query ? " matched" : ", newest-updated first"}.`,
        data: { projects: page.map(toModelProject), ...(refs.length > 0 ? { refs } : {}) },
        ...(matches.length > page.length ? { truncated: true, totalMatched: matches.length } : {}),
        ...(page.length === 1
          ? { presentation: { cta: { buttonText: "Open Project", url: buildQuestCoralProjectDeepLink(page[0]!.id) } } }
          : {}),
      }
    },
  }

  /**
   * Details and the activity feed were two tools that both had to resolve the
   * same project first — a guaranteed two-round drill-down for a single
   * "how's X going" question. `include` makes it one round.
   */
  const getProject: SecretaryTool<{ ref?: string; name?: string; include?: Array<"context" | "updates">; since?: string; until?: string; cursor?: string; limit?: number }> = {
    name: "questCoral_getProject",
    module: "questCoral",
    description:
      "Get one Quest Coral project: status, progress, owner, people involved, next step and timeline — plus, with `include`, its written Project Context and/or its activity feed (updates, feedback, blockers, Red Team Reviews) in the same call. The feed supports a date range and a `cursor` for paging into older updates. Pass `ref` from an earlier result when you have one, otherwise `name`.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: [],
      properties: {
        ...entityArgSchema("project", "The project's name."),
        include: {
          type: "array",
          items: { type: "string", enum: ["context", "updates"] },
          description: "Extra sections: the written Project Context, and/or the activity feed.",
        },
        since: { type: "string", description: "Feed only: updates on/after this ISO date." },
        until: { type: "string", description: "Feed only: updates on/before this ISO date." },
        cursor: { type: "string", description: "Feed only: pagination cursor from a previous call's nextCursor." },
        limit: { type: "number", description: "Feed only: max updates to return (1-12)." },
      },
    },
    schema: z.object({
      ref: z.string().max(20).optional(),
      name: z.string().min(1).max(160).optional(),
      include: z.array(z.enum(["context", "updates"])).max(2).optional(),
      since: z.string().max(40).optional(),
      until: z.string().max(40).optional(),
      cursor: z.string().max(60).optional(),
      limit: z.number().int().min(1).max(12).optional(),
    }),
    async run(args, budget): Promise<SecretaryToolResult> {
      let project: QuestCoralProjectSummary | null = null
      if (resolver && (args.ref || args.name)) {
        const resolution = await resolver.resolveArg({ ref: args.ref, name: args.name }, "project")
        if (resolution.status !== "found") return describeUnresolved(resolution, "project", args.name ?? args.ref ?? "")
        const projectId = resolution.entity.sourceIds.questCoralProjectId
        const byName = await provider.findProjectsByName(resolution.entity.name, MAX_PROJECT_MATCHES)
        project = byName.find((candidate) => candidate.id === projectId) ?? byName[0] ?? null
      } else if (args.name) {
        const resolved = await resolveOneProject(provider, args.name)
        if (resolved.kind === "not-found") return { summary: `No Quest Coral project matches "${args.name}".`, empty: true }
        if (resolved.kind === "ambiguous") {
          return {
            summary: `More than one project matches "${args.name}". Ask which one.`,
            data: { candidates: resolved.matches.map((entry) => ({ name: entry.name, status: entry.status, ownerName: entry.ownerName })) },
          }
        }
        project = resolved.project
      }
      if (!project) return { summary: "Provide a ref or a project name.", empty: true }

      const include = new Set(args.include ?? [])
      const limit = include.has("updates") ? allowedPageSize(budget, args.limit, 12) : 0
      const [projectContext, feed] = await Promise.all([
        include.has("context") ? provider.getProjectContext(project.id) : Promise.resolve(null),
        limit > 0
          ? provider.getProjectUpdates(project.id, { since: args.since, until: args.until, cursor: args.cursor, limit })
          : Promise.resolve({ updates: [], nextCursor: null as string | null }),
      ])
      budget.remainingRecords -= feed.updates.length + 1

      return {
        summary: `Details for Quest Coral project "${project.name}"${feed.updates.length > 0 ? `, with ${feed.updates.length} recent update(s)` : ""}.`,
        data: {
          project: toModelProject(project),
          ...(projectContext ? { projectContext } : {}),
          ...(include.has("updates") ? { updates: feed.updates.map(toModelUpdate) } : {}),
        },
        responseFormat: projectDetailFormat(project, feed.updates),
        ...(feed.nextCursor ? { nextCursor: feed.nextCursor, truncated: true } : {}),
        presentation: { cta: { buttonText: "Open Project", url: buildQuestCoralProjectDeepLink(project.id) } },
      }
    },
  }

  const listRecentActivity: SecretaryTool<{ since?: string; limit?: number }> = {
    name: "questCoral_listRecentActivity",
    module: "questCoral",
    description:
      "List recent Quest Coral activity across ALL projects, newest first — for cross-project questions like 'what needs attention' or 'what happened this week'. Optional `since` (ISO date) bounds how far back to look.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: [],
      properties: {
        since: { type: "string", description: "Only activity on/after this ISO date." },
        limit: { type: "number", description: "Max updates to return (1-12)." },
      },
    },
    schema: z.object({ since: z.string().max(40).optional(), limit: z.number().int().min(1).max(12).optional() }),
    async run(args, budget): Promise<SecretaryToolResult> {
      const limit = Math.max(1, Math.min(args.limit ?? budget.maxRecordsPerTool, budget.maxRecordsPerTool, budget.remainingRecords))
      if (limit <= 0) return { summary: "The retrieval budget for this question is used up.", empty: true }

      const updates = await provider.listRecentActivity({ since: args.since, limit })
      budget.remainingRecords -= updates.length
      if (updates.length === 0) return { summary: "No recent Quest Coral activity was retrieved.", empty: true }
      return { summary: `${updates.length} recent Quest Coral update(s) across projects, newest first.`, data: { updates: updates.map(toModelUpdate) } }
    },
  }

  return [searchProjects, getProject, listRecentActivity]
}
