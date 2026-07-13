"use client"

import { useState, useCallback, useRef, useEffect, useMemo } from "react"
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  type AuthCredential,
  GoogleAuthProvider,
  linkWithCredential,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth"
import { FirebaseError } from "firebase/app"
import {
  collection,
  doc,
  getDoc,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  onSnapshot,
  query,
  where,
  serverTimestamp,
  Timestamp,
  arrayUnion,
  arrayRemove,
  deleteField,
} from "firebase/firestore"
import { auth, db, getStorageLazy } from "@/lib/firebase"
import { loadEntityCatalog, type DirectorySearchIndex } from "@/lib/directory-search"
import { appContextsFromCatalog, importedContactsFromCatalog } from "@/lib/entity-catalog-adapters"
import { registerFCMToken, onForegroundMessage, type NotificationPreference } from "@/lib/fcm"
// image-upload loaded lazily in handleSend (only when uploading images)
import dynamic from "next/dynamic"
import { haptic, getUserAvatarColor } from "@/lib/utils"
// Critical path — loaded immediately (login → compose → stream)
import { StreamScreen } from "@/components/stream-screen"
import { ComposeScreen } from "@/components/compose-screen"
import { LoginScreen } from "@/components/login-screen"
import { AppScreenSkeleton, LaunchLoadingScreen } from "@/components/app-loading-screen"
import { ToastNotification } from "@/components/toast-notification"
import { DirectoryStateProvider } from "@/components/directory/directory-state-provider"
// Secondary screens — lazy-loaded on demand (code splitting)
const TagSheet = dynamic(() => import("@/components/tag-sheet").then((m) => ({ default: m.TagSheet })), { ssr: false })
const RegisterScreen = dynamic(() => import("@/components/register-screen").then((m) => ({ default: m.RegisterScreen })), { ssr: false })
const ProfileScreen = dynamic(() => import("@/components/profile-screen").then((m) => ({ default: m.ProfileScreen })), { ssr: false })
const ProjectListScreen = dynamic(() => import("@/components/project-list-screen").then((m) => ({ default: m.ProjectListScreen })), { ssr: false })
const ProjectDetailScreen = dynamic(() => import("@/components/project-detail-screen").then((m) => ({ default: m.ProjectDetailScreen })), { ssr: false })
const NotificationsScreen = dynamic(() => import("@/components/notifications-screen").then((m) => ({ default: m.NotificationsScreen })), { ssr: false })
const PeopleScreen = dynamic(() => import("@/components/people-screen").then((m) => ({ default: m.PeopleScreen })), { ssr: false })
const AdminScreen = dynamic(() => import("@/components/admin-screen").then((m) => ({ default: m.AdminScreen })), { ssr: false })
const CalendarScreen = dynamic(() => import("@/components/calendar-screen").then((m) => ({ default: m.CalendarScreen })), { ssr: false })
const ContextsScreen = dynamic(() => import("@/components/contexts-screen").then((m) => ({ default: m.ContextsScreen })), { ssr: false })
const ContextDetailScreen = dynamic(() => import("@/components/context-detail-screen").then((m) => ({ default: m.ContextDetailScreen })), { ssr: false })
const DirectoryScreen = dynamic(() => import("@/components/directory/directory-screen").then((m) => ({ default: m.DirectoryScreen })), { ssr: false })
const DirectoryProfileScreen = dynamic(() => import("@/components/directory/directory-profile-screen").then((m) => ({ default: m.DirectoryProfileScreen })), { ssr: false })
const HelpScreen = dynamic(() => import("@/components/help-screen").then((m) => ({ default: m.HelpScreen })), { ssr: false })
const NotificationPromptBanner = dynamic(() => import("@/components/notification-prompt-banner").then((m) => ({ default: m.NotificationPromptBanner })), { ssr: false })
import {
  type Message,
  type MessageDraft,
  type MessageType,
  type Project,
  type Contact,
  type ImportedContact,
  type TagCategory,
  type AppContext,
  PROJECT_COLORS,
  USER_COLORS,
  deriveNameFromEmail,
  deriveInitials,
  generateProjectId,
  getMessageProjectIds,
  getMessagePeopleIds,
  getMessageTagIds,
  getLegacyProjectIdsFromTagIds,
  getLegacyTypeFromTagIds,
  getAvailableTags,
  messageHasProject,
  messageHasTags,
  projectTagId,
  sortTagsByActivity,
  computeVisibleToUserIds,
  normalizeEmail,
  type CategoryItem,
} from "@/lib/store"

const USE_DIRECTORY_CATALOG = process.env.NEXT_PUBLIC_USE_DIRECTORY_CATALOG === "true"

type Screen =
  | "loading"
  | "login"
  | "register"
  | "stream"
  | "compose"
  | "tag"
  | "profile"
  | "notifications"
  | "projects"
  | "project-detail"
  | "people"
  | "admin"
  | "calendar"
  | "contexts"
  | "context-detail"
  | "directory"
  | "directory-detail"
  | "help"

// Depth map — higher = further in the hierarchy
const SCREEN_DEPTH: Record<Screen, number> = {
  loading: -1,
  login: 0,
  register: 0,
  stream: 1,
  compose: 2,
  tag: 2,
  profile: 3,
  calendar: 3,
  notifications: 4,
  projects: 4,
  people: 4,
  admin: 4,
  help: 4,
  "project-detail": 5,
  contexts: 4,
  "context-detail": 5,
  directory: 1,
  "directory-detail": 2,
}

// Remembers which module (Communications vs Directory) the user was last in,
// so reopening the app resumes there instead of always defaulting to Comms.
const LAST_MODULE_KEY = "svc-last-module"
type SvcModuleName = "communications" | "directory"

function getLastModule(): SvcModuleName | null {
  if (typeof window === "undefined") return null
  const lastModule = localStorage.getItem(LAST_MODULE_KEY) === "directory" ? "directory" : null
  if (lastModule) document.cookie = `${LAST_MODULE_KEY}=directory; path=/; max-age=31536000; samesite=lax`
  return lastModule
}

function persistLastModule(screen: Screen): void {
  if (typeof window === "undefined") return
  let module: SvcModuleName | null = null
  if (screen === "directory" || screen === "directory-detail") {
    module = "directory"
  } else if (screen !== "loading" && screen !== "login" && screen !== "register") {
    module = "communications"
  }
  if (!module) return
  localStorage.setItem(LAST_MODULE_KEY, module)
  document.cookie = `${LAST_MODULE_KEY}=${module}; path=/; max-age=31536000; samesite=lax`
}

interface ToastState {
  message: string
  action?: { label: string; onClick: () => void }
  duration?: number
  key: number
}

function toDate(value: unknown): Date {
  if (value instanceof Timestamp) return value.toDate()
  if (value instanceof Date) return value
  if (typeof value === "number" || typeof value === "string") return new Date(value)
  return new Date()
}

function mapMessageDoc(id: string, data: Record<string, any>): Message {
  const senderId = data.senderId ?? data.authorId ?? ""
  const projectIds = Array.isArray(data.projectIds)
    ? data.projectIds.filter(Boolean)
    : [data.projectId ?? data.project_id].filter(Boolean)
  const timestamp = toDate(data.timestamp ?? data.createdAt)

  return {
    id,
    senderId,
    authorId: data.authorId ?? senderId,
    participants: Array.isArray(data.participants) ? data.participants : [senderId].filter(Boolean),
    visibleToUserIds: Array.isArray(data.visibleToUserIds) ? data.visibleToUserIds.filter(Boolean) : undefined,
    recipientIds: Array.isArray(data.recipientIds) ? data.recipientIds.filter(Boolean) : [],
    peopleIds: Array.isArray(data.peopleIds)
      ? data.peopleIds.filter(Boolean)
      : (Array.isArray(data.recipientIds) ? data.recipientIds.filter(Boolean) : []),
    projectId: data.projectId ?? data.project_id ?? projectIds[0] ?? null,
    projectIds,
    project_id: data.project_id ?? null,
    tagIds: Array.isArray(data.tagIds) ? data.tagIds.filter(Boolean) : undefined,
    text: data.text ?? data.content ?? "",
    content: data.content ?? data.text ?? "",
    type: (data.type ?? "none") as MessageType,
    timestamp,
    createdAt: toDate(data.createdAt ?? data.timestamp),
    updatedAt: toDate(data.updatedAt ?? data.timestamp),
    isFavorited: data.isFavorited ?? false,
    contactIds: Array.isArray(data.contactIds) ? data.contactIds.filter(Boolean) : [],
    contextIds: Array.isArray(data.contextIds) ? data.contextIds.filter(Boolean) : [],
    imageUrl: data.imageUrl,
    imagePath: data.imagePath,
    imageName: data.imageName,
    imageContentType: data.imageContentType,
    imageSize: typeof data.imageSize === "number" ? data.imageSize : undefined,
    imageWidth: typeof data.imageWidth === "number" ? data.imageWidth : undefined,
    imageHeight: typeof data.imageHeight === "number" ? data.imageHeight : undefined,
    imageBlurHash: typeof data.imageBlurHash === "string" ? data.imageBlurHash : undefined,
    imageUploadedAt: data.imageUploadedAt ? toDate(data.imageUploadedAt) : undefined,
    calendarDates: Array.isArray(data.calendarDates)
      ? data.calendarDates
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((d: any) => ({
            id: String(d.id ?? ""),
            date: String(d.date ?? ""),
            createdAt: d.createdAt instanceof Timestamp ? d.createdAt.toDate() : new Date(),
            createdBy: String(d.createdBy ?? ""),
          }))
          .filter((d: { date: string }) => !!d.date)
      : undefined,
    replyToId: typeof data.replyToId === "string" ? data.replyToId : undefined,
    replyPreview: data.replyPreview && typeof data.replyPreview === "object"
      ? {
          messageId: String(data.replyPreview.messageId ?? ""),
          authorId: String(data.replyPreview.authorId ?? ""),
          authorName: String(data.replyPreview.authorName ?? ""),
          text: String(data.replyPreview.text ?? ""),
        }
      : undefined,
  }
}

function sanitizeStorageName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 90) || "image"
}

function resolveLinkedImportedContactUserIds(importedContactIds: string[], importedContacts: ImportedContact[]): string[] {
  if (importedContactIds.length === 0) return []
  const contactsById = new Map(importedContacts.map((contact) => [contact.id, contact]))
  return importedContactIds
    .map((id) => contactsById.get(id)?.linkedUserId)
    .filter((id): id is string => !!id)
}

function mapImportedContactDoc(id: string, data: Record<string, any>): ImportedContact {
  return {
    id,
    ownerUserId: data.ownerUserId,
    name: data.name,
    email: data.email ?? undefined,
    emailNormalized: data.emailNormalized ?? undefined,
    phone: data.phone ?? undefined,
    phoneNormalized: data.phoneNormalized ?? undefined,
    source: data.source ?? "manual",
    tags: Array.isArray(data.tags) ? data.tags : [],
    emails: Array.isArray(data.emails) ? data.emails : undefined,
    phones: Array.isArray(data.phones) ? data.phones : undefined,
    emailNormalizedCandidates: Array.isArray(data.emailNormalizedCandidates) ? data.emailNormalizedCandidates : undefined,
    company: data.company ?? undefined,
    companies: Array.isArray(data.companies) ? data.companies : undefined,
    role: data.role ?? undefined,
    roles: Array.isArray(data.roles) ? data.roles : undefined,
    notes: data.notes ?? undefined,
    addresses: Array.isArray(data.addresses) ? data.addresses : undefined,
    urls: Array.isArray(data.urls) ? data.urls : undefined,
    importBatchId: data.importBatchId ?? undefined,
    sourceSheet: data.sourceSheet ?? undefined,
    sourceRecordId: data.sourceRecordId ?? undefined,
    sourceDatabaseFile: data.sourceDatabaseFile ?? undefined,
    sourceCompanyId: data.sourceCompanyId ?? undefined,
    sourcePositionId: data.sourcePositionId ?? undefined,
    linkedUserId: data.linkedUserId ?? null,
    linkedAt: data.linkedAt instanceof Timestamp ? data.linkedAt.toDate() : null,
    status: data.status ?? "not_registered",
    // Contacts are global-only for now — default any legacy/unset doc to global.
    visibility: data.visibility ?? "global",
    createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toDate() : new Date(),
    updatedAt: data.updatedAt instanceof Timestamp ? data.updatedAt.toDate() : new Date(),
  } as ImportedContact
}

export default function Home() {
  // ── Auth ──────────────────────────────────────────────────────────────
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null)
  const [currentUser, setCurrentUser] = useState<Contact | null>(null)
  const [pendingGoogleLinkEmail, setPendingGoogleLinkEmail] = useState<string | null>(null)
  const pendingGoogleCredentialRef = useRef<AuthCredential | null>(null)

  // ── Firestore data ────────────────────────────────────────────────────
  const [contacts, setContacts] = useState<Contact[]>([])
  const [participantMessages, setParticipantMessages] = useState<Message[]>([])
  const [projectMessages, setProjectMessages] = useState<Message[]>([])
  const [visibleMessages, setVisibleMessages] = useState<Message[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [customCategories, setCustomCategories] = useState<CategoryItem[]>([])
  const [globalImportedContacts, setGlobalImportedContacts] = useState<ImportedContact[]>([])
  const [appContexts, setAppContexts] = useState<AppContext[]>([])
  const [catalogIndex, setCatalogIndex] = useState<DirectorySearchIndex | null>(null)
  const [selectedContextId, setSelectedContextId] = useState<string | null>(null)
  const [selectedContextData, setSelectedContextData] = useState<AppContext | null>(null)
  const [selectedContextLoading, setSelectedContextLoading] = useState(false)
  const [selectedDirectoryId, setSelectedDirectoryId] = useState<string | null>(null)
  // Loading flags — false until first snapshot arrives (prevents empty-state flash)
  const [contactsLoaded, setContactsLoaded] = useState(false)
  const [contextsLoaded, setContextsLoaded] = useState(false)
  const [messagesLoaded, setMessagesLoaded] = useState(false)

  const importedContacts = useMemo(() => {
    const byId = new Map<string, ImportedContact>()
    globalImportedContacts.forEach((contact) => {
      byId.set(contact.id, contact)
    })
    return [...byId.values()]
  }, [globalImportedContacts])

  // Merged feed: union of all message sources, deduped by ID.
  // participantMessages = legacy query (array-contains participants)
  // projectMessages     = legacy query (array-contains projectId)
  // visibleMessages     = new query (array-contains visibleToUserIds)
  //
  // IMPORTANT: after merging, apply a client-side visibility gate.
  // If a message has visibleToUserIds, that field is the source of truth.
  // Even if the message arrived via the legacy participants/projectId listeners,
  // we must NOT show it to users not listed in visibleToUserIds.
  // This is what prevents Case E (corrupted participants=allUids) from leaking.
  const messages = useMemo(() => {
    const byId = new Map<string, Message>()
    participantMessages.forEach((m) => byId.set(m.id, m))
    projectMessages.forEach((m) => byId.set(m.id, m))
    visibleMessages.forEach((m) => byId.set(m.id, m))
    const uid = firebaseUser?.uid
    return [...byId.values()]
      .filter((m) => {
        // If visibleToUserIds exists → it decides. Exclude if current user not in it.
        if (uid && Array.isArray(m.visibleToUserIds)) {
          return m.visibleToUserIds.includes(uid)
        }
        // Legacy: no visibleToUserIds yet → trust what the listener returned
        return true
      })
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
  }, [participantMessages, projectMessages, visibleMessages, firebaseUser])

  const recentUserMessages = useMemo(
    () => messages.filter((m) => m.senderId === firebaseUser?.uid).slice(-20).reverse(),
    [messages, firebaseUser?.uid]
  )

  // ── Navigation ────────────────────────────────────────────────────────
  const [activeScreen, setActiveScreen] = useState<Screen>("loading")
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null)
  const [activeFilter, setActiveFilter] = useState<string>("all")
  const [selectedPeopleFilter, setSelectedPeopleFilter] = useState<string[]>([])
  const [selectedTagFilter, setSelectedTagFilter] = useState<string[]>([])
  const [selectedDateFilter, setSelectedDateFilter] = useState<string[]>([])
  const [selectedContextFilter, setSelectedContextFilter] = useState<string[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const nextColorIndex = useRef(0)
  const [listenerKey, setListenerKey] = useState(0)
  const [composeMode, setComposeMode] = useState<"fullscreen" | "sheet">("fullscreen")
  const [composeInitialProjectId, setComposeInitialProjectId] = useState<string | null>(null)
  const [calendarInitialDate, setCalendarInitialDate] = useState<string | null>(null)
  const notificationsReturnRef = useRef<Screen>("profile")
  const tagSourceScreenRef = useRef<Screen>("stream")

  // Directional transition tracking
  const prevScreenRef = useRef<Screen>("loading")
  const [entranceClass, setEntranceClass] = useState("animate-fade-in")
  const [calendarEntranceClass, setCalendarEntranceClass] = useState("animate-fade-in")
  const [showScreenSkeleton, setShowScreenSkeleton] = useState(false)
  const skeletonTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Notification preference (read from Firestore, updated by user)
  const [notifPreference, setNotifPreference] = useState<NotificationPreference>("instant")

  // Toast state
  const [toast, setToast] = useState<ToastState | null>(null)
  const toastKeyRef = useRef(0)

  const showToast = useCallback(
    (message: string, action?: { label: string; onClick: () => void }, duration?: number) => {
      toastKeyRef.current += 1
      setToast({ message, action, duration, key: toastKeyRef.current })
    },
    []
  )

  // ── Core navigation ───────────────────────────────────────────────────
  const navigateTo = useCallback((next: Screen) => {
    const prev = prevScreenRef.current
    let cls: string
    if (prev === "login" || prev === "register" || next === "login" || next === "register") {
      cls = "animate-fade-in"
    } else {
      const d = SCREEN_DEPTH[next] - SCREEN_DEPTH[prev]
      cls = d > 0 ? "animate-slide-in-right" : d < 0 ? "animate-slide-in-left" : "animate-fade-in"
    }
    setEntranceClass(cls)
    // Only update calendar's entrance class when truly navigating to it (not returning from tag overlay)
    if (next === "calendar" && prev !== "tag") setCalendarEntranceClass(cls)
    if (skeletonTimerRef.current) clearTimeout(skeletonTimerRef.current)
    const shouldSkeleton = prev !== "loading" && next === "project-detail"
    setShowScreenSkeleton(shouldSkeleton)
    if (shouldSkeleton) {
      skeletonTimerRef.current = setTimeout(() => setShowScreenSkeleton(false), 180)
    }
    prevScreenRef.current = next
    setActiveScreen(next)
    persistLastModule(next)
  }, [])

  useEffect(() => {
    return () => {
      if (skeletonTimerRef.current) clearTimeout(skeletonTimerRef.current)
    }
  }, [])

  // ── Auth state listener ───────────────────────────────────────────────
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) {
        setFirebaseUser(user)
        // Build preliminary currentUser from auth token (instant, no network)
        // The users collection listener will overwrite with Firestore data once it arrives
        const authName = user.displayName || deriveNameFromEmail(user.email ?? "")
        const authInitials = deriveInitials(authName)
        const authColor = getUserAvatarColor(user.uid)
        const emailNormalized = normalizeEmail(user.email)
        setCurrentUser({
          id: user.uid,
          name: authName,
          initials: authInitials,
          color: authColor,
          email: user.email ?? undefined,
          emailNormalized,
        })
        // Navigate immediately — don't block on Firestore. Default is Compose
        // (Communications), unless the user's last session was in Directory.
        navigateTo(getLastModule() === "directory" ? "directory" : "compose")
        // Background auth metadata update. Do not lead with a one-shot getDoc:
        // it can race the realtime listeners and trip Firebase's ca9/b815 bug.
        // Missing display fields are filled after the persistent users snapshot.
        const userRef = doc(db, "users", user.uid)
        setDoc(userRef, {
          id: user.uid,
          email: user.email ?? "",
          emailNormalized,
          emailVerified: user.emailVerified === true,
          authProviderIds: user.providerData.map((p) => p.providerId),
        }, { merge: true }).catch(() => {})
        // Register FCM token if notification permission was already granted
        if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
          registerFCMToken(user.uid).catch(() => {})
        }
      } else {
        setFirebaseUser(null)
        setCurrentUser(null)
        setContacts([])
        setParticipantMessages([])
        setProjectMessages([])
        setProjects([])
        setGlobalImportedContacts([])
        setCatalogIndex(null)
        setContactsLoaded(false)
        setContextsLoaded(false)
        setMessagesLoaded(false)
        setAppContexts([])
        navigateTo("login")
      }
    })
    return unsub
  }, [navigateTo])

  // ── Firestore listeners (only when authenticated) ──────────────────────
  useEffect(() => {
    if (!firebaseUser) return

    // Reset loading flags so skeletons show while new snapshots arrive
    setMessagesLoaded(false)

    // 1. All users (contacts = everyone except me)
    const usersUnsub = onSnapshot(collection(db, "users"), (snap) => {
      const all = snap.docs.map((d) => {
        const data = d.data()
        const resolvedEmail = data.email ?? (d.id === firebaseUser.uid ? firebaseUser.email : undefined)
        const resolvedName = data.name || deriveNameFromEmail(resolvedEmail ?? "")
        return {
          id: data.id ?? d.id,
          name: resolvedName,
          email: resolvedEmail ?? undefined,
          emailNormalized: data.emailNormalized ?? undefined,
          initials: data.initials || deriveInitials(resolvedName),
          color: data.color ?? getUserAvatarColor(d.id),
          lastSeen: data.lastSeen instanceof Timestamp ? data.lastSeen.toDate() : null,
          isAdmin: data.isAdmin === true,
        } as Contact
      })
      setContacts(all.filter((u) => u.id !== firebaseUser.uid))
      // Update currentUser profile from Firestore
      const me = all.find((u) => u.id === firebaseUser.uid)
      if (me) setCurrentUser(me)
      // Read notification preference from raw doc
      const meDoc = snap.docs.find((d) => d.id === firebaseUser.uid)
      if (meDoc) {
        const meData = meDoc.data()
        const pref = meData.notificationPreference
        setNotifPreference(pref === "muted" ? "muted" : "instant")
        const authName = firebaseUser.displayName || deriveNameFromEmail(firebaseUser.email ?? "")
        const missingProfileFields = {
          ...(!meData.name ? { name: authName } : {}),
          ...(!meData.initials ? { initials: deriveInitials(authName) } : {}),
          ...(!meData.color ? { color: getUserAvatarColor(firebaseUser.uid) } : {}),
        }
        if (Object.keys(missingProfileFields).length > 0) {
          setDoc(meDoc.ref, missingProfileFields, { merge: true }).catch(() => {})
        }
      }
    }, () => {})

    // 2. All projects (tags are global — visible to any authenticated user)
    const projectsUnsub = onSnapshot(collection(db, "projects"), (snap) => {
      setProjects(snap.docs.map((d) => d.data() as Project))
    }, () => {})

    // 2b. User-created categories
    // Filter out any docs whose name shadows a system category (prevents duplicates)
    const _systemNames = new Set(["project","status","date / time","report","task","custom","type"])
    const categoriesUnsub = onSnapshot(collection(db, "categories"), (snap) => {
      setCustomCategories(
        snap.docs
          .map((d) => ({
            id: d.id,
            name: d.data().name as string,
            isSystem: false,
            isTimeBased: d.data().isTimeBased ?? false,
          }))
          .filter((c) => !_systemNames.has(c.name.trim().toLowerCase()))
      )
    }, () => {})

    // 3. Messages where current user is a participant (legacy, kept for backward compat)
    const messagesQuery = query(
      collection(db, "messages"),
      where("participants", "array-contains", firebaseUser.uid)
    )
    const messagesUnsub = onSnapshot(messagesQuery, (snap) => {
      setParticipantMessages(snap.docs.map((d) => mapMessageDoc(d.id, d.data())))
      setMessagesLoaded(true)
    }, () => {
      // Restart all listeners after a brief delay if a permission error occurs
      setMessagesLoaded(true)
      setTimeout(() => setListenerKey((k) => k + 1), 3000)
    })

    // 4. Messages via visibleToUserIds (new visibility model — forward compat)
    const visibleQuery = query(
      collection(db, "messages"),
      where("visibleToUserIds", "array-contains", firebaseUser.uid)
    )
    const visibleUnsub = onSnapshot(visibleQuery, (snap) => {
      setVisibleMessages(snap.docs.map((d) => mapMessageDoc(d.id, d.data())))
      setMessagesLoaded(true)
    }, () => {
      setVisibleMessages([])
      setMessagesLoaded(true)
    })

    // 5. Imported contacts — all contacts are global; every authenticated user
    //    reads the whole collection (single listener, no visibility filter).
    const useCompactCatalog = USE_DIRECTORY_CATALOG
    const globalImportedContactsUnsub = useCompactCatalog
      ? () => {}
      : onSnapshot(collection(db, "contacts"), (snap) => {
          setGlobalImportedContacts(snap.docs.map((d) => mapImportedContactDoc(d.id, d.data())))
          setContactsLoaded(true)
        }, () => {
          setGlobalImportedContacts([])
          setContactsLoaded(true)
        })

    // 6. Contexts — global, no filter needed
    const contextsUnsub = useCompactCatalog ? () => {} : onSnapshot(collection(db, "contexts"), (snap) => {
      setAppContexts(snap.docs.map((d) => {
        const data = d.data()
        return {
          id: d.id,
          name: data.name ?? "",
          description: data.description || undefined,
          fields: Array.isArray(data.fields) ? data.fields : [],
          createdBy: data.createdBy ?? "",
          createdAt: toDate(data.createdAt),
          updatedAt: toDate(data.updatedAt),
          importBatchId: data.importBatchId ?? undefined,
          sourceSheet: data.sourceSheet ?? undefined,
          sourceRecordId: data.sourceRecordId ?? undefined,
          sourceDatabaseFile: data.sourceDatabaseFile ?? undefined,
        } as AppContext
      }))
      setContextsLoaded(true)
    }, () => {
      setAppContexts([])
      setContextsLoaded(true)
    })

    return () => {
      usersUnsub()
      projectsUnsub()
      categoriesUnsub()
      messagesUnsub()
      visibleUnsub()
      globalImportedContactsUnsub()
      contextsUnsub()
    }
  }, [firebaseUser, listenerKey])

  // Compact shared catalog: restores IndexedDB immediately, then revalidates
  // 32 deterministic shards. A tiny metadata listener refreshes it after
  // source writes without keeping /contacts or /contexts globally subscribed.
  useEffect(() => {
    if (!firebaseUser || !USE_DIRECTORY_CATALOG) return
    let active = true
    let firstMetaSnapshot = true
    let refreshTimer: number | null = null
    setContactsLoaded(false)
    setContextsLoaded(false)

    const applyCatalog = (index: DirectorySearchIndex) => {
      if (!active) return
      setCatalogIndex(index)
      setGlobalImportedContacts(importedContactsFromCatalog(index))
      setAppContexts(appContextsFromCatalog(index))
      setContactsLoaded(true)
      setContextsLoaded(true)
    }
    const refresh = () => {
      loadEntityCatalog(firebaseUser.uid, { onCache: applyCatalog })
        .then(applyCatalog)
        .catch(() => {
          if (!active) return
          setContactsLoaded(true)
          setContextsLoaded(true)
        })
    }
    refresh()
    const unsubscribe = onSnapshot(doc(db, "directoryMeta", "status"), () => {
      if (firstMetaSnapshot) { firstMetaSnapshot = false; return }
      if (refreshTimer) window.clearTimeout(refreshTimer)
      refreshTimer = window.setTimeout(refresh, 350)
    }, () => {})
    return () => {
      active = false
      if (refreshTimer) window.clearTimeout(refreshTimer)
      unsubscribe()
    }
  }, [firebaseUser])

  useEffect(() => {
    if (!selectedContextId || activeScreen !== "context-detail") return
    let active = true
    setSelectedContextLoading(true)
    getDoc(doc(db, "contexts", selectedContextId)).then((snapshot) => {
      if (!active || !snapshot.exists()) return
      const data = snapshot.data()
      setSelectedContextData({
        id: snapshot.id,
        name: data.name ?? "",
        description: data.description || undefined,
        fields: Array.isArray(data.fields) ? data.fields : [],
        fieldCount: Array.isArray(data.fields) ? data.fields.length : 0,
        createdBy: data.createdBy ?? "",
        createdAt: toDate(data.createdAt),
        updatedAt: toDate(data.updatedAt),
        importBatchId: data.importBatchId ?? undefined,
        sourceSheet: data.sourceSheet ?? undefined,
        sourceRecordId: data.sourceRecordId ?? undefined,
        sourceDatabaseFile: data.sourceDatabaseFile ?? undefined,
      })
    }).catch(() => {}).finally(() => {
      if (active) setSelectedContextLoading(false)
    })
    return () => { active = false }
  }, [activeScreen, selectedContextId])

  // Recovery scripts v1/v2 removed — they corrupted participants by setting
  // participants = allUids on every message. visibleToUserIds is now the
  // source of truth and is computed correctly per-message.

  useEffect(() => {
    if (!firebaseUser) return
    const userRef = doc(db, "users", firebaseUser.uid)
    const updateLastSeen = () => {
      setDoc(userRef, { lastSeen: serverTimestamp() }, { merge: true }).catch(() => {})
    }
    updateLastSeen()
    const interval = window.setInterval(updateLastSeen, 60000)
    const onVisibility = () => {
      if (document.visibilityState === "visible") updateLastSeen()
    }
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [firebaseUser])

  // ── Foreground FCM messages → in-app toast ────────────────────────────────
  useEffect(() => {
    if (!firebaseUser) return
    const unsub = onForegroundMessage((title, body) => {
      showToast(`${title}: ${body}`)
    })
    return unsub
  }, [firebaseUser, showToast])

  // ── Second listener: project-tagged messages (covers members not in participants) ──
  useEffect(() => {
    if (!firebaseUser || projects.length === 0) {
      setProjectMessages([])
      return
    }
    const projectIds = projects.map((p) => p.id).slice(0, 30) // Firestore 'in' max 30
    const projectMsgsQuery = query(
      collection(db, "messages"),
      where("projectId", "in", projectIds)
    )
    const unsub = onSnapshot(projectMsgsQuery, (snap) => {
      setProjectMessages(snap.docs.map((d) => mapMessageDoc(d.id, d.data())))
    }, () => { setProjectMessages([]) })
    return () => { unsub(); setProjectMessages([]) }
  }, [firebaseUser, projects])

  // ── Auth handlers ─────────────────────────────────────────────────────
  const handleLogin = useCallback(async (email: string, password: string) => {
    const cred = await signInWithEmailAndPassword(auth, email, password)
    const pendingGoogleCredential = pendingGoogleCredentialRef.current
    if (pendingGoogleCredential) {
      const signedInEmail = normalizeEmail(cred.user.email)
      const pendingEmail = normalizeEmail(pendingGoogleLinkEmail)
      if (pendingEmail && signedInEmail !== pendingEmail) {
        await signOut(auth)
        throw new Error("Sign in with the account that matches the Google email.")
      }

      try {
        const linked = await linkWithCredential(cred.user, pendingGoogleCredential)
        await linked.user.reload()
        await setDoc(doc(db, "users", linked.user.uid), {
          email: linked.user.email ?? "",
          emailNormalized: normalizeEmail(linked.user.email),
          emailVerified: linked.user.emailVerified === true,
          authProviderIds: linked.user.providerData.map((provider) => provider.providerId),
        }, { merge: true })
        pendingGoogleCredentialRef.current = null
        setPendingGoogleLinkEmail(null)
        showToast("Google sign-in linked ✓", undefined, 2500)
      } catch (error) {
        const code = error instanceof FirebaseError ? error.code : ""
        if (code === "auth/provider-already-linked" || code === "auth/credential-already-in-use") {
          pendingGoogleCredentialRef.current = null
          setPendingGoogleLinkEmail(null)
          return
        }
        throw error
      }
    }
    // onAuthStateChanged will handle navigation
  }, [pendingGoogleLinkEmail, showToast])

  const handleGoogleSignIn = useCallback(async () => {
    const provider = new GoogleAuthProvider()
    provider.setCustomParameters({ prompt: "select_account" })
    try {
      await signInWithPopup(auth, provider)
      pendingGoogleCredentialRef.current = null
      setPendingGoogleLinkEmail(null)
    } catch (error) {
      if (error instanceof FirebaseError && error.code === "auth/account-exists-with-different-credential") {
        const pendingCredential = GoogleAuthProvider.credentialFromError(error)
        const email = typeof error.customData?.email === "string" ? error.customData.email : ""
        if (pendingCredential && email) {
          pendingGoogleCredentialRef.current = pendingCredential
          setPendingGoogleLinkEmail(email)
          throw new Error("This Google email already has an account. Sign in with your password once to link Google.")
        }
      }
      throw error
    }
    // onAuthStateChanged will persist /users and handle navigation
  }, [])

  const handleRegister = useCallback(async (name: string, email: string, password: string) => {
    const cred = await createUserWithEmailAndPassword(auth, email, password)
    const uid = cred.user.uid
    const initials = deriveInitials(name)
    const color = getUserAvatarColor(uid)
    const emailNormalized = normalizeEmail(email)
    const userDoc: Contact = { id: uid, name, email: emailNormalized, emailNormalized, initials, color }
    await setDoc(doc(db, "users", uid), {
      ...userDoc,
      emailVerified: cred.user.emailVerified === true,
      authProviderIds: cred.user.providerData.map((provider) => provider.providerId),
    })
    // onAuthStateChanged will handle navigation
  }, [])

  const handleSignOut = useCallback(async () => {
    if (firebaseUser?.uid) {
      const { clearDirectorySearchCache } = await import("@/lib/directory-search")
      await clearDirectorySearchCache(firebaseUser.uid).catch(() => {})
    }
    await signOut(auth)
    // onAuthStateChanged will navigate to login
  }, [firebaseUser?.uid])

  // ── Project handlers ──────────────────────────────────────────────────
  const handleCreateProject = useCallback(
    async (name: string, memberIds: string[] = [], category?: TagCategory): Promise<Project> => {
      const color = PROJECT_COLORS[nextColorIndex.current % PROJECT_COLORS.length]
      nextColorIndex.current += 1
      const id = generateProjectId()
      const members = firebaseUser ? [...new Set([firebaseUser.uid, ...memberIds])] : memberIds
      // Categories are legacy metadata only; new tags default to a flat custom tag.
      const tagCategory = category ?? "custom"
      const newProject: Project = {
        id,
        name: name.trim(),
        color,
        members,
        ownerId: firebaseUser?.uid ?? "",
        tagCategory,
      }
      await setDoc(doc(db, "projects", id), newProject)
      showToast(`"${newProject.name}" created`, undefined, 2500)
      return newProject
    },
    [firebaseUser, showToast]
  )

  const handleDeleteProject = useCallback(
    async (id: string) => {
      haptic.destructive()
      const targetProject = projects.find((p) => p.id === id)
      if (!targetProject) return
      const affected = messages.filter((m) => messageHasProject(m, id))
      const batch = writeBatch(db)
      affected.forEach((m) => {
        const remaining = getMessageProjectIds(m).filter((projectId) => projectId !== id)
        const remainingTagIds = getMessageTagIds(m).filter((tagId) => tagId !== projectTagId(id))
        // Recompute visibility: author + explicit recipients only
        const visibleToUserIds = computeVisibleToUserIds(
          m.authorId ?? m.senderId,
          m.recipientIds ?? []
        )
        batch.update(doc(db, "messages", m.id), {
          projectIds: remaining,
          projectId: remaining[0] ?? null,
          tagIds: remainingTagIds,
          visibleToUserIds,
          updatedAt: serverTimestamp(),
        })
      })
      batch.delete(doc(db, "projects", id))
      await batch.commit()
      showToast("Tag deleted", {
        label: "Undo",
        onClick: async () => {
          const restore = writeBatch(db)
          restore.set(doc(db, "projects", id), targetProject)
          affected.forEach((m) => {
            const restored = [...new Set([...getMessageProjectIds(m), id])]
            const restoredTagIds = [...new Set([...getMessageTagIds(m), projectTagId(id)])]
            // Restore original visibleToUserIds (before deletion)
            restore.update(doc(db, "messages", m.id), {
              projectIds: restored,
              projectId: restored[0] ?? id,
              tagIds: restoredTagIds,
              ...(m.visibleToUserIds ? { visibleToUserIds: m.visibleToUserIds } : {}),
              updatedAt: serverTimestamp(),
            })
          })
          await restore.commit()
        },
      })
    },
    [messages, projects, showToast]
  )

  const handleFavoriteProject = useCallback(
    async (id: string) => {
      haptic.light()
      const proj = projects.find((p) => p.id === id)
      if (!proj) return
      await updateDoc(doc(db, "projects", id), { isFavorited: !proj.isFavorited })
    },
    [projects]
  )

  const handleRenameProject = useCallback(
    async (id: string, name: string, category?: TagCategory) => {
      const nextName = name.trim()
      if (!nextName) return
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updates: Record<string, any> = { name: nextName }
      if (category) updates.tagCategory = category
      await updateDoc(doc(db, "projects", id), updates)
      showToast("Tag updated ✓", undefined, 2000)
    },
    [showToast]
  )

  // ── Message handlers ──────────────────────────────────────────────────
  const handleSend = useCallback(
    async (draft: MessageDraft) => {
      const text = draft.text.trim()
      if ((!text && !draft.imageFile) || !firebaseUser) { navigateTo("stream"); return }
      const importedContactIds = draft.importedContactIds ?? []
      const incomingTagIds = draft.tagIds ?? []
      const projectIds = getLegacyProjectIdsFromTagIds(incomingTagIds, draft.projectIds).filter(Boolean)
      const legacyType = getLegacyTypeFromTagIds(incomingTagIds, draft.type)
      const tagIds = [...new Set([
        ...incomingTagIds,
        ...getMessageTagIds({
          tagIds: undefined,
          type: legacyType,
          projectId: projectIds[0] ?? null,
          projectIds,
          project_id: null,
        }),
      ])]
      const peopleIds = [...new Set([
        ...(draft.peopleIds ?? draft.contactIds),
        ...resolveLinkedImportedContactUserIds(importedContactIds, importedContacts),
      ].filter(Boolean))]
      const participants = [...new Set([firebaseUser.uid, ...peopleIds])]
      const imageMeta: Record<string, unknown> = {}

      if (draft.imageFile) {
        const { validateImageFile, compressImageFile: compress } = await import("@/lib/image-upload")
        const validationError = validateImageFile(draft.imageFile)
        if (validationError) {
          showToast(validationError, undefined, 3500)
          throw new Error(validationError)
        }
        try {
          const imageFile = await compress(draft.imageFile)
          const safeName = sanitizeStorageName(imageFile.name)
          const imagePath = `message-images/${firebaseUser.uid}/${Date.now()}-${safeName}`
          const { ref, uploadBytes, getDownloadURL } = await import("firebase/storage")
          const storageInstance = await getStorageLazy()
          const imageRef = ref(storageInstance, imagePath)
          await uploadBytes(imageRef, imageFile, { contentType: imageFile.type || "image/jpeg" })
          imageMeta.imageUrl = await getDownloadURL(imageRef)
          imageMeta.imagePath = imagePath
          imageMeta.imageName = imageFile.name
          imageMeta.imageContentType = imageFile.type || "image/jpeg"
          imageMeta.imageSize = imageFile.size
          imageMeta.imageUploadedAt = serverTimestamp()
          // Read natural dimensions + generate BlurHash from the file before it leaves memory
          try {
            const dims = await new Promise<{ w: number; h: number; blurHash: string }>((resolve, reject) => {
              const url = URL.createObjectURL(imageFile)
              const el = new window.Image()
              el.onload = () => {
                const w = el.naturalWidth
                const h = el.naturalHeight
                // Draw at small size for fast BlurHash encoding (32px wide, proportional height)
                const thumbW = 32
                const thumbH = Math.max(1, Math.round((h / w) * thumbW))
                const canvas = document.createElement("canvas")
                canvas.width = thumbW
                canvas.height = thumbH
                const ctx = canvas.getContext("2d")!
                ctx.drawImage(el, 0, 0, thumbW, thumbH)
                const { data } = ctx.getImageData(0, 0, thumbW, thumbH)
                // Dynamic import so blurhash encode only runs in this path
                import("blurhash").then(({ encode }) => {
                  try {
                    const hash = encode(data, thumbW, thumbH, 4, 3)
                    resolve({ w, h, blurHash: hash })
                  } catch { resolve({ w, h, blurHash: "" }) }
                }).catch(() => resolve({ w, h, blurHash: "" }))
                URL.revokeObjectURL(url)
              }
              el.onerror = reject
              el.src = url
            })
            imageMeta.imageWidth = dims.w
            imageMeta.imageHeight = dims.h
            if (dims.blurHash) imageMeta.imageBlurHash = dims.blurHash
          } catch { /* non-critical — skip if decode fails */ }
        } catch (error) {
          showToast("Image upload failed. Check Firebase Storage setup.", undefined, 3500)
          throw error
        }
      }

      const visibleToUserIds = computeVisibleToUserIds(
        firebaseUser.uid,
        peopleIds
      )

      // Build calendarDates from draft date strings
      const calendarDateObjects = (draft.calendarDates ?? [])
        .filter(Boolean)
        .map((dateStr, idx) => ({
          id: `cd-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
          date: dateStr,
          createdAt: Timestamp.now(),
          createdBy: firebaseUser.uid,
        }))

      const msgData = {
        authorId: firebaseUser.uid,
        senderId: firebaseUser.uid,
        recipientIds: peopleIds,
        peopleIds,
        participants,
        visibleToUserIds,
        projectIds,
        projectId: projectIds[0] ?? null,
        tagIds,
        content: text,
        text,
        type: legacyType,
        contactIds: importedContactIds,
        contextIds: draft.contextIds ?? [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        timestamp: serverTimestamp(),
        isFavorited: false,
        ...(calendarDateObjects.length > 0 ? {
          calendarDates: calendarDateObjects,
          calendarDateStrings: calendarDateObjects.map((d) => d.date),
        } : {}),
        ...(draft.replyToId ? { replyToId: draft.replyToId, replyPreview: draft.replyPreview } : {}),
        ...imageMeta,
      }
      await addDoc(collection(db, "messages"), msgData)
      setCalendarInitialDate(null)
      navigateTo("stream")
    },
    [firebaseUser, importedContacts, projects, navigateTo, showToast]
  )

  const handleDeleteMessage = useCallback(
    (id: string) => {
      // Capture message for Undo before deleting
      const target = messages.find((m) => m.id === id)
      if (!target) return
      deleteDoc(doc(db, "messages", id))
      showToast("Message deleted", {
        label: "Undo",
        onClick: async () => {
          // Re-create the message (without serverTimestamp to preserve order)
          await setDoc(doc(db, "messages", id), {
            authorId: target.authorId ?? target.senderId,
            senderId: target.senderId,
            recipientIds: target.recipientIds ?? [],
            peopleIds: getMessagePeopleIds(target),
            participants: target.participants,
            ...(target.visibleToUserIds ? { visibleToUserIds: target.visibleToUserIds } : {}),
            projectIds: getMessageProjectIds(target),
            projectId: target.projectId ?? null,
            tagIds: getMessageTagIds(target),
            content: target.content ?? target.text,
            text: target.text,
            type: target.type,
            createdAt: Timestamp.fromDate(target.createdAt ?? target.timestamp),
            updatedAt: Timestamp.fromDate(target.updatedAt ?? target.timestamp),
            timestamp: Timestamp.fromDate(target.timestamp),
            isFavorited: target.isFavorited ?? false,
            ...(target.imageUrl ? {
              imageUrl: target.imageUrl,
              imagePath: target.imagePath,
              imageName: target.imageName,
              imageContentType: target.imageContentType,
              imageSize: target.imageSize,
              ...(target.imageUploadedAt ? { imageUploadedAt: Timestamp.fromDate(target.imageUploadedAt) } : {}),
            } : {}),
          })
        },
      })
    },
    [messages, showToast]
  )

  const handleFavoriteMessage = useCallback(async (id: string) => {
    const msg = messages.find((m) => m.id === id)
    if (!msg) return
    await updateDoc(doc(db, "messages", id), { isFavorited: !msg.isFavorited })
  }, [messages])

  const handleApplyTag = useCallback(
    async (peopleIds: string[], tagIds: string[], importedContactIds: string[] = [], calendarDates?: string[], contextIds?: string[]) => {
      if (!selectedMessageId) return
      const selectedMessage = messages.find((m) => m.id === selectedMessageId)
      if (!selectedMessage) return
      const resolvedPeopleIds = [...new Set([
        ...peopleIds,
        ...resolveLinkedImportedContactUserIds(importedContactIds, importedContacts),
      ].filter(Boolean))]
      // Always include all project members so they receive the message
      const type = getLegacyTypeFromTagIds(tagIds, "none")
      const projectIds = getLegacyProjectIdsFromTagIds(tagIds, [])
      const selectedProjectIds = [...new Set(projectIds.filter(Boolean))]
      // NEVER shrink participants — tag edits only ADD access, never revoke it.
      // Existing participants keep access; new people are added.
      const mergedParticipants = [...new Set([
        ...selectedMessage.participants,  // preserve all existing access
        selectedMessage.senderId,         // always include sender
        firebaseUser!.uid,                // always include the person editing
        ...resolvedPeopleIds,
      ])]

      // Compute visibleToUserIds from author + explicit recipients only
      const authorId = selectedMessage.authorId ?? selectedMessage.senderId
      const visibleToUserIds = computeVisibleToUserIds(
        authorId,
        resolvedPeopleIds
      )

      // Build calendarDates update — only overwrite if caller passed the array
      const newCalendarDates = calendarDates !== undefined
        ? calendarDates
            .filter(Boolean)
            .map((dateStr, idx) => ({
              id: `cd-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
              date: dateStr,
              createdAt: Timestamp.now(),
              createdBy: firebaseUser!.uid,
            }))
        : undefined

      await updateDoc(doc(db, "messages", selectedMessageId), {
        type,
        recipientIds: resolvedPeopleIds.filter((id) => id !== selectedMessage.senderId),
        peopleIds: resolvedPeopleIds.filter((id) => id !== selectedMessage.senderId),
        projectIds: selectedProjectIds,
        projectId: selectedProjectIds[0] ?? null,
        tagIds,
        participants: mergedParticipants,
        visibleToUserIds,
        contactIds: importedContactIds,
        ...(contextIds !== undefined ? { contextIds } : {}),
        ...(newCalendarDates !== undefined ? {
          calendarDates: newCalendarDates,
          calendarDateStrings: newCalendarDates.map((d) => d.date),
        } : {}),
        updatedAt: serverTimestamp(),
      })
      setSelectedMessageId(null)
      navigateTo("stream")
      const parts: string[] = []
      if (type !== "none") parts.push(type.charAt(0).toUpperCase() + type.slice(1))
      if (selectedProjectIds.length) parts.push(selectedProjectIds.length === 1 ? "tag" : "tags")
      showToast(parts.length ? `Tagged: ${parts.join(", ")} ✓` : "Context saved ✓", undefined, 2000)
    },
    [selectedMessageId, importedContacts, projects, messages, navigateTo, showToast]
  )

  const handleRemoveProjectTag = useCallback(
    async (messageId: string, projectId?: string) => {
      const message = messages.find((m) => m.id === messageId)
      const remaining = projectId && message
        ? getMessageProjectIds(message).filter((id) => id !== projectId)
        : []
      const remainingTagIds = message && projectId
        ? getMessageTagIds(message).filter((tagId) => tagId !== projectTagId(projectId))
        : []
      // Recompute visibility: author + explicit recipients only
      const visibleToUserIds = message
        ? computeVisibleToUserIds(
            message.authorId ?? message.senderId,
            message.recipientIds ?? []
          )
        : undefined
      await updateDoc(doc(db, "messages", messageId), {
        projectIds: remaining,
        projectId: remaining[0] ?? null,
        tagIds: remainingTagIds,
        ...(visibleToUserIds ? { visibleToUserIds } : {}),
        updatedAt: serverTimestamp(),
      })
      showToast("Tag removed ✓", undefined, 2000)
    },
    [messages, projects, showToast]
  )

  // ── Imported contact handlers ─────────────────────────────────────────
  const handleSaveImportedContacts = useCallback(
    async (newContacts: Omit<ImportedContact, "id">[]) => {
      if (!firebaseUser || newContacts.length === 0) return
      const batch = writeBatch(db)
      const optimisticContacts: ImportedContact[] = []
      newContacts.forEach((c) => {
        const ref = doc(collection(db, "contacts"))
        const emailNormalized = normalizeEmail(c.email)
        const emailNormalizedCandidates = [
          ...new Set([
            emailNormalized,
            ...(c.emailNormalizedCandidates ?? []),
            ...(c.emails ?? []).flatMap((point) => [point.normalized, normalizeEmail(point.value)]),
          ].filter(Boolean)),
        ]
        batch.set(ref, {
          ownerUserId: c.ownerUserId,
          name: c.name,
          source: c.source,
          tags: c.tags,
          linkedUserId: c.linkedUserId,
          status: c.status,
          // All contacts are global for now — no private option.
          visibility: "global",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          ...(emailNormalized && { email: emailNormalized, emailNormalized }),
          ...(c.phone != null && { phone: c.phone }),
          ...(c.phoneNormalized && { phoneNormalized: c.phoneNormalized }),
          ...(c.emails && c.emails.length > 0 && { emails: c.emails }),
          ...(c.phones && c.phones.length > 0 && { phones: c.phones }),
          ...(emailNormalizedCandidates.length > 0 && { emailNormalizedCandidates }),
          ...(c.company && { company: c.company }),
          ...(c.companies && c.companies.length > 0 && { companies: c.companies }),
          ...(c.role && { role: c.role }),
          ...(c.roles && c.roles.length > 0 && { roles: c.roles }),
          ...(c.notes && { notes: c.notes }),
          ...(c.addresses && c.addresses.length > 0 && { addresses: c.addresses }),
          ...(c.urls && c.urls.length > 0 && { urls: c.urls }),
          ...(c.importBatchId && { importBatchId: c.importBatchId }),
        })
        optimisticContacts.push({ ...c, id: ref.id, visibility: "global", createdAt: new Date(), updatedAt: new Date() })
      })
      await batch.commit()
      setGlobalImportedContacts((current) => [...optimisticContacts, ...current])
      showToast(`${newContacts.length} contact${newContacts.length === 1 ? "" : "s"} imported ✓`, undefined, 3000)
    },
    [firebaseUser, showToast]
  )

  const handleInviteContact = useCallback(
    (contact: ImportedContact) => {
      const url = `${window.location.origin}`
      const fallback = () => {
        try {
          const el = document.createElement("textarea")
          el.value = url
          el.style.cssText = "position:fixed;opacity:0;pointer-events:none"
          document.body.appendChild(el)
          el.select()
          document.execCommand("copy")
          document.body.removeChild(el)
        } catch {}
      }
      if (navigator?.clipboard?.writeText) {
        navigator.clipboard.writeText(url).catch(fallback)
      } else {
        fallback()
      }
      haptic.light()
      showToast(`Invite link copied for ${contact.name}`, undefined, 3000)
    },
    [showToast]
  )

  const handleAddTagToContact = useCallback(
    async (contactId: string, tag: string) => {
      const trimmed = tag.trim()
      if (!trimmed) return
      await updateDoc(doc(db, "contacts", contactId), {
        tags: arrayUnion(trimmed),
        updatedAt: serverTimestamp(),
      })
      setGlobalImportedContacts((current) => current.map((contact) => contact.id === contactId
        ? { ...contact, tags: [...new Set([...contact.tags, trimmed])], updatedAt: new Date() }
        : contact))
    },
    []
  )

  const handleRemoveTagFromContact = useCallback(
    async (contactId: string, tag: string) => {
      await updateDoc(doc(db, "contacts", contactId), {
        tags: arrayRemove(tag),
        updatedAt: serverTimestamp(),
      })
      setGlobalImportedContacts((current) => current.map((contact) => contact.id === contactId
        ? { ...contact, tags: contact.tags.filter((item) => item !== tag), updatedAt: new Date() }
        : contact))
    },
    []
  )

  const handleDeleteImportedContact = useCallback(
    async (contactId: string) => {
      haptic.destructive()
      await deleteDoc(doc(db, "contacts", contactId))
      setGlobalImportedContacts((current) => current.filter((contact) => contact.id !== contactId))
      showToast("Contact removed", undefined, 2000)
    },
    [showToast]
  )

  const handleUpdateImportedContact = useCallback(
    async (contactId: string, updates: { email?: string | null; phone?: string | null }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fields: Record<string, any> = { updatedAt: serverTimestamp() }
      if ("email" in updates) {
        const emailNormalized = normalizeEmail(updates.email)
        fields.email = emailNormalized || deleteField()
        fields.emailNormalized = emailNormalized || deleteField()
        fields.emailNormalizedCandidates = emailNormalized ? [emailNormalized] : deleteField()
        fields.emails = emailNormalized ? [{
          label: "email",
          value: emailNormalized,
          normalized: emailNormalized,
          isPrimary: true,
        }] : deleteField()
      }
      if ("phone" in updates) {
        fields.phone = updates.phone?.trim() ? updates.phone.trim() : deleteField()
        const phoneNormalized = updates.phone?.replace(/\D/g, "")
        fields.phoneNormalized = phoneNormalized ? (phoneNormalized.length === 11 && phoneNormalized.startsWith("1") ? phoneNormalized.slice(1) : phoneNormalized) : deleteField()
      }
      await updateDoc(doc(db, "contacts", contactId), fields)
      setGlobalImportedContacts((current) => current.map((contact) => contact.id === contactId
        ? {
            ...contact,
            ...(Object.prototype.hasOwnProperty.call(updates, "email") ? { email: updates.email?.trim() || undefined } : {}),
            ...(Object.prototype.hasOwnProperty.call(updates, "phone") ? { phone: updates.phone?.trim() || undefined } : {}),
            updatedAt: new Date(),
          }
        : contact))
    },
    []
  )

  // ── Navigation helpers ────────────────────────────────────────────────
  const handleMessageClick = useCallback((message: Message) => {
    tagSourceScreenRef.current = activeScreen as Screen
    setSelectedMessageId(message.id)
    navigateTo("tag")
  }, [navigateTo, activeScreen])

  const handleCloseTag = useCallback(() => {
    setSelectedMessageId(null)
    navigateTo(tagSourceScreenRef.current)
  }, [navigateTo])

  const goToCompose = useCallback(() => {
    const filterProjectId = activeFilter !== "all" && activeFilter !== "unsorted" ? activeFilter : null
    setComposeInitialProjectId(filterProjectId)
    setComposeMode("sheet")
    navigateTo("compose")
  }, [navigateTo, activeFilter])
  const goToComposeFromProject = useCallback((projectId: string) => { setComposeInitialProjectId(projectId); setComposeMode("sheet"); navigateTo("compose") }, [navigateTo])
  const goToStream = useCallback(() => navigateTo("stream"), [navigateTo])
  const goToProfile = useCallback(() => navigateTo("profile"), [navigateTo])
  const goToNotificationsFromProfile = useCallback(() => {
    notificationsReturnRef.current = "profile"
    navigateTo("notifications")
  }, [navigateTo])
  const goToNotificationsFromStream = useCallback(() => {
    notificationsReturnRef.current = "stream"
    navigateTo("notifications")
  }, [navigateTo])
  const handleNotificationsBack = useCallback(() => {
    navigateTo(notificationsReturnRef.current)
  }, [navigateTo])
  const goToPeople = useCallback(() => navigateTo("people"), [navigateTo])
  const peopleReturnRef = useRef<Screen>("profile")
  const goToPeopleFromStream = useCallback(() => {
    peopleReturnRef.current = "stream"
    navigateTo("people")
  }, [navigateTo])
  const handlePeopleBack = useCallback(() => {
    navigateTo(peopleReturnRef.current)
  }, [navigateTo])
  const goToAdmin = useCallback(() => navigateTo("admin"), [navigateTo])
  const goToHelp = useCallback(() => navigateTo("help"), [navigateTo])

  const projectsReturnRef = useRef<Screen>("profile")
  const goToProjects = useCallback(() => {
    projectsReturnRef.current = "profile"
    navigateTo("projects")
  }, [navigateTo])
  const goToProjectsFromStream = useCallback(() => {
    projectsReturnRef.current = "stream"
    navigateTo("projects")
  }, [navigateTo])
  const handleProjectsBack = useCallback(() => {
    navigateTo(projectsReturnRef.current)
  }, [navigateTo])

  const calendarReturnRef = useRef<Screen>("stream")
  const goToCalendar = useCallback(() => {
    calendarReturnRef.current = "stream"
    navigateTo("calendar")
  }, [navigateTo])
  const handleCalendarBack = useCallback(() => navigateTo(calendarReturnRef.current), [navigateTo])

  // ── Contexts navigation ───────────────────────────────────────────────
  const contextsReturnRef = useRef<Screen>("stream")
  const goToContextsFromStream = useCallback(() => {
    contextsReturnRef.current = "stream"
    navigateTo("contexts")
  }, [navigateTo])
  const handleContextsBack = useCallback(() => {
    navigateTo(contextsReturnRef.current)
  }, [navigateTo])
  const goToContextDetail = useCallback((contextId: string) => {
    setSelectedContextId(contextId)
    setSelectedContextData(null)
    setSelectedContextLoading(true)
    navigateTo("context-detail")
  }, [navigateTo])

  // ── Directory navigation ──────────────────────────────────────────────
  const goToDirectoryFromStream = useCallback(() => navigateTo("directory"), [navigateTo])
  const goToDirectoryDetail = useCallback((directoryId: string) => {
    setSelectedDirectoryId(directoryId)
    navigateTo("directory-detail")
  }, [navigateTo])
  const handleDirectoryDetailBack = useCallback(() => {
    setSelectedDirectoryId(null)
    navigateTo("directory")
  }, [navigateTo])
  const handleDirectorySwitchToStream = useCallback(() => navigateTo("stream"), [navigateTo])

  // ── Context CRUD ──────────────────────────────────────────────────────
  const handleCreateContext = useCallback(async (name: string, description?: string): Promise<AppContext> => {
    if (!firebaseUser) throw new Error("Not authenticated")
    const ref = await addDoc(collection(db, "contexts"), {
      name,
      ...(description ? { description } : {}),
      fields: [],
      createdBy: firebaseUser.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
    const context: AppContext = {
      id: ref.id,
      name,
      description: description || undefined,
      fields: [],
      createdBy: firebaseUser.uid,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    setAppContexts((current) => [context, ...current])
    return context
  }, [firebaseUser])

  const handleUpdateContext = useCallback(async (
    id: string,
    updates: Partial<Pick<AppContext, "name" | "description" | "fields">>
  ) => {
    await updateDoc(doc(db, "contexts", id), { ...updates, updatedAt: serverTimestamp() })
    setAppContexts((current) => current.map((context) => context.id === id ? { ...context, ...updates, updatedAt: new Date() } : context))
    setSelectedContextData((current) => current?.id === id ? { ...current, ...updates, updatedAt: new Date() } : current)
  }, [])

  const handleDeleteContext = useCallback(async (id: string) => {
    await deleteDoc(doc(db, "contexts", id))
    setAppContexts((current) => current.filter((context) => context.id !== id))
    setSelectedContextData(null)
    navigateTo("contexts")
  }, [navigateTo])

  const handleNewMessageFromCalendar = useCallback(
    (date: string) => {
      setCalendarInitialDate(date)
      setComposeInitialProjectId(null)
      setComposeMode("fullscreen")
      navigateTo("compose")
    },
    [navigateTo]
  )

  const handleSendFromCalendar = useCallback(
    async (text: string, date: string, peopleIds: string[] = [], incomingTagIds: string[] = [], importedContactIds: string[] = []) => {
      if (!firebaseUser) return
      const resolvedPeopleIds = [...new Set([
        ...peopleIds,
        ...resolveLinkedImportedContactUserIds(importedContactIds, importedContacts),
      ].filter(Boolean))]
      const projectIds = getLegacyProjectIdsFromTagIds(incomingTagIds, []).filter(Boolean)
      const legacyType = getLegacyTypeFromTagIds(incomingTagIds, "none")
      const tagIds = [...new Set([
        ...incomingTagIds,
        ...getMessageTagIds({ tagIds: undefined, type: legacyType, projectId: projectIds[0] ?? null, projectIds, project_id: null }),
      ])]
      const participants = [...new Set([firebaseUser.uid, ...resolvedPeopleIds])]
      const visibleToUserIds = computeVisibleToUserIds(firebaseUser.uid, resolvedPeopleIds)
      const calendarDateObj = {
        id: `cd-${Date.now()}-0-${Math.random().toString(36).slice(2, 6)}`,
        date,
        createdAt: Timestamp.now(),
        createdBy: firebaseUser.uid,
      }
      await addDoc(collection(db, "messages"), {
        authorId: firebaseUser.uid,
        senderId: firebaseUser.uid,
        recipientIds: resolvedPeopleIds,
        peopleIds: resolvedPeopleIds,
        participants,
        visibleToUserIds,
        projectIds,
        projectId: projectIds[0] ?? null,
        tagIds,
        content: text,
        text,
        type: legacyType,
        contactIds: importedContactIds,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        timestamp: serverTimestamp(),
        isFavorited: false,
        calendarDates: [calendarDateObj],
        calendarDateStrings: [date],
      })
    },
    [firebaseUser, importedContacts, projects]
  )

  const handleCopyMessage = useCallback((text: string) => {
    const fallback = () => {
      try {
        const el = document.createElement("textarea")
        el.value = text
        el.style.cssText = "position:fixed;opacity:0;pointer-events:none"
        document.body.appendChild(el)
        el.select()
        document.execCommand("copy")
        document.body.removeChild(el)
      } catch {}
    }
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(fallback)
    } else {
      fallback()
    }
    haptic.light()
    showToast("Copied ✓", undefined, 2000)
  }, [showToast])

  const goToProjectDetail = useCallback((projectId: string) => {
    setSelectedProjectId(projectId)
    navigateTo("project-detail")
  }, [navigateTo])

  // ── Derived values ────────────────────────────────────────────────────
  const userName = currentUser?.name ?? ""
  const userEmail = firebaseUser?.email ?? ""
  const userInitials = currentUser?.initials ?? ""
  const userColor = currentUser?.color ?? getUserAvatarColor(firebaseUser?.uid ?? "")

  const selectedMessage = messages.find((m) => m.id === selectedMessageId) || null
  const activeUsers = useMemo(() => {
    const cutoff = Date.now() - 90000
    return [currentUser, ...contacts].filter((contact): contact is Contact =>
      !!contact?.lastSeen && contact.lastSeen.getTime() > cutoff
    )
  }, [contacts, currentUser])

  const availableTags = useMemo(() => sortTagsByActivity(getAvailableTags(projects), messages), [projects, messages])

  const messageMatchesPeopleFilter = useCallback((message: Message, peopleIds: string[]) => {
    if (peopleIds.length === 0) return true

    const senderIds = new Set<string>()
    if (message.senderId) senderIds.add(message.senderId)
    if (message.authorId) senderIds.add(message.authorId)

    const allIds = new Set<string>(senderIds)
    ;(message.recipientIds ?? []).filter(Boolean).forEach((id) => allIds.add(id))
    ;(message.peopleIds ?? []).filter(Boolean).forEach((id) => allIds.add(id))
    ;(message.contactIds ?? []).filter(Boolean).forEach((id) => allIds.add(id))

    return peopleIds.some((id) => {
      // "Me" filter → only messages the current user SENT
      if (id === firebaseUser?.uid) return senderIds.has(id)
      return allIds.has(id)
    })
  }, [firebaseUser?.uid])

  const filteredMessages = useMemo(() =>
    messages.filter((message) =>
      messageMatchesPeopleFilter(message, selectedPeopleFilter) &&
      messageHasTags(message, selectedTagFilter) &&
      (selectedDateFilter.length === 0 ||
        (message.calendarDates ?? []).some((calendarDate) => selectedDateFilter.includes(calendarDate.date))) &&
      (selectedContextFilter.length === 0 ||
        selectedContextFilter.some((ctxId) => (message.contextIds ?? []).includes(ctxId)))
    ),
    [messages, messageMatchesPeopleFilter, selectedPeopleFilter, selectedTagFilter, selectedDateFilter, selectedContextFilter]
  )

  const activeStreamFilters = useMemo(() => ({
    peopleIds: selectedPeopleFilter,
    tagIds: selectedTagFilter,
    contextIds: selectedContextFilter,
  }), [selectedPeopleFilter, selectedTagFilter, selectedContextFilter])

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="h-full w-full flex flex-col bg-background overflow-hidden relative">

      {/* Loading splash */}
      {activeScreen === "loading" && <LaunchLoadingScreen />}

      {showScreenSkeleton && activeScreen !== "loading" && <AppScreenSkeleton />}

      {!showScreenSkeleton && activeScreen === "login" && (
        <LoginScreen
          onLogin={handleLogin}
          onGoogleSignIn={handleGoogleSignIn}
          googleLinkEmail={pendingGoogleLinkEmail}
          onGoRegister={() => navigateTo("register")}
        />
      )}

      {!showScreenSkeleton && activeScreen === "register" && (
        <RegisterScreen onRegister={handleRegister} onGoogleSignIn={handleGoogleSignIn} onGoLogin={() => navigateTo("login")} />
      )}

      {!showScreenSkeleton && activeScreen === "profile" && (
        <ProfileScreen
          className={entranceClass}
          userName={userName}
          userEmail={userEmail}
          userInitials={userInitials}
          userColor={userColor}
          projectCount={projects.length}
          messageCount={messages.length}
          onBack={goToStream}
          onSignOut={handleSignOut}
          onNotifications={goToNotificationsFromProfile}
          isAdmin={currentUser?.isAdmin === true}
          onAdmin={goToAdmin}
          onHelp={goToHelp}
        />
      )}

      {!showScreenSkeleton && activeScreen === "notifications" && (
        <NotificationsScreen
          className={entranceClass}
          onBack={handleNotificationsBack}
          userId={firebaseUser?.uid ?? ""}
          notificationPreference={notifPreference}
          onPreferenceChange={setNotifPreference}
        />
      )}

      {!showScreenSkeleton && activeScreen === "admin" && currentUser?.isAdmin && (
        <AdminScreen
          className={entranceClass}
          currentUser={currentUser}
          allUsers={[currentUser, ...contacts]}
          onBack={goToProfile}
        />
      )}

      {!showScreenSkeleton && activeScreen === "help" && (
        <HelpScreen className={entranceClass} onBack={goToProfile} />
      )}

      {!showScreenSkeleton && activeScreen === "people" && currentUser && (
        <PeopleScreen
          className={entranceClass}
          contacts={contacts}
          currentUser={currentUser}
          importedContacts={importedContacts}
          registeredUsers={[currentUser, ...contacts]}
          messages={messages}
          isLoading={!contactsLoaded}
          onBack={handlePeopleBack}
          onSaveImportedContacts={handleSaveImportedContacts}
          onInviteContact={handleInviteContact}
          onAddTagToContact={handleAddTagToContact}
          onRemoveTagFromContact={handleRemoveTagFromContact}
          onDeleteImportedContact={handleDeleteImportedContact}
          onUpdateImportedContact={handleUpdateImportedContact}
        />
      )}

      {!showScreenSkeleton && activeScreen === "projects" && (
        <ProjectListScreen
          className={entranceClass}
          projects={projects}
          messages={messages}
          contacts={contacts}
          onBack={handleProjectsBack}
          onProjectSelect={goToProjectDetail}
          onCreateProject={handleCreateProject}
          onDeleteProject={handleDeleteProject}
          onFavoriteProject={handleFavoriteProject}
          onRenameProject={handleRenameProject}
        />
      )}

      {!showScreenSkeleton && activeScreen === "project-detail" && selectedProjectId && (() => {
        const proj = projects.find((p) => p.id === selectedProjectId)
        if (!proj) return null
        return (
          <ProjectDetailScreen
            className={entranceClass}
            project={proj}
            messages={messages}
            contacts={contacts}
            currentUserId={currentUser?.id ?? ""}
            currentUser={currentUser}
            onBack={goToProjects}
            onMessageClick={handleMessageClick}
            onDeleteMessage={handleDeleteMessage}
            onFavoriteMessage={handleFavoriteMessage}
            onCopyMessage={handleCopyMessage}
            onCompose={goToComposeFromProject}
            onSendMessage={handleSend}
          />
        )
      })()}

      {!showScreenSkeleton && activeScreen === "compose" && composeMode === "fullscreen" && (
        <ComposeScreen
          mode="fullscreen"
          onCancel={goToStream}
          onSend={handleSend}
          projects={projects}
          onCreateProject={handleCreateProject}
          contacts={contacts}
          importedContacts={importedContacts}
          initialProjectId={composeInitialProjectId}
          initialCalendarDates={calendarInitialDate ? [calendarInitialDate] : undefined}
          availableTags={availableTags}
          contexts={appContexts}
          onCreateContext={handleCreateContext}
          isContactsLoading={!contactsLoaded}
          isContextsLoading={!contextsLoaded}
        />
      )}

      {!showScreenSkeleton && (activeScreen === "calendar" || (activeScreen === "tag" && tagSourceScreenRef.current === "calendar")) && (
        <>
          <CalendarScreen
            className={calendarEntranceClass}
            messages={messages}
            contacts={contacts}
            projects={projects}
            currentUserId={currentUser?.id ?? ""}
            onBack={handleCalendarBack}
            onSendMessage={handleSendFromCalendar}
            onMessageClick={handleMessageClick}
            importedContacts={importedContacts}
          />
          {activeScreen === "tag" && selectedMessage && (
            <TagSheet
              message={selectedMessage}
              onApply={handleApplyTag}
              onClose={handleCloseTag}
              projects={projects}
              onCreateProject={handleCreateProject}
              contacts={contacts}
              importedContacts={importedContacts}
              availableTags={availableTags}
              customCategories={customCategories}
              activeStreamFilters={activeStreamFilters}
              recentUserMessages={recentUserMessages}
              contexts={appContexts}
              onCreateContext={handleCreateContext}
            />
          )}
        </>
      )}

      {!showScreenSkeleton && (activeScreen === "directory" || activeScreen === "directory-detail") && firebaseUser && (
        <DirectoryStateProvider userId={firebaseUser.uid}>
          <div className="relative flex min-h-0 flex-1 overflow-hidden">
            <DirectoryScreen
              className={activeScreen === "directory" ? `${entranceClass} h-full w-full` : "hidden"}
              userId={firebaseUser.uid}
              initialIndex={catalogIndex}
              onOpenDetail={goToDirectoryDetail}
              onSwitchToStream={handleDirectorySwitchToStream}
            />
            {activeScreen === "directory-detail" && selectedDirectoryId && (
              <DirectoryProfileScreen
                className={entranceClass}
                directoryId={selectedDirectoryId}
                userId={firebaseUser.uid}
                onBack={handleDirectoryDetailBack}
                onOpenEntity={goToDirectoryDetail}
              />
            )}
          </div>
        </DirectoryStateProvider>
      )}

      {!showScreenSkeleton && activeScreen === "contexts" && (
        <ContextsScreen
          className={entranceClass}
          contexts={appContexts}
          messages={messages}
          isLoading={!contextsLoaded}
          onBack={handleContextsBack}
          onContextSelect={goToContextDetail}
          onCreateContext={handleCreateContext}
        />
      )}

      {!showScreenSkeleton && activeScreen === "context-detail" && selectedContextId && (() => {
        if (selectedContextLoading) return <AppScreenSkeleton />
        const ctx = selectedContextData ?? appContexts.find((c) => c.id === selectedContextId)
        if (!ctx) return null
        return (
          <ContextDetailScreen
            className={entranceClass}
            context={ctx}
            currentUserId={currentUser?.id ?? ""}
            onBack={() => navigateTo("contexts")}
            onUpdate={handleUpdateContext}
            onDelete={handleDeleteContext}
          />
        )
      })()}

      {!showScreenSkeleton && (activeScreen === "stream" ||
        (activeScreen === "compose" && composeMode === "sheet") ||
        (activeScreen === "tag" && tagSourceScreenRef.current !== "calendar")) && (
        <>
          <StreamScreen
            messages={filteredMessages}
            activeFilter={activeFilter}
            onFilterChange={setActiveFilter}
            selectedPeopleFilter={selectedPeopleFilter}
            selectedTagFilter={selectedTagFilter}
            selectedDateFilter={selectedDateFilter}
            selectedContextFilter={selectedContextFilter}
            onPeopleFilterChange={setSelectedPeopleFilter}
            onTagFilterChange={setSelectedTagFilter}
            onDateFilterChange={setSelectedDateFilter}
            onContextFilterChange={setSelectedContextFilter}
            onCompose={goToCompose}
            onMessageClick={handleMessageClick}
            onProfile={goToProfile}
            onPeople={goToPeopleFromStream}
            onDeleteMessage={handleDeleteMessage}
            onFavoriteMessage={handleFavoriteMessage}
            userInitials={userInitials}
            userColor={userColor}
            projects={projects}
            contacts={contacts}
            currentUserId={currentUser?.id ?? ""}
            onGoToProject={goToProjectDetail}
            onRemoveProjectTag={handleRemoveProjectTag}
            onDeleteProject={handleDeleteProject}
            onFavoriteProject={handleFavoriteProject}
            onProjects={goToProjectsFromStream}
            onCalendar={goToCalendar}
            onContexts={goToContextsFromStream}
            onDirectory={goToDirectoryFromStream}
            onCopyMessage={handleCopyMessage}
            onSendMessage={handleSend}
            onCreateProject={handleCreateProject}
            onCreateContext={handleCreateContext}
            activeUsers={activeUsers}
            availableTags={availableTags}
            importedContacts={importedContacts}
            contexts={appContexts}
            isLoading={!messagesLoaded}
          />
          {/* Notification prompt banner — only on stream, fades in after 800ms if not yet enabled */}
          {activeScreen === "stream" && firebaseUser && (
            <NotificationPromptBanner
              userId={firebaseUser.uid}
              onNavigateToNotifications={goToNotificationsFromStream}
            />
          )}

          {/* Persistent compose backdrop — never unmounts, toggles via CSS (iOS hit-test fix) */}
          <div
            className={`fixed inset-0 z-40 flex flex-col justify-end md:items-center md:justify-center transition-opacity duration-200 ${activeScreen === "compose" && composeMode === "sheet" ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
            onPointerDown={activeScreen === "compose" && composeMode === "sheet" ? goToStream : undefined}
            style={{ paddingBottom: "env(keyboard-inset-height, 0px)" }}
          >
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm pointer-events-none" />
            {activeScreen === "compose" && composeMode === "sheet" && (
              <div
                onPointerDown={(e) => e.stopPropagation()}
                className="relative z-10 h-[90%] md:h-auto md:w-140 md:max-h-[80vh] md:rounded-3xl md:overflow-hidden animate-in slide-in-from-bottom duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] flex flex-col shadow-2xl"
              >
                <ComposeScreen
                  mode="sheet"
                  onCancel={goToStream}
                  onSend={handleSend}
                  projects={projects}
                  onCreateProject={handleCreateProject}
                  contacts={contacts}
                  importedContacts={importedContacts}
                  initialProjectId={composeInitialProjectId}
                  initialCalendarDates={calendarInitialDate ? [calendarInitialDate] : undefined}
                  availableTags={availableTags}
                  contexts={appContexts}
                  onCreateContext={handleCreateContext}
                  isContactsLoading={!contactsLoaded}
                  isContextsLoading={!contextsLoaded}
                />
              </div>
            )}
          </div>
          {activeScreen === "tag" && selectedMessage && (
            <TagSheet
              message={selectedMessage}
              onApply={handleApplyTag}
              onClose={handleCloseTag}
              projects={projects}
              onCreateProject={handleCreateProject}
              contacts={contacts}
              importedContacts={importedContacts}
              availableTags={availableTags}
              customCategories={customCategories}
              activeStreamFilters={activeStreamFilters}
              recentUserMessages={recentUserMessages}
              contexts={appContexts}
              onCreateContext={handleCreateContext}
            />
          )}
        </>
      )}

      {/* Global toast */}
      {toast && (
        <ToastNotification
          key={toast.key}
          message={toast.message}
          action={toast.action}
          duration={toast.duration}
          onDismiss={() => setToast(null)}
        />
      )}
    </div>
  )
}
