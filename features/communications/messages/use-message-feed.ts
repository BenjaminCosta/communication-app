"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  collection,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  startAfter,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase/firestore"
import { db } from "@/lib/firebase"
import { createLoadMetric, createSnapshotMetric, recordFirebaseMetricError } from "@/lib/firebase-dev-metrics"
import type { Message } from "@/lib/store"
import { mapMessageDocument, mergeMessageFeed } from "./message-feed-model"

interface UseMessageFeedOptions {
  userId?: string
  projectIds: string[]
}

interface UseMessageFeedResult {
  messages: Message[]
  isLoaded: boolean
  isPaginated: boolean
  hasOlderMessages: boolean
  isLoadingOlderMessages: boolean
  loadOlderMessages: () => Promise<void>
}

const USE_PAGINATED_MESSAGE_FEED = process.env.NEXT_PUBLIC_USE_PAGINATED_MESSAGE_FEED === "true"
const MESSAGE_PAGE_SIZE = 75

/**
 * Owns both message-feed strategies. Legacy is the default. The canonical
 * paginated strategy is opt-in and automatically falls back for the current
 * user when its query cannot attach (for example, while its index is missing).
 */
export function useMessageFeed({ userId, projectIds }: UseMessageFeedOptions): UseMessageFeedResult {
  const [participantMessages, setParticipantMessages] = useState<Message[]>([])
  const [projectMessages, setProjectMessages] = useState<Message[]>([])
  const [visibleMessages, setVisibleMessages] = useState<Message[]>([])
  const [legacyLoaded, setLegacyLoaded] = useState(false)
  const [listenerKey, setListenerKey] = useState(0)
  const [canonicalFailureUserId, setCanonicalFailureUserId] = useState<string | null>(null)
  const [recentMessages, setRecentMessages] = useState<Message[]>([])
  const [historicalMessages, setHistoricalMessages] = useState<Message[]>([])
  const [canonicalLoaded, setCanonicalLoaded] = useState(false)
  const [hasOlderMessages, setHasOlderMessages] = useState(false)
  const [isLoadingOlderMessages, setIsLoadingOlderMessages] = useState(false)
  const recentCursorRef = useRef<QueryDocumentSnapshot<DocumentData> | null>(null)
  const historyCursorRef = useRef<QueryDocumentSnapshot<DocumentData> | null>(null)
  const loadingOlderRef = useRef(false)
  const activeUserIdRef = useRef(userId)
  activeUserIdRef.current = userId
  const projectIdsKey = JSON.stringify(projectIds.slice(0, 30))
  const canonicalEnabled = Boolean(
    USE_PAGINATED_MESSAGE_FEED && userId && canonicalFailureUserId !== userId,
  )

  useEffect(() => {
    if (!userId || canonicalEnabled) {
      setParticipantMessages([])
      setVisibleMessages([])
      setLegacyLoaded(false)
      return
    }

    setParticipantMessages([])
    setVisibleMessages([])
    setLegacyLoaded(false)
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    const participantMetric = createSnapshotMetric("messages.participants")
    const visibleMetric = createSnapshotMetric("messages.visibleToUserIds")

    const participantQuery = query(
      collection(db, "messages"),
      where("participants", "array-contains", userId),
    )
    const participantUnsubscribe = onSnapshot(participantQuery, (snapshot) => {
      participantMetric(snapshot)
      setParticipantMessages(snapshot.docs.map((entry) => mapMessageDocument(entry.id, entry.data())))
      setLegacyLoaded(true)
    }, () => {
      recordFirebaseMetricError("messages.participants")
      setLegacyLoaded(true)
      retryTimer = setTimeout(() => setListenerKey((key) => key + 1), 3000)
    })

    const visibleQuery = query(
      collection(db, "messages"),
      where("visibleToUserIds", "array-contains", userId),
    )
    const visibleUnsubscribe = onSnapshot(visibleQuery, (snapshot) => {
      visibleMetric(snapshot)
      setVisibleMessages(snapshot.docs.map((entry) => mapMessageDocument(entry.id, entry.data())))
      setLegacyLoaded(true)
    }, () => {
      recordFirebaseMetricError("messages.visibleToUserIds")
      setVisibleMessages([])
      setLegacyLoaded(true)
    })

    return () => {
      if (retryTimer) clearTimeout(retryTimer)
      participantUnsubscribe()
      visibleUnsubscribe()
    }
  }, [canonicalEnabled, listenerKey, userId])

  useEffect(() => {
    if (!userId || canonicalEnabled) {
      setProjectMessages([])
      return
    }
    const boundedProjectIds = JSON.parse(projectIdsKey) as string[]
    if (boundedProjectIds.length === 0) {
      setProjectMessages([])
      return
    }

    const projectMetric = createSnapshotMetric("messages.projectId")
    const projectQuery = query(
      collection(db, "messages"),
      where("projectId", "in", boundedProjectIds),
    )
    const unsubscribe = onSnapshot(projectQuery, (snapshot) => {
      projectMetric(snapshot)
      setProjectMessages(snapshot.docs.map((entry) => mapMessageDocument(entry.id, entry.data())))
    }, () => {
      recordFirebaseMetricError("messages.projectId")
      setProjectMessages([])
    })
    return () => {
      unsubscribe()
      setProjectMessages([])
    }
  }, [canonicalEnabled, projectIdsKey, userId])

  useEffect(() => {
    if (!canonicalEnabled || !userId) {
      setRecentMessages([])
      setHistoricalMessages([])
      setCanonicalLoaded(false)
      setHasOlderMessages(false)
      setIsLoadingOlderMessages(false)
      recentCursorRef.current = null
      historyCursorRef.current = null
      loadingOlderRef.current = false
      return
    }

    setRecentMessages([])
    setHistoricalMessages([])
    setCanonicalLoaded(false)
    setHasOlderMessages(false)
    recentCursorRef.current = null
    historyCursorRef.current = null
    const recentMetric = createSnapshotMetric("messages.canonical.recent")
    const recentQuery = query(
      collection(db, "messages"),
      where("visibleToUserIds", "array-contains", userId),
      orderBy("timestamp", "desc"),
      limit(MESSAGE_PAGE_SIZE),
    )

    const unsubscribe = onSnapshot(recentQuery, (snapshot) => {
      recentMetric(snapshot)
      recentCursorRef.current = snapshot.docs.at(-1) ?? null
      setRecentMessages(snapshot.docs.map((entry) => mapMessageDocument(entry.id, entry.data())))
      setHasOlderMessages(snapshot.size === MESSAGE_PAGE_SIZE)
      setCanonicalLoaded(true)
    }, () => {
      recordFirebaseMetricError("messages.canonical.recent")
      setCanonicalLoaded(true)
      setCanonicalFailureUserId(userId)
    })

    return unsubscribe
  }, [canonicalEnabled, userId])

  const loadOlderMessages = useCallback(async (): Promise<void> => {
    if (!canonicalEnabled || !userId || loadingOlderRef.current) return
    const cursor = historyCursorRef.current ?? recentCursorRef.current
    if (!cursor) {
      setHasOlderMessages(false)
      return
    }

    loadingOlderRef.current = true
    setIsLoadingOlderMessages(true)
    const loadMetric = createLoadMetric("messages.canonical.older")
    try {
      const olderQuery = query(
        collection(db, "messages"),
        where("visibleToUserIds", "array-contains", userId),
        orderBy("timestamp", "desc"),
        startAfter(cursor),
        limit(MESSAGE_PAGE_SIZE),
      )
      const snapshot = await getDocs(olderQuery)
      if (activeUserIdRef.current !== userId) return
      loadMetric(snapshot.size)
      historyCursorRef.current = snapshot.docs.at(-1) ?? historyCursorRef.current
      const page = snapshot.docs.map((entry) => mapMessageDocument(entry.id, entry.data()))
      setHistoricalMessages((current) => {
        const byId = new Map(current.map((message) => [message.id, message]))
        page.forEach((message) => byId.set(message.id, message))
        return [...byId.values()]
      })
      setHasOlderMessages(snapshot.size === MESSAGE_PAGE_SIZE)
    } catch {
      recordFirebaseMetricError("messages.canonical.older")
    } finally {
      loadingOlderRef.current = false
      setIsLoadingOlderMessages(false)
    }
  }, [canonicalEnabled, userId])

  const legacyMessages = useMemo(() => mergeMessageFeed({
    participantMessages,
    projectMessages,
    visibleMessages,
  }, userId), [participantMessages, projectMessages, userId, visibleMessages])

  const canonicalMessages = useMemo(() => mergeMessageFeed({
    participantMessages: [],
    projectMessages: [],
    visibleMessages: [...historicalMessages, ...recentMessages],
  }, userId), [historicalMessages, recentMessages, userId])

  return {
    messages: canonicalEnabled ? canonicalMessages : legacyMessages,
    isLoaded: canonicalEnabled ? canonicalLoaded : legacyLoaded,
    isPaginated: canonicalEnabled,
    hasOlderMessages: canonicalEnabled && hasOlderMessages,
    isLoadingOlderMessages: canonicalEnabled && isLoadingOlderMessages,
    loadOlderMessages,
  }
}
