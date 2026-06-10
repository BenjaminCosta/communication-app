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
  arrayUnion,
  arrayRemove,
  deleteField,
} from "firebase/firestore"
import { getDownloadURL, ref, uploadBytes } from "firebase/storage"
import { auth, db, storage } from "@/lib/firebase"
import { compressImageFile, validateImageFile } from "@/lib/image-upload"
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
import { PeopleScreen } from "@/components/people-screen"
import { AdminScreen } from "@/components/admin-screen"
import { CalendarScreen } from "@/components/calendar-screen"
import { ToastNotification } from "@/components/toast-notification"
import { AppLoadingScreen, AppScreenSkeleton } from "@/components/app-loading-screen"
import {
  type Message,
  type MessageDraft,
  type MessageType,
  type Project,
  type Contact,
  type ImportedContact,
  type TagCategory,
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
  type CategoryItem,
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
  | "people"
  | "admin"
  | "calendar"

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
  privacy: 4,
  projects: 4,
  people: 4,
  admin: 4,
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
    contactIds: Array.isArray(data.contactIds) ? data.contactIds.filter(Boolean) : [],
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
  const [customCategories, setCustomCategories] = useState<CategoryItem[]>([])
  const [importedContacts, setImportedContacts] = useState<ImportedContact[]>([])

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
        const name = user.displayName || deriveNameFromEmail(user.email ?? "")
        const initials = deriveInitials(name)
        setCurrentUser({
          id: user.uid,
          name,
          initials,
          color: getUserAvatarColor(user.uid),
          email: user.email ?? undefined,
        })
        // Ensure email is always persisted so other users can see it
        await setDoc(doc(db, "users", user.uid), { email: user.email ?? "" }, { merge: true })
        navigateTo("compose")
      } else {
        setFirebaseUser(null)
        setCurrentUser(null)
        setContacts([])
        setParticipantMessages([])
        setProjectMessages([])
        setProjects([])
        setImportedContacts([])
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
          email: data.email ?? undefined,
          initials: data.initials,
          color: data.color ?? getUserAvatarColor(d.id),
          lastSeen: data.lastSeen instanceof Timestamp ? data.lastSeen.toDate() : null,
          isAdmin: data.isAdmin === true,
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

    // 2b. User-created categories
    const categoriesUnsub = onSnapshot(collection(db, "categories"), (snap) => {
      setCustomCategories(
        snap.docs.map((d) => ({
          id: d.id,
          name: d.data().name as string,
          isSystem: false,
          isTimeBased: d.data().isTimeBased ?? false,
        }))
      )
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

    // 5. Imported contacts — strictly private, owner-only
    const contactsQuery = query(
      collection(db, "contacts"),
      where("ownerUserId", "==", firebaseUser.uid)
    )
    const importedContactsUnsub = onSnapshot(contactsQuery, (snap) => {
      setImportedContacts(snap.docs.map((d) => {
        const data = d.data()
        return {
          id: d.id,
          ownerUserId: data.ownerUserId,
          name: data.name,
          email: data.email ?? undefined,
          phone: data.phone ?? undefined,
          source: data.source ?? "manual",
          tags: Array.isArray(data.tags) ? data.tags : [],
          linkedUserId: data.linkedUserId ?? null,
          status: data.status ?? "not_registered",
          visibility: data.visibility ?? "private",
          createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toDate() : new Date(),
          updatedAt: data.updatedAt instanceof Timestamp ? data.updatedAt.toDate() : new Date(),
        } as ImportedContact
      }))
    }, () => {
      setImportedContacts([])
    })

    return () => {
      usersUnsub()
      projectsUnsub()
      categoriesUnsub()
      messagesUnsub()
      visibleUnsub()
      importedContactsUnsub()
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
    const userDoc: Contact = { id: uid, name, email, initials, color }
    await setDoc(doc(db, "users", uid), userDoc)
    // onAuthStateChanged will handle navigation
  }, [])

  const handleSignOut = useCallback(async () => {
    await signOut(auth)
    // onAuthStateChanged will navigate to login
  }, [])

  // ── Project handlers ──────────────────────────────────────────────────
  const handleCreateProject = useCallback(
    async (name: string, memberIds: string[] = [], category?: TagCategory): Promise<Project> => {
      const color = PROJECT_COLORS[nextColorIndex.current % PROJECT_COLORS.length]
      nextColorIndex.current += 1
      const id = generateProjectId()
      const members = firebaseUser ? [...new Set([firebaseUser.uid, ...memberIds])] : memberIds
      // Use user-selected category; fallback: "project" if multiple members, else "custom"
      const tagCategory = category ?? (members.length > 1 ? "project" : "custom")
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

  const handleCreateCategory = useCallback(
    async (name: string) => {
      if (!firebaseUser || !name.trim()) return
      await addDoc(collection(db, "categories"), {
        name: name.trim(),
        createdBy: firebaseUser.uid,
        createdAt: serverTimestamp(),
        isTimeBased: false,
      })
      showToast(`Category "${name.trim()}" created`, undefined, 2000)
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
      const participants = [...new Set([firebaseUser.uid, ...peopleIds])]
      const imageMeta: Record<string, unknown> = {}

      if (draft.imageFile) {
        const validationError = validateImageFile(draft.imageFile)
        if (validationError) {
          showToast(validationError, undefined, 3500)
          throw new Error(validationError)
        }
        try {
          const imageFile = await compressImageFile(draft.imageFile)
          const safeName = sanitizeStorageName(imageFile.name)
          const imagePath = `message-images/${firebaseUser.uid}/${Date.now()}-${safeName}`
          const imageRef = ref(storage, imagePath)
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
        contactIds: draft.importedContactIds ?? [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        timestamp: serverTimestamp(),
        isFavorited: false,
        ...(calendarDateObjects.length > 0 ? { calendarDates: calendarDateObjects } : {}),
        ...(draft.replyToId ? { replyToId: draft.replyToId, replyPreview: draft.replyPreview } : {}),
        ...imageMeta,
      }
      await addDoc(collection(db, "messages"), msgData)
      setCalendarInitialDate(null)
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
    async (peopleIds: string[], tagIds: string[], importedContactIds: string[] = [], calendarDates?: string[]) => {
      if (!selectedMessageId) return
      const selectedMessage = messages.find((m) => m.id === selectedMessageId)
      if (!selectedMessage) return
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
        ...peopleIds,
      ])]

      // Compute visibleToUserIds from author + explicit recipients only
      const authorId = selectedMessage.authorId ?? selectedMessage.senderId
      const visibleToUserIds = computeVisibleToUserIds(
        authorId,
        peopleIds
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
        recipientIds: peopleIds.filter((id) => id !== selectedMessage.senderId),
        peopleIds: peopleIds.filter((id) => id !== selectedMessage.senderId),
        projectIds: selectedProjectIds,
        projectId: selectedProjectIds[0] ?? null,
        tagIds,
        participants: mergedParticipants,
        visibleToUserIds,
        contactIds: importedContactIds,
        ...(newCalendarDates !== undefined ? { calendarDates: newCalendarDates } : {}),
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
      newContacts.forEach((c) => {
        const ref = doc(collection(db, "contacts"))
        batch.set(ref, {
          ownerUserId: c.ownerUserId,
          name: c.name,
          source: c.source,
          tags: c.tags,
          linkedUserId: c.linkedUserId,
          status: c.status,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          ...(c.email != null && { email: c.email }),
          ...(c.phone != null && { phone: c.phone }),
        })
      })
      await batch.commit()
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
    },
    []
  )

  const handleRemoveTagFromContact = useCallback(
    async (contactId: string, tag: string) => {
      await updateDoc(doc(db, "contacts", contactId), {
        tags: arrayRemove(tag),
        updatedAt: serverTimestamp(),
      })
    },
    []
  )

  const handleDeleteImportedContact = useCallback(
    async (contactId: string) => {
      haptic.destructive()
      await deleteDoc(doc(db, "contacts", contactId))
      showToast("Contact removed", undefined, 2000)
    },
    [showToast]
  )

  const handleUpdateImportedContact = useCallback(
    async (contactId: string, updates: { email?: string | null; phone?: string | null }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fields: Record<string, any> = { updatedAt: serverTimestamp() }
      if ("email" in updates) {
        fields.email = updates.email?.trim() ? updates.email.trim() : deleteField()
      }
      if ("phone" in updates) {
        fields.phone = updates.phone?.trim() ? updates.phone.trim() : deleteField()
      }
      await updateDoc(doc(db, "contacts", contactId), fields)
    },
    []
  )

  const handleSetContactVisibility = useCallback(
    async (contactId: string, visibility: "private" | "global") => {
      await updateDoc(doc(db, "contacts", contactId), {
        visibility,
        updatedAt: serverTimestamp(),
      })
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
  const goToPrivacy = useCallback(() => navigateTo("privacy"), [navigateTo])
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

  const goToCalendar = useCallback(() => navigateTo("calendar"), [navigateTo])

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
      const projectIds = getLegacyProjectIdsFromTagIds(incomingTagIds, []).filter(Boolean)
      const legacyType = getLegacyTypeFromTagIds(incomingTagIds, "none")
      const tagIds = [...new Set([
        ...incomingTagIds,
        ...getMessageTagIds({ tagIds: undefined, type: legacyType, projectId: projectIds[0] ?? null, projectIds, project_id: null }),
      ])]
      const participants = [...new Set([firebaseUser.uid, ...peopleIds])]
      const visibleToUserIds = computeVisibleToUserIds(firebaseUser.uid, peopleIds)
      const calendarDateObj = {
        id: `cd-${Date.now()}-0-${Math.random().toString(36).slice(2, 6)}`,
        date,
        createdAt: Timestamp.now(),
        createdBy: firebaseUser.uid,
      }
      await addDoc(collection(db, "messages"), {
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
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        timestamp: serverTimestamp(),
        isFavorited: false,
        calendarDates: [calendarDateObj],
      })
    },
    [firebaseUser, projects]
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
        (message.calendarDates ?? []).some((calendarDate) => selectedDateFilter.includes(calendarDate.date)))
    ),
    [messages, messageMatchesPeopleFilter, selectedPeopleFilter, selectedTagFilter, selectedDateFilter]
  )

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="h-full w-full flex flex-col bg-background overflow-hidden relative">

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
          onPeople={goToPeople}
          isAdmin={currentUser?.isAdmin === true}
          onAdmin={goToAdmin}
        />
      )}

      {!showScreenSkeleton && activeScreen === "notifications" && (
        <NotificationsScreen className={entranceClass} onBack={handleNotificationsBack} />
      )}

      {!showScreenSkeleton && activeScreen === "admin" && currentUser?.isAdmin && (
        <AdminScreen
          className={entranceClass}
          currentUser={currentUser}
          allUsers={[currentUser, ...contacts]}
          onBack={goToProfile}
        />
      )}

      {!showScreenSkeleton && activeScreen === "privacy" && (
        <PrivacySecurityScreen className={entranceClass} onBack={goToProfile} />
      )}

      {!showScreenSkeleton && activeScreen === "people" && currentUser && (
        <PeopleScreen
          className={entranceClass}
          contacts={contacts}
          currentUser={currentUser}
          importedContacts={importedContacts}
          registeredUsers={[currentUser, ...contacts]}
          onBack={handlePeopleBack}
          onSaveImportedContacts={handleSaveImportedContacts}
          onInviteContact={handleInviteContact}
          onAddTagToContact={handleAddTagToContact}
          onRemoveTagFromContact={handleRemoveTagFromContact}
          onDeleteImportedContact={handleDeleteImportedContact}
          onUpdateImportedContact={handleUpdateImportedContact}
          onSetContactVisibility={handleSetContactVisibility}
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
          customCategories={customCategories}
          onCreateCategory={handleCreateCategory}
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
            onBack={goToStream}
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
              activeStreamFilters={{ peopleIds: selectedPeopleFilter, tagIds: selectedTagFilter }}
              recentUserMessages={recentUserMessages}
            />
          )}
        </>
      )}

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
            onPeopleFilterChange={setSelectedPeopleFilter}
            onTagFilterChange={setSelectedTagFilter}
            onDateFilterChange={setSelectedDateFilter}
            onCompose={goToCompose}
            onMessageClick={handleMessageClick}
            onNewProject={handleCreateProject}
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
            onCopyMessage={handleCopyMessage}
            onSendMessage={handleSend}
            onCreateProject={handleCreateProject}
            activeUsers={activeUsers}
            availableTags={availableTags}
            importedContacts={importedContacts}
            customCategories={customCategories}
            onCreateCategory={handleCreateCategory}
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
                  initialCalendarDates={calendarInitialDate ? [calendarInitialDate] : undefined}
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
              importedContacts={importedContacts}
              availableTags={availableTags}
              customCategories={customCategories}
              activeStreamFilters={{ peopleIds: selectedPeopleFilter, tagIds: selectedTagFilter }}
              recentUserMessages={recentUserMessages}
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
