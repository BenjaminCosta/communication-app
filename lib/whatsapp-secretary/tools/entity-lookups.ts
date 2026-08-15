import { getFirebaseAdminApp } from "@/lib/ai/server/firebase-admin"
import { findWhatsAppReportJobsByNameCandidates } from "@/lib/whatsapp-reports"
import type { EntityLookups, JobLookupRecord } from "@/lib/whatsapp-secretary/entity-resolver"
import { createServerDirectoryProviderWithKeywordFallback } from "@/lib/whatsapp-secretary/tools/directory"
import { lookupLinkedJobByContextId } from "@/lib/whatsapp-secretary/tools/job-fanout"
import { createServerQuestCoralProviderWithFallback } from "@/lib/whatsapp-secretary/tools/quest-coral"
import { createServerApplicationsProviderWithFallback } from "@/lib/whatsapp-secretary/tools/applications"

/**
 * Production wiring for {@link EntityLookups}.
 *
 * Deliberately a separate file from `entity-resolver.ts`: module tool files
 * import the resolver's types, so the resolver itself must not import them
 * back. Keeping the concrete wiring here means the dependency edges all point
 * one way — tools → resolver types, orchestrator → this file → tools — with no
 * cycle. It also keeps `entity-resolver.ts` free of Firebase imports, so its
 * unit tests run under plain `tsx` with no Admin SDK credentials.
 *
 * Every lookup here reuses an existing, already-tested search path rather than
 * re-implementing name matching: Directory's keyword-fallback provider, the
 * Directory-context → ByeByeDPR-job mapping from `job-fanout.ts`, and the
 * hybrid Quest Coral / Applications providers.
 */

type RecordValue = Record<string, unknown>

async function getAdminDb() {
  const { getFirestore } = await import("firebase-admin/firestore")
  return getFirestore(await getFirebaseAdminApp())
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

/**
 * The ByeByeDPR-only fallback returns `{id, name}` (its query `.select("name")`s
 * for cost), but a fully resolved job should also know its Directory context so
 * Outlook/Messages lookups work off the same entity. One bounded point read per
 * fallback match closes that gap — and only on the fallback path, since the
 * Directory-first path already has the context id.
 */
async function attachContextIds(jobs: Array<{ id: string; name: string }>): Promise<JobLookupRecord[]> {
  if (jobs.length === 0) return []
  const db = await getAdminDb()
  const snapshots = await db.getAll(...jobs.map((job) => db.collection("jobs").doc(job.id)))
  const contextIds = new Map(
    snapshots.filter((snapshot) => snapshot.exists).map((snapshot) => [snapshot.id, asString((snapshot.data() as RecordValue | undefined)?.directoryContextId)]),
  )
  return jobs.map((job) => ({ ...job, directoryContextId: contextIds.get(job.id) || null }))
}

export function createServerEntityLookups(): EntityLookups {
  const directory = createServerDirectoryProviderWithKeywordFallback()
  const questCoral = createServerQuestCoralProviderWithFallback()
  const applications = createServerApplicationsProviderWithFallback()

  return {
    directory,

    async findJobByContextId(contextId) {
      const job = await lookupLinkedJobByContextId(contextId)
      return job ? { id: job.id, name: job.name, directoryContextId: contextId } : null
    },

    async findJobsByName(name) {
      return attachContextIds(await findWhatsAppReportJobsByNameCandidates([name]))
    },

    async findLinkedUserId(contactId) {
      const db = await getAdminDb()
      const snapshot = await db.collection("contacts").doc(contactId).get()
      return asString((snapshot.data() as RecordValue | undefined)?.linkedUserId) || null
    },

    async findProjectsByName(query, limit) {
      const projects = await questCoral.findProjectsByName(query, limit)
      return projects.map((project) => ({ id: project.id, name: project.name, status: project.status }))
    },

    async findCandidatesByName(query, limit) {
      const candidates = await applications.findCandidatesByName(query, limit)
      return candidates.map((candidate) => ({
        id: candidate.id ?? "",
        candidateName: candidate.candidateName,
        jobName: candidate.jobName,
        status: candidate.status,
      }))
    },
  }
}
