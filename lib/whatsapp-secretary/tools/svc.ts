import { z } from "zod"
import type { SecretaryModule, SecretaryTool, SecretaryToolResult } from "@/lib/whatsapp-secretary/tool-registry"
import {
  describeUnresolved,
  toModelEntity,
  type EntityKind,
  type EntityResolver,
  type ResolvedEntity,
} from "@/lib/whatsapp-secretary/entity-resolver"
import { createServerDossierSources } from "@/lib/whatsapp-secretary/tools/dossier-sources"

/**
 * `svc_getEntityDossier` — one call that answers "what is going on with X?"
 * across every module at once.
 *
 * This is the generic form of a pattern `me_getMySvcContext` already proved
 * works: fan out over a bounded set of per-module reads, return each section
 * separately, and report absence explicitly instead of leaving a gap the model
 * will fill in. That tool could only ever answer it for the *sender*; a
 * cross-module question about any other job, person or project had to be
 * assembled by the model from five separate tool calls — each re-resolving the
 * same name, each spending from the shared record budget, all inside four tool
 * rounds.
 *
 * Doing it in one server-side call fixes three things at once: the name is
 * resolved exactly once (so no section can silently be about a different job),
 * the round budget is spent on *reasoning* rather than on plumbing, and every
 * section is bounded by construction rather than by whatever budget happened
 * to be left when the model got to it.
 *
 * Sections are requested explicitly and default to the ones that make sense
 * for the entity's kind, so asking about a person doesn't pay for an Outlook
 * lookup that can't apply to them.
 */

export type DossierSection = "relationships" | "outlook" | "reports" | "clocking" | "messages" | "applications" | "project"

const SECTIONS_FOR_KIND: Record<EntityKind, DossierSection[]> = {
  job: ["outlook", "reports", "clocking", "messages", "applications", "relationships"],
  person: ["relationships", "reports"],
  company: ["relationships"],
  project: ["project"],
  candidate: [],
}

const MAX_PER_SECTION = 4

/**
 * Which module's access flag governs each section. The dossier is a
 * convenience over already-permitted reads, never a way around them: a section
 * whose module this sender cannot reach is dropped **before** any query runs,
 * in code, exactly as `buildToolRegistry` drops a whole module's tools.
 */
const SECTION_MODULE: Record<DossierSection, SecretaryModule> = {
  relationships: "directory",
  outlook: "outlooks",
  reports: "reports",
  clocking: "clocking",
  messages: "messages",
  applications: "applications",
  project: "questCoral",
}

export interface DossierOutlook {
  windowStart: string
  windowEnd: string
  taskCount: number
  activeToday: boolean
}

export interface DossierReport {
  status: "draft" | "submitted"
  createdAt: string | null
  workCompleted: string | null
}

export interface DossierClock {
  activeWorkerCount: number
  mostRecentClockInAt: string | null
}

export interface DossierMessage {
  category: string
  authorName: string
  text: string
  createdAt: string | null
}

export interface DossierApplication {
  candidateName: string
  status: string
  updatedAt: string | null
}

export interface DossierRelated {
  name: string
  type: string
  relation?: string
}

export interface DossierProject {
  status: string
  progress: number
  ownerName: string
  nextStep: string | null
  recentUpdate: string | null
}

/**
 * Every live read the dossier needs, behind one injectable interface. Each
 * method is allowed to fail: {@link buildDossier} runs them independently and
 * degrades a broken section to `null`, exactly as the self-context snapshot
 * does, so one unavailable module never blanks the whole answer.
 */
export interface DossierSources {
  getOutlook(contextId: string, onDate: string): Promise<DossierOutlook | null>
  getReports(byeByeDprJobId: string, limit: number): Promise<DossierReport[]>
  getReportsByAuthor(userId: string, limit: number): Promise<DossierReport[]>
  getClockActivity(byeByeDprJobId: string): Promise<DossierClock | null>
  getOperationalMessages(contextId: string, limit: number): Promise<DossierMessage[]>
  getApplications(directoryJobId: string, limit: number): Promise<DossierApplication[]>
  getRelated(directoryId: string, limit: number): Promise<DossierRelated[]>
  getProject(projectId: string): Promise<DossierProject | null>
}

export interface Dossier {
  entity: Record<string, unknown>
  outlook: DossierOutlook | null
  reports: DossierReport[]
  clocking: DossierClock | null
  messages: DossierMessage[]
  applications: DossierApplication[]
  related: DossierRelated[]
  project: DossierProject | null
  /** Sections that were asked for but genuinely hold nothing, stated plainly so the model says so instead of guessing. */
  emptySections: string[]
  /** Sections skipped because this entity has no id to look them up by (e.g. a job with no ByeByeDPR link). */
  unavailableSections: string[]
}

async function safely<T>(run: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await run()
  } catch {
    return fallback
  }
}

export async function buildDossier(
  entity: ResolvedEntity,
  sections: DossierSection[],
  sources: DossierSources,
  today: string,
): Promise<Dossier> {
  const want = new Set(sections)
  const ids = entity.sourceIds
  const unavailable: string[] = []

  /** A section the caller asked for but this entity structurally cannot have. */
  function skip(section: DossierSection, reason: string): null {
    if (want.has(section)) unavailable.push(`${section}: ${reason}`)
    return null
  }

  const [outlook, reports, clocking, messages, applications, related, project] = await Promise.all([
    want.has("outlook")
      ? ids.contextId
        ? safely(() => sources.getOutlook(ids.contextId as string, today), null)
        : Promise.resolve(skip("outlook", "this record isn't linked to a Directory job context"))
      : Promise.resolve(null),

    want.has("reports")
      ? ids.byeByeDprJobId
        ? safely(() => sources.getReports(ids.byeByeDprJobId as string, MAX_PER_SECTION), [])
        : ids.linkedUserId
          ? safely(() => sources.getReportsByAuthor(ids.linkedUserId as string, MAX_PER_SECTION), [])
          : Promise.resolve(skip("reports", "no linked ByeByeDPR job or SVC account") ?? [])
      : Promise.resolve([]),

    want.has("clocking")
      ? ids.byeByeDprJobId
        ? safely(() => sources.getClockActivity(ids.byeByeDprJobId as string), null)
        : Promise.resolve(skip("clocking", "no linked ByeByeDPR job"))
      : Promise.resolve(null),

    want.has("messages")
      ? ids.contextId
        ? safely(() => sources.getOperationalMessages(ids.contextId as string, MAX_PER_SECTION), [])
        : Promise.resolve(skip("messages", "this record isn't linked to a Directory job context") ?? [])
      : Promise.resolve([]),

    want.has("applications")
      ? ids.directoryId
        ? safely(() => sources.getApplications(ids.directoryId as string, MAX_PER_SECTION), [])
        : Promise.resolve([])
      : Promise.resolve([]),

    want.has("relationships")
      ? ids.directoryId
        ? safely(() => sources.getRelated(ids.directoryId as string, MAX_PER_SECTION * 2), [])
        : Promise.resolve(skip("relationships", "no SVC Directory record") ?? [])
      : Promise.resolve([]),

    want.has("project")
      ? ids.questCoralProjectId
        ? safely(() => sources.getProject(ids.questCoralProjectId as string), null)
        : Promise.resolve(skip("project", "not a Quest Coral project"))
      : Promise.resolve(null),
  ])

  const emptySections: string[] = []
  if (want.has("outlook") && !outlook && ids.contextId) emptySections.push("no 3-Week Outlook on file")
  if (want.has("reports") && reports.length === 0 && (ids.byeByeDprJobId || ids.linkedUserId)) emptySections.push("no Daily Reports on file")
  if (want.has("clocking") && !clocking && ids.byeByeDprJobId) emptySections.push("no clock activity on file")
  if (want.has("messages") && messages.length === 0 && ids.contextId) emptySections.push("no automatic Communications history on file")
  if (want.has("applications") && applications.length === 0 && ids.directoryId) emptySections.push("no applications linked")
  if (want.has("relationships") && related.length === 0 && ids.directoryId) emptySections.push("no linked Directory records")

  return {
    entity: toModelEntity(entity),
    outlook,
    reports,
    clocking,
    messages,
    applications,
    related,
    project,
    emptySections,
    unavailableSections: unavailable,
  }
}

export function createSvcTools(
  deps: { resolver?: EntityResolver; sources?: DossierSources; today?: string; enabledModules?: SecretaryModule[] } = {},
): SecretaryTool[] {
  const resolver = deps.resolver
  const sources = deps.sources ?? createServerDossierSources()
  const today = deps.today ?? new Date().toISOString().slice(0, 10)
  const allowed = deps.enabledModules ? new Set(deps.enabledModules) : null
  const permitted = (sections: DossierSection[]): DossierSection[] =>
    allowed ? sections.filter((section) => allowed.has(SECTION_MODULE[section])) : sections

  const getEntityDossier: SecretaryTool<{ ref?: string; name?: string; kind?: EntityKind; sections?: DossierSection[] }> = {
    name: "svc_getEntityDossier",
    module: "svc",
    description:
      "Everything SVC currently knows about one job, person, company or project, across every module in a single call — its 3-Week Outlook, recent Daily Reports, clock activity, automatic Communications history, linked applications, related Directory records, and Quest Coral status, as applicable. Use this for broad 'what's going on with X', 'catch me up on X', 'give me a summary of X' questions instead of calling five separate module tools. Sections default to what makes sense for the record's kind; narrow them with `sections` when the question is specific. Empty and unavailable sections are reported explicitly — treat them as 'nothing on file', never as a reason to guess.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: [],
      properties: {
        ref: { type: "string", description: "Opaque ref from an earlier result. Prefer this over a name when you have one." },
        name: { type: "string", description: "The job, person, company or project name." },
        kind: { type: "string", enum: ["job", "person", "company", "project"], description: "What kind of record the name refers to. Defaults to job, then falls back through the others." },
        sections: {
          type: "array",
          items: { type: "string", enum: ["relationships", "outlook", "reports", "clocking", "messages", "applications", "project"] },
          description: "Optional subset of sections. Omit for the sensible default for this record's kind.",
        },
      },
    },
    schema: z.object({
      ref: z.string().max(20).optional(),
      name: z.string().min(1).max(200).optional(),
      kind: z.enum(["job", "person", "company", "project"]).optional(),
      sections: z.array(z.enum(["relationships", "outlook", "reports", "clocking", "messages", "applications", "project"])).max(7).optional(),
    }),
    async run(args, budget): Promise<SecretaryToolResult> {
      if (!resolver) return { summary: "Entity resolution is unavailable.", empty: true }
      if (!args.ref && !args.name) return { summary: "Provide a ref or a name.", empty: true }
      if (budget.remainingRecords <= 0) return { summary: "The retrieval budget for this question is used up.", empty: true }

      // A dossier is the expensive tool in the catalog, so it declares its own
      // worst-case cost up front rather than letting seven sections each
      // decrement whatever is left in an arbitrary order.
      const kinds: EntityKind[] = args.kind ? [args.kind] : ["job", "person", "company", "project"]
      let entity: ResolvedEntity | null = null
      let lastUnresolved: Exclude<Awaited<ReturnType<EntityResolver["resolveArg"]>>, { status: "found" }> | null = null
      for (const kind of kinds) {
        const resolution = await resolver.resolveArg({ ref: args.ref, name: args.name }, kind)
        if (resolution.status === "found") {
          entity = resolution.entity
          break
        }
        if (resolution.status === "ambiguous") {
          lastUnresolved = resolution
          break
        }
        lastUnresolved = resolution
      }
      if (!entity) {
        return describeUnresolved(lastUnresolved ?? { status: "not-found" }, args.kind ?? "job", args.name ?? args.ref ?? "")
      }

      const sections = permitted(args.sections ?? SECTIONS_FOR_KIND[entity.kind])
      const dossier = await buildDossier(entity, sections, sources, today)

      const recordCount =
        (dossier.outlook ? 1 : 0) +
        dossier.reports.length +
        (dossier.clocking ? 1 : 0) +
        dossier.messages.length +
        dossier.applications.length +
        dossier.related.length +
        (dossier.project ? 1 : 0)
      budget.remainingRecords -= Math.max(1, Math.min(recordCount, budget.maxRecordsPerTool))

      if (recordCount === 0) {
        return {
          summary: `Nothing is currently on file for "${entity.name}" across the sections checked.`,
          data: { dossier },
          empty: true,
        }
      }

      const present = [
        dossier.outlook ? "an active Outlook" : null,
        dossier.reports.length > 0 ? `${dossier.reports.length} Daily Report(s)` : null,
        dossier.clocking ? "clock activity" : null,
        dossier.messages.length > 0 ? `${dossier.messages.length} operational post(s)` : null,
        dossier.applications.length > 0 ? `${dossier.applications.length} application(s)` : null,
        dossier.related.length > 0 ? `${dossier.related.length} linked record(s)` : null,
        dossier.project ? "Quest Coral status" : null,
      ].filter(Boolean)

      return {
        summary: `Cross-module dossier for "${entity.name}" (${entity.kind}): ${present.join(", ")}.`,
        data: { dossier },
        // Each section is a bounded slice by construction, never a full audit.
        truncated: true,
      }
    },
  }

  return [getEntityDossier]
}
