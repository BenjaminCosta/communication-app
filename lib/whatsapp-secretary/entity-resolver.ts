import type { DirectoryDataProvider } from "@/features/directory/ai/server/tools/types"

/**
 * One shared "name → entity" resolver for every WhatsApp Secretary module.
 *
 * Before this existed, six independent call sites solved the same problem with
 * two different reranking implementations — `resolveJobByNameViaDirectory`,
 * bare `findByName`, Quest Coral's hybrid provider, Applications' hybrid
 * provider, `resolveAuthorIdByName` and `resolveTag`. Every tool took a raw
 * `jobName: string` and resolved it again on every call, which meant a
 * cross-module question about one job paid for the same lookup three times
 * **and the three resolvers could land on different jobs**, silently blending
 * two records into a single answer. That was the motivating correctness bug,
 * not a performance concern.
 *
 * Three properties make that impossible now:
 *
 * 1. **One resolution per name per request.** Results are memoized on the
 *    resolver instance, which the orchestrator creates once per question. Ask
 *    for "North Ridge" from five tools and you get the same entity object five
 *    times, from one lookup.
 * 2. **One entity carries every id.** A resolved job knows its Directory
 *    `contextId` *and* its ByeByeDPR `jobId` at the same time, so modules stop
 *    re-deriving the other half.
 * 3. **Refs, not names, flow between tools.** A resolved entity is handed to
 *    the model as an opaque `ref` (`e1`, `e2`, …) minted per request. The
 *    model passes that back instead of a name, so follow-up calls skip
 *    resolution entirely and cannot drift onto a different record. Internal
 *    Firestore ids stay in `sourceIds`, which {@link toModelEntity} strips.
 *
 * Ambiguity is resolved once, here, in one shape — so the native WhatsApp
 * disambiguation list has a single source of candidates rather than each
 * module inventing its own `candidates` payload.
 */

export type EntityKind = "person" | "company" | "job" | "project" | "candidate"

/** Server-only identifiers. Never handed to a model — see {@link toModelEntity}. */
export interface EntitySourceIds {
  /** Composite Directory id, e.g. `job__abc`. */
  directoryId?: string
  /** `/contexts` document id — what Outlooks, Messages `contextIds` and Applications `entityIds` key on. */
  contextId?: string
  /** ByeByeDPR `/jobs` document id — what Reports and Clocking key on. */
  byeByeDprJobId?: string
  questCoralProjectId?: string
  applicationId?: string
  /** Firebase uid, when a person is a linked SVC app user. */
  linkedUserId?: string
}

export interface ResolvedEntity {
  /** Opaque per-request handle the model may pass back to any tool. */
  ref: string
  kind: EntityKind
  name: string
  sourceIds: EntitySourceIds
  /** Small, safe descriptors — used for disambiguation lists and dossier headers. */
  meta: {
    role?: string
    companyName?: string
    location?: string
    status?: string
  }
}

export type EntityResolution =
  | { status: "found"; entity: ResolvedEntity }
  | { status: "ambiguous"; candidates: ResolvedEntity[] }
  | { status: "not-found" }

/** The `{ref?, name?}` argument shape every consolidated tool accepts. */
export interface EntityArg {
  ref?: string
  name?: string
}

export interface EntityResolver {
  /** Resolve a plain name. Memoized per resolver instance. */
  resolve(query: string, kind: EntityKind): Promise<EntityResolution>
  /**
   * Resolve the standard `{ref?, name?}` tool argument. A `ref` minted earlier
   * this turn resolves with zero lookups; a `name` falls through to
   * {@link EntityResolver.resolve}.
   */
  resolveArg(arg: EntityArg, kind: EntityKind): Promise<EntityResolution>
  /** Look up an already-minted ref. Returns null for an unknown/expired handle. */
  lookup(ref: string): ResolvedEntity | null
  /**
   * Re-seed entities resolved on a previous turn.
   *
   * Without this, every ref died at the end of its request: a follow-up like
   * "and what about its reports?" had to re-resolve the name from scratch,
   * paying the lookup again and — worse — risking landing on a different
   * record than the answer the user is following up on. Rehydrating makes a
   * ref stable across the conversation, which is what makes a follow-up cheap
   * *and* consistent.
   */
  hydrate(entities: ResolvedEntity[]): void
  /** Everything resolved this turn, for persisting into the next one. */
  minted(): ResolvedEntity[]
}

export interface JobLookupRecord {
  id: string
  name: string
  directoryContextId?: string | null
}

export interface ProjectLookupRecord {
  id: string
  name: string
  status?: string
}

export interface CandidateLookupRecord {
  id: string
  candidateName: string
  jobName?: string
  status?: string
}

/**
 * Every live lookup the resolver needs, behind one injectable interface so
 * offline tests never touch Firestore. The real wiring lives in
 * `createServerEntityLookups()` (`tools/entity-lookups.ts`), which is kept in a
 * separate file so this one stays import-cycle-free: module tool files import
 * the resolver's *types*, and the resolver must not import them back.
 */
export interface EntityLookups {
  /** Directory search, already keyword-fallback wrapped by the caller. */
  directory: Pick<DirectoryDataProvider, "findByName">
  /** ByeByeDPR job linked to a Directory `/contexts` id, if any. */
  findJobByContextId(contextId: string): Promise<JobLookupRecord | null>
  /** ByeByeDPR-only job-name fallback, for jobs Directory can't resolve. */
  findJobsByName(name: string): Promise<JobLookupRecord[]>
  /** The linked Firebase uid on a `/contacts` document, when the person has one. */
  findLinkedUserId(contactId: string): Promise<string | null>
  findProjectsByName(query: string, limit: number): Promise<ProjectLookupRecord[]>
  findCandidatesByName(query: string, limit: number): Promise<CandidateLookupRecord[]>
}

const MAX_CANDIDATES = 5
const DIRECTORY_KIND: Partial<Record<EntityKind, "person" | "company" | "job">> = {
  person: "person",
  company: "company",
  job: "job",
}

function normalizeQuery(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ")
}

/** Compact, model-safe projection — `sourceIds` never crosses this boundary. */
export function toModelEntity(entity: ResolvedEntity): Record<string, unknown> {
  return {
    ref: entity.ref,
    kind: entity.kind,
    name: entity.name,
    ...(entity.meta.role ? { role: entity.meta.role } : {}),
    ...(entity.meta.companyName ? { companyName: entity.meta.companyName } : {}),
    ...(entity.meta.location ? { location: entity.meta.location } : {}),
    ...(entity.meta.status ? { status: entity.meta.status } : {}),
  }
}

export function toModelEntities(entities: ResolvedEntity[]): Array<Record<string, unknown>> {
  return entities.map(toModelEntity)
}

/**
 * A resolution that could not produce exactly one entity, rendered as the
 * standard tool result body. Centralized so every module reports "not found"
 * and "ambiguous" identically — which is also what lets the response-UX layer
 * build a disambiguation list from one predictable shape.
 */
export function describeUnresolved(
  resolution: Exclude<EntityResolution, { status: "found" }>,
  kind: EntityKind,
  query: string,
): { summary: string; data?: unknown; empty?: boolean } {
  if (resolution.status === "not-found") {
    return { summary: `No ${kind} matches "${query}".`, empty: true }
  }
  return {
    summary: `More than one ${kind} matches "${query}". Ask which one.`,
    data: { candidates: toModelEntities(resolution.candidates) },
  }
}

export function createEntityResolver(lookups: EntityLookups): EntityResolver {
  const cache = new Map<string, Promise<EntityResolution>>()
  const byRef = new Map<string, ResolvedEntity>()
  let nextRef = 1

  function mint(entity: Omit<ResolvedEntity, "ref">): ResolvedEntity {
    // Re-minting the same underlying record within one request would hand the
    // model two refs for one thing; key on the ids instead so a job reached
    // from Directory and from ByeByeDPR collapses to a single handle.
    const identity = JSON.stringify([entity.kind, entity.sourceIds])
    for (const existing of byRef.values()) {
      if (JSON.stringify([existing.kind, existing.sourceIds]) === identity) return existing
    }
    const resolved: ResolvedEntity = { ...entity, ref: `e${nextRef++}` }
    byRef.set(resolved.ref, resolved)
    return resolved
  }

  async function resolveDirectory(query: string, kind: "person" | "company" | "job"): Promise<EntityResolution> {
    const matches = await lookups.directory.findByName(query, { type: kind, limit: MAX_CANDIDATES })
    if (matches.length === 0) return { status: "not-found" }

    const entities = await Promise.all(
      matches.map(async (match) => {
        const sourceIds: EntitySourceIds = { directoryId: match.id }
        if (match.sourceCollection === "contexts") sourceIds.contextId = match.sourceId
        if (kind === "job" && match.sourceCollection === "contexts") {
          const linked = await lookups.findJobByContextId(match.sourceId)
          if (linked) sourceIds.byeByeDprJobId = linked.id
        }
        if (kind === "person" && match.sourceCollection === "contacts") {
          const linkedUserId = await lookups.findLinkedUserId(match.sourceId)
          if (linkedUserId) sourceIds.linkedUserId = linkedUserId
        }
        return mint({
          kind,
          name: match.name,
          sourceIds,
          meta: {
            ...(match.role ? { role: match.role } : {}),
            ...(match.companyName ? { companyName: match.companyName } : {}),
            ...(match.location ? { location: match.location } : {}),
            ...(match.status ? { status: match.status } : {}),
          },
        })
      }),
    )
    return entities.length === 1 ? { status: "found", entity: entities[0] } : { status: "ambiguous", candidates: entities }
  }

  /** Jobs get a second chance in ByeByeDPR's own collection when Directory can't place them. */
  async function resolveJob(query: string): Promise<EntityResolution> {
    const viaDirectory = await resolveDirectory(query, "job")
    if (viaDirectory.status === "found" || viaDirectory.status === "ambiguous") return viaDirectory

    const jobs = await lookups.findJobsByName(query)
    if (jobs.length === 0) return { status: "not-found" }
    const entities = jobs.slice(0, MAX_CANDIDATES).map((job) =>
      mint({
        kind: "job",
        name: job.name,
        sourceIds: {
          byeByeDprJobId: job.id,
          ...(job.directoryContextId ? { contextId: job.directoryContextId } : {}),
        },
        meta: {},
      }),
    )
    return entities.length === 1 ? { status: "found", entity: entities[0] } : { status: "ambiguous", candidates: entities }
  }

  async function resolveProject(query: string): Promise<EntityResolution> {
    const projects = await lookups.findProjectsByName(query, MAX_CANDIDATES)
    if (projects.length === 0) return { status: "not-found" }
    const entities = projects.map((project) =>
      mint({
        kind: "project",
        name: project.name,
        sourceIds: { questCoralProjectId: project.id },
        meta: { ...(project.status ? { status: project.status } : {}) },
      }),
    )
    return entities.length === 1 ? { status: "found", entity: entities[0] } : { status: "ambiguous", candidates: entities }
  }

  async function resolveCandidate(query: string): Promise<EntityResolution> {
    const candidates = await lookups.findCandidatesByName(query, MAX_CANDIDATES)
    if (candidates.length === 0) return { status: "not-found" }
    const entities = candidates.map((candidate) =>
      mint({
        kind: "candidate",
        name: candidate.candidateName,
        sourceIds: { applicationId: candidate.id },
        meta: {
          ...(candidate.jobName ? { companyName: candidate.jobName } : {}),
          ...(candidate.status ? { status: candidate.status } : {}),
        },
      }),
    )
    return entities.length === 1 ? { status: "found", entity: entities[0] } : { status: "ambiguous", candidates: entities }
  }

  async function resolveUncached(query: string, kind: EntityKind): Promise<EntityResolution> {
    if (kind === "job") return resolveJob(query)
    if (kind === "project") return resolveProject(query)
    if (kind === "candidate") return resolveCandidate(query)
    const directoryKind = DIRECTORY_KIND[kind]
    return directoryKind ? resolveDirectory(query, directoryKind) : { status: "not-found" }
  }

  return {
    resolve(query, kind) {
      const trimmed = query.trim()
      if (!trimmed) return Promise.resolve({ status: "not-found" })
      const key = `${kind}:${normalizeQuery(trimmed)}`
      const cached = cache.get(key)
      if (cached) return cached
      // Cache the promise, not the result, so concurrent tool calls in the same
      // round share one in-flight lookup instead of racing duplicates.
      const pending = resolveUncached(trimmed, kind).catch((error) => {
        cache.delete(key)
        throw error
      })
      cache.set(key, pending)
      return pending
    },

    resolveArg(arg, kind) {
      if (arg.ref) {
        const entity = byRef.get(arg.ref.trim())
        if (entity && entity.kind === kind) return Promise.resolve({ status: "found", entity })
        // An unknown ref is treated as not-found rather than silently falling
        // back to `name`: a stale handle must not resolve to a different record.
        if (!arg.name) return Promise.resolve({ status: "not-found" })
      }
      return arg.name ? this.resolve(arg.name, kind) : Promise.resolve({ status: "not-found" })
    },

    lookup(ref) {
      return byRef.get(ref.trim()) ?? null
    },

    hydrate(entities) {
      for (const entity of entities) {
        if (!entity.ref || byRef.has(entity.ref)) continue
        byRef.set(entity.ref, entity)
        // Seed the name cache too, so re-asking by name this turn is also free
        // and lands on the same entity the ref points at.
        cache.set(`${entity.kind}:${normalizeQuery(entity.name)}`, Promise.resolve({ status: "found", entity }))
        // Keep minting past whatever the previous turn used, so a new entity
        // this turn can never collide with a rehydrated handle.
        const numeric = Number.parseInt(entity.ref.replace(/^e/, ""), 10)
        if (Number.isFinite(numeric) && numeric >= nextRef) nextRef = numeric + 1
      }
    },

    minted() {
      return [...byRef.values()]
    },
  }
}

/** JSON Schema fragment for the shared `{ref?, name?}` argument pair. */
export function entityArgSchema(kind: EntityKind, description: string): Record<string, unknown> {
  return {
    ref: { type: "string", description: `Opaque ref for a ${kind} returned by an earlier tool this turn. Prefer this over a name — it is exact and needs no re-resolution.` },
    name: { type: "string", description },
  }
}
