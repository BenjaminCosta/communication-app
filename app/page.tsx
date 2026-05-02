"use client"

import { useState, useCallback, useRef, useEffect, useMemo } from "react"
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  type User,
} from "firebase/auth"
import {
  collection,
  doc,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore"
import { auth, db } from "@/lib/firebase"
import { StreamScreen } from "@/components/stream-screen"
import { ComposeScreen } from "@/components/compose-screen"
import { TagSheet } from "@/components/tag-sheet"
import { LoginScreen } from "@/components/login-screen"
import { RegisterScreen } from "@/components/register-screen"
import { ProfileScreen } from "@/components/profile-screen"
import { ProjectListScreen } from "@/components/project-list-screen"
import { ProjectDetailScreen } from "@/components/project-detail-screen"
import { NotificationsScreen } from "@/components/notifications-screen"
import { PrivacySecurityScreen } from "@/components/privacy-security-screen"
import { ToastNotification } from "@/components/toast-notification"
import {
  type Message,
  type MessageType,
  type Project,
  type Contact,
  PROJECT_COLORS,
  USER_COLORS,
  deriveNameFromEmail,
  deriveInitials,
  generateProjectId,
} from "@/lib/store"

type Screen =
  | "loading"
  | "login"
  | "register"
  | "stream"
  | "compose"
  | "tag"
  | "profile"
  | "notifications"
  | "privacy"
  | "projects"
  | "project-detail"

// Depth map — higher = further in the hierarchy
const SCREEN_DEPTH: Record<Screen, number> = {
  loading: -1,
  login: 0,
  register: 0,
  stream: 1,
  compose: 2,
  tag: 2,
  profile: 3,
  notifications: 4,
  privacy: 4,
  projects: 4,
  "project-detail": 5,
}

interface ToastState {
  message: string
  action?: { label: string; onClick: () => void }
  duration?: number
  key: number
}

export default function Home() {
  // ── Auth ──────────────────────────────────────────────────────────────
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null)
  const [currentUser, setCurrentUser] = useState<Contact | null>(null)

  // ── Firestore data ────────────────────────────────────────────────────
  const [contacts, setContacts] = useState<Contact[]>([])
  const [messages, setMessages] = useState<Message[]>([])
  const [projects, setProjects] = useState<Project[]>([])

  // ── Navigation ────────────────────────────────────────────────────────
  const [activeScreen, setActiveScreen] = useState<Screen>("loading")
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null)
  const [activeFilter, setActiveFilter] = useState<string>("all")
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const nextColorIndex = useRef(0)
  const [composeMode, setComposeMode] = useState<"fullscreen" | "sheet">("fullscreen")
  const notificationsReturnRef = useRef<Screen>("profile")

  // Directional transition tracking
  const prevScreenRef = useRef<Screen>("loading")
  const [entranceClass, setEntranceClass] = useState("animate-fade-in")

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
    if (prev === "login" || prev === "register" || next === "login" || next === "register") {
      setEntranceClass("animate-fade-in")
    } else {
      const d = SCREEN_DEPTH[next] - SCREEN_DEPTH[prev]
      setEntranceClass(
        d > 0 ? "animate-slide-in-right" : d < 0 ? "animate-slide-in-left" : "animate-fade-in"
      )
    }
    prevScreenRef.current = next
    setActiveScreen(next)
  }, [])

  // ── Auth state listener ───────────────────────────────────────────────
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setFirebaseUser(user)
        // User doc may not exist yet if created via createUserWithEmailAndPassword
        // We'll get it from contacts listener or create it here as fallback
        const name = user.displayName || deriveNameFromEmail(user.email ?? "")
        const initials = deriveInitials(name)
        setCurrentUser({
          id: user.uid,
          name,
          initials,
          color: "bg-primary",
        })
        navigateTo("compose")
      } else {
        setFirebaseUser(null)
        setCurrentUser(null)
        setContacts([])
        setMessages([])
        setProjects([])
        navigateTo("login")
      }
    })
    return unsub
  }, [navigateTo])

  // ── Firestore listeners (only when authenticated) ──────────────────────
  useEffect(() => {
    if (!firebaseUser) return

    // 1. All users (contacts = everyone except me)
    const usersUnsub = onSnapshot(collection(db, "users"), (snap) => {
      const all = snap.docs.map((d) => d.data() as Contact)
      setContacts(all.filter((u) => u.id !== firebaseUser.uid))
      // Update currentUser profile from Firestore
      const me = all.find((u) => u.id === firebaseUser.uid)
      if (me) setCurrentUser(me)
    })

    // 2. Projects where current user is a member
    const projectsQuery = query(
      collection(db, "projects"),
      where("members", "array-contains", firebaseUser.uid)
    )
    const projectsUnsub = onSnapshot(projectsQuery, (snap) => {
      setProjects(snap.docs.map((d) => d.data() as Project))
    })

    // 3. Messages where current user is a participant (sorted client-side to avoid composite index)
    const messagesQuery = query(
      collection(db, "messages"),
      where("participants", "array-contains", firebaseUser.uid)
    )
    const messagesUnsub = onSnapshot(messagesQuery, (snap) => {
      const msgs: Message[] = snap.docs.map((d) => {
        const data = d.data()
        return {
          id: d.id,
          senderId: data.senderId,
          participants: data.participants,
          projectId: data.projectId ?? null,
          text: data.text,
          type: data.type as MessageType,
          timestamp: data.timestamp instanceof Timestamp
            ? data.timestamp.toDate()
            : new Date(data.timestamp ?? 0),
          isFavorited: data.isFavorited ?? false,
        }
      })
      // Sort ascending by timestamp client-side
      msgs.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
      setMessages(msgs)
    })

    return () => {
      usersUnsub()
      projectsUnsub()
      messagesUnsub()
    }
  }, [firebaseUser])

  // ── Auth handlers ─────────────────────────────────────────────────────
  const handleLogin = useCallback(async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password)
    // onAuthStateChanged will handle navigation
  }, [])

  const handleRegister = useCallback(async (name: string, email: string, password: string) => {
    const cred = await createUserWithEmailAndPassword(auth, email, password)
    const uid = cred.user.uid
    const initials = deriveInitials(name)
    // Pick a random color
    const color = USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)]
    const userDoc: Contact = { id: uid, name, initials, color }
    await setDoc(doc(db, "users", uid), userDoc)
    // onAuthStateChanged will handle navigation
  }, [])

  const handleSignOut = useCallback(async () => {
    await signOut(auth)
    // onAuthStateChanged will navigate to login
  }, [])

  // ── Project handlers ──────────────────────────────────────────────────
  const handleCreateProject = useCallback(
    async (name: string, memberIds: string[] = []): Promise<Project> => {
      const color = PROJECT_COLORS[nextColorIndex.current % PROJECT_COLORS.length]
      nextColorIndex.current += 1
      const id = generateProjectId()
      const members = firebaseUser ? [...new Set([firebaseUser.uid, ...memberIds])] : memberIds
      const newProject: Project = { id, name: name.trim(), color, members, ownerId: firebaseUser?.uid ?? "" }
      await setDoc(doc(db, "projects", id), newProject)
      return newProject
    },
    [firebaseUser]
  )

  const handleUpdateProjectMembers = useCallback(
    async (projectId: string, memberIds: string[]) => {
      await updateDoc(doc(db, "projects", projectId), { members: memberIds })
    },
    []
  )

  // ── Message handlers ──────────────────────────────────────────────────
  const handleSend = useCallback(
    async (text: string, contactIds: string[], projectId: string | null, type: MessageType) => {
      if (!text.trim() || !firebaseUser) { navigateTo("stream"); return }
      const participants = [...new Set([firebaseUser.uid, ...contactIds])]
      const msgData = {
        senderId: firebaseUser.uid,
        participants,
        projectId: projectId ?? null,
        text: text.trim(),
        type,
        timestamp: serverTimestamp(),
        isFavorited: false,
      }
      await addDoc(collection(db, "messages"), msgData)
      navigateTo("stream")
      showToast("Sent ✓", undefined, 2000)
    },
    [firebaseUser, navigateTo, showToast]
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
            senderId: target.senderId,
            participants: target.participants,
            projectId: target.projectId ?? null,
            text: target.text,
            type: target.type,
            timestamp: Timestamp.fromDate(target.timestamp),
            isFavorited: target.isFavorited ?? false,
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
    async (type: MessageType, projectId: string | null) => {
      if (!selectedMessageId) return
      await updateDoc(doc(db, "messages", selectedMessageId), { type, projectId: projectId ?? null })
      setSelectedMessageId(null)
      navigateTo("stream")
      const label = type.charAt(0).toUpperCase() + type.slice(1)
      showToast(`Tagged as ${label}`, undefined, 2000)
    },
    [selectedMessageId, navigateTo, showToast]
  )

  // ── Navigation helpers ────────────────────────────────────────────────
  const handleMessageClick = useCallback((message: Message) => {
    setSelectedMessageId(message.id)
    navigateTo("tag")
  }, [navigateTo])

  const handleCloseTag = useCallback(() => {
    setSelectedMessageId(null)
    navigateTo("stream")
  }, [navigateTo])

  const goToCompose = useCallback(() => { setComposeMode("sheet"); navigateTo("compose") }, [navigateTo])
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
  const goToPrivacy = useCallback(() => navigateTo("privacy"), [navigateTo])
  const goToProjects = useCallback(() => navigateTo("projects"), [navigateTo])
  const goToProjectDetail = useCallback((projectId: string) => {
    setSelectedProjectId(projectId)
    navigateTo("project-detail")
  }, [navigateTo])

  // ── Derived values ────────────────────────────────────────────────────
  const userName = currentUser?.name ?? ""
  const userEmail = firebaseUser?.email ?? ""
  const userInitials = currentUser?.initials ?? ""

  const selectedMessage = messages.find((m) => m.id === selectedMessageId) || null

  const filteredMessages = useMemo(() =>
    activeFilter === "all"
      ? messages
      : activeFilter === "unsorted"
      ? messages.filter((m) => m.type === "none")
      : messages.filter((m) => m.projectId === activeFilter),
    [messages, activeFilter]
  )

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="h-dvh w-full flex flex-col bg-background overflow-hidden relative">

      {/* Loading splash */}
      {activeScreen === "loading" && (
        <div className="flex-1 flex items-center justify-center">
          <span className="w-8 h-8 rounded-full border-2 border-white/20 border-t-primary animate-spin" />
        </div>
      )}

      {activeScreen === "login" && (
        <LoginScreen onLogin={handleLogin} onGoRegister={() => navigateTo("register")} />
      )}

      {activeScreen === "register" && (
        <RegisterScreen onRegister={handleRegister} onGoLogin={() => navigateTo("login")} />
      )}

      {activeScreen === "profile" && (
        <ProfileScreen
          className={entranceClass}
          userName={userName}
          userEmail={userEmail}
          userInitials={userInitials}
          projectCount={projects.length}
          messageCount={messages.length}
          onBack={goToStream}
          onSignOut={handleSignOut}
          onNotifications={goToNotificationsFromProfile}
          onPrivacy={goToPrivacy}
          onProjects={goToProjects}
        />
      )}

      {activeScreen === "notifications" && (
        <NotificationsScreen className={entranceClass} onBack={handleNotificationsBack} />
      )}

      {activeScreen === "privacy" && (
        <PrivacySecurityScreen className={entranceClass} onBack={goToProfile} />
      )}

      {activeScreen === "projects" && (
        <ProjectListScreen
          className={entranceClass}
          projects={projects}
          messages={messages}
          contacts={contacts}
          onBack={goToProfile}
          onProjectSelect={goToProjectDetail}
          onCreateProject={handleCreateProject}
        />
      )}

      {activeScreen === "project-detail" && selectedProjectId && (() => {
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
            onUpdateMembers={handleUpdateProjectMembers}
          />
        )
      })()}

      {activeScreen === "compose" && composeMode === "fullscreen" && (
        <ComposeScreen
          mode="fullscreen"
          onCancel={goToStream}
          onSend={handleSend}
          projects={projects}
          onCreateProject={handleCreateProject}
          contacts={contacts}
        />
      )}

      {(activeScreen === "stream" ||
        (activeScreen === "compose" && composeMode === "sheet") ||
        activeScreen === "tag") && (
        <>
          <StreamScreen
            messages={filteredMessages}
            activeFilter={activeFilter}
            onFilterChange={setActiveFilter}
            onCompose={goToCompose}
            onMessageClick={handleMessageClick}
            onNewProject={handleCreateProject}
            onProfile={goToProfile}
            onNotifications={goToNotificationsFromStream}
            onDeleteMessage={handleDeleteMessage}
            onFavoriteMessage={handleFavoriteMessage}
            userInitials={userInitials}
            projects={projects}
            contacts={contacts}
            currentUserId={currentUser?.id ?? ""}
          />
          {activeScreen === "compose" && (
            <div
              className="fixed inset-0 z-40 flex flex-col justify-end md:items-center md:justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
              style={{ paddingBottom: "env(keyboard-inset-height, 0px)" }}
            >
              <div className="h-[90%] md:h-auto md:w-140 md:max-h-[80vh] md:rounded-3xl md:overflow-hidden animate-in slide-in-from-bottom duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] flex flex-col shadow-2xl">
                <ComposeScreen
                  mode="sheet"
                  onCancel={goToStream}
                  onSend={handleSend}
                  projects={projects}
                  onCreateProject={handleCreateProject}
                  contacts={contacts}
                />
              </div>
            </div>
          )}
          {activeScreen === "tag" && selectedMessage && (
            <TagSheet
              message={selectedMessage}
              onApply={handleApplyTag}
              onClose={handleCloseTag}
              projects={projects}
              onCreateProject={handleCreateProject}
              contacts={contacts}
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
