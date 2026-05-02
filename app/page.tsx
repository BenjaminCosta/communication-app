"use client"

import { useState, useCallback, useRef } from "react"
import { StreamScreen } from "@/components/stream-screen"
import { ComposeScreen } from "@/components/compose-screen"
import { TagSheet } from "@/components/tag-sheet"
import { LoginScreen } from "@/components/login-screen"
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
  PROJECT_COLORS,
  generateId,
  generateProjectId,
} from "@/lib/store"

type Screen = "login" | "stream" | "compose" | "tag" | "profile" | "notifications" | "privacy" | "projects" | "project-detail"

// Depth map — higher = further in the hierarchy
const SCREEN_DEPTH: Record<Screen, number> = {
  login: 0,
  stream: 1,
  compose: 2,
  tag: 2,
  profile: 3,
  notifications: 4,
  privacy: 4,
  projects: 4,
  "project-detail": 5,
}

function deriveNameFromEmail(email: string): string {
  const local = email.split("@")[0]
  return local
    .split(/[._\-+]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
}

function deriveInitials(name: string): string {
  const parts = name.trim().split(" ").filter(Boolean)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  }
  return name.slice(0, 2).toUpperCase()
}

interface ToastState {
  message: string
  action?: { label: string; onClick: () => void }
  duration?: number
  key: number
}

export default function Home() {
  const [activeScreen, setActiveScreen] = useState<Screen>("login")
  const [userEmail, setUserEmail] = useState("")
  const [messages, setMessages] = useState<Message[]>([])
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null)
  const [activeFilter, setActiveFilter] = useState<string>("all")
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const nextColorIndex = useRef(0)
  const [composeMode, setComposeMode] = useState<"fullscreen" | "sheet">("fullscreen")
  const notificationsReturnRef = useRef<Screen>("profile")

  // Directional transition tracking
  const prevScreenRef = useRef<Screen>("login")
  const [entranceClass, setEntranceClass] = useState("animate-fade-in")

  // Toast state
  const [toast, setToast] = useState<ToastState | null>(null)
  const toastKeyRef = useRef(0)

  const showToast = useCallback((message: string, action?: { label: string; onClick: () => void }, duration?: number) => {
    toastKeyRef.current += 1
    setToast({ message, action, duration, key: toastKeyRef.current })
  }, [])

  const userName = deriveNameFromEmail(userEmail)
  const userInitials = deriveInitials(userName)

  // Core navigation — computes entrance direction based on screen hierarchy
  const navigateTo = useCallback((next: Screen) => {
    const prev = prevScreenRef.current
    // Login transitions are always a plain fade
    if (prev === "login" || next === "login") {
      setEntranceClass("animate-fade-in")
    } else {
      const d = SCREEN_DEPTH[next] - SCREEN_DEPTH[prev]
      setEntranceClass(d > 0 ? "animate-slide-in-right" : d < 0 ? "animate-slide-in-left" : "animate-fade-in")
    }
    prevScreenRef.current = next
    setActiveScreen(next)
  }, [])

  const handleCreateProject = useCallback((name: string, memberIds: string[] = []): Project => {
    const color = PROJECT_COLORS[nextColorIndex.current % PROJECT_COLORS.length]
    nextColorIndex.current += 1
    const newProject: Project = { id: generateProjectId(), name: name.trim(), color, members: memberIds }
    setProjects((prev) => [...prev, newProject])
    return newProject
  }, [])

  const handleDeleteMessage = useCallback((id: string) => {
    // Capture message before removing it for potential Undo
    setMessages((prev) => {
      const target = prev.find((m) => m.id === id)
      if (!target) return prev
      const next = prev.filter((m) => m.id !== id)
      // Show toast with Undo — restore the message at its original index
      const originalIndex = prev.indexOf(target)
      showToast("Message deleted", {
        label: "Undo",
        onClick: () => setMessages((cur) => {
          const arr = [...cur]
          arr.splice(originalIndex, 0, target)
          return arr
        }),
      })
      return next
    })
  }, [showToast])

  const handleFavoriteMessage = useCallback((id: string) => {
    setMessages((prev) =>
      prev.map((m) => m.id === id ? { ...m, isFavorited: !m.isFavorited } : m)
    )
  }, [])

  const handleUpdateProjectMembers = useCallback((projectId: string, memberIds: string[]) => {
    setProjects((prev) =>
      prev.map((p) => (p.id === projectId ? { ...p, members: memberIds } : p))
    )
  }, [])

  const handleLogin = useCallback((email: string) => {
    setUserEmail(email)
    setComposeMode("fullscreen")
    navigateTo("compose")
  }, [navigateTo])

  const handleSignOut = useCallback(() => {
    setUserEmail("")
    setMessages([])
    setProjects([])
    navigateTo("login")
  }, [navigateTo])

  const goToCompose = useCallback(() => {
    setComposeMode("sheet")
    navigateTo("compose")
  }, [navigateTo])
  const goToStream        = useCallback(() => navigateTo("stream"), [navigateTo])
  const goToProfile       = useCallback(() => navigateTo("profile"), [navigateTo])
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
  const goToPrivacy       = useCallback(() => navigateTo("privacy"), [navigateTo])
  const goToProjects      = useCallback(() => navigateTo("projects"), [navigateTo])
  const goToProjectDetail = useCallback((projectId: string) => {
    setSelectedProjectId(projectId)
    navigateTo("project-detail")
  }, [navigateTo])

  const handleSend = useCallback(
    (text: string, contactIds: string[], projectId: string | null, type: MessageType) => {
      if (!text.trim()) { navigateTo("stream"); return }
      const newMessage: Message = {
        id: generateId(),
        contactId: "me",
        projectId,
        text: text.trim(),
        type,
        timestamp: new Date(),
        isMe: true,
      }
      setMessages((prev) => [...prev, newMessage])
      navigateTo("stream")
      showToast("Sent ✓", undefined, 2000)
    },
    [navigateTo, showToast]
  )

  const handleMessageClick = useCallback((message: Message) => {
    setSelectedMessageId(message.id)
    navigateTo("tag")
  }, [navigateTo])

  const handleApplyTag = useCallback(
    (type: MessageType, projectId: string | null) => {
      if (!selectedMessageId) return
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === selectedMessageId ? { ...msg, type, projectId } : msg
        )
      )
      setSelectedMessageId(null)
      navigateTo("stream")
      const label = type.charAt(0).toUpperCase() + type.slice(1)
      showToast(`Tagged as ${label}`, undefined, 2000)
    },
    [selectedMessageId, navigateTo, showToast]
  )

  const handleCloseTag = useCallback(() => {
    setSelectedMessageId(null)
    navigateTo("stream")
  }, [navigateTo])

  const selectedMessage = messages.find((m) => m.id === selectedMessageId) || null

  const filteredMessages =
    activeFilter === "all"
      ? messages
      : activeFilter === "unsorted"
      ? messages.filter((m) => m.type === "none")
      : messages.filter((m) => m.projectId === activeFilter)

  return (
    <div className="h-dvh w-full flex flex-col bg-background overflow-hidden relative">
      {activeScreen === "login" && (
        <LoginScreen onLogin={handleLogin} />
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
        />
      )}
      {(activeScreen === "stream" || (activeScreen === "compose" && composeMode === "sheet") || activeScreen === "tag") && (
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
          />
          {activeScreen === "compose" && (
            <div
              className="fixed inset-0 z-40 flex flex-col justify-end md:items-center md:justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
              style={{ paddingBottom: 'env(keyboard-inset-height, 0px)' }}
            >
              <div className="h-[90%] md:h-auto md:w-140 md:max-h-[80vh] md:rounded-3xl md:overflow-hidden animate-in slide-in-from-bottom duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] flex flex-col shadow-2xl">
                <ComposeScreen
                  mode="sheet"
                  onCancel={goToStream}
                  onSend={handleSend}
                  projects={projects}
                  onCreateProject={handleCreateProject}
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
            />
          )}
        </>
      )}

      {/* Global toast — rendered at root level, above everything */}
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
