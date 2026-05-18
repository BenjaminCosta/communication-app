"use client"

import { useState, useRef, useEffect, useMemo, Fragment } from "react"
import { Bell, MessageCircle, Star, Trash2, FolderOpen, X, LayoutGrid, Copy, User, Tag, Image as ImageIcon, Check, Search, Users, CircleSlash } from "lucide-react"
import { cn, haptic } from "@/lib/utils"
import {
  type Message,
  type MessageDraft,
  type MessageType,
  type Project,
  type Contact,
  type Tag as MessageTag,
  getContactFromList,
  formatTime,
  getMessageTagIds,
  MESSAGE_TYPE_CONFIG,
  parseProjectTagId,
  parseSystemTypeTagId,
  projectTagId,
  systemTypeTagId,
} from "@/lib/store"
import { CreateProjectModal } from "@/components/create-project-modal"
import { MessageInputBar } from "@/components/message-input-bar"
import { useSwipeDismiss } from "@/hooks/use-swipe-dismiss"

const typeStyles = MESSAGE_TYPE_CONFIG

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function getDayLabel(date: Date): string {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const msgDay = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const diffDays = Math.round((today.getTime() - msgDay.getTime()) / 86_400_000)
  if (diffDays === 0) return "Today"
  if (diffDays === 1) return "Yesterday"
  if (diffDays < 7) return date.toLocaleDateString("en-US", { weekday: "long" })
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

interface StreamScreenProps {
  messages: Message[]
  activeFilter: string
  onFilterChange: (filter: string) => void
  selectedPeopleFilter: string[]
  selectedTagFilter: string[]
  onPeopleFilterChange: (ids: string[]) => void
  onTagFilterChange: (ids: string[]) => void
  onCompose: () => void
  onMessageClick: (message: Message) => void
  onNewProject: (name: string, memberIds: string[]) => void
  onProfile: () => void
  onNotifications: () => void
  onDeleteMessage: (id: string) => void
  onFavoriteMessage: (id: string) => void
  userInitials: string
  userColor: string
  projects: Project[]
  contacts: Contact[]
  currentUserId: string
  onGoToProject: (projectId: string) => void
  onRemoveProjectTag: (messageId: string, projectId?: string) => void
  onDeleteProject: (id: string) => void
  onFavoriteProject: (id: string) => void
  onProjects: () => void
  onCopyMessage: (text: string) => void
  onSendMessage: (draft: MessageDraft) => Promise<void>
  onCreateProject: (name: string, memberIds?: string[]) => Promise<Project>
  activeUsers: Contact[]
  availableTags: MessageTag[]
}

export function StreamScreen({
  messages,
  activeFilter,
  onFilterChange,
  selectedPeopleFilter,
  selectedTagFilter,
  onPeopleFilterChange,
  onTagFilterChange,
  onCompose,
  onMessageClick,
  onNewProject,
  onProfile,
  onNotifications,
  onDeleteMessage,
  onFavoriteMessage,
  userInitials,
  userColor,
  projects,
  contacts,
  currentUserId,
  onGoToProject,
  onRemoveProjectTag,
  onDeleteProject,
  onFavoriteProject,
  onProjects,
  onCopyMessage,
  onSendMessage,
  onCreateProject,
  activeUsers,
  availableTags,
}: StreamScreenProps) {
  const [showCreateProject, setShowCreateProject] = useState(false)
  const [selectedMsgId, setSelectedMsgId] = useState<string | null>(null)
  const [projectTagCtx, setProjectTagCtx] = useState<{ projectId: string; messageId: string } | null>(null)
  const [selectedChipId, setSelectedChipId] = useState<string | null>(null)
  const [confirmDeleteChipId, setConfirmDeleteChipId] = useState<string | null>(null)
  const [confirmDeleteMsgId, setConfirmDeleteMsgId] = useState<string | null>(null)
  const [showPeopleFilterSheet, setShowPeopleFilterSheet] = useState(false)
  const [showTagFilterSheet, setShowTagFilterSheet] = useState(false)
  const [quickText, setQuickText] = useState("")
  const [quickRecipients, setQuickRecipients] = useState<string[]>([])
  const [quickProjects, setQuickProjects] = useState<string[]>([])
  const [quickType, setQuickType] = useState<MessageType>("none")
  const [quickImage, setQuickImage] = useState<File | null>(null)
  const [quickImagePreview, setQuickImagePreview] = useState<string | null>(null)
  const [showQuickSheet, setShowQuickSheet] = useState(false)
  const [quickSheetMode, setQuickSheetMode] = useState<"menu" | "who" | "tag">("menu")
  const [showCreateQuickProject, setShowCreateQuickProject] = useState(false)
  const [isQuickSending, setIsQuickSending] = useState(false)
  const [isQuickSent, setIsQuickSent] = useState(false)
  const [projectSearch, setProjectSearch] = useState("")
  const [showProjectSearch, setShowProjectSearch] = useState(false)
  const [showFeedSkeleton, setShowFeedSkeleton] = useState(false)
  const [floatingDate, setFloatingDate] = useState<string | null>(null)
  const [showFloatingDate, setShowFloatingDate] = useState(false)
  const feedRef = useRef<HTMLDivElement>(null)
  const quickFileInputRef = useRef<HTMLInputElement>(null)
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const floatingHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isPinnedToBottom = useRef(true)
  const prevMessageCountRef = useRef(0)
  const previousFilterRef = useRef(activeFilter)

  const clearChipSelection = () => { setSelectedChipId(null); setConfirmDeleteChipId(null) }
  const clearMsgSelection = () => { setSelectedMsgId(null); setConfirmDeleteMsgId(null) }

  useEffect(() => {
    return () => {
      if (quickImagePreview) URL.revokeObjectURL(quickImagePreview)
    }
  }, [quickImagePreview])

  useEffect(() => {
    if (previousFilterRef.current === activeFilter) return
    previousFilterRef.current = activeFilter
    setShowFeedSkeleton(false)

    const showTimer = setTimeout(() => setShowFeedSkeleton(true), 120)
    const hideTimer = setTimeout(() => setShowFeedSkeleton(false), 560)

    return () => {
      clearTimeout(showTimer)
      clearTimeout(hideTimer)
    }
  }, [activeFilter])

  // Track whether user is near the bottom + update floating date badge
  const handleScroll = () => {
    const el = feedRef.current
    if (!el) return
    isPinnedToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80

    // Find the topmost visible date marker
    const feedRect = el.getBoundingClientRect()
    const markers = el.querySelectorAll<HTMLElement>('[data-date-label]')
    let label: string | null = null
    for (const marker of Array.from(markers)) {
      const rect = marker.getBoundingClientRect()
      if (rect.top >= feedRect.top) {
        label = marker.dataset.dateLabel ?? null
        break
      }
    }
    if (label) {
      setFloatingDate(label)
      setShowFloatingDate(true)
    }
    if (floatingHideTimer.current) clearTimeout(floatingHideTimer.current)
    floatingHideTimer.current = setTimeout(() => setShowFloatingDate(false), 1200)
  }

  // Auto-scroll to bottom only when a new message arrives (not on deletions)
  useEffect(() => {
    const increased = messages.length > prevMessageCountRef.current
    prevMessageCountRef.current = messages.length
    if (!increased) return
    const lastMessage = [...messages].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime()).at(-1)
    if (isPinnedToBottom.current || lastMessage?.senderId === currentUserId) {
      if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight
    }
  }, [messages, currentUserId])

  const toggleQuickRecipient = (id: string) => {
    setQuickRecipients((prev) => prev.includes(id) ? prev.filter((uid) => uid !== id) : [...prev, id])
  }

  const toggleQuickProject = (id: string) => {
    setQuickProjects((prev) => prev.includes(id) ? prev.filter((projectId) => projectId !== id) : [...prev, id])
  }

  const quickTagIds = useMemo(() => [
    ...(quickType !== "none" ? [systemTypeTagId(quickType)] : []),
    ...quickProjects.map(projectTagId),
  ], [quickType, quickProjects])

  const toggleQuickTag = (tagId: string) => {
    const systemType = parseSystemTypeTagId(tagId)
    if (systemType) {
      setQuickType((prev) => prev === systemType ? "none" : systemType)
      return
    }
    if (tagId === systemTypeTagId("none")) {
      setQuickType("none")
      return
    }
    const projectId = parseProjectTagId(tagId)
    if (projectId) toggleQuickProject(projectId)
  }

  const handleQuickImage = (file: File | null) => {
    if (!file) return
    setQuickImage(file)
    setQuickImagePreview((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return URL.createObjectURL(file)
    })
    setShowQuickSheet(false)
  }

  const clearQuickImage = () => {
    if (quickImagePreview) URL.revokeObjectURL(quickImagePreview)
    setQuickImage(null)
    setQuickImagePreview(null)
    if (quickFileInputRef.current) quickFileInputRef.current.value = ""
  }

  const resetQuickDraft = () => {
    setQuickText("")
    setQuickRecipients([])
    setQuickProjects([])
    setQuickType("none")
    clearQuickImage()
  }

  const handleQuickSend = async () => {
    if ((!quickText.trim() && !quickImage) || isQuickSending) return
    haptic.success()
    setIsQuickSending(true)
    try {
      await onSendMessage({
        text: quickText.trim(),
        contactIds: quickRecipients,
        peopleIds: quickRecipients,
        projectIds: quickProjects,
        tagIds: quickTagIds,
        type: quickType,
        imageFile: quickImage,
      })
      resetQuickDraft()
      setIsQuickSent(true)
      setTimeout(() => setIsQuickSent(false), 1400)
    } finally {
      setIsQuickSending(false)
    }
  }

  const startPress = (msgId: string) => {
    pressTimer.current = setTimeout(() => {
      setSelectedMsgId(msgId)
      navigator?.vibrate?.(12)
    }, 450)
  }

  const cancelPress = () => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current)
      pressTimer.current = null
    }
  }

  const sortedMessages = useMemo(() => {
    return [...messages].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
  }, [messages])
  const selectedMsg = selectedMsgId ? messages.find((m) => m.id === selectedMsgId) : null
  const activeUserIds = useMemo(() => new Set(activeUsers.map((user) => user.id)), [activeUsers])
  const sortedProjects = useMemo(
    () => [...projects.filter((p) => p.isFavorited), ...projects.filter((p) => !p.isFavorited)],
    [projects]
  )
  const selectedProjectTag = useMemo(() => {
    const projectTagIds = selectedTagFilter.map(parseProjectTagId).filter(Boolean) as string[]
    return projectTagIds.length === 1 ? projects.find((project) => project.id === projectTagIds[0]) ?? null : null
  }, [selectedTagFilter, projects])
  const searchedProjects = useMemo(() => {
    const query = projectSearch.trim().toLowerCase()
    if (!query) return sortedProjects
    return sortedProjects.filter((project) => project.name.toLowerCase().includes(query))
  }, [projectSearch, sortedProjects])

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-background animate-fade-in">
      {/* Header */}
      <div className="flex-shrink-0 px-4 app-topbar flex items-center justify-between border-b border-white/10 animate-slide-down">
        <h1 className="text-lg font-bold tracking-tight">
          SVC <span className="text-primary">Stream</span>
        </h1>
        <div className="flex items-center gap-2">
          {/* Notifications bell */}
          <button
            onClick={onNotifications}
            className="w-9 h-9 rounded-full bg-white/5 border border-white/10 flex items-center justify-center active:scale-95 hover:bg-white/8 transition-all duration-150"
          >
            <Bell className="w-4 h-4 text-muted-foreground" />
          </button>
          {/* Tags shortcut */}
          <button
            onClick={onProjects}
            className="w-9 h-9 rounded-full bg-white/5 border border-white/10 flex items-center justify-center active:scale-95 hover:bg-white/8 transition-all duration-150"
          >
            <LayoutGrid className="w-4 h-4 text-muted-foreground" />
          </button>
          {/* Profile avatar */}
          <button
            onClick={onProfile}
            className={cn(
              "w-9 h-9 rounded-full flex items-center justify-center active:scale-95 transition-all duration-150",
              userColor
            )}
          >
            <span className="text-[11px] font-bold text-white">{userInitials}</span>
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex-shrink-0 flex items-center gap-2 overflow-x-auto px-4 py-2 border-b border-white/10 scrollbar-hide">
        <FilterChip
          active={selectedPeopleFilter.length === 0 && selectedTagFilter.length === 0}
          onClick={() => {
            onPeopleFilterChange([])
            onTagFilterChange([])
            onFilterChange("all")
          }}
        >
          All
        </FilterChip>
        <FilterChip
          active={selectedPeopleFilter.length > 0}
          tone="people"
          icon={<Users className="w-3.5 h-3.5" />}
          onClick={() => setShowPeopleFilterSheet(true)}
        >
          People{selectedPeopleFilter.length > 0 ? ` (${selectedPeopleFilter.length})` : ""}
        </FilterChip>
        <button
          onClick={() => setShowTagFilterSheet(true)}
          className={cn(
            "h-9 min-w-[150px] flex-1 rounded-full border px-3 transition-all flex items-center gap-2 justify-start active:scale-95",
            selectedTagFilter.length > 0
              ? "bg-primary/15 border-primary/35 text-primary"
              : "bg-white/5 border-white/10 text-muted-foreground hover:border-primary/40 hover:bg-primary/10 hover:text-primary"
          )}
          aria-label="Filter tags"
        >
          <Tag className="w-4 h-4 shrink-0" />
          <span className="text-xs font-semibold tracking-wide truncate">
            Tags{selectedTagFilter.length > 0 ? ` (${selectedTagFilter.length})` : ""}
          </span>
        </button>
        <button
          onClick={() => setShowCreateProject(true)}
          className="w-8 h-8 rounded-full shrink-0 transition-all border bg-white/5 border-dashed border-white/20 text-foreground/60 hover:border-primary/40 hover:text-primary hover:bg-primary/10 active:bg-white/10 flex items-center justify-center text-lg font-light"
        >
          +
        </button>
      </div>

      {/* Feed */}
      <div className="flex-1 min-h-0 relative">
        {/* Floating date badge — WhatsApp style */}
        <div
          className={cn(
            "absolute top-2 left-1/2 -translate-x-1/2 z-10 pointer-events-none transition-opacity duration-150",
            showFloatingDate ? "opacity-90" : "opacity-0"
          )}
        >
          <span className="px-2.5 py-0.5 rounded-full bg-black/80 border border-white/15 text-[9px] font-semibold tracking-tight uppercase text-foreground/90">
            {floatingDate}
          </span>
        </div>

        <div
          ref={feedRef}
          onScroll={handleScroll}
          className="h-full overflow-y-auto px-4 py-3 flex flex-col gap-0 scrollbar-hide"
          onClick={() => selectedMsgId && clearMsgSelection()}
        >
          {showFeedSkeleton ? (
            <StreamFeedSkeleton />
          ) : sortedMessages.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 py-16">
              <div className="w-16 h-16 rounded-full bg-white/5 border border-white/10 flex items-center justify-center animate-float">
                <MessageCircle className="w-7 h-7 text-muted-foreground/50" />
              </div>
              <p className="text-sm text-muted-foreground">Nothing sent yet</p>
              <p className="text-xs text-muted-foreground/50">Tap 🤔 to send your first message</p>
            </div>
          ) : (
            sortedMessages.map((msg, index) => {
              const prevMsg = sortedMessages[index - 1]
              const nextMsg = sortedMessages[index + 1]
              const newDay = !prevMsg || !isSameDay(prevMsg.timestamp, msg.timestamp)
              const isFirstInGroup = newDay || prevMsg.senderId !== msg.senderId
              const isLastInGroup = !nextMsg || !isSameDay(msg.timestamp, nextMsg.timestamp) || nextMsg.senderId !== msg.senderId
              return (
                <Fragment key={msg.id}>
                  {/* invisible date anchor for scroll detection */}
                  <div data-date-label={getDayLabel(msg.timestamp)} className="h-0 overflow-hidden" aria-hidden />
                  <MessageBubble
                    message={msg}
                    projects={projects}
                    contacts={contacts}
                    currentUserId={currentUserId}
                    userInitials={userInitials}
                    userColor={userColor}
                    isAuthorActive={activeUserIds.has(msg.senderId)}
                    isSelected={selectedMsgId === msg.id}
                    isFirstInGroup={isFirstInGroup}
                    isLastInGroup={isLastInGroup}
                    onTap={() => {
                      if (selectedMsgId) { clearMsgSelection(); return }
                      onMessageClick(msg)
                    }}
                    onPressStart={() => startPress(msg.id)}
                    onPressEnd={cancelPress}
                    onProjectTagTap={(projectId) => setProjectTagCtx({ projectId, messageId: msg.id })}
                  />
                </Fragment>
              )
            })
          )}
          <div className="h-3" />
        </div>
      </div>

      <MessageInputBar
        text={quickText}
        setText={setQuickText}
        contacts={contacts}
        projects={projects}
        recipients={quickRecipients}
        projectIds={quickProjects}
        type={quickType}
        imageFile={quickImage}
        imagePreview={quickImagePreview}
        isSending={isQuickSending}
        isSent={isQuickSent}
        onOpenSheet={() => { setQuickSheetMode("menu"); setShowQuickSheet(true) }}
        onRemoveRecipient={(id) => setQuickRecipients((prev) => prev.filter((uid) => uid !== id))}
        onRemoveProject={(id) => setQuickProjects((prev) => prev.filter((projectId) => projectId !== id))}
        onClearType={() => setQuickType("none")}
        onClearImage={clearQuickImage}
        onSend={handleQuickSend}
      />
      <input
        ref={quickFileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => handleQuickImage(e.target.files?.[0] ?? null)}
      />

      {/* Persistent backdrop — single div that never unmounts, toggling pointer-events
          avoids the iOS bug where removing a fixed overlay from DOM locks scroll */}
      <div
        className={cn(
          "fixed inset-0 z-20",
          (selectedMsg || selectedChipId || projectTagCtx) ? "pointer-events-auto" : "pointer-events-none"
        )}
        onClick={() => { clearMsgSelection(); clearChipSelection(); setProjectTagCtx(null) }}
      />

      {/* Message action bar — appears on long press */}
      {selectedMsg && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-30 animate-scale-in px-3 w-full max-w-sm">
            <div className="flex items-center justify-center gap-1 bg-[#0d1c35] border border-white/15 rounded-2xl p-1.5 shadow-2xl">
              {/* Copy */}
              <button
                onClick={() => { haptic.light(); onCopyMessage(selectedMsg.text); clearMsgSelection() }}
                className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold text-muted-foreground hover:bg-white/5 hover:text-foreground transition-all active:scale-95"
              >
                <Copy className="w-4 h-4" />
                Copy
              </button>
              <div className="w-px h-6 bg-white/15 shrink-0" />
              {/* Favorite */}
              <button
                onClick={() => { haptic.light(); onFavoriteMessage(selectedMsg.id); clearMsgSelection() }}
                className={cn(
                  "flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all active:scale-95",
                  selectedMsg.isFavorited
                    ? "bg-feedback/15 text-feedback"
                    : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
                )}
              >
                <Star className={cn("w-4 h-4", selectedMsg.isFavorited && "fill-current")} />
                {selectedMsg.isFavorited ? "Unfavorite" : "Favorite"}
              </button>
              {selectedMsg.senderId === currentUserId && (
                <>
                  <div className="w-px h-6 bg-white/15 shrink-0" />
                  {confirmDeleteMsgId === selectedMsg.id ? (
                    <button
                      onClick={() => { haptic.destructive(); onDeleteMessage(selectedMsg.id); clearMsgSelection() }}
                      className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold text-problem hover:bg-problem/10 transition-all active:scale-95 animate-pulse"
                    >
                      <Trash2 className="w-4 h-4" />
                      Sure?
                    </button>
                  ) : (
                    <button
                      onClick={() => setConfirmDeleteMsgId(selectedMsg.id)}
                      className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold text-problem hover:bg-problem/10 transition-all active:scale-95"
                    >
                      <Trash2 className="w-4 h-4" />
                      Delete
                    </button>
                  )}
                </>
              )}
            </div>
        </div>
      )}

      {/* Tag chip action bar — long-press on filter chip */}
      {selectedChipId && (() => {
        const proj = projects.find((p) => p.id === selectedChipId)
        if (!proj) return null
        return (
          <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-30 animate-scale-in px-4 w-full max-w-sm">
              <div className="flex items-center justify-center gap-1 bg-[#0d1c35] border border-white/15 rounded-2xl p-1.5 shadow-2xl">
                {/* Label */}
                <div className="flex items-center gap-1.5 px-2 py-2 shrink-0 max-w-[80px]">
                  <div className={cn("w-2 h-2 rounded-full shrink-0", proj.color)} />
                  <span className="text-xs font-bold text-foreground/70 truncate">{proj.name}</span>
                </div>
                <div className="w-px h-6 bg-white/15 shrink-0" />
                {/* Favorite */}
                <button
                  onClick={() => { haptic.light(); onFavoriteProject(proj.id); clearChipSelection() }}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all active:scale-95",
                    proj.isFavorited ? "bg-feedback/15 text-feedback" : "text-muted-foreground hover:bg-white/5"
                  )}
                >
                  <Star className={cn("w-4 h-4", proj.isFavorited && "fill-current")} />
                  {proj.isFavorited ? "Unpin" : "Pin"}
                </button>
                <div className="w-px h-6 bg-white/15 shrink-0" />
                {/* Info */}
                <button
                  onClick={() => { clearChipSelection(); onGoToProject(proj.id) }}
                  className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-semibold text-muted-foreground hover:bg-white/5 hover:text-foreground transition-all active:scale-95"
                >
                  <FolderOpen className="w-4 h-4" />
                  Info
                </button>
                <div className="w-px h-6 bg-white/15 shrink-0" />
                {/* Delete — 2-step */}
                {confirmDeleteChipId === proj.id ? (
                  <button
                    onClick={() => { haptic.destructive(); onDeleteProject(proj.id); clearChipSelection() }}
                    className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-semibold text-problem hover:bg-problem/10 transition-all active:scale-95 animate-pulse"
                  >
                    <Trash2 className="w-4 h-4" />
                    Sure?
                  </button>
                ) : (
                  <button
                    onClick={() => setConfirmDeleteChipId(proj.id)}
                    className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-semibold text-problem hover:bg-problem/10 transition-all active:scale-95"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete
                  </button>
                )}
              </div>
            </div>
        )
      })()}

      {/* Tag action bar — tap on tag badge */}
      {projectTagCtx && (() => {
        const proj = projects.find((p) => p.id === projectTagCtx.projectId)
        return (
          <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-30 animate-scale-in px-4 w-full max-w-sm">
              <div className="flex items-center justify-center gap-1 bg-[#0d1c35] border border-white/15 rounded-2xl p-1.5 shadow-2xl">
                {/* Tag label */}
                <div className="flex items-center gap-1.5 px-3 py-2 shrink-0">
                  <div className={cn("w-2 h-2 rounded-full shrink-0", proj?.color ?? "bg-white/30")} />
                  <span className="text-xs font-bold text-foreground/70 truncate max-w-[90px]">{proj?.name ?? "Tag"}</span>
                </div>
                <div className="w-px h-6 bg-white/15 shrink-0" />
                {/* View info */}
                <button
                  onClick={() => { setProjectTagCtx(null); onGoToProject(projectTagCtx.projectId) }}
                  className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-semibold text-muted-foreground hover:bg-white/5 hover:text-foreground transition-all active:scale-95"
                >
                  <FolderOpen className="w-4 h-4" />
                  Info
                </button>
                <div className="w-px h-6 bg-white/15 shrink-0" />
                {/* Remove tag */}
                <button
                  onClick={() => { haptic.light(); setProjectTagCtx(null); onRemoveProjectTag(projectTagCtx.messageId, projectTagCtx.projectId) }}
                  className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-semibold text-problem hover:bg-problem/10 transition-all active:scale-95"
                >
                  <X className="w-4 h-4" />
                  Untag
                </button>
              </div>
            </div>
        )
      })()}

      {/* Create Tag modal */}
      {showCreateProject && (
        <CreateProjectModal
          contacts={contacts}
          onClose={() => setShowCreateProject(false)}
          onSubmit={(name, memberIds) => {
            onNewProject(name, memberIds)
            setShowCreateProject(false)
          }}
        />
      )}

      {showPeopleFilterSheet && (
        <PeopleFilterSheet
          contacts={contacts}
          currentUserId={currentUserId}
          userInitials={userInitials}
          userColor={userColor}
          selectedPeople={selectedPeopleFilter}
          onChange={onPeopleFilterChange}
          onClose={() => setShowPeopleFilterSheet(false)}
        />
      )}

      {showTagFilterSheet && (
        <TagFilterSheet
          tags={availableTags}
          selectedTags={selectedTagFilter}
          onChange={(ids) => {
            onTagFilterChange(ids)
            const projectIds = ids.map(parseProjectTagId).filter(Boolean) as string[]
            onFilterChange(projectIds.length === 1 && ids.length === 1 ? projectIds[0] : "all")
          }}
          onClose={() => setShowTagFilterSheet(false)}
        />
      )}

      {showProjectSearch && (
        <ProjectSearchSheet
          projects={searchedProjects}
          query={projectSearch}
          onQueryChange={setProjectSearch}
          activeFilter={activeFilter}
          onSelect={(projectId) => {
            onTagFilterChange([projectTagId(projectId)])
            onFilterChange(projectId)
            setShowProjectSearch(false)
          }}
          onAll={() => {
            onTagFilterChange([])
            onFilterChange("all")
            setShowProjectSearch(false)
          }}
          onClose={() => setShowProjectSearch(false)}
        />
      )}

      {showQuickSheet && (
        <QuickContextSheet
          mode={quickSheetMode}
          setMode={setQuickSheetMode}
          contacts={contacts}
          selectedRecipients={quickRecipients}
          selectedTags={quickTagIds}
          onToggleRecipient={toggleQuickRecipient}
          tags={availableTags}
          onToggleTag={toggleQuickTag}
          onAttachImage={() => quickFileInputRef.current?.click()}
          onCreateProject={() => { setShowQuickSheet(false); setShowCreateQuickProject(true) }}
          onClose={() => setShowQuickSheet(false)}
        />
      )}

      {showCreateQuickProject && (
        <CreateProjectModal
          contacts={contacts}
          onClose={() => setShowCreateQuickProject(false)}
          onSubmit={async (name, memberIds) => {
            const project = await onCreateProject(name, memberIds)
            setQuickProjects((prev) => [...new Set([...prev, project.id])])
            setShowCreateQuickProject(false)
          }}
        />
      )}

    </div>
  )
}

function QuickContextSheet({
  mode,
  setMode,
  contacts,
  selectedRecipients,
  selectedTags,
  onToggleRecipient,
  tags,
  onToggleTag,
  onAttachImage,
  onCreateProject,
  onClose,
}: {
  mode: "menu" | "who" | "tag"
  setMode: (mode: "menu" | "who" | "tag") => void
  contacts: Contact[]
  selectedRecipients: string[]
  selectedTags: string[]
  onToggleRecipient: (id: string) => void
  tags: MessageTag[]
  onToggleTag: (id: string) => void
  onAttachImage: () => void
  onCreateProject: () => void
  onClose: () => void
}) {
  const [userSearch, setUserSearch] = useState("")
  const [tagSearch, setTagSearch] = useState("")
  const [showTagPicker, setShowTagPicker] = useState(false)
  const { handlers: swipeHandlers, dragStyle } = useSwipeDismiss(onClose)
  const filteredContacts = contacts.filter((contact) =>
    contact.name.toLowerCase().includes(userSearch.trim().toLowerCase())
  )
  const filteredTags = tags.filter((tag) =>
    tag.name.toLowerCase().includes(tagSearch.trim().toLowerCase())
  )

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px]" onClick={onClose} />
      <div
        style={dragStyle}
        className="fixed bottom-0 left-0 right-0 z-50 bg-[#0a1628] border-t border-white/10 rounded-t-3xl px-5 pt-4 pb-10 shadow-2xl animate-in slide-in-from-bottom duration-200"
      >
        <div {...swipeHandlers} className="-mx-5 -mt-4 pt-4 pb-5 touch-none cursor-grab active:cursor-grabbing">
          <div className="w-10 h-1 bg-white/15 rounded-full mx-auto" />
        </div>
        {mode !== "menu" && (
          <button onClick={() => setMode("menu")} className="mb-3 text-xs font-semibold text-primary active:opacity-70">
            Back
          </button>
        )}
        {mode === "menu" && (
          <div className="grid grid-cols-2 gap-2">
            <SheetAction icon={<User className="w-4 h-4" />} label="Who" onClick={() => setMode("who")} />
            <SheetAction icon={<Tag className="w-4 h-4" />} label="Tag" onClick={() => setMode("tag")} />
            <SheetAction icon={<ImageIcon className="w-4 h-4" />} label="Attach image" onClick={() => { onAttachImage(); onClose() }} />
            <SheetAction icon={<Tag className="w-4 h-4" />} label="New tag" onClick={onCreateProject} />
          </div>
        )}
        {mode === "who" && (
          <>
            <SheetSearchInput value={userSearch} onChange={setUserSearch} placeholder="Search users" />
            <div className="flex flex-wrap gap-2 max-h-64 overflow-y-auto">
              {filteredContacts.map((contact) => (
                <button
                  key={contact.id}
                  onClick={() => onToggleRecipient(contact.id)}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-full border text-xs font-semibold transition-all",
                    selectedRecipients.includes(contact.id) ? "bg-primary/15 border-primary/30 text-primary" : "bg-white/5 border-white/10 text-muted-foreground"
                  )}
                >
                  <div className={cn("w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white", contact.color)}>
                    {contact.initials}
                  </div>
                  {contact.name}
                  {selectedRecipients.includes(contact.id) && <Check className="w-3 h-3" />}
                </button>
              ))}
              {contacts.length === 0 && <p className="text-xs text-muted-foreground">No other users yet.</p>}
              {contacts.length > 0 && filteredContacts.length === 0 && <p className="text-xs text-muted-foreground">No users found.</p>}
            </div>
          </>
        )}
        {mode === "tag" && (
          <>
            {selectedTags.length > 0 && (
              <div className="mb-2 flex gap-1.5 overflow-x-auto scrollbar-hide">
                {selectedTags.map((tagId) => {
                  const tag = tags.find((item) => item.id === tagId)
                  if (!tag) return null
                  const isUnassigned = tag.id === systemTypeTagId("none")
                  return (
                    <button
                      key={tagId}
                      onClick={() => onToggleTag(tagId)}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap",
                        isUnassigned
                          ? "border-feedback/25 bg-feedback/12 text-feedback"
                          : "border-primary/25 bg-primary/12 text-primary"
                      )}
                    >
                      <span>{tag.name}</span>
                      <X className="w-3 h-3" />
                    </button>
                  )
                })}
              </div>
            )}
            <SheetSearchInput
              value={tagSearch}
              onChange={setTagSearch}
              onFocus={() => setShowTagPicker(true)}
              onBlur={() => setTimeout(() => {
                if (selectedTags.length === 0) setShowTagPicker(false)
              }, 120)}
              placeholder="Search tags"
            />
            {(showTagPicker || selectedTags.length > 0) && (
              <div className="flex flex-col gap-1 max-h-64 overflow-y-auto">
                {filteredTags.map((tag) => {
                  const selected = selectedTags.includes(tag.id)
                  const isUnassigned = tag.id === systemTypeTagId("none")
                  return (
                    <button
                      key={tag.id}
                      onClick={() => onToggleTag(tag.id)}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors",
                        selected ? isUnassigned ? "bg-feedback/15" : "bg-primary/15" : "active:bg-white/5"
                      )}
                    >
                      <div className={cn("w-2 h-2 rounded-full shrink-0", tagDotClass(tag))} />
                      <span className={cn("text-sm font-semibold flex-1 text-left", selected ? isUnassigned ? "text-feedback" : "text-primary" : "text-foreground/90")}>{tag.name}</span>
                      {selected && <Check className={cn("w-4 h-4", isUnassigned ? "text-feedback" : "text-primary")} />}
                    </button>
                  )
                })}
                {tags.length === 0 && <p className="text-xs text-muted-foreground py-2">No tags yet.</p>}
                {tags.length > 0 && filteredTags.length === 0 && <p className="text-xs text-muted-foreground py-2">No tags found.</p>}
              </div>
            )}
          </>
        )}
      </div>
    </>
  )
}

function ProjectSearchSheet({
  projects,
  query,
  onQueryChange,
  activeFilter,
  onSelect,
  onAll,
  onClose,
}: {
  projects: Project[]
  query: string
  onQueryChange: (value: string) => void
  activeFilter: string
  onSelect: (projectId: string) => void
  onAll: () => void
  onClose: () => void
}) {
  const { handlers: swipeHandlers, dragStyle } = useSwipeDismiss(onClose)

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px]" onClick={onClose} />
      <div
        style={dragStyle}
        className="fixed bottom-0 left-0 right-0 z-50 bg-[#0a1628] border-t border-white/10 rounded-t-3xl px-5 pt-4 pb-10 shadow-2xl animate-in slide-in-from-bottom duration-200"
      >
        <div {...swipeHandlers} className="-mx-5 -mt-4 pt-4 pb-5 touch-none cursor-grab active:cursor-grabbing">
          <div className="w-10 h-1 bg-white/15 rounded-full mx-auto" />
        </div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-[11px] font-bold uppercase tracking-[2px] text-muted-foreground font-mono">
            Tags
          </p>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full bg-white/5 border border-white/10 flex items-center justify-center"
          >
            <X className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        </div>
        <SheetSearchInput value={query} onChange={onQueryChange} placeholder="Search tags" />
        <div className="flex flex-col gap-1 max-h-[45dvh] overflow-y-auto scrollbar-hide">
          <button
            onClick={onAll}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors text-left",
              activeFilter === "all" ? "bg-primary/15 text-primary" : "active:bg-white/5 text-foreground/90"
            )}
          >
            <span className="w-2 h-2 rounded-full bg-white/30 shrink-0" />
            <span className="text-sm font-semibold flex-1">All Tags</span>
            {activeFilter === "all" && <Check className="w-4 h-4 text-primary" />}
          </button>
          {projects.map((project) => {
            const active = activeFilter === project.id
            return (
              <button
                key={project.id}
                onClick={() => onSelect(project.id)}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors text-left",
                  active ? "bg-primary/15 text-primary" : "active:bg-white/5 text-foreground/90"
                )}
              >
                <span className={cn("w-2 h-2 rounded-full shrink-0", project.color)} />
                <span className="text-sm font-semibold flex-1 truncate">{project.name}</span>
                {project.isFavorited && <Star className="w-3.5 h-3.5 text-feedback fill-current" />}
                {active && <Check className="w-4 h-4 text-primary" />}
              </button>
            )
          })}
          {projects.length === 0 && (
            <p className="text-xs text-muted-foreground px-1 py-3">No tags found.</p>
          )}
        </div>
      </div>
    </>
  )
}

function StreamFeedSkeleton() {
  return (
    <div className="flex flex-col gap-4 py-1">
      <FeedSkeletonBubble side="left" width="w-[74%]" lines={2} />
      <FeedSkeletonBubble side="right" width="w-[62%]" lines={1} />
      <FeedSkeletonBubble side="left" width="w-[82%]" lines={3} image />
      <FeedSkeletonBubble side="right" width="w-[70%]" lines={2} />
    </div>
  )
}

function FeedSkeletonBubble({
  side,
  width,
  lines,
  image,
}: {
  side: "left" | "right"
  width: string
  lines: number
  image?: boolean
}) {
  return (
    <div className={cn("flex gap-2 items-end animate-pulse", side === "right" && "flex-row-reverse")}>
      <div className="w-8 h-8 rounded-full bg-white/8 border border-white/10 shrink-0" />
      <div className={cn("max-w-[78%] md:max-w-[55%] flex flex-col gap-1", width, side === "right" && "items-end")}>
        {side === "left" && <div className="h-3 w-20 rounded-full bg-white/8" />}
        <div
          className={cn(
            "w-full border border-white/10 bg-white/[0.07] p-3",
            side === "right" ? "rounded-[16px_16px_4px_16px]" : "rounded-[16px_16px_16px_4px]"
          )}
        >
          {image && <div className="mb-3 h-24 rounded-xl bg-white/8" />}
          <div className="flex flex-col gap-2">
            {Array.from({ length: lines }).map((_, index) => (
              <div
                key={index}
                className={cn(
                  "h-3 rounded-full bg-white/10",
                  index === lines - 1 ? "w-2/3" : "w-full"
                )}
              />
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <div className="h-4 w-16 rounded-full bg-white/8" />
            <div className="ml-auto h-3 w-10 rounded-full bg-white/8" />
          </div>
        </div>
      </div>
    </div>
  )
}

function SheetSearchInput({
  value,
  onChange,
  onFocus,
  onBlur,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  onFocus?: () => void
  onBlur?: () => void
  placeholder: string
}) {
  return (
    <label className="mb-3 flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
      <Search className="w-4 h-4 text-muted-foreground" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
      />
    </label>
  )
}

function SheetAction({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 text-left text-sm font-semibold text-foreground/90 active:bg-white/10"
    >
      <span className="w-8 h-8 rounded-full bg-primary/12 text-primary flex items-center justify-center">{icon}</span>
      {label}
    </button>
  )
}

function PeopleFilterSheet({
  contacts,
  currentUserId,
  userInitials,
  userColor,
  selectedPeople,
  onChange,
  onClose,
}: {
  contacts: Contact[]
  currentUserId: string
  userInitials: string
  userColor: string
  selectedPeople: string[]
  onChange: (ids: string[]) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState("")
  const { handlers: swipeHandlers, dragStyle } = useSwipeDismiss(onClose)
  const people = [
    { id: currentUserId, name: "Me", initials: userInitials, color: userColor },
    ...contacts,
  ].filter((person) => person.id)
  const filtered = people.filter((person) => person.name.toLowerCase().includes(query.trim().toLowerCase()))
  const toggle = (id: string) => {
    onChange(selectedPeople.includes(id) ? selectedPeople.filter((item) => item !== id) : [...selectedPeople, id])
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px]" onClick={onClose} />
      <div
        style={dragStyle}
        className="fixed bottom-0 left-0 right-0 z-50 bg-[#0a1628] border-t border-white/10 rounded-t-3xl px-5 pt-4 pb-10 shadow-2xl animate-in slide-in-from-bottom duration-200"
      >
        <div {...swipeHandlers} className="-mx-5 -mt-4 pt-4 pb-5 touch-none cursor-grab active:cursor-grabbing">
          <div className="w-10 h-1 bg-white/15 rounded-full mx-auto" />
        </div>
        <SheetHeader title="People" onClose={onClose} />
        <SheetSearchInput value={query} onChange={setQuery} placeholder="Search people" />
        <div className="flex flex-col gap-1 max-h-[45dvh] overflow-y-auto scrollbar-hide">
          <button
            onClick={() => onChange([])}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors text-left",
              selectedPeople.length === 0
                ? "bg-feedback/15 text-feedback"
                : "active:bg-white/5 text-foreground/90"
            )}
          >
            <span className="w-7 h-7 rounded-full bg-feedback/15 border border-feedback/25 flex items-center justify-center shrink-0">
              <Users className="w-3.5 h-3.5 text-feedback" />
            </span>
            <span className="text-sm font-semibold flex-1 truncate">All People</span>
            {selectedPeople.length === 0 && <Check className="w-4 h-4 text-feedback" />}
          </button>
          {filtered.map((person) => {
            const selected = selectedPeople.includes(person.id)
            return (
              <button
                key={person.id}
                onClick={() => toggle(person.id)}
                className={cn("flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors text-left", selected ? "bg-primary/15 text-primary" : "active:bg-white/5 text-foreground/90")}
              >
                <span className={cn("w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0", person.color)}>
                  {person.initials}
                </span>
                <span className="text-sm font-semibold flex-1 truncate">{person.name}</span>
                {selected && <Check className="w-4 h-4 text-primary" />}
              </button>
            )
          })}
          {filtered.length === 0 && <p className="text-xs text-muted-foreground px-1 py-3">No people found.</p>}
        </div>
      </div>
    </>
  )
}

function TagFilterSheet({
  tags,
  selectedTags,
  onChange,
  onClose,
}: {
  tags: MessageTag[]
  selectedTags: string[]
  onChange: (ids: string[]) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState("")
  const { handlers: swipeHandlers, dragStyle } = useSwipeDismiss(onClose)
  const queryText = query.trim().toLowerCase()
  const filtered = tags
    .filter((tag) => tag.name.toLowerCase().includes(queryText))
    .sort((a, b) => {
      if (!queryText) {
        if (a.id === systemTypeTagId("none")) return -1
        if (b.id === systemTypeTagId("none")) return 1
      }
      return 0
    })
  const toggle = (id: string) => {
    onChange(selectedTags.includes(id) ? selectedTags.filter((item) => item !== id) : [...selectedTags, id])
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px]" onClick={onClose} />
      <div
        style={dragStyle}
        className="fixed bottom-0 left-0 right-0 z-50 bg-[#0a1628] border-t border-white/10 rounded-t-3xl px-5 pt-4 pb-10 shadow-2xl animate-in slide-in-from-bottom duration-200"
      >
        <div {...swipeHandlers} className="-mx-5 -mt-4 pt-4 pb-5 touch-none cursor-grab active:cursor-grabbing">
          <div className="w-10 h-1 bg-white/15 rounded-full mx-auto" />
        </div>
        <SheetHeader title="Tags" onClose={onClose} />
        <SheetSearchInput value={query} onChange={setQuery} placeholder="Search tags" />
        <div className="flex flex-col gap-1 max-h-[45dvh] overflow-y-auto scrollbar-hide">
          <button
            onClick={() => onChange([])}
            className={cn("flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors text-left", selectedTags.length === 0 ? "bg-primary/15 text-primary" : "active:bg-white/5 text-foreground/90")}
          >
            <span className="w-4 h-4 rounded-full bg-white/[0.035] border border-white/[0.07] flex items-center justify-center shrink-0">
              <LayoutGrid className="w-2.5 h-2.5 text-muted-foreground/60" />
            </span>
            <span className="text-sm font-semibold flex-1">All Tags</span>
            {selectedTags.length === 0 && <Check className="w-4 h-4 text-primary" />}
          </button>
          {filtered.map((tag) => {
            const selected = selectedTags.includes(tag.id)
            const isUnassigned = tag.id === systemTypeTagId("none")
            return (
              <button
                key={tag.id}
                onClick={() => toggle(tag.id)}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors text-left",
                  selected
                    ? isUnassigned ? "bg-feedback/15 text-feedback" : "bg-primary/15 text-primary"
                    : "active:bg-white/5 text-foreground/90"
                )}
              >
                {isUnassigned ? (
                  <span className="w-4 h-4 rounded-full bg-feedback/[0.07] border border-feedback/10 flex items-center justify-center shrink-0">
                    <CircleSlash className="w-2.5 h-2.5 text-feedback/70" />
                  </span>
                ) : (
                  <span className={cn("w-2 h-2 rounded-full shrink-0", tagDotClass(tag))} />
                )}
                <span className="text-sm font-semibold flex-1 truncate">{tag.name}</span>
                {tag.isFavorited && <Star className="w-3.5 h-3.5 text-feedback fill-current" />}
                {selected && <Check className={cn("w-4 h-4", isUnassigned ? "text-feedback" : "text-primary")} />}
              </button>
            )
          })}
          {filtered.length === 0 && <p className="text-xs text-muted-foreground px-1 py-3">No tags found.</p>}
        </div>
      </div>
    </>
  )
}

function SheetHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <p className="text-[11px] font-bold uppercase tracking-[2px] text-muted-foreground font-mono">
        {title}
      </p>
      <button
        onClick={onClose}
        className="w-7 h-7 rounded-full bg-white/5 border border-white/10 flex items-center justify-center"
      >
        <X className="w-3.5 h-3.5 text-muted-foreground" />
      </button>
    </div>
  )
}

function tagDotClass(tag: MessageTag): string {
  const systemType = parseSystemTypeTagId(tag.id)
  if (systemType === "progress") return "bg-progress"
  if (systemType === "problem") return "bg-problem"
  if (systemType === "feedback") return "bg-feedback"
  if (systemType === "decision") return "bg-decision"
  return tag.color || "bg-primary"
}

function FilterChip({
  children, active, highlight, isFavorited, icon, tone, onClick, onLongPress,
}: {
  children: React.ReactNode
  active?: boolean
  highlight?: boolean
  isFavorited?: boolean
  icon?: React.ReactNode
  tone?: "default" | "people"
  onClick?: () => void
  onLongPress?: () => void
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const didLongPress = useRef(false)

  const startPress = () => {
    didLongPress.current = false
    if (!onLongPress) return
    timer.current = setTimeout(() => {
      didLongPress.current = true
      navigator?.vibrate?.(12)
      onLongPress()
    }, 450)
  }
  const cancelPress = () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
  }
  const handleClick = () => {
    if (didLongPress.current) { didLongPress.current = false; return }
    onClick?.()
  }

  return (
    <button
      onPointerDown={startPress}
      onPointerUp={cancelPress}
      onPointerLeave={cancelPress}
      onPointerCancel={cancelPress}
      onClick={handleClick}
      className={cn(
        "text-xs font-semibold px-3 py-1.5 rounded-full whitespace-nowrap shrink-0 tracking-wide transition-all border flex items-center gap-1",
        active && tone === "people"
          ? "bg-feedback/15 border-feedback/35 text-feedback"
        : active
          ? "bg-primary/20 border-primary/35 text-primary"
        : highlight
          ? "bg-feedback/10 border-feedback/25 text-feedback"
        : tone === "people"
          ? "bg-feedback/8 border-feedback/20 text-feedback/80 hover:bg-feedback/12 hover:border-feedback/35"
          : "bg-white/5 border-white/10 text-muted-foreground hover:bg-primary/10 hover:border-primary/35 hover:text-primary"
      )}
    >
      {isFavorited && <Star className="w-2.5 h-2.5 fill-current text-feedback shrink-0" />}
      {icon}
      {children}
    </button>
  )
}

function MessageBubble({
  message, projects, contacts, currentUserId, userInitials, userColor, isAuthorActive, isSelected, isFirstInGroup, isLastInGroup, onTap, onPressStart, onPressEnd, onProjectTagTap,
}: {
  message: Message
  projects: Project[]
  contacts: Contact[]
  currentUserId: string
  userInitials: string
  userColor: string
  isAuthorActive: boolean
  isSelected: boolean
  isFirstInGroup?: boolean
  isLastInGroup?: boolean
  onTap: () => void
  onPressStart: () => void
  onPressEnd: () => void
  onProjectTagTap?: (projectId: string) => void
}) {
  const first = isFirstInGroup ?? true
  const last = isLastInGroup ?? true
  const [isExpanded, setIsExpanded] = useState(false)
  const isLong = !!message.text && message.text.length > 360
  const isMe = message.senderId === currentUserId
  const contact = isMe
    ? { id: currentUserId, name: "Me", initials: userInitials, color: userColor }
    : (getContactFromList(message.senderId, contacts) ?? { id: message.senderId, name: "Unknown", initials: "?", color: "bg-white/10" })
  const messageTags = getMessageTagIds(message).map((tagId) => {
    if (tagId === systemTypeTagId("none")) {
      return { id: tagId, name: typeStyles.none.label, systemType: "none" as const, color: typeStyles.none.text }
    }
    const systemType = parseSystemTypeTagId(tagId)
    if (systemType) {
      return { id: tagId, name: typeStyles[systemType].label, systemType, color: typeStyles[systemType].text }
    }
    const projectId = parseProjectTagId(tagId)
    const project = projectId ? projects.find((p) => p.id === projectId) : null
    return project ? { id: tagId, name: project.name, projectId, color: project.color, isFavorited: project.isFavorited } : null
  }).filter(Boolean) as Array<{ id: string; name: string; color: string; systemType?: MessageType; projectId?: string; isFavorited?: boolean }>

  // Tail is on the bottom-sender-side corner (WhatsApp style)
  const bubbleRadius = isMe
    ? (!first && !last) ? "rounded-[16px_4px_4px_16px]"
    : !first            ? "rounded-[16px_4px_16px_16px]"
    :                     "rounded-[16px_16px_4px_16px]"
    : (!first && !last) ? "rounded-[4px_16px_16px_4px]"
    : !first            ? "rounded-[4px_16px_16px_16px]"
    :                     "rounded-[16px_16px_16px_4px]"

  return (
    <div
      className={cn(
        "flex gap-2 items-end select-none no-callout",
        isMe && "flex-row-reverse",
        isSelected && "opacity-90",
        first ? "mt-3 animate-fade-up" : "mt-1"
      )}
    >
      {/* Avatar — only visible on first message in a group */}
      {first ? (
        <div className={cn(
          "relative w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 text-white",
          contact.color
        )}>
          {contact.initials}
          {isAuthorActive && (
            <span className="absolute -right-0.5 -bottom-0.5 w-3.5 h-3.5 rounded-full bg-emerald-400 border-[3px] border-background shadow-[0_0_12px_rgba(52,211,153,0.9)]" />
          )}
        </div>
      ) : (
        <div className="w-8 shrink-0" />
      )}

      <div className={cn("max-w-[75%] md:max-w-[55%] flex flex-col gap-1", isMe && "items-end")}>
        {!isMe && first && (
          <span className="text-xs font-semibold text-muted-foreground px-1">{contact.name}</span>
        )}
        <div
          onPointerDown={(e) => { e.stopPropagation(); onPressStart() }}
          onPointerUp={() => { cancelAnimationFrame(0); onPressEnd() }}
          onPointerCancel={onPressEnd}
          onPointerLeave={onPressEnd}
          onClick={(e) => { e.stopPropagation(); onTap() }}
          onContextMenu={(e) => { e.preventDefault(); onPressStart(); setTimeout(onPressEnd, 0) }}
          className={cn(
            "border p-3 px-3.5 cursor-pointer transition-all duration-150",
            isMe
              ? cn("bg-[#112a52] border-primary/25", bubbleRadius)
              : cn("bg-card border-white/10", bubbleRadius),
            isSelected && (isMe
              ? "bg-primary/25 border-primary/50 shadow-[0_0_0_2px_rgba(37,99,235,0.3)]"
              : "bg-primary/10 border-primary/30 shadow-[0_0_0_2px_rgba(37,99,235,0.2)]")
          )}
        >
          {message.imageUrl && (
            <img
              src={message.imageUrl}
              alt={message.imageName || "Attached image"}
              className="mb-2 max-h-72 w-full rounded-xl object-cover border border-white/10 bg-black/20"
            />
          )}
          {message.text && (
            <div>
              <p className={cn(
                "text-sm leading-relaxed text-foreground/90 no-callout",
                isLong && !isExpanded && "line-clamp-10"
              )}>
                {message.text}
              </p>
              {isLong && (
                <button
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); setIsExpanded((v) => !v) }}
                  className="text-sm text-primary underline mt-0.5 active:opacity-60 transition-opacity"
                >
                  {isExpanded ? "Read less" : "Read more"}
                </button>
              )}
            </div>
          )}
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {messageTags.length === 0 && (
              <div className="w-1.5 h-1.5 rounded-full bg-feedback flex-shrink-0 shadow-[0_0_6px_rgba(245,158,11,0.5)] animate-pulse" />
            )}
            {messageTags.length === 0 && (
              <span className="text-[10px] font-bold tracking-wide uppercase px-2 py-0.5 rounded-full font-mono flex-shrink-0 border border-white/10 bg-white/5 text-muted-foreground no-callout">
                Unassigned
              </span>
            )}
            {messageTags.map((tag) => {
              if (tag.systemType === "none") {
                return (
                  <Fragment key={tag.id}>
                    <div className="w-1.5 h-1.5 rounded-full bg-feedback flex-shrink-0 shadow-[0_0_6px_rgba(245,158,11,0.5)] animate-pulse" />
                    <span className="text-[10px] font-bold tracking-wide uppercase px-2 py-0.5 rounded-full font-mono flex-shrink-0 border border-white/10 bg-white/5 text-muted-foreground no-callout">
                      Unassigned
                    </span>
                  </Fragment>
                )
              }
              return (
                <button
                  key={tag.id}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (tag.projectId) onProjectTagTap?.(tag.projectId)
                  }}
                  className={cn(
                    "text-[10px] font-semibold tracking-wide border rounded px-2 py-0.5 font-mono active:bg-primary/20 transition-colors no-callout",
                    tag.systemType
                      ? cn(typeStyles[tag.systemType].bg, typeStyles[tag.systemType].text, typeStyles[tag.systemType].border)
                      : "bg-primary/10 text-primary border-primary/20"
                  )}
                >
                  {tag.isFavorited && <Star className="inline w-2 h-2 fill-current text-feedback mr-0.5 -mt-px" />}
                  {tag.name}
                </button>
              )
            })}
            {message.isFavorited && (
              <Star className="w-3 h-3 text-feedback fill-current ml-0.5 flex-shrink-0" />
            )}
            <span className="text-[10px] text-muted-foreground font-mono ml-auto">
              {formatTime(message.timestamp)}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
