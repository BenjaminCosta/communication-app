import { getFirebaseAdminApp } from "@/lib/ai/server/firebase-admin"

/**
 * Shared, bounded "list active ByeByeDPR jobs" primitive for the WhatsApp
 * Secretary's cross-job tools (`outlooks.ts`'s `listActiveOutlooks`,
 * `clocking.ts`'s `getMostActiveJobs`). The `jobs` collection is already
 * small and read in full elsewhere in the app; this mirrors that same
 * assumption with an explicit, defensive `MAX_FANOUT_JOBS` cap so a future
 * change in that assumption fails safe (fewer results) rather than turning
 * into an unbounded read.
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
