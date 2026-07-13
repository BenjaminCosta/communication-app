"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import {
  recordDirectoryRecent,
  setDirectoryFavorite,
  subscribeDirectoryFavorites,
  subscribeDirectoryRecents,
} from "@/lib/directory-user-state"

interface DirectoryUserStateValue {
  favoriteIds: string[]
  recentIds: string[]
  favoritesLoading: boolean
  recentsLoading: boolean
  toggleFavorite: (directoryId: string) => Promise<void>
  recordRecent: (directoryId: string) => void
}

const DirectoryUserStateContext = createContext<DirectoryUserStateValue | null>(null)

export function DirectoryStateProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [favoriteIds, setFavoriteIds] = useState<string[]>([])
  const [recentIds, setRecentIds] = useState<string[]>([])
  const [favoritesLoading, setFavoritesLoading] = useState(true)
  const [recentsLoading, setRecentsLoading] = useState(true)
  const favoriteIdsRef = useRef(favoriteIds)

  useEffect(() => {
    favoriteIdsRef.current = favoriteIds
  }, [favoriteIds])

  useEffect(() => {
    setFavoritesLoading(true)
    return subscribeDirectoryFavorites(
      userId,
      (ids) => { favoriteIdsRef.current = ids; setFavoriteIds(ids); setFavoritesLoading(false) },
      () => setFavoritesLoading(false),
    )
  }, [userId])

  useEffect(() => {
    setRecentsLoading(true)
    return subscribeDirectoryRecents(
      userId,
      (ids) => { setRecentIds(ids); setRecentsLoading(false) },
      () => setRecentsLoading(false),
    )
  }, [userId])

  const toggleFavorite = useCallback(async (directoryId: string) => {
    const wasFavorite = favoriteIdsRef.current.includes(directoryId)
    const optimistic = wasFavorite
      ? favoriteIdsRef.current.filter((id) => id !== directoryId)
      : [directoryId, ...favoriteIdsRef.current]
    favoriteIdsRef.current = optimistic
    setFavoriteIds(optimistic)
    try {
      await setDirectoryFavorite(userId, directoryId, !wasFavorite)
    } catch (error) {
      const reverted = wasFavorite
        ? [directoryId, ...favoriteIdsRef.current.filter((id) => id !== directoryId)]
        : favoriteIdsRef.current.filter((id) => id !== directoryId)
      favoriteIdsRef.current = reverted
      setFavoriteIds(reverted)
      throw error
    }
  }, [userId])

  const recordRecent = useCallback((directoryId: string) => {
    setRecentIds((current) => [directoryId, ...current.filter((id) => id !== directoryId)].slice(0, 3))
    recordDirectoryRecent(userId, directoryId).catch(() => {})
  }, [userId])

  const value = useMemo(() => ({
    favoriteIds,
    recentIds,
    favoritesLoading,
    recentsLoading,
    toggleFavorite,
    recordRecent,
  }), [favoriteIds, recentIds, favoritesLoading, recentsLoading, toggleFavorite, recordRecent])

  return <DirectoryUserStateContext.Provider value={value}>{children}</DirectoryUserStateContext.Provider>
}

export function useDirectoryUserState(): DirectoryUserStateValue {
  const value = useContext(DirectoryUserStateContext)
  if (!value) throw new Error("useDirectoryUserState must be used inside DirectoryStateProvider")
  return value
}
