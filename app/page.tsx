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
import { createLoadMetric, createSnapshotMetric, recordFirebaseMetricError } from "@/lib/firebase-dev-metrics"
import { normalizePhoneDigits } from "@/lib/phone-normalization"
import { isLikelyPhone } from "@/lib/directory-core"
import { useMessageFeed } from "@/features/communications/messages/use-message-feed"
// image-upload loaded lazily in handleSend (only when uploading images)
import dynamic from "next/dynamic"
import { haptic, getUserAvatarColor } from "@/lib/utils"
// Critical path — loaded immediately (login → compose → stream)
import { StreamScreen } from "@/components/stream-screen"
import { ComposeScreen } from "@/components/compose-screen"
import { LoginScreen } from "@/components/login-screen"
import { useApplicationsDashboard } from "@/features/applications/use-applications-dashboard"
import { APPLICATION_STATUS_ORDER, type ApplicationStatus } from "@/lib/applications-core"
import { useQuestCoralDashboard } from "@/features/quest-coral/use-quest-coral-dashboard"
import { useByeByeDprDashboard } from "@/features/bye-bye-dpr/use-bye-bye-dpr-dashboard"
import { publishQuestCoralFeedbackReply } from "@/features/quest-coral/quest-coral-feedback-client"
import { publishQuestCoralRedTeamReviewReply } from "@/features/quest-coral/quest-coral-red-team-review-client"
import { AppScreenSkeleton, LaunchLoadingScreen } from "@/components/app-loading-screen"
import { ToastNotification } from "@/components/toast-notification"
import { DirectoryStateProvider } from "@/components/directory/directory-state-provider"
import { PwaInstallAutoPrompt } from "@/components/pwa-install"
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
const SecretaryAiScreen = dynamic(() => import("@/components/secretary-ai-screen").then((m) => ({ default: m.SecretaryAiScreen })), { ssr: false })
const ApplicationsListScreen = dynamic(() => import("@/components/applications/dashboard/applications-list-screen").then((m) => ({ default: m.ApplicationsListScreen })), { ssr: false })
const ApplicationDetailScreen = dynamic(() => import("@/components/applications/dashboard/application-detail-screen").then((m) => ({ default: m.ApplicationDetailScreen })), { ssr: false })
const CandidateFlowScreen = dynamic(() => import("@/components/applications/candidate/candidate-flow-screen").then((m) => ({ default: m.CandidateFlowScreen })), { ssr: false })
const QuestCoralScreen = dynamic(() => import("@/components/quest-coral/quest-coral-screen").then((m) => ({ default: m.QuestCoralScreen })), { ssr: false })
const QuestCoralProjectDetailScreen = dynamic(() => import("@/components/quest-coral/project-detail-screen").then((m) => ({ default: m.ProjectDetailScreen })), { ssr: false })
const ByeByeDprScreen = dynamic(() => import("@/components/bye-bye-dpr/byebye-dpr-screen").then((m) => ({ default: m.ByeByeDprScreen })), { ssr: false })
const CourtneyRobertsCenterScreen = dynamic(() => import("@/components/courtney-roberts-center-screen").then((m) => ({ default: m.CourtneyRobertsCenterScreen })), { ssr: false })
const CourtneyRobertsCenterThreadScreen = dynamic(() => import("@/components/courtney-roberts-center-thread-screen").then((m) => ({ default: m.CourtneyRobertsCenterThreadScreen })), { ssr: false })
const CourtneyRobertsCenterAccessScreen = dynamic(() => import("@/components/courtney-roberts-center-access-screen").then((m) => ({ default: m.CourtneyRobertsCenterAccessScreen })), { ssr: false })
const CourtneyRobertsCenterFormDetailScreen = dynamic(() => import("@/components/courtney-roberts-center-form-detail-screen").then((m) => ({ default: m.CourtneyRobertsCenterFormDetailScreen })), { ssr: false })
const NotificationPromptBanner = dynamic(() => import("@/components/notification-prompt-banner").then((m) => ({ default: m.NotificationPromptBanner })), { ssr: false })
import {
  type Message,
  type MessageDraft,
  type MessageFileAttachment,
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
  | "applications"
  | "application-detail"
  | "apply"
  | "help"
  | "secretary-ai"
  | "quest-coral"
  | "quest-coral-detail"
  | "bye-bye-dpr"
  | "courtney-roberts-center"
  | "courtney-roberts-center-thread"
  | "courtney-roberts-center-access"
  | "courtney-roberts-center-form-detail"

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
  "secretary-ai": 4,
  "project-detail": 5,
  contexts: 4,
  "context-detail": 5,
  directory: 1,
  "directory-detail": 2,
  applications: 1,
  "application-detail": 2,
  // The candidate flow is its own root: it is reached by link, not by drilling in.
  apply: 0,
  "quest-coral": 1,
  "quest-coral-detail": 2,
  "bye-bye-dpr": 1,
  "courtney-roberts-center": 4,
  "courtney-roberts-center-thread": 5,
  "courtney-roberts-center-access": 5,
  "courtney-roberts-center-form-detail": 5,
}

// Remembers which module the user was last in,
// so reopening the app resumes there instead of always defaulting to Comms.
const LAST_MODULE_KEY = "svc-last-module"
type SvcModuleName = "communications" | "directory" | "applications" | "quest-coral" | "bye-bye-dpr"
type DirectoryDeepLinkView = "profile" | "outlook"
type SvcDeepLink =
  | { kind: "directory"; directoryId: string; view: DirectoryDeepLinkView }
  | { kind: "module"; module: SvcModuleName }
  | { kind: "application"; applicationId: string }
  | { kind: "quest-coral"; projectId: string }
  | { kind: "applications-queue"; status: ApplicationStatus }
  | { kind: "communications"; contextId: string }

/** Secure candidate link: ?apply=<token>. Works before sign-in. */
function getApplyDeepLink(): string | null {
  if (typeof window === "undefined") return null
  return new URLSearchParams(window.location.search).get("apply")?.trim() || null
}

function getDirectoryDeepLink(): { directoryId: string; view: DirectoryDeepLinkView } | null {
  if (typeof window === "undefined") return null
  const params = new URLSearchParams(window.location.search)
  const directoryId = params.get("directory")?.trim()
  if (!directoryId) return null
  return {
    directoryId,
    view: params.get("view") === "outlook" ? "outlook" : "profile",
  }
}

/**
 * Internal deep links are deliberately just navigation state. Authentication
 * and each module's normal Firestore access rules still apply after app boot;
 * a URL never grants access to a record.
 */
function getSvcDeepLink(): SvcDeepLink | null {
  const directory = getDirectoryDeepLink()
  if (directory) return { kind: "directory", ...directory }
  if (typeof window === "undefined") return null

  const params = new URLSearchParams(window.location.search)
  const applicationId = params.get("application")?.trim()
  if (applicationId && applicationId.length <= 200) return { kind: "application", applicationId }

  const projectId = params.get("questCoral")?.trim()
  if (projectId && projectId.length <= 200) return { kind: "quest-coral", projectId }

  const contextId = params.get("communications")?.trim()
  if (contextId && contextId.length <= 200) return { kind: "communications", contextId }

  const module = params.get("module")?.trim()
  const applicationStatus = params.get("applicationStatus")?.trim()
  if (module === "applications" && applicationStatus && APPLICATION_STATUS_ORDER.includes(applicationStatus as ApplicationStatus)) {
    return { kind: "applications-queue", status: applicationStatus as ApplicationStatus }
  }
  if (module === "communications" || module === "directory" || module === "applications" || module === "quest-coral" || module === "bye-bye-dpr") {
    return { kind: "module", module }
  }
  return null
}

function getLastModule(): SvcModuleName | null {
  if (typeof window === "undefined") return null
  const stored = localStorage.getItem(LAST_MODULE_KEY)
  const lastModule =
    stored === "directory" || stored === "applications" || stored === "quest-coral" || stored === "bye-bye-dpr"
      ? stored
      : null
  if (lastModule) document.cookie = `${LAST_MODULE_KEY}=${lastModule}; path=/; max-age=31536000; samesite=lax`
  return lastModule
}

function persistLastModule(screen: Screen): void {
  if (typeof window === "undefined") return
  let module: SvcModuleName | null = null
  if (screen === "directory" || screen === "directory-detail") {
    module = "directory"
  } else if (screen === "applications" || screen === "application-detail") {
    module = "applications"
  } else if (screen === "quest-coral" || screen === "quest-coral-detail") {
    module = "quest-coral"
  } else if (screen === "bye-bye-dpr") {
    module = "bye-bye-dpr"
  } else if (screen === "apply") {
    // Candidate sessions must never change what an internal user resumes into.
    return
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
  const [projects, setProjects] = useState<Project[]>([])
  const [customCategories, setCustomCategories] = useState<CategoryItem[]>([])
  const [globalImportedContacts, setGlobalImportedContacts] = useState<ImportedContact[]>([])
  const [appContexts, setAppContexts] = useState<AppContext[]>([])
  const [catalogIndex, setCatalogIndex] = useState<DirectorySearchIndex | null>(null)
  const [selectedContextId, setSelectedContextId] = useState<string | null>(null)
  const [selectedContextData, setSelectedContextData] = useState<AppContext | null>(null)
  const [selectedContextLoading, setSelectedContextLoading] = useState(false)
  const [selectedDirectoryId, setSelectedDirectoryId] = useState<string | null>(null)
  const [directoryDetailView, setDirectoryDetailView] = useState<DirectoryDeepLinkView>("profile")
  const [selectedCourtneyRobertsCenterConversationId, setSelectedCourtneyRobertsCenterConversationId] = useState<string | null>(null)
  const [selectedOutlookFormSubmissionId, setSelectedOutlookFormSubmissionId] = useState<string | null>(null)
  // ── Applications (mock data for now — see features/applications) ───────
  const [selectedApplicationId, setSelectedApplicationId] = useState<string | null>(null)
  const [applyToken, setApplyToken] = useState<string | null>(null)
  // Read once at mount so the candidate link survives the auth round-trip.
  const applyTokenRef = useRef<string | null>(getApplyDeepLink())
  // ── Quest Coral ───────────────────────────────────────────────────────
  const [selectedQuestCoralProjectId, setSelectedQuestCoralProjectId] = useState<string | null>(null)
  // Loading flags — false until first snapshot arrives (prevents empty-state flash)
  const [contactsLoaded, setContactsLoaded] = useState(false)
  const [contextsLoaded, setContextsLoaded] = useState(false)
  const messageProjectIds = useMemo(() => projects.map((project) => project.id), [projects])
  const {
    messages,
    isLoaded: messagesLoaded,
    hasOlderMessages,
    isLoadingOlderMessages,
    loadOlderMessages,
  } = useMessageFeed({
    userId: firebaseUser?.uid,
    projectIds: messageProjectIds,
  })

  const importedContacts = useMemo(() => {
    const byId = new Map<string, ImportedContact>()
    globalImportedContacts.forEach((contact) => {
      byId.set(contact.id, contact)
    })
    return [...byId.values()]
  }, [globalImportedContacts])

  const directoryCompanies = useMemo(
    () => catalogIndex?.byType.company.map((entry) => ({ id: entry.sourceId, name: entry.name })) ?? [],
    [catalogIndex],
  )
  const directoryPeople = useMemo(
    () => catalogIndex?.byType.person.map((entry) => ({ id: entry.sourceId, name: entry.name })) ?? [],
    [catalogIndex],
  )

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
  const [applicationDeepLinkStatus, setApplicationDeepLinkStatus] = useState<ApplicationStatus | null>(null)
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const nextColorIndex = useRef(0)
  const [composeMode, setComposeMode] = useState<"fullscreen" | "sheet">("fullscreen")
  const [composeInitialProjectId, setComposeInitialProjectId] = useState<string | null>(null)
  const [composeInitialText, setComposeInitialText] = useState("")
  const [composeInitialContextIds, setComposeInitialContextIds] = useState<string[]>([])
  const [composeInitialAttachment, setComposeInitialAttachment] = useState<MessageFileAttachment | null>(null)
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
      // A candidate link owns the session regardless of sign-in state: the
      // person filling it in is not an SVC user. Crucially, do NOT set
      // firebaseUser here — that would start the whole-app Firestore listeners
      // (users/projects/contacts/…), which the candidate has no access to. The
      // candidate flow manages its own custom-token sign-in internally.
      if (applyTokenRef.current) {
        navigateTo("apply")
        return
      }
      if (user) {
        // Builds released before the isolated candidate Firebase app signed a
        // candidate into the primary auth instance. Do not let that legacy
        // token render the internal dashboard: it fails staff-only writes
        // (notably secure-link creation) with Firestore 403s. The candidate
        // screen itself is exempt above and keeps the staff session intact.
        void user.getIdTokenResult().then((tokenResult) => {
          if (applyTokenRef.current) return
          if (typeof tokenResult.claims.applicationId === "string" && tokenResult.claims.applicationId) {
            void signOut(auth)
            return
          }
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
          // Navigate immediately — don't block on Firestore. A WhatsApp/SVC
          // deep link only selects a screen; Firebase auth/rules still decide
          // whether its data can load. It takes precedence over the last module.
          const deepLink = getSvcDeepLink()
          if (deepLink?.kind === "directory") {
            setSelectedDirectoryId(deepLink.directoryId)
            setDirectoryDetailView(deepLink.view)
            navigateTo("directory-detail")
          } else if (deepLink?.kind === "application") {
            setSelectedApplicationId(deepLink.applicationId)
            navigateTo("application-detail")
          } else if (deepLink?.kind === "quest-coral") {
            setSelectedQuestCoralProjectId(deepLink.projectId)
            navigateTo("quest-coral-detail")
          } else if (deepLink?.kind === "communications") {
            // The link only seeds ordinary Stream filters. It does not bypass
            // the app's message visibility rules, which still run on load.
            setSelectedPeopleFilter([])
            setSelectedTagFilter([])
            setSelectedDateFilter([])
            setSelectedContextFilter([deepLink.contextId])
            navigateTo("stream")
          } else if (deepLink?.kind === "applications-queue") {
            setApplicationDeepLinkStatus(deepLink.status)
            navigateTo("applications")
          } else if (deepLink?.kind === "module") {
            navigateTo(deepLink.module === "communications" ? "stream" : deepLink.module)
          } else {
            // Default is Compose (Communications), unless the user last worked
            // in Directory, Applications or Quest Coral.
            const lastModule = getLastModule()
            navigateTo(
              lastModule === "directory"
                ? "directory"
                : lastModule === "applications"
                  ? "applications"
                  : lastModule === "quest-coral"
                    ? "quest-coral"
                    : lastModule === "bye-bye-dpr"
                      ? "bye-bye-dpr"
                      : "compose",
            )
          }
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
        }).catch(() => {
          void signOut(auth)
        })
        return
      } else {
        setFirebaseUser(null)
        setCurrentUser(null)
        setContacts([])
        setProjects([])
        setGlobalImportedContacts([])
        setCatalogIndex(null)
        setContactsLoaded(false)
        setContextsLoaded(false)
        setAppContexts([])
        navigateTo("login")
      }
    })
    return unsub
  }, [navigateTo])

  // ── Firestore listeners (only when authenticated) ──────────────────────
  useEffect(() => {
    if (!firebaseUser) return

    const usersMetric = createSnapshotMetric("users")
    const projectsMetric = createSnapshotMetric("projects")
    const categoriesMetric = createSnapshotMetric("categories")
    const contactsMetric = createSnapshotMetric("contacts")
    const contextsMetric = createSnapshotMetric("contexts")

    // 1. All users (contacts = everyone except me)
    const usersUnsub = onSnapshot(collection(db, "users"), (snap) => {
      usersMetric(snap)
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
          phone: data.phone ?? undefined,
          phoneNormalized: data.phoneNormalized ?? undefined,
          phoneSource: data.phoneSource ?? undefined,
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
    }, () => recordFirebaseMetricError("users"))

    // 2. All projects (tags are global — visible to any authenticated user)
    const projectsUnsub = onSnapshot(collection(db, "projects"), (snap) => {
      projectsMetric(snap)
      setProjects(snap.docs.map((d) => d.data() as Project))
    }, () => recordFirebaseMetricError("projects"))

    // 2b. User-created categories
    // Filter out any docs whose name shadows a system category (prevents duplicates)
    const _systemNames = new Set(["project","status","date / time","report","task","custom","type"])
    const categoriesUnsub = onSnapshot(collection(db, "categories"), (snap) => {
      categoriesMetric(snap)
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
    }, () => recordFirebaseMetricError("categories"))

    // 5. Imported contacts — all contacts are global; every authenticated user
    //    reads the whole collection (single listener, no visibility filter).
    const useCompactCatalog = USE_DIRECTORY_CATALOG
    const globalImportedContactsUnsub = useCompactCatalog
      ? () => {}
      : onSnapshot(collection(db, "contacts"), (snap) => {
          contactsMetric(snap)
          setGlobalImportedContacts(snap.docs.map((d) => mapImportedContactDoc(d.id, d.data())))
          setContactsLoaded(true)
        }, () => {
          recordFirebaseMetricError("contacts")
          setGlobalImportedContacts([])
          setContactsLoaded(true)
        })

    // 6. Contexts — global, no filter needed
    const contextsUnsub = useCompactCatalog ? () => {} : onSnapshot(collection(db, "contexts"), (snap) => {
      contextsMetric(snap)
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
      recordFirebaseMetricError("contexts")
      setAppContexts([])
      setContextsLoaded(true)
    })

    return () => {
      usersUnsub()
      projectsUnsub()
      categoriesUnsub()
      globalImportedContactsUnsub()
      contextsUnsub()
    }
  }, [firebaseUser])

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
      const catalogLoadMetric = createLoadMetric("directory.catalog")
      loadEntityCatalog(firebaseUser.uid, { onCache: applyCatalog })
        .then((index) => {
          catalogLoadMetric(index.documents.length)
          applyCatalog(index)
        })
        .catch(() => {
          recordFirebaseMetricError("directory.catalog")
          if (!active) return
          setContactsLoaded(true)
          setContextsLoaded(true)
        })
    }
    refresh()
    const directoryMetaMetric = createSnapshotMetric("directory.meta")
    const unsubscribe = onSnapshot(doc(db, "directoryMeta", "status"), (snapshot) => {
      directoryMetaMetric({
        size: snapshot.exists() ? 1 : 0,
        docChanges: () => [],
        metadata: snapshot.metadata,
      })
      if (firstMetaSnapshot) { firstMetaSnapshot = false; return }
      if (refreshTimer) window.clearTimeout(refreshTimer)
      refreshTimer = window.setTimeout(refresh, 350)
    }, () => recordFirebaseMetricError("directory.meta"))
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

  const handleRegister = useCallback(async (name: string, email: string, password: string, phone: string) => {
    const cred = await createUserWithEmailAndPassword(auth, email, password)
    const uid = cred.user.uid
    const initials = deriveInitials(name)
    const color = getUserAvatarColor(uid)
    const emailNormalized = normalizeEmail(email)
    const trimmedPhone = phone.trim()
    const userDoc: Contact = {
      id: uid,
      name,
      email: emailNormalized,
      emailNormalized,
      initials,
      color,
      ...(trimmedPhone ? { phone: trimmedPhone, phoneNormalized: normalizePhoneDigits(trimmedPhone) } : {}),
    }
    await setDoc(doc(db, "users", uid), {
      ...userDoc,
      ...(trimmedPhone ? { phoneSource: "registration" } : {}),
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
      if ((!text && !draft.imageFile && !draft.attachment) || !firebaseUser) { navigateTo("stream"); return }
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
      let feedbackReplyImage: {
        url: string
        path?: string
        name?: string
        contentType?: string
        size?: number
        width?: number
        height?: number
        blurHash?: string
      } | undefined

      // Pre-uploaded file attachment (e.g. outlook PDF) — reference it, no re-upload.
      const attachmentMeta: Record<string, unknown> = {}
      if (draft.attachment?.url) {
        attachmentMeta.fileUrl = draft.attachment.url
        attachmentMeta.fileName = draft.attachment.name
        attachmentMeta.fileContentType = draft.attachment.contentType
        if (typeof draft.attachment.size === "number") attachmentMeta.fileSize = draft.attachment.size
        if (draft.attachment.path) attachmentMeta.filePath = draft.attachment.path
      }

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
          feedbackReplyImage = {
            url: imageMeta.imageUrl as string,
            path: imagePath,
            name: imageFile.name,
            contentType: imageFile.type || "image/jpeg",
            size: imageFile.size,
          }
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
            if (feedbackReplyImage) {
              feedbackReplyImage.width = dims.w
              feedbackReplyImage.height = dims.h
            }
            if (dims.blurHash) {
              imageMeta.imageBlurHash = dims.blurHash
              if (feedbackReplyImage) feedbackReplyImage.blurHash = dims.blurHash
            }
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
        ...attachmentMeta,
      }
      const replyToMessage = draft.replyToId ? messages.find((message) => message.id === draft.replyToId) : undefined
      const isQuestCoralFeedbackReply = replyToMessage?.sourceModule === "quest-coral"
        && Boolean(replyToMessage.sourceQuestCoralFeedbackId)
      const isQuestCoralRedTeamReviewReply = replyToMessage?.sourceModule === "quest-coral"
        && Boolean(replyToMessage.sourceQuestCoralRedTeamReviewId)
      if (isQuestCoralFeedbackReply && draft.replyToId) {
        const feedbackReplyRef = doc(collection(db, "questCoralFeedbackReplies"))
        await publishQuestCoralFeedbackReply({
          replyId: feedbackReplyRef.id,
          replyToMessageId: draft.replyToId,
          body: text,
          authorName: firebaseUser.displayName ?? currentUser?.name ?? "Someone",
          requestedRecipientIds: peopleIds,
          contactIds: importedContactIds,
          calendarDates: draft.calendarDates ?? [],
          ...(feedbackReplyImage ? { image: feedbackReplyImage } : {}),
          ...(draft.attachment?.url ? {
            attachment: {
              url: draft.attachment.url,
              ...(draft.attachment.path ? { path: draft.attachment.path } : {}),
              ...(draft.attachment.name ? { name: draft.attachment.name } : {}),
              ...(draft.attachment.contentType ? { contentType: draft.attachment.contentType } : {}),
              ...(typeof draft.attachment.size === "number" ? { size: draft.attachment.size } : {}),
            },
          } : {}),
        })
      } else if (isQuestCoralRedTeamReviewReply && draft.replyToId) {
        const redTeamReviewReplyRef = doc(collection(db, "questCoralRedTeamReviewReplies"))
        await publishQuestCoralRedTeamReviewReply({
          replyId: redTeamReviewReplyRef.id,
          replyToMessageId: draft.replyToId,
          body: text,
          authorName: firebaseUser.displayName ?? currentUser?.name ?? "Someone",
          requestedRecipientIds: peopleIds,
          contactIds: importedContactIds,
          calendarDates: draft.calendarDates ?? [],
          ...(feedbackReplyImage ? { image: feedbackReplyImage } : {}),
          ...(draft.attachment?.url ? {
            attachment: {
              url: draft.attachment.url,
              ...(draft.attachment.path ? { path: draft.attachment.path } : {}),
              ...(draft.attachment.name ? { name: draft.attachment.name } : {}),
              ...(draft.attachment.contentType ? { contentType: draft.attachment.contentType } : {}),
              ...(typeof draft.attachment.size === "number" ? { size: draft.attachment.size } : {}),
            },
          } : {}),
        })
      } else {
        await addDoc(collection(db, "messages"), msgData)
      }
      setCalendarInitialDate(null)
      setComposeInitialText("")
      setComposeInitialContextIds([])
      setComposeInitialAttachment(null)
      navigateTo("stream")
    },
    [firebaseUser, currentUser?.name, importedContacts, messages, projects, navigateTo, showToast]
  )

  const handleDeleteMessage = useCallback(
    (id: string) => {
      // Capture message for Undo before deleting
      const target = messages.find((m) => m.id === id)
      if (!target) return
      if (target.sourceModule === "quest-coral") {
        showToast("Quest Coral feedback threads are read-only in Communications.", undefined, 3000)
        return
      }
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
    if (msg.sourceModule === "quest-coral") {
      showToast("Quest Coral feedback threads are read-only in Communications.", undefined, 3000)
      return
    }
    await updateDoc(doc(db, "messages", id), { isFavorited: !msg.isFavorited })
  }, [messages, showToast])

  const handleApplyTag = useCallback(
    async (peopleIds: string[], tagIds: string[], importedContactIds: string[] = [], calendarDates?: string[], contextIds?: string[]) => {
      if (!selectedMessageId) return
      const selectedMessage = messages.find((m) => m.id === selectedMessageId)
      if (!selectedMessage) return
      if (selectedMessage.sourceModule === "quest-coral") {
        showToast("Quest Coral feedback threads are read-only in Communications.", undefined, 3000)
        return
      }
      const resolvedPeopleIds = [...new Set([
        ...peopleIds,
        ...resolveLinkedImportedContactUserIds(importedContactIds, importedContacts),
      ].filter(Boolean))]
      // Tags classify the message; only explicit people grant visibility.
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
      if (message?.sourceModule === "quest-coral") {
        showToast("Quest Coral feedback threads are read-only in Communications.", undefined, 3000)
        return
      }
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
        const trimmedPhone = updates.phone?.trim()
        fields.phoneNormalized = trimmedPhone ? normalizePhoneDigits(trimmedPhone) : deleteField()
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

  const handleUpdateMyPhone = useCallback(
    async (phone: string | null): Promise<boolean> => {
      if (!firebaseUser) return false
      const trimmed = phone?.trim()
      if (trimmed && !isLikelyPhone(trimmed)) {
        showToast("Enter a valid phone number", undefined, 2500)
        return false
      }
      await updateDoc(doc(db, "users", firebaseUser.uid), {
        phone: trimmed || deleteField(),
        phoneNormalized: trimmed ? normalizePhoneDigits(trimmed) : deleteField(),
        phoneSource: trimmed ? "self-reported" : deleteField(),
        updatedAt: serverTimestamp(),
      })
      // The /users onSnapshot listener will pick this up too, but updating
      // currentUser immediately avoids a UI flash while it round-trips.
      setCurrentUser((current) => current
        ? { ...current, phone: trimmed || undefined, phoneNormalized: trimmed ? normalizePhoneDigits(trimmed) : undefined }
        : current)
      return true
    },
    [firebaseUser, showToast]
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
    setComposeInitialText("")
    setComposeInitialContextIds([])
    setComposeInitialAttachment(null)
    setComposeMode("sheet")
    navigateTo("compose")
  }, [navigateTo, activeFilter])
  const goToComposeFromProject = useCallback((projectId: string) => { setComposeInitialProjectId(projectId); setComposeInitialText(""); setComposeInitialContextIds([]); setComposeInitialAttachment(null); setComposeMode("sheet"); navigateTo("compose") }, [navigateTo])
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
  const goToSecretaryAi = useCallback(() => navigateTo("secretary-ai"), [navigateTo])
  const goToCourtneyRobertsCenter = useCallback(() => navigateTo("courtney-roberts-center"), [navigateTo])
  const goToCourtneyRobertsCenterThread = useCallback((conversationId: string) => {
    setSelectedCourtneyRobertsCenterConversationId(conversationId)
    navigateTo("courtney-roberts-center-thread")
  }, [navigateTo])
  const goToCourtneyRobertsCenterAccess = useCallback(() => navigateTo("courtney-roberts-center-access"), [navigateTo])
  const goToCourtneyRobertsCenterFormDetail = useCallback((submissionId: string) => {
    setSelectedOutlookFormSubmissionId(submissionId)
    navigateTo("courtney-roberts-center-form-detail")
  }, [navigateTo])

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
    setDirectoryDetailView("profile")
    navigateTo("directory-detail")
  }, [navigateTo])
  const handleDirectoryDetailBack = useCallback(() => {
    setSelectedDirectoryId(null)
    setDirectoryDetailView("profile")
    navigateTo("directory")
  }, [navigateTo])
  const handleDirectorySwitchToStream = useCallback(() => navigateTo("stream"), [navigateTo])

  // ── Applications navigation ───────────────────────────────────────────
  const goToApplications = useCallback(() => navigateTo("applications"), [navigateTo])
  const goToApplicationDetail = useCallback((applicationId: string) => {
    setSelectedApplicationId(applicationId)
    navigateTo("application-detail")
  }, [navigateTo])
  const handleApplicationDetailBack = useCallback(() => {
    setSelectedApplicationId(null)
    navigateTo("applications")
  }, [navigateTo])
  const handlePreviewCandidateFlow = useCallback((token: string) => {
    setApplyToken(token)
    navigateTo("apply")
  }, [navigateTo])
  const handleExitCandidatePreview = useCallback(() => {
    setApplyToken(null)
    navigateTo("applications")
  }, [navigateTo])

  // ── ByeByeDPR navigation ─────────────────────────────────────────────────
  const goToByeByeDpr = useCallback(() => navigateTo("bye-bye-dpr"), [navigateTo])

  // ── Quest Coral navigation ──────────────────────────────────────────────
  const goToQuestCoral = useCallback(() => navigateTo("quest-coral"), [navigateTo])
  const goToQuestCoralDetail = useCallback((projectId: string) => {
    setSelectedQuestCoralProjectId(projectId)
    navigateTo("quest-coral-detail")
  }, [navigateTo])
  const handleQuestCoralDetailBack = useCallback(() => {
    setSelectedQuestCoralProjectId(null)
    navigateTo("quest-coral")
  }, [navigateTo])
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
      setComposeInitialAttachment(null)
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
  const userPhone = currentUser?.phone ?? ""

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

  // Applications listeners only need to be live once the reviewer actually
  // opens the module — everyone else pays zero Firestore cost for it. Sticky
  // once true: switching away keeps the data warm instead of re-subscribing.
  const [hasEnteredApplications, setHasEnteredApplications] = useState(false)
  if (!hasEnteredApplications && (activeScreen === "applications" || activeScreen === "application-detail")) {
    setHasEnteredApplications(true)
  }
  const applicationsDashboard = useApplicationsDashboard(currentUser?.name ?? "You", firebaseUser?.uid ?? "", hasEnteredApplications)
  const selectedApplication = applicationsDashboard.getApplication(selectedApplicationId)
  // Activity is a subcollection: the hook only subscribes to the open candidate.
  const setApplicationsSelection = applicationsDashboard.setSelectedId
  useEffect(() => {
    setApplicationsSelection(selectedApplicationId)
  }, [selectedApplicationId, setApplicationsSelection])

  // Same lazy-activation as Applications above.
  const [hasEnteredQuestCoral, setHasEnteredQuestCoral] = useState(false)
  if (!hasEnteredQuestCoral && (activeScreen === "quest-coral" || activeScreen === "quest-coral-detail")) {
    setHasEnteredQuestCoral(true)
  }
  // Quest Coral selects its Firestore or local demo adapter from the public flag.
  const questCoralDashboard = useQuestCoralDashboard(firebaseUser?.uid ?? "", currentUser?.name ?? "You", hasEnteredQuestCoral)
  const selectedQuestCoralProject = questCoralDashboard.getProject(selectedQuestCoralProjectId)
  const selectedQuestCoralUpdates = selectedQuestCoralProject
    ? questCoralDashboard.updatesForProject(selectedQuestCoralProject.id)
    : []
  const selectedQuestCoralFeedbackReplies = selectedQuestCoralProject
    ? questCoralDashboard.feedbackRepliesForProject(selectedQuestCoralProject.id)
    : []
  const selectedQuestCoralRedTeamReviewReplies = selectedQuestCoralProject
    ? questCoralDashboard.redTeamReviewRepliesForProject(selectedQuestCoralProject.id)
    : []
  const selectedQuestCoralCoverage = selectedQuestCoralProject
    ? questCoralDashboard.coverageFor(selectedQuestCoralProject)
    : null

  // Same lazy-activation as Applications/Quest Coral above — the boot fetch
  // only ever runs once per session, on first entry, not on every switch.
  const [hasEnteredByeByeDpr, setHasEnteredByeByeDpr] = useState(false)
  if (!hasEnteredByeByeDpr && activeScreen === "bye-bye-dpr") {
    setHasEnteredByeByeDpr(true)
  }
  const byeByeDprDashboard = useByeByeDprDashboard(firebaseUser?.uid ?? "", hasEnteredByeByeDpr)

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
          onSecretaryAi={goToSecretaryAi}
          isAdmin={currentUser?.isAdmin === true}
          onAdmin={goToAdmin}
          onHelp={goToHelp}
        />
      )}

      {!showScreenSkeleton && activeScreen === "secretary-ai" && (
        <SecretaryAiScreen
          className={entranceClass}
          onBack={goToProfile}
          userPhone={userPhone}
          onUpdatePhone={handleUpdateMyPhone}
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

      {!showScreenSkeleton && activeScreen === "courtney-roberts-center" && (
        <CourtneyRobertsCenterScreen
          className={entranceClass}
          onSelectConversation={goToCourtneyRobertsCenterThread}
          onSelectFormSubmission={goToCourtneyRobertsCenterFormDetail}
          onManageAccess={goToCourtneyRobertsCenterAccess}
          onSwitchToStream={goToStream}
          onSwitchToDirectory={goToDirectoryFromStream}
          onSwitchToApplications={goToApplications}
          onSwitchToQuestCoral={goToQuestCoral}
          onSwitchToByeByeDpr={goToByeByeDpr}
        />
      )}

      {!showScreenSkeleton && activeScreen === "courtney-roberts-center-thread" && selectedCourtneyRobertsCenterConversationId && (
        <CourtneyRobertsCenterThreadScreen
          className={entranceClass}
          conversationId={selectedCourtneyRobertsCenterConversationId}
          onBack={() => navigateTo("courtney-roberts-center")}
        />
      )}

      {!showScreenSkeleton && activeScreen === "courtney-roberts-center-access" && (
        <CourtneyRobertsCenterAccessScreen
          className={entranceClass}
          onBack={() => navigateTo("courtney-roberts-center")}
        />
      )}

      {!showScreenSkeleton && activeScreen === "courtney-roberts-center-form-detail" && selectedOutlookFormSubmissionId && (
        <CourtneyRobertsCenterFormDetailScreen
          className={entranceClass}
          submissionId={selectedOutlookFormSubmissionId}
          onBack={() => navigateTo("courtney-roberts-center")}
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
          initialText={composeInitialText}
          initialContextIds={composeInitialContextIds}
          initialAttachment={composeInitialAttachment}
          initialCalendarDates={calendarInitialDate ? [calendarInitialDate] : undefined}
          availableTags={availableTags}
          contexts={appContexts}
          onCreateContext={handleCreateContext}
          isContactsLoading={!contactsLoaded}
          isContextsLoading={!contextsLoaded}
          onDirectory={goToDirectoryFromStream}
          onApplications={goToApplications}
          onQuestCoral={goToQuestCoral}
          onByeByeDpr={goToByeByeDpr}
          onCourtneyRobertsCenter={goToCourtneyRobertsCenter}
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
              onSwitchToApplications={goToApplications}
              onSwitchToQuestCoral={goToQuestCoral}
              onSwitchToByeByeDpr={goToByeByeDpr}
              onCourtneyRobertsCenter={goToCourtneyRobertsCenter}
            />
            {activeScreen === "directory-detail" && selectedDirectoryId && (
              <DirectoryProfileScreen
                className={entranceClass}
                directoryId={selectedDirectoryId}
                userId={firebaseUser.uid}
                initialView={directoryDetailView}
                onBack={handleDirectoryDetailBack}
                onOpenEntity={goToDirectoryDetail}
                companies={directoryCompanies}
                people={directoryPeople}
              />
            )}
          </div>
        </DirectoryStateProvider>
      )}

      {/* Candidate flow — reached by secure link (?apply=…) or previewed from
          the dashboard. Deliberately usable without an SVC account. */}
      {!showScreenSkeleton && activeScreen === "apply" && (
        <CandidateFlowScreen
          className={entranceClass}
          token={applyToken ?? applyTokenRef.current ?? "demo"}
          onExit={applyTokenRef.current ? undefined : handleExitCandidatePreview}
          // Only a token that arrived in the URL is a real candidate session;
          // dashboard previews stay on mock so they can't disturb the reviewer.
          preview={!applyTokenRef.current}
        />
      )}

      {!showScreenSkeleton && (activeScreen === "applications" || activeScreen === "application-detail") && firebaseUser && (
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          <ApplicationsListScreen
            className={activeScreen === "applications" ? `${entranceClass} h-full w-full` : "hidden"}
            dashboard={applicationsDashboard}
            initialStatusFilter={applicationDeepLinkStatus ?? undefined}
            onOpenApplication={goToApplicationDetail}
            onSwitchToStream={goToStream}
            onSwitchToDirectory={goToDirectoryFromStream}
            onSwitchToQuestCoral={goToQuestCoral}
            onSwitchToByeByeDpr={goToByeByeDpr}
            onCourtneyRobertsCenter={goToCourtneyRobertsCenter}
            onPreviewCandidateFlow={handlePreviewCandidateFlow}
          />
          {activeScreen === "application-detail" && selectedApplication && (
            <ApplicationDetailScreen
              className={entranceClass}
              application={selectedApplication}
              onBack={handleApplicationDetailBack}
              onRequestInfo={(message) => applicationsDashboard.requestInfo(selectedApplication.id, message)}
              onApprove={() => applicationsDashboard.approve(selectedApplication.id)}
              onMarkHired={() => applicationsDashboard.markHired(selectedApplication.id)}
              reviewer={applicationsDashboard.reviewer}
              onRecordActivity={(kind, message) => applicationsDashboard.recordActivity(selectedApplication.id, kind, message)}
              onArchive={async () => {
                const archived = await applicationsDashboard.archive(selectedApplication.id)
                if (archived) handleApplicationDetailBack()
                return archived
              }}
              onUnarchive={() => applicationsDashboard.unarchive(selectedApplication.id)}
              onDelete={async () => {
                const deleted = await applicationsDashboard.deleteApplication(selectedApplication.id)
                if (deleted) handleApplicationDetailBack()
                return deleted
              }}
              onRetryTranscription={() => applicationsDashboard.retryTranscription(selectedApplication.id)}
              onPreviewCandidateFlow={handlePreviewCandidateFlow}
            />
          )}
        </div>
      )}

      {!showScreenSkeleton && (activeScreen === "quest-coral" || activeScreen === "quest-coral-detail") && firebaseUser && (
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          <QuestCoralScreen
            className={activeScreen === "quest-coral" ? `${entranceClass} h-full w-full` : "hidden"}
            dashboard={questCoralDashboard}
            contacts={contacts}
            importedContacts={importedContacts}
            onOpenProject={goToQuestCoralDetail}
            onSwitchToStream={goToStream}
            onSwitchToDirectory={goToDirectoryFromStream}
            onSwitchToApplications={goToApplications}
            onSwitchToByeByeDpr={goToByeByeDpr}
            onCourtneyRobertsCenter={goToCourtneyRobertsCenter}
          />
          {activeScreen === "quest-coral-detail" && selectedQuestCoralProject && selectedQuestCoralCoverage && (
            <QuestCoralProjectDetailScreen
              className={entranceClass}
              project={selectedQuestCoralProject}
              updates={selectedQuestCoralUpdates}
              feedbackReplies={selectedQuestCoralFeedbackReplies}
              redTeamReviewReplies={selectedQuestCoralRedTeamReviewReplies}
              activityLoaded={questCoralDashboard.updatesLoaded}
              coverage={selectedQuestCoralCoverage}
              contacts={contacts}
              importedContacts={importedContacts}
              currentUserName={questCoralDashboard.currentUserName}
              onBack={handleQuestCoralDetailBack}
              onAddUpdate={(input) => questCoralDashboard.addUpdate(selectedQuestCoralProject.id, input)}
              onPatchProject={(patch) => questCoralDashboard.patchProject(selectedQuestCoralProject.id, patch)}
              onDeleteProject={() => questCoralDashboard.deleteProject(selectedQuestCoralProject.id)}
              onMarkProjectRead={() => questCoralDashboard.markProjectRead(selectedQuestCoralProject.id)}
            />
          )}
        </div>
      )}

      {!showScreenSkeleton && activeScreen === "bye-bye-dpr" && firebaseUser && (
        <ByeByeDprScreen
          className={`${entranceClass} h-full w-full`}
          dashboard={byeByeDprDashboard}
          userDisplayName={currentUser?.name || "there"}
          onSwitchToStream={goToStream}
          onSwitchToDirectory={goToDirectoryFromStream}
          onSwitchToApplications={goToApplications}
          onSwitchToQuestCoral={goToQuestCoral}
          onCourtneyRobertsCenter={goToCourtneyRobertsCenter}
        />
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
            onApplications={goToApplications}
            onQuestCoral={goToQuestCoral}
            onByeByeDpr={goToByeByeDpr}
            onCourtneyRobertsCenter={goToCourtneyRobertsCenter}
            onCopyMessage={handleCopyMessage}
            onSendMessage={handleSend}
            onCreateProject={handleCreateProject}
            onCreateContext={handleCreateContext}
            activeUsers={activeUsers}
            availableTags={availableTags}
            importedContacts={importedContacts}
            contexts={appContexts}
            isLoading={!messagesLoaded}
            hasOlderMessages={hasOlderMessages}
            isLoadingOlderMessages={isLoadingOlderMessages}
            onLoadOlderMessages={loadOlderMessages}
          />
          {/* The install promotion waits until Stream is ready; notification setup
              follows after installation when that is the prerequisite. */}
          {activeScreen === "stream" && firebaseUser && (
            <>
              <PwaInstallAutoPrompt />
              <NotificationPromptBanner
                userId={firebaseUser.uid}
                onNavigateToNotifications={goToNotificationsFromStream}
              />
            </>
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
                  initialText={composeInitialText}
                  initialContextIds={composeInitialContextIds}
                  initialCalendarDates={calendarInitialDate ? [calendarInitialDate] : undefined}
                  availableTags={availableTags}
                  contexts={appContexts}
                  onCreateContext={handleCreateContext}
                  isContactsLoading={!contactsLoaded}
                  isContextsLoading={!contextsLoaded}
                  onDirectory={goToDirectoryFromStream}
                  onApplications={goToApplications}
                  onQuestCoral={goToQuestCoral}
                  onByeByeDpr={goToByeByeDpr}
                  onCourtneyRobertsCenter={goToCourtneyRobertsCenter}
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
