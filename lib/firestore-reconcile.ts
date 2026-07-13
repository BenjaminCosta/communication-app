import {
  getDocsFromServer,
  onSnapshot,
  type DocumentData,
  type Query,
  type QuerySnapshot,
  type Unsubscribe,
} from "firebase/firestore"

/**
 * Firestore persistent cache occasionally leaves an iOS PWA listener on a
 * stale first snapshot. Give the normal listener time to reach the backend and
 * only pay for a forced server read when it remains cache-only.
 */
export function subscribeWithServerReconcile(
  target: Query<DocumentData>,
  onChange: (snapshot: QuerySnapshot<DocumentData>) => void,
  onError?: (error: Error) => void,
  timeoutMs = 1_500,
): Unsubscribe {
  let sawServerSnapshot = false
  let closed = false
  const timer = window.setTimeout(() => {
    if (!closed && !sawServerSnapshot) {
      getDocsFromServer(target)
        .then((snapshot) => {
          if (closed || sawServerSnapshot) return
          sawServerSnapshot = true
          onChange(snapshot)
        })
        .catch(() => {})
    }
  }, timeoutMs)
  const unsubscribe = onSnapshot(
    target,
    { includeMetadataChanges: true },
    (snapshot) => {
      if (!snapshot.metadata.fromCache) {
        sawServerSnapshot = true
        window.clearTimeout(timer)
      }
      onChange(snapshot)
    },
    (error) => onError?.(error),
  )
  return () => {
    closed = true
    window.clearTimeout(timer)
    unsubscribe()
  }
}
