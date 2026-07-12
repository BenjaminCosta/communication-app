import {
  collection,
  deleteDoc,
  doc,
  getDocsFromServer,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  type Query,
  type Unsubscribe,
} from "firebase/firestore"
import { db } from "@/lib/firebase"

// Multi-tab persistent local cache can serve a listener's first snapshot from
// a stale/empty on-device cache before it reconciles with the backend
// (observed on iOS PWA installs). Force one server round-trip alongside the
// listener so a stale cache gets corrected immediately instead of waiting on
// the SDK's own reconnect timing — the fetched docs land in the same local
// cache the listener reads from, so this doesn't need its own onChange call.
function primeFromServer(target: Query): void {
  getDocsFromServer(target).catch(() => {})
}

export function subscribeDirectoryFavorites(
  userId: string,
  onChange: (ids: string[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  const favoritesQuery = query(
    collection(db, "users", userId, "directoryFavorites"),
    orderBy("favoritedAt", "desc"),
  )
  primeFromServer(favoritesQuery)
  return onSnapshot(
    favoritesQuery,
    (snapshot) => onChange(snapshot.docs.map((entry) => entry.id)),
    (error) => onError?.(error),
  )
}

export function subscribeDirectoryRecents(
  userId: string,
  onChange: (ids: string[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  const recentsQuery = query(
    collection(db, "users", userId, "directoryRecents"),
    orderBy("viewedAt", "desc"),
    limit(3),
  )
  primeFromServer(recentsQuery)
  return onSnapshot(
    recentsQuery,
    (snapshot) => onChange(snapshot.docs.map((entry) => entry.id)),
    (error) => onError?.(error),
  )
}

export async function setDirectoryFavorite(userId: string, directoryId: string, isFavorite: boolean): Promise<void> {
  const favoriteRef = doc(db, "users", userId, "directoryFavorites", directoryId)
  if (!isFavorite) {
    await deleteDoc(favoriteRef)
    return
  }
  await setDoc(favoriteRef, {
    directoryId,
    favoritedAt: serverTimestamp(),
  })
}

export async function recordDirectoryRecent(userId: string, directoryId: string): Promise<void> {
  await setDoc(doc(db, "users", userId, "directoryRecents", directoryId), {
    directoryId,
    viewedAt: serverTimestamp(),
  })
}
