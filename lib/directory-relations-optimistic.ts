import type { RelationEntityRef } from "@/lib/directory-relations"

/**
 * Cross-navigation bridge for /directoryRelations edge edits.
 *
 * A Directory edit writes the source doc (a job's involvedContactIds, a
 * person's company, …); a Cloud Function trigger then derives the actual
 * /directoryRelations edge asynchronously. The screen you're editing on
 * already knows the exact change and merges it into its own state instantly
 * (see directory-profile-screen.tsx's onSaved) — but a relation edit is
 * inherently two-sided, and the OTHER endpoint's profile is a screen that
 * hasn't been mounted yet. Without this, navigating there right after
 * (Person A → the Job you just added them to) would show stale data until
 * the trigger catches up, no matter how fast the edited screen itself feels.
 *
 * This module records the mirrored change against the other entity's id in
 * an in-memory, session-only map. Any profile screen that loads relations
 * for that id applies pending overrides on top of whatever it fetches, so
 * the change is visible immediately regardless of which side you look from.
 * Entries expire on their own shortly after the trigger would realistically
 * have finished, so a failed/slow reconcile never leaves permanently wrong
 * data — worst case it reverts to the (by-then actually correct) server
 * state within a few seconds.
 */

interface PendingEdgeChange {
  action: "add" | "remove"
  ref: RelationEntityRef
  expiresAt: number
}

const TTL_MS = 15_000

const pendingByEntity = new Map<string, Map<string, PendingEdgeChange>>()

function bucket(entityId: string): Map<string, PendingEdgeChange> {
  let existing = pendingByEntity.get(entityId)
  if (!existing) {
    existing = new Map()
    pendingByEntity.set(entityId, existing)
  }
  return existing
}

/** Record that, from `entityId`'s perspective, `otherRef` was added/removed. */
export function recordOptimisticEdgeChange(
  entityId: string,
  otherRef: RelationEntityRef,
  action: "add" | "remove",
): void {
  bucket(entityId).set(otherRef.id, { action, ref: otherRef, expiresAt: Date.now() + TTL_MS })
}

/** Apply any still-fresh pending changes for `entityId` on top of freshly loaded edges. */
export function applyOptimisticOverrides(entityId: string, edges: RelationEntityRef[]): RelationEntityRef[] {
  const pending = pendingByEntity.get(entityId)
  if (!pending || pending.size === 0) return edges

  const now = Date.now()
  const byId = new Map(edges.map((edge) => [edge.id, edge]))
  for (const [otherId, change] of pending) {
    if (change.expiresAt < now) {
      pending.delete(otherId)
      continue
    }
    if (change.action === "remove") byId.delete(otherId)
    else byId.set(otherId, change.ref)
  }
  if (pending.size === 0) pendingByEntity.delete(entityId)
  return [...byId.values()]
}
