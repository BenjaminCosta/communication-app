"use client"

import { useState, useCallback, useRef } from "react"
import { StreamScreen } from "@/components/stream-screen"
import { ComposeScreen } from "@/components/compose-screen"
import { TagSheet } from "@/components/tag-sheet"
import { LoginScreen } from "@/components/login-screen"
import { ProfileScreen } from "@/components/profile-screen"
import { NotificationsScreen } from "@/components/notifications-screen"
import { PrivacySecurityScreen } from "@/components/privacy-security-screen"
import {
  type Message,
  type MessageType,
  type Project,
  PROJECT_COLORS,
  generateId,
  generateProjectId,
} from "@/lib/store"

type Screen = "login" | "stream" | "compose" | "tag" | "profile" | "notifications" | "privacy"

// Derive a display name from an email address
// e.g. "ben.jacosta@svc.co" → "Ben Jacosta"
// e.g. "benjacosta@svc.co"  → "Benjacosta"
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

export default function Home() {
  const [activeScreen, setActiveScreen] = useState<Screen>("login")
  const [userEmail, setUserEmail] = useState("")
  const [messages, setMessages] = useState<Message[]>([])
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null)
  const [activeFilter, setActiveFilter] = useState<string>("all")
  const [activeTypeFilter, setActiveTypeFilter] = useState<string>("all")
  const [projects, setProjects] = useState<Project[]>([])
  const nextColorIndex = useRef(0)
  const [composeMode, setComposeMode] = useState<"fullscreen" | "sheet">("fullscreen")

  const userName = deriveNameFromEmail(userEmail)
  const userInitials = deriveInitials(userName)

  // Create a new project
  const handleCreateProject = useCallback((name: string): Project => {
    const color = PROJECT_COLORS[nextColorIndex.current % PROJECT_COLORS.length]
    nextColorIndex.current += 1
    const newProject: Project = { id: generateProjectId(), name: name.trim(), color }
    setProjects((prev) => [...prev, newProject])
    return newProject
  }, [])

  // Navigation
  const handleLogin = useCallback((email: string) => {
    setUserEmail(email)
    setComposeMode("fullscreen")
    setActiveScreen("compose")
  }, [])

  const handleSignOut = useCallback(() => {
    setUserEmail("")
    setMessages([])
    setProjects([])
    setActiveScreen("login")
  }, [])

  const goToCompose = useCallback(() => {
    setComposeMode("sheet")
    setActiveScreen("compose")
  }, [])
  const goToStream = useCallback(() => setActiveScreen("stream"), [])
  const goToProfile = useCallback(() => setActiveScreen("profile"), [])
  const goToNotifications = useCallback(() => setActiveScreen("notifications"), [])
  const goToPrivacy = useCallback(() => setActiveScreen("privacy"), [])

  // Send a new message
  const handleSend = useCallback(
    (text: string, contactIds: string[], projectId: string | null, type: MessageType) => {
      if (!text.trim()) {
        setActiveScreen("stream")
        return
      }
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
      setActiveScreen("stream")
    },
    []
  )

  // Open tag sheet for a message
  const handleMessageClick = useCallback((message: Message) => {
    setSelectedMessageId(message.id)
    setActiveScreen("tag")
  }, [])

  // Apply tag to message
  const handleApplyTag = useCallback(
    (type: MessageType, projectId: string | null) => {
      if (!selectedMessageId) return
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === selectedMessageId ? { ...msg, type, projectId } : msg
        )
      )
      setSelectedMessageId(null)
      setActiveScreen("stream")
    },
    [selectedMessageId]
  )

  // Close tag sheet
  const handleCloseTag = useCallback(() => {
    setSelectedMessageId(null)
    setActiveScreen("stream")
  }, [])

  const selectedMessage = messages.find((m) => m.id === selectedMessageId) || null

  const filteredMessages =
    activeFilter === "all"
      ? messages
      : activeFilter === "unsorted"
      ? messages.filter((m) => m.type === "none")
      : messages.filter((m) => m.projectId === activeFilter)

  const visibleMessages =
    activeTypeFilter === "all"
      ? filteredMessages
      : filteredMessages.filter((m) => m.type === activeTypeFilter)

  return (
    <div className="h-dvh w-full flex flex-col bg-background overflow-hidden relative">
      {activeScreen === "login" && (
        <LoginScreen onLogin={handleLogin} />
      )}
      {activeScreen === "profile" && (
        <ProfileScreen
          userName={userName}
          userEmail={userEmail}
          userInitials={userInitials}
          onBack={goToStream}
          onSignOut={handleSignOut}
          onNotifications={goToNotifications}
          onPrivacy={goToPrivacy}
        />
      )}
      {activeScreen === "notifications" && (
        <NotificationsScreen onBack={goToProfile} />
      )}
      {activeScreen === "privacy" && (
        <PrivacySecurityScreen onBack={goToProfile} />
      )}
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
            messages={visibleMessages}
            activeFilter={activeFilter}
            onFilterChange={setActiveFilter}
            activeTypeFilter={activeTypeFilter}
            onTypeFilterChange={setActiveTypeFilter}
            onCompose={goToCompose}
            onMessageClick={handleMessageClick}
            onNewProject={handleCreateProject}
            onProfile={goToProfile}
            userInitials={userInitials}
            projects={projects}
          />
          {activeScreen === "compose" && (
            <div className="fixed inset-0 z-40 flex flex-col justify-end md:items-center md:justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
              {/* Mobile: slides from bottom · Desktop: centered floating card */}
              <div className="h-[90%] md:h-auto md:w-[560px] md:max-h-[80vh] md:rounded-3xl md:overflow-hidden animate-in slide-in-from-bottom duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] flex flex-col shadow-2xl">
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
    </div>
  )
}
