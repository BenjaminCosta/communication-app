/**
 * Development-only Firebase listener metrics.
 *
 * Enable with NEXT_PUBLIC_FIREBASE_DEBUG_METRICS=true. Metrics deliberately
 * contain only labels, counts, cache state, and timing — never document IDs or
 * Firestore payloads.
 */

const ENABLED = process.env.NEXT_PUBLIC_FIREBASE_DEBUG_METRICS === "true"

type ChangeType = "added" | "modified" | "removed"

interface SnapshotMetricSource {
  size: number
  docChanges: () => Array<{ type: ChangeType }>
  metadata?: { fromCache?: boolean }
}
interface FirebaseMetric {
  name: string
  event: "snapshot" | "load" | "error"
  elapsedMs: number
  snapshotNumber?: number
  documentCount?: number
  added?: number
  modified?: number
  removed?: number
  fromCache?: boolean
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now()
}

function emit(metric: FirebaseMetric): void {
  if (!ENABLED) return
  console.debug("[firebase-metrics]", metric)
}

export function createSnapshotMetric(name: string): (snapshot: SnapshotMetricSource) => void {
  if (!ENABLED) return () => {}
  const startedAt = now()
  let snapshotNumber = 0

  return (snapshot) => {
    snapshotNumber += 1
    const changes = snapshot.docChanges()
    emit({
      name,
      event: "snapshot",
      elapsedMs: Math.round(now() - startedAt),
      snapshotNumber,
      documentCount: snapshot.size,
      added: changes.filter((change) => change.type === "added").length,
      modified: changes.filter((change) => change.type === "modified").length,
      removed: changes.filter((change) => change.type === "removed").length,
      fromCache: snapshot.metadata?.fromCache === true,
    })
  }
}

export function createLoadMetric(name: string): (documentCount?: number) => void {
  if (!ENABLED) return () => {}
  const startedAt = now()
  return (documentCount) => {
    emit({
      name,
      event: "load",
      elapsedMs: Math.round(now() - startedAt),
      documentCount,
    })
  }
}

export function recordFirebaseMetricError(name: string): void {
  emit({ name, event: "error", elapsedMs: 0 })
}
