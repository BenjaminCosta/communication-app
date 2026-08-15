import { createEntityResolver, type EntityLookups, type EntityResolver } from "../lib/whatsapp-secretary/entity-resolver"
import type { DirectoryIndexRecord } from "../lib/ai/server/directory-data"

/**
 * A real {@link EntityResolver} over fixture lookups, shared by the module tool
 * tests.
 *
 * Deliberately the *real* resolver rather than a hand-written stub: the whole
 * point of the resolver is that every module gets the same entity for the same
 * name, so a test double per module would test the opposite of what matters.
 * Only the Firestore-backed lookups are faked.
 */

export function directoryRecord(overrides: Partial<DirectoryIndexRecord> & { name: string }): DirectoryIndexRecord {
  return {
    id: `job__${overrides.name.toLowerCase().replace(/\s+/g, "-")}`,
    type: "job",
    sourceCollection: "contexts",
    sourceId: `ctx-${overrides.name.toLowerCase().replace(/\s+/g, "-")}`,
    normalizedName: overrides.name.toLowerCase(),
    companyName: "",
    location: "",
    role: "",
    subtitle: "",
    description: "",
    status: "",
    askContext: null,
    sourceUpdatedAtMs: null,
    ...overrides,
  }
}

export interface FixtureResolverOptions {
  people?: DirectoryIndexRecord[]
  companies?: DirectoryIndexRecord[]
  jobs?: DirectoryIndexRecord[]
  /** ByeByeDPR job linked to a `/contexts` id. */
  linkedJobs?: Record<string, { id: string; name: string }>
  /** ByeByeDPR-only fallback, for jobs Directory cannot resolve. */
  byeByeDprJobs?: Array<{ id: string; name: string; directoryContextId?: string | null }>
  linkedUserIds?: Record<string, string>
  projects?: Array<{ id: string; name: string; status?: string }>
  candidates?: Array<{ id: string; candidateName: string; jobName?: string; status?: string }>
}

function matches(record: { name: string }, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase()
  const name = record.name.toLocaleLowerCase()
  return name === normalized || name.startsWith(normalized) || normalized.startsWith(name)
}

export function fixtureLookups(options: FixtureResolverOptions = {}): EntityLookups {
  const byType = {
    person: options.people ?? [],
    company: options.companies ?? [],
    job: options.jobs ?? [],
  }
  return {
    directory: {
      async findByName(name, findOptions = {}) {
        const pool = findOptions.type ? byType[findOptions.type as keyof typeof byType] ?? [] : [...byType.person, ...byType.company, ...byType.job]
        return pool.filter((record) => matches(record, name)).slice(0, findOptions.limit ?? 5)
      },
    },
    async findJobByContextId(contextId) {
      const linked = options.linkedJobs?.[contextId]
      return linked ? { ...linked, directoryContextId: contextId } : null
    },
    async findJobsByName(name) {
      return (options.byeByeDprJobs ?? []).filter((job) => matches(job, name))
    },
    async findLinkedUserId(contactId) {
      return options.linkedUserIds?.[contactId] ?? null
    },
    async findProjectsByName(query, limit) {
      return (options.projects ?? []).filter((project) => matches(project, query)).slice(0, limit)
    },
    async findCandidatesByName(query, limit) {
      return (options.candidates ?? [])
        .filter((candidate) => matches({ name: candidate.candidateName }, query))
        .slice(0, limit)
    },
  }
}

export function fixtureResolver(options: FixtureResolverOptions = {}): EntityResolver {
  return createEntityResolver(fixtureLookups(options))
}
