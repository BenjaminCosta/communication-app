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
  writeBatch,
  onSnapshot,
  query,
  where,
  getDocs,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore"
import { getDownloadURL, ref, uploadBytes } from "firebase/storage"
import { auth, db, storage } from "@/lib/firebase"
import { haptic, getUserAvatarColor } from "@/lib/utils"
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
import { AppLoadingScreen, AppScreenSkeleton } from "@/components/app-loading-screen"
import {
  type Message,
  type MessageDraft,
  type MessageType,
  type Project,
  type Contact,
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
    imageUrl: data.imageUrl,
    imagePath: data.imagePath,
    imageName: data.imageName,
    imageContentType: data.imageContentType,
  }
}

function sanitizeStorageName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 90) || "image"
}

export default function Home() {
  // ── Auth ──────────────────────────────────────────────────────────────
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null)
  const [currentUser, setCurrentUser] = useState<Contact | null>(null)

  // ── Firestore data ────────────────────────────────────────────────────
  const [contacts, setContacts] = useState<Contact[]>([])
  const [participantMessages, setParticipantMessages] = useState<Message[]>([])
  const [projectMessages, setProjectMessages] = useState<Message[]>([])
  const [visibleMessages, setVisibleMessages] = useState<Message[]>([])
  const [projects, setProjects] = useState<Project[]>([])

  // Merged feed: union of all message sources, deduped by ID.
  // participantMessages = legacy query (array-contains participants)
  // projectMessages     = legacy query (array-contains projectId)
  // visibleMessages     = new query (array-contains visibleToUserIds)
  const messages = useMemo(() => {
    const byId = new Map<string, Message>()
    participantMessages.forEach((m) => byId.set(m.id, m))
    projectMessages.forEach((m) => byId.set(m.id, m))
    visibleMessages.forEach((m) => byId.set(m.id, m))
    return [...byId.values()].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
  }, [participantMessages, projectMessages, visibleMessages])

  // ── Navigation ────────────────────────────────────────────────────────
  const [activeScreen, setActiveScreen] = useState<Screen>("loading")
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null)
  const [activeFilter, setActiveFilter] = useState<string>("all")
  const [selectedPeopleFilter, setSelectedPeopleFilter] = useState<string[]>([])
  const [selectedTagFilter, setSelectedTagFilter] = useState<string[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const nextColorIndex = useRef(0)
  const [listenerKey, setListenerKey] = useState(0)
  const [composeMode, setComposeMode] = useState<"fullscreen" | "sheet">("fullscreen")
  const [composeInitialProjectId, setComposeInitialProjectId] = useState<string | null>(null)
  const notificationsReturnRef = useRef<Screen>("profile")

  // Directional transition tracking
  const prevScreenRef = useRef<Screen>("loading")
  const [entranceClass, setEntranceClass] = useState("animate-fade-in")
  const [showScreenSkeleton, setShowScreenSkeleton] = useState(false)
  const skeletonTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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
    if (skeletonTimerRef.current) clearTimeout(skeletonTimerRef.current)
    const shouldSkeleton = prev !== "loading" && next === "project-detail"
    setShowScreenSkeleton(shouldSkeleton)
    if (shouldSkeleton) {
      skeletonTimerRef.current = setTimeout(() => setShowScreenSkeleton(false), 180)
    }
    prevScreenRef.current = next
    setActiveScreen(next)
  }, [])

  useEffect(() => {
    return () => {
      if (skeletonTimerRef.current) clearTimeout(skeletonTimerRef.current)
    }
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
          color: getUserAvatarColor(user.uid),
        })
        navigateTo("compose")
      } else {
        setFirebaseUser(null)
        setCurrentUser(null)
        setContacts([])
        setParticipantMessages([])
        setProjectMessages([])
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
      const all = snap.docs.map((d) => {
        const data = d.data()
        return {
          id: data.id ?? d.id,
          name: data.name,
          initials: data.initials,
          color: data.color ?? getUserAvatarColor(d.id),
          lastSeen: data.lastSeen instanceof Timestamp ? data.lastSeen.toDate() : null,
        } as Contact
      })
      setContacts(all.filter((u) => u.id !== firebaseUser.uid))
      // Update currentUser profile from Firestore
      const me = all.find((u) => u.id === firebaseUser.uid)
      if (me) setCurrentUser(me)
    }, () => {})

    // 2. Projects where current user is a member
    const projectsQuery = query(
      collection(db, "projects"),
      where("members", "array-contains", firebaseUser.uid)
    )
    const projectsUnsub = onSnapshot(projectsQuery, (snap) => {
      setProjects(snap.docs.map((d) => d.data() as Project))
    }, () => {})

    // 3. Messages where current user is a participant (legacy, kept for backward compat)
    const messagesQuery = query(
      collection(db, "messages"),
      where("participants", "array-contains", firebaseUser.uid)
    )
    const messagesUnsub = onSnapshot(messagesQuery, (snap) => {
      setParticipantMessages(snap.docs.map((d) => mapMessageDoc(d.id, d.data())))
    }, () => {
      // Restart all listeners after a brief delay if a permission error occurs
      setTimeout(() => setListenerKey((k) => k + 1), 3000)
    })

    // 4. Messages via visibleToUserIds (new visibility model — forward compat)
    const visibleQuery = query(
      collection(db, "messages"),
      where("visibleToUserIds", "array-contains", firebaseUser.uid)
    )
    const visibleUnsub = onSnapshot(visibleQuery, (snap) => {
      setVisibleMessages(snap.docs.map((d) => mapMessageDoc(d.id, d.data())))
    }, () => {
      setVisibleMessages([])
    })

    return () => {
      usersUnsub()
      projectsUnsub()
      messagesUnsub()
      visibleUnsub()
    }
  }, [firebaseUser, listenerKey])

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
    const interval = window.setInterval(updateLastSeen, 30000)
    const onVisibility = () => {
      if (document.visibilityState === "visible") updateLastSeen()
    }
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [firebaseUser])

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
    await signInWithEmailAndPassword(auth, email, password)
    // onAuthStateChanged will handle navigation
  }, [])

  const handleRegister = useCallback(async (name: string, email: string, password: string) => {
    const cred = await createUserWithEmailAndPassword(auth, email, password)
    const uid = cred.user.uid
    const initials = deriveInitials(name)
    const color = getUserAvatarColor(uid)
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
      const newProject: Project = {
        id,
        name: name.trim(),
        color,
        members,
        ownerId: firebaseUser?.uid ?? "",
        tagCategory: members.length > 1 ? "project" : "custom",
      }
      await setDoc(doc(db, "projects", id), newProject)
      showToast(`"${newProject.name}" created`, undefined, 2500)
      return newProject
    },
    [firebaseUser, showToast]
  )

  const handleUpdateProjectMembers = useCallback(
    async (projectId: string, memberIds: string[]) => {
      await updateDoc(doc(db, "projects", projectId), { members: memberIds })
    },
    []
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
        // Recompute visibility without the deleted project's members
        const visibleToUserIds = computeVisibleToUserIds(
          m.authorId ?? m.senderId,
          m.recipientIds ?? [],
          remainingTagIds,
          projects
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
    async (id: string, name: string) => {
      const nextName = name.trim()
      if (!nextName) return
      await updateDoc(doc(db, "projects", id), { name: nextName })
      showToast("Tag renamed ✓", undefined, 2000)
    },
    [showToast]
  )

  // ── Message handlers ──────────────────────────────────────────────────
  const handleSend = useCallback(
    async (draft: MessageDraft) => {
      const text = draft.text.trim()
      if ((!text && !draft.imageFile) || !firebaseUser) { navigateTo("stream"); return }
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
      const peopleIds = [...new Set([...(draft.peopleIds ?? draft.contactIds)].filter(Boolean))]
      const projectMembers = projectIds.flatMap((projectId) => projects.find((p) => p.id === projectId)?.members ?? [])
      const participants = [...new Set([firebaseUser.uid, ...peopleIds, ...projectMembers])]
      const imageMeta: Partial<Message> = {}

      if (draft.imageFile) {
        try {
          const safeName = sanitizeStorageName(draft.imageFile.name)
          const imagePath = `message-images/${firebaseUser.uid}/${Date.now()}-${safeName}`
          const imageRef = ref(storage, imagePath)
          await uploadBytes(imageRef, draft.imageFile, { contentType: draft.imageFile.type || "image/jpeg" })
          imageMeta.imageUrl = await getDownloadURL(imageRef)
          imageMeta.imagePath = imagePath
          imageMeta.imageName = draft.imageFile.name
          imageMeta.imageContentType = draft.imageFile.type || "image/jpeg"
        } catch (error) {
          showToast("Image upload failed. Check Firebase Storage setup.", undefined, 3500)
          throw error
        }
      }

      const visibleToUserIds = computeVisibleToUserIds(
        firebaseUser.uid,
        peopleIds,
        tagIds,
        projects
      )

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
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        timestamp: serverTimestamp(),
        isFavorited: false,
        ...imageMeta,
      }
      await addDoc(collection(db, "messages"), msgData)
      navigateTo("stream")
    },
    [firebaseUser, projects, navigateTo, showToast]
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
    async (peopleIds: string[], tagIds: string[]) => {
      if (!selectedMessageId) return
      const selectedMessage = messages.find((m) => m.id === selectedMessageId)
      if (!selectedMessage) return
      // Always include all project members so they receive the message
      const type = getLegacyTypeFromTagIds(tagIds, "none")
      const projectIds = getLegacyProjectIdsFromTagIds(tagIds, [])
      const selectedProjectIds = [...new Set(projectIds.filter(Boolean))]
      const projectMembers = selectedProjectIds.flatMap((projectId) => projects.find((p) => p.id === projectId)?.members ?? [])
      // NEVER shrink participants — tag edits only ADD access, never revoke it.
      // Existing participants keep access; new project members and people tags are added.
      const mergedParticipants = [...new Set([
        ...selectedMessage.participants,  // preserve all existing access
        selectedMessage.senderId,         // always include sender
        firebaseUser!.uid,                // always include the person editing
        ...peopleIds,
        ...projectMembers,
      ])]

      // Compute visibleToUserIds fresh from the new tags + recipients
      const authorId = selectedMessage.authorId ?? selectedMessage.senderId
      const visibleToUserIds = computeVisibleToUserIds(
        authorId,
        peopleIds,
        tagIds,
        projects
      )

      await updateDoc(doc(db, "messages", selectedMessageId), {
        type,
        recipientIds: peopleIds.filter((id) => id !== selectedMessage.senderId),
        peopleIds: peopleIds.filter((id) => id !== selectedMessage.senderId),
        projectIds: selectedProjectIds,
        projectId: selectedProjectIds[0] ?? null,
        tagIds,
        participants: mergedParticipants,
        visibleToUserIds,
        updatedAt: serverTimestamp(),
      })
      setSelectedMessageId(null)
      navigateTo("stream")
      const parts: string[] = []
      if (type !== "none") parts.push(type.charAt(0).toUpperCase() + type.slice(1))
      if (selectedProjectIds.length) parts.push(selectedProjectIds.length === 1 ? "tag" : "tags")
      showToast(parts.length ? `Tagged: ${parts.join(", ")} ✓` : "Context saved ✓", undefined, 2000)
    },
    [selectedMessageId, projects, messages, navigateTo, showToast]
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
      // Recompute visibility: author + direct recipients + remaining tag members
      const visibleToUserIds = message
        ? computeVisibleToUserIds(
            message.authorId ?? message.senderId,
            message.recipientIds ?? [],
            remainingTagIds,
            projects
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

  // ── Navigation helpers ────────────────────────────────────────────────
  const handleMessageClick = useCallback((message: Message) => {
    setSelectedMessageId(message.id)
    navigateTo("tag")
  }, [navigateTo])

  const handleCloseTag = useCallback(() => {
    setSelectedMessageId(null)
    navigateTo("stream")
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
  const goToPrivacy = useCallback(() => navigateTo("privacy"), [navigateTo])

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

    const filterablePeopleIds = new Set<string>()
    if (message.senderId) filterablePeopleIds.add(message.senderId)
    if (message.authorId) filterablePeopleIds.add(message.authorId)

    const recipientIds = (message.recipientIds ?? []).filter(Boolean)
    const storedPeopleIds = (message.peopleIds ?? []).filter(Boolean)

    recipientIds.forEach((id) => filterablePeopleIds.add(id))
    storedPeopleIds.forEach((id) => filterablePeopleIds.add(id))

    return peopleIds.some((id) => filterablePeopleIds.has(id))
  }, [])

  const filteredMessages = useMemo(() =>
    messages.filter((message) =>
      messageMatchesPeopleFilter(message, selectedPeopleFilter) &&
      messageHasTags(message, selectedTagFilter)
    ),
    [messages, messageMatchesPeopleFilter, selectedPeopleFilter, selectedTagFilter]
  )

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="h-dvh w-full flex flex-col bg-background overflow-hidden relative">

      {/* Loading splash */}
      {activeScreen === "loading" && <AppLoadingScreen />}

      {showScreenSkeleton && activeScreen !== "loading" && <AppScreenSkeleton />}

      {!showScreenSkeleton && activeScreen === "login" && (
        <LoginScreen onLogin={handleLogin} onGoRegister={() => navigateTo("register")} />
      )}

      {!showScreenSkeleton && activeScreen === "register" && (
        <RegisterScreen onRegister={handleRegister} onGoLogin={() => navigateTo("login")} />
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
          onPrivacy={goToPrivacy}
          onProjects={goToProjects}
        />
      )}

      {!showScreenSkeleton && activeScreen === "notifications" && (
        <NotificationsScreen className={entranceClass} onBack={handleNotificationsBack} />
      )}

      {!showScreenSkeleton && activeScreen === "privacy" && (
        <PrivacySecurityScreen className={entranceClass} onBack={goToProfile} />
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
            onUpdateMembers={handleUpdateProjectMembers}
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
          initialProjectId={composeInitialProjectId}
          availableTags={availableTags}
        />
      )}

      {!showScreenSkeleton && (activeScreen === "stream" ||
        (activeScreen === "compose" && composeMode === "sheet") ||
        activeScreen === "tag") && (
        <>
          <StreamScreen
            messages={filteredMessages}
            activeFilter={activeFilter}
            onFilterChange={setActiveFilter}
            selectedPeopleFilter={selectedPeopleFilter}
            selectedTagFilter={selectedTagFilter}
            onPeopleFilterChange={setSelectedPeopleFilter}
            onTagFilterChange={setSelectedTagFilter}
            onCompose={goToCompose}
            onMessageClick={handleMessageClick}
            onNewProject={handleCreateProject}
            onProfile={goToProfile}
            onNotifications={goToNotificationsFromStream}
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
            onCopyMessage={handleCopyMessage}
            onSendMessage={handleSend}
            onCreateProject={handleCreateProject}
            activeUsers={activeUsers}
            availableTags={availableTags}
          />
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
                  initialProjectId={composeInitialProjectId}
                  availableTags={availableTags}
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
              availableTags={availableTags}
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
