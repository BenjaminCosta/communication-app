import { getFirebaseAdminApp } from "@/lib/ai/server/firebase-admin"
import type { DirectoryDataProvider } from "@/features/directory/ai/server/tools/types"
import type { WhatsAppReportJob } from "@/lib/whatsapp-reports"

/**
 * Shared, bounded "list active ByeByeDPR jobs" primitive for the WhatsApp
 * Secretary's cross-job tools (`outlooks.ts`'s `listActiveOutlooks`,
 * `clocking.ts`'s `getMostActiveJobs`). The `jobs` collection is already
 * small and read in full elsewhere in the app; this mirrors that same
 * assumption with an explicit, defensive `MAX_FANOUT_JOBS` cap so a future
 * change in that assumption fails safe (fewer results) rather than turning
 * into an unbounded read.
 *
 * Also owns `resolveJobByNameViaDirectory`, the hybrid job-name resolver
 * shared by `reports.ts` and `clocking.ts`: it tries Directory's job search
 * first (inheriting Directory's keyword/partial-name fallback quality) and
 * only falls back to the legacy ByeByeDPR-only resolver
 * (`findWhatsAppReportJobsByNameCandidates`) when Directory can't produce a
 * single, linked match — so job resolution only ever gets better, never
 * regresses, and the Daily Report draft action's own use of that legacy
 * resolver is completely untouched.
 *
 * Deliberately does NOT import `lib/bye-bye-dpr-server.ts`/`-store.ts` —
 * both are marked `server-only`, which only resolves inside Next's own
 * bundler, so importing them here would break this file's offline tests
 * (which run under plain `tsx`). Reads the collection directly instead,
 * matching the pattern already used by `lib/whatsapp-secretary/tools/reports.ts`
 * and `clocking.ts` for the same reason.
 */

export const MAX_FANOUT_JOBS = 50

export interface FanOutJob {
  id: string
  name: string
  directoryContextId: string | null
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

export async function listActiveJobsForFanOut(): Promise<FanOutJob[]> {
  const { getFirestore } = await import("firebase-admin/firestore")
  const db = getFirestore(await getFirebaseAdminApp())
  const snapshot = await db.collection("jobs").where("isActive", "==", true).limit(MAX_FANOUT_JOBS).get()
  return snapshot.docs.map((doc) => {
    const data = doc.data() as Record<string, unknown>
    return {
      id: doc.id,
      name: asString(data.name),
      directoryContextId: asString(data.directoryContextId) || null,
    }
  })
}

/** Single-equality-filter lookup — no composite index needed. */
async function lookupLinkedJobByContextId(directoryContextId: string): Promise<WhatsAppReportJob | null> {
  const { getFirestore } = await import("firebase-admin/firestore")
  const db = getFirestore(await getFirebaseAdminApp())
  const snapshot = await db.collection("jobs").where("directoryContextId", "==", directoryContextId).limit(1).get()
  const doc = snapshot.docs[0]
  if (!doc) return null
  const data = doc.data() as Record<string, unknown>
  return { id: doc.id, name: asString(data.name) }
}

/**
 * Resolves a job name to its ByeByeDPR job, Directory-first. Tries
 * Directory's `findByName(name, {type:"job"})` — a single unambiguous
 * `contexts` match is mapped to its linked ByeByeDPR job via
 * `jobs.directoryContextId`. Any other outcome (no match, more than one
 * match, or a Directory job with no linked ByeByeDPR job) falls back to
 * `fallback` unchanged. `lookupLinkedJob` is injectable purely for testing
 * this branching logic without a live Firestore.
 */
export async function resolveJobByNameViaDirectory(
  name: string,
  directoryProvider: Pick<DirectoryDataProvider, "findByName">,
  fallback: (name: string) => Promise<WhatsAppReportJob[]>,
  lookupLinkedJob: (directoryContextId: string) => Promise<WhatsAppReportJob | null> = lookupLinkedJobByContextId,
): Promise<WhatsAppReportJob[]> {
  const matches = await directoryProvider.findByName(name, { type: "job", limit: 3 })
  const contextMatches = matches.filter((match) => match.sourceCollection === "contexts")
  if (contextMatches.length !== 1) return fallback(name)

  const linkedJob = await lookupLinkedJob(contextMatches[0].sourceId)
  if (!linkedJob) return fallback(name)
  return [linkedJob]
}
