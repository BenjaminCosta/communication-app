import {
  collection,
  deleteDoc,
  doc,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  type Unsubscribe,
} from "firebase/firestore"
import { db } from "@/lib/firebase"
import { subscribeWithServerReconcile } from "@/lib/firestore-reconcile"

export function subscribeDirectoryFavorites(
  userId: string,
  onChange: (ids: string[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  const favoritesQuery = query(
    collection(db, "users", userId, "directoryFavorites"),
    orderBy("favoritedAt", "desc"),
  )
  return subscribeWithServerReconcile(
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
  return subscribeWithServerReconcile(
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
