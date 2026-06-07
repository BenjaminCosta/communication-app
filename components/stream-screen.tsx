"use client"

import { useState, useRef, useEffect, useMemo, Fragment, type PointerEvent as ReactPointerEvent, type TouchEvent as ReactTouchEvent, type WheelEvent as ReactWheelEvent } from "react"
import { MessageCircle, Star, Trash2, FolderOpen, X, LayoutGrid, Copy, User, Tag, Image as ImageIcon, Check, Search, Users, CircleSlash, ZoomIn, ZoomOut, RotateCcw, CalendarDays, ChevronDown, ChevronRight, Plus, CornerDownLeft } from "lucide-react"
import { cn, haptic } from "@/lib/utils"
import { validateImageFile } from "@/lib/image-upload"
import {
  type Message,
  type MessageDraft,
  type MessageType,
  type Project,
  type Contact,
  type Tag as MessageTag,
  type ImportedContact,
  type TagCategory,
  type CategoryItem,
  getContactFromList,
  formatTime,
  getMessageTagIds,
  MESSAGE_TYPE_CONFIG,
  parseProjectTagId,
  parseSystemTypeTagId,
  projectTagId,
  systemTypeTagId,
  getCategoryLabel,
  SYSTEM_CATEGORIES,
  type ReplyPreview,
} from "@/lib/store"
import { CreateProjectModal } from "@/components/create-project-modal"
import { UniversalAddModal } from "@/components/universal-add-modal"
import { MessageInputBar } from "@/components/message-input-bar"
import { useSwipeDismiss } from "@/hooks/use-swipe-dismiss"
import { useSwipeToReply } from "@/hooks/use-swipe-to-reply"
import { DatePickerModal } from "@/components/date-picker-modal"
import { NavigationMenuModal } from "@/components/navigation-menu-modal"
import { GlobalSearchSheet } from "@/components/global-search-sheet"
import { CategoryIcon, getCategoryDotClass } from "@/components/category-icon"
import { MessageImage } from "@/components/message-image"

const typeStyles = MESSAGE_TYPE_CONFIG

function formatCalDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number)
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

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
  selectedDateFilter: string[]
  onPeopleFilterChange: (ids: string[]) => void
  onTagFilterChange: (ids: string[]) => void
  onDateFilterChange: (dates: string[]) => void
  onCompose: () => void
  onMessageClick: (message: Message) => void
  onNewProject: (name: string, memberIds: string[], category?: TagCategory) => void
  onProfile: () => void
  onPeople: () => void
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
  onCalendar: () => void
  onCopyMessage: (text: string) => void
  onSendMessage: (draft: MessageDraft) => Promise<void>
  onCreateProject: (name: string, memberIds?: string[], category?: TagCategory) => Promise<Project>
  activeUsers: Contact[]
  availableTags: MessageTag[]
  importedContacts: ImportedContact[]
  customCategories?: CategoryItem[]
  onCreateCategory?: (name: string) => Promise<void> | void
}

export function StreamScreen({
  messages,
  activeFilter,
  onFilterChange,
  selectedPeopleFilter,
  selectedTagFilter,
  selectedDateFilter,
  onPeopleFilterChange,
  onTagFilterChange,
  onDateFilterChange,
  onCompose,
  onMessageClick,
  onNewProject,
  onProfile,
  onPeople,
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
  onCalendar,
  onCopyMessage,
  onSendMessage,
  onCreateProject,
  activeUsers,
  availableTags,
  importedContacts,
  customCategories = [],
  onCreateCategory,
}: StreamScreenProps) {
  const [showCreateProject, setShowCreateProject] = useState(false)
  const [showUniversalAdd, setShowUniversalAdd] = useState(false)
  const [selectedMsgId, setSelectedMsgId] = useState<string | null>(null)
  const [projectTagCtx, setProjectTagCtx] = useState<{ projectId: string; messageId: string } | null>(null)
  const [selectedChipId, setSelectedChipId] = useState<string | null>(null)
  const [confirmDeleteChipId, setConfirmDeleteChipId] = useState<string | null>(null)
  const [confirmDeleteMsgId, setConfirmDeleteMsgId] = useState<string | null>(null)
  const [showPeopleFilterSheet, setShowPeopleFilterSheet] = useState(false)
  const [showTagFilterSheet, setShowTagFilterSheet] = useState(false)
  const [showDateFilterPicker, setShowDateFilterPicker] = useState(false)
  const [viewerImage, setViewerImage] = useState<{ url: string; name?: string } | null>(null)
  const [quickText, setQuickText] = useState("")
  const [quickRecipients, setQuickRecipients] = useState<string[]>([])
  const [quickImportedRecipients, setQuickImportedRecipients] = useState<string[]>([])
  const [quickProjects, setQuickProjects] = useState<string[]>([])
  const [quickCalendarDates, setQuickCalendarDates] = useState<string[]>([])
  const [quickType, setQuickType] = useState<MessageType>("none")
  const [quickImage, setQuickImage] = useState<File | null>(null)
  const [quickImagePreview, setQuickImagePreview] = useState<string | null>(null)
  const [quickImageError, setQuickImageError] = useState<string | null>(null)
  const [quickSendError, setQuickSendError] = useState<string | null>(null)
  const [showQuickSheet, setShowQuickSheet] = useState(false)
  const [showQuickActionMenu, setShowQuickActionMenu] = useState(false)
  const [quickSheetMode, setQuickSheetMode] = useState<"menu" | "who" | "tag" | "date">("menu")
  const [showCreateQuickProject, setShowCreateQuickProject] = useState(false)
  const [isQuickSending, setIsQuickSending] = useState(false)
  const [isQuickSent, setIsQuickSent] = useState(false)
  const [projectSearch, setProjectSearch] = useState("")
  const [showProjectSearch, setShowProjectSearch] = useState(false)
  const [showFeedSkeleton, setShowFeedSkeleton] = useState(false)
  const [showNavMenu, setShowNavMenu] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [highlightMessageId, setHighlightMessageId] = useState<string | null>(null)
  const [replyingTo, setReplyingTo] = useState<Message | null>(null)
  const [bannerMounted, setBannerMounted] = useState(false)
  const [bannerOpen, setBannerOpen] = useState(false)
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [floatingDate, setFloatingDate] = useState<string | null>(null)
  const [showFloatingDate, setShowFloatingDate] = useState(false)
  const feedRef = useRef<HTMLDivElement>(null)
  const inputAreaRef = useRef<HTMLDivElement>(null)
  const [inputAreaHeight, setInputAreaHeight] = useState(58)
  const quickFileInputRef = useRef<HTMLInputElement>(null)
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const floatingHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isPinnedToBottom = useRef(true)
  const prevMessageCountRef = useRef(0)
  const previousFilterRef = useRef(activeFilter)

  const clearChipSelection = () => { setSelectedChipId(null); setConfirmDeleteChipId(null) }
  const clearMsgSelection = () => { setSelectedMsgId(null); setConfirmDeleteMsgId(null) }

  function scrollToAndHighlight(id: string) {
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current)
    setHighlightMessageId(id)
    setTimeout(() => {
      const el = feedRef.current?.querySelector(`[data-msg-id="${id}"]`)
      el?.scrollIntoView({ behavior: "smooth", block: "center" })
    }, 180)
    highlightTimerRef.current = setTimeout(() => setHighlightMessageId(null), 2500)
  }

  // Track input area height so feed padding stays in sync (handles reply banner + chips)
  useEffect(() => {
    const el = inputAreaRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setInputAreaHeight(el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Scroll to bottom whenever the input area grows (reply banner appears, chips expand, etc.)
  useEffect(() => {
    if (isPinnedToBottom.current && feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight
    }
  }, [inputAreaHeight])

  // Scroll to bottom immediately when reply mode activates
  useEffect(() => {
    if (replyingTo && feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight
    }
  }, [replyingTo])

  // Banner mount/open lifecycle: mount immediately on open, unmount after exit transition
  useEffect(() => {
    if (bannerTimer.current) clearTimeout(bannerTimer.current)
    if (replyingTo) {
      setBannerMounted(true)
      requestAnimationFrame(() => setBannerOpen(true))
    } else {
      setBannerOpen(false)
      bannerTimer.current = setTimeout(() => setBannerMounted(false), 230)
    }
    return () => { if (bannerTimer.current) clearTimeout(bannerTimer.current) }
  }, [replyingTo])

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

  const toggleQuickImportedRecipient = (id: string) => {
    setQuickImportedRecipients((prev) => prev.includes(id) ? prev.filter((uid) => uid !== id) : [...prev, id])
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
    setQuickSendError(null)
    const validationError = validateImageFile(file)
    if (validationError) {
      setQuickImageError(validationError)
      if (quickFileInputRef.current) quickFileInputRef.current.value = ""
      return
    }
    if (!file) return
    setQuickImageError(null)
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
    setQuickImageError(null)
    if (quickFileInputRef.current) quickFileInputRef.current.value = ""
  }

  const resetQuickDraft = () => {
    setQuickText("")
    setQuickRecipients([])
    setQuickImportedRecipients([])
    setQuickProjects([])
    setQuickCalendarDates([])
    setQuickType("none")
    setQuickSendError(null)
    setReplyingTo(null)
    clearQuickImage()
  }

  const handleQuickSend = async () => {
    if ((!quickText.trim() && !quickImage) || isQuickSending) return
    haptic.success()
    setIsQuickSending(true)
    setQuickSendError(null)
    try {
      // Auto-assign the active project filter if user hasn't manually chosen one.
      // e.g. composing while filtering by "Project X" → message goes into that project.
      const filterProjectId = activeFilter !== "all" && activeFilter !== "unsorted" ? activeFilter : null
      const effectiveProjects = quickProjects.length === 0 && filterProjectId
        ? [filterProjectId]
        : quickProjects
      const effectiveTagIds = [
        ...(quickType !== "none" ? [systemTypeTagId(quickType)] : []),
        ...effectiveProjects.map(projectTagId),
      ]
      const replyAuthorName = replyingTo
        ? (replyingTo.senderId === currentUserId
          ? "You"
          : (contacts.find((c) => c.id === replyingTo.senderId)?.name ?? "Unknown"))
        : undefined
      await onSendMessage({
        text: quickText.trim(),
        contactIds: quickRecipients,
        peopleIds: quickRecipients,
        importedContactIds: quickImportedRecipients,
        projectIds: effectiveProjects,
        tagIds: effectiveTagIds,
        type: quickType,
        imageFile: quickImage,
        calendarDates: quickCalendarDates.length > 0 ? quickCalendarDates : undefined,
        ...(replyingTo ? {
          replyToId: replyingTo.id,
          replyPreview: {
            messageId: replyingTo.id,
            authorId: replyingTo.senderId,
            authorName: replyAuthorName!,
            text: replyingTo.text.slice(0, 120),
          } satisfies ReplyPreview,
        } : {}),
      })
      resetQuickDraft()
      setIsQuickSent(true)
      setTimeout(() => setIsQuickSent(false), 1400)
    } catch {
      setIsQuickSent(false)
      setQuickSendError("Could not send the message. Please try again.")
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
    <div className="stream-glass-screen flex-1 flex flex-col min-h-0 animate-fade-in overflow-hidden">
      {/* Header */}
      <div className="glass-panel flex-shrink-0 px-4 app-topbar flex items-center justify-between border-b animate-slide-down">
        <h1 className="text-lg font-bold tracking-tight">
          SVC <span className="text-blue-300">Stream</span>
        </h1>
        <div className="flex items-center gap-2">
          {/* Search */}
          <button
            onClick={() => setShowSearch(true)}
            className="glass-button w-9 h-9 rounded-full border flex items-center justify-center active:scale-[0.98] transition-all duration-150"
            aria-label="Search"
          >
            <Search className="w-4 h-4 text-white" />
          </button>
          {/* Navigation menu */}
          <button
            onClick={() => setShowNavMenu(true)}
            className="w-9 h-9 rounded-full border border-primary/30 bg-[linear-gradient(135deg,rgba(37,99,235,0.96),rgba(99,102,241,0.92))] flex items-center justify-center active:scale-[0.98] transition-all duration-150 glow-blue text-white"
            aria-label="Navigation menu"
          >
            <LayoutGrid className="w-4 h-4" />
          </button>
          {/* Profile avatar */}
          <button
            onClick={onProfile}
            className={cn(
              "w-9 h-9 rounded-full flex items-center justify-center active:scale-[0.98] transition-all duration-150 border border-white/15 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_10px_24px_rgba(0,0,0,0.18)]",
              userColor
            )}
          >
            <span className="text-[11px] font-bold text-white">{userInitials}</span>
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      {/* Feed — filter bar and input bar float as absolute overlays so messages are visible behind them */}
      <div className="flex-1 min-h-0 relative">
        {/* Filter bar — transparent overlay at top */}
        <div className="absolute top-0 left-0 right-0 z-10 flex items-center gap-2 overflow-x-auto px-4 py-1.5 scrollbar-hide">
          <FilterChip
            active={selectedPeopleFilter.length === 0 && selectedTagFilter.length === 0 && selectedDateFilter.length === 0}
            onClick={() => {
              onPeopleFilterChange([])
              onTagFilterChange([])
              onDateFilterChange([])
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
              "h-9 min-w-[118px] flex-1 rounded-full border px-3 transition-all duration-150 flex items-center gap-2 justify-start active:scale-[0.98]",
              selectedTagFilter.length > 0
                ? "glass-pill-active"
                : "glass-pill text-white/85 hover:border-primary/40 hover:text-blue-200"
            )}
            aria-label="Filter tags"
          >
            <Tag className="w-4 h-4 shrink-0" />
            <span className="text-xs font-semibold tracking-wide truncate">
              Tags{selectedTagFilter.length > 0 ? ` (${selectedTagFilter.length})` : ""}
            </span>
          </button>
          <button
            onClick={() => setShowDateFilterPicker(true)}
            className={cn(
              "relative h-9 w-9 rounded-full shrink-0 transition-all duration-150 border active:scale-[0.98] flex items-center justify-center",
              selectedDateFilter.length > 0
                ? "border-sky-300/55 bg-sky-400/24 text-sky-100 shadow-[0_14px_34px_rgba(56,189,248,0.18)] backdrop-blur-xl"
                : "glass-pill border-sky-400/32 text-sky-200 hover:bg-sky-400/16 hover:border-sky-300/50"
            )}
            aria-label="Filter dates"
          >
            <CalendarDays className="w-3.5 h-3.5" />
            {selectedDateFilter.length > 0 && (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full border border-[#07111f] bg-sky-300 px-1 text-[9px] font-bold leading-none text-[#07111f]">
                {selectedDateFilter.length}
              </span>
            )}
          </button>
        </div>

        {/* Floating date badge — offset below filter bar */}
        <div
          className={cn(
            "absolute top-[56px] left-1/2 -translate-x-1/2 z-10 pointer-events-none transition-opacity duration-150",
            showFloatingDate ? "opacity-90" : "opacity-0"
          )}
        >
          <span className="glass-pill px-2.5 py-0.5 rounded-full border text-[9px] font-semibold tracking-tight uppercase text-foreground/90">
            {floatingDate}
          </span>
        </div>

        <div
          ref={feedRef}
          onScroll={handleScroll}
          className="absolute inset-0 overflow-y-auto px-4 pt-12 flex flex-col gap-0 scrollbar-hide"
          style={{ paddingBottom: `calc(env(safe-area-inset-bottom) + ${inputAreaHeight}px + 8px)` }}
          onClick={() => selectedMsgId && clearMsgSelection()}
        >
          {showFeedSkeleton ? (
            <StreamFeedSkeleton />
          ) : sortedMessages.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 py-16">
              <div className="glass-panel w-16 h-16 rounded-full border flex items-center justify-center animate-float">
                <MessageCircle className="w-7 h-7 text-muted-foreground/50" />
              </div>
              <p className="text-sm text-muted-foreground">Nothing sent yet</p>
              <p className="text-xs text-muted-foreground/50">Use the message bar to send your first message</p>
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
                    isHighlighted={highlightMessageId === msg.id}
                    isFirstInGroup={isFirstInGroup}
                    isLastInGroup={isLastInGroup}
                    onTap={() => {
                      if (selectedMsgId) { clearMsgSelection(); return }
                      onMessageClick(msg)
                    }}
                    onPressStart={() => startPress(msg.id)}
                    onPressEnd={cancelPress}
                    onImageOpen={(url, name) => setViewerImage({ url, name })}
                    onProjectTagTap={(projectId) => setProjectTagCtx({ projectId, messageId: msg.id })}
                    onReply={(msg) => {
                      setReplyingTo(msg)
                      setQuickRecipients(msg.recipientIds ?? msg.peopleIds ?? [])
                      setQuickProjects(msg.projectIds ?? (msg.projectId ? [msg.projectId] : []))
                      setQuickCalendarDates((msg.calendarDates ?? []).map((d) => d.date))
                    }}
                    onReplyQuoteTap={(msgId) => scrollToAndHighlight(msgId)}
                  />
                </Fragment>
              )
            })
          )}
          <div className="h-3" />
        </div>

        {/* Message input — transparent overlay at bottom */}
        <div ref={inputAreaRef} className="absolute bottom-0 left-0 right-0 z-10">
          {/* Reply preview banner — mounted only when active, animates open/close */}
          {bannerMounted && (
            <div
              className="reply-banner-grid"
              data-open={bannerOpen ? "true" : "false"}
            >
              <div className="overflow-hidden min-h-0">
                <div className="mx-3 mb-1.5 mt-1 px-3 py-2 rounded-xl bg-white/6 border border-white/10 backdrop-blur-sm flex items-start gap-2.5">
                  <div className="w-0.5 self-stretch rounded-full bg-blue-400/70 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-blue-300 truncate">
                      {replyingTo
                        ? (replyingTo.senderId === currentUserId ? "You" : (contacts.find((c) => c.id === replyingTo.senderId)?.name ?? "Unknown"))
                        : ""}
                    </p>
                    <p className="text-xs text-white/50 truncate">{replyingTo?.text || (replyingTo ? "Image" : "")}</p>
                  </div>
                  <button
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => setReplyingTo(null)}
                    className="text-white/40 hover:text-white/70 p-1 -mr-1 transition-colors shrink-0"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          )}
          <MessageInputBar
            text={quickText}
            setText={setQuickText}
            contacts={contacts}
            projects={projects}
            recipients={quickRecipients}
            importedContacts={importedContacts}
            importedRecipients={quickImportedRecipients}
            onRemoveImportedRecipient={(id) => setQuickImportedRecipients((prev) => prev.filter((uid) => uid !== id))}
            projectIds={quickProjects}
            calendarDates={quickCalendarDates}
            type={quickType}
            imageFile={quickImage}
            imagePreview={quickImagePreview}
            imageError={quickImageError}
            sendError={quickSendError}
            isSending={isQuickSending}
            isSent={isQuickSent}
            onOpenSheet={() => setShowQuickActionMenu(true)}
            onRemoveRecipient={(id) => setQuickRecipients((prev) => prev.filter((uid) => uid !== id))}
            onRemoveProject={(id) => setQuickProjects((prev) => prev.filter((projectId) => projectId !== id))}
            onRemoveCalendarDate={(date) => setQuickCalendarDates((prev) => prev.filter((item) => item !== date))}
            onClearType={() => setQuickType("none")}
            onClearImage={clearQuickImage}
            onSend={handleQuickSend}
          />
        </div>
      </div>
      {showQuickActionMenu && (
        <QuickActionPopover
          onClose={() => setShowQuickActionMenu(false)}
          onAddTags={() => {
            setShowQuickActionMenu(false)
            setQuickSheetMode("menu")
            setShowQuickSheet(true)
          }}
          onAttachImage={() => {
            setShowQuickActionMenu(false)
            quickFileInputRef.current?.click()
          }}
          onCreateTag={() => {
            setShowQuickActionMenu(false)
            setShowCreateProject(true)
          }}
        />
      )}
      <input
        ref={quickFileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => handleQuickImage(e.target.files?.[0] ?? null)}
      />

      {viewerImage && (
        <ImageViewerModal
          image={viewerImage}
          onClose={() => setViewerImage(null)}
        />
      )}

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
            <div className="glass-panel flex items-center justify-center gap-1 border rounded-2xl p-1.5">
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
              <div className="glass-panel flex items-center justify-center gap-1 border rounded-2xl p-1.5">
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
              <div className="glass-panel flex items-center justify-center gap-1 border rounded-2xl p-1.5">
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
          customCategories={customCategories}
          onClose={() => setShowCreateProject(false)}
          onSubmit={(name, memberIds, category) => {
            onNewProject(name, memberIds, category)
            setShowCreateProject(false)
          }}
        />
      )}

      {showPeopleFilterSheet && (
        <PeopleFilterSheet
          contacts={contacts}
          importedContacts={importedContacts}
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
          customCategories={customCategories}
          selectedTags={selectedTagFilter}
          onChange={(ids) => {
            onTagFilterChange(ids)
            const projectIds = ids.map(parseProjectTagId).filter(Boolean) as string[]
            onFilterChange(projectIds.length === 1 && ids.length === 1 ? projectIds[0] : "all")
          }}
          onClose={() => setShowTagFilterSheet(false)}
        />
      )}
      {showDateFilterPicker && (
        <DatePickerModal
          selectedDates={selectedDateFilter}
          title="Filter dates"
          onConfirm={(dates) => {
            onDateFilterChange(dates)
            setShowDateFilterPicker(false)
          }}
          onClose={() => setShowDateFilterPicker(false)}
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
          importedContacts={importedContacts}
          selectedRecipients={quickRecipients}
          selectedImportedRecipients={quickImportedRecipients}
          selectedTags={quickTagIds}
          selectedCalendarDates={quickCalendarDates}
          onToggleRecipient={toggleQuickRecipient}
          onToggleImportedRecipient={toggleQuickImportedRecipient}
          tags={availableTags}
          customCategories={customCategories}
          onToggleTag={toggleQuickTag}
          onCalendarDatesChange={setQuickCalendarDates}
          onCreateProject={() => { setShowQuickSheet(false); setShowUniversalAdd(true) }}
          onClose={() => setShowQuickSheet(false)}
        />
      )}

      {showCreateQuickProject && (
        <CreateProjectModal
          contacts={contacts}
          customCategories={customCategories}
          onClose={() => setShowCreateQuickProject(false)}
          onSubmit={async (name, memberIds, category) => {
            const project = await onCreateProject(name, memberIds, category)
            setQuickProjects((prev) => [...new Set([...prev, project.id])])
            setShowCreateQuickProject(false)
          }}
        />
      )}

      {showUniversalAdd && (
        <UniversalAddModal
          onClose={() => setShowUniversalAdd(false)}
          onChooseTag={() => { setShowUniversalAdd(false); setShowCreateQuickProject(true) }}
          onCreateCategory={(name) => onCreateCategory?.(name)}
        />
      )}

      {/* Navigation menu modal */}
      {showNavMenu && (
        <NavigationMenuModal
          activeScreen="stream"
          onClose={() => setShowNavMenu(false)}
          onNavigate={(target) => {
            if (target === "stream") {
              // Already on stream — just close
            } else if (target === "people") {
              onPeople()
            } else if (target === "projects") {
              onProjects()
            } else if (target === "calendar") {
              onCalendar()
            }
          }}
        />
      )}

      {/* Global search sheet */}
      {showSearch && (
        <GlobalSearchSheet
          onClose={() => setShowSearch(false)}
          messages={messages}
          contacts={contacts}
          importedContacts={importedContacts}
          projects={projects}
          customCategories={customCategories}
          availableTags={availableTags}
          currentUserId={currentUserId}
          onMessageClick={(msg) => { setShowSearch(false); scrollToAndHighlight(msg.id) }}
          onPersonFilterClick={(id) => { setShowSearch(false); onPeopleFilterChange([id]) }}
          onTagFilterClick={(id) => { setShowSearch(false); onTagFilterChange([id]) }}
        />
      )}

    </div>
  )
}

function QuickActionPopover({
  onAddTags,
  onAttachImage,
  onCreateTag,
  onClose,
}: {
  onAddTags: () => void
  onAttachImage: () => void
  onCreateTag: () => void
  onClose: () => void
}) {
  return (
    <>
      <button
        type="button"
        aria-label="Close quick actions"
        onClick={onClose}
        className="fixed inset-0 z-40 bg-transparent"
      />
      <div className="glass-panel fixed bottom-[calc(var(--sab)+64px)] left-3 z-50 w-64 overflow-hidden rounded-[22px] border animate-fade-up">
        <QuickActionItem
          icon={<Tag className="w-5 h-5" />}
          iconClassName="text-primary"
          label="Tags"
          onClick={onAddTags}
        />
        <QuickActionItem
          icon={<ImageIcon className="w-5 h-5" />}
          iconClassName="text-sky-400"
          label="Attach image"
          onClick={onAttachImage}
        />
        <div className="h-px bg-white/8 mx-4" />
        <QuickActionItem
          icon={<Plus className="w-5 h-5" />}
          iconClassName="text-emerald-400"
          label="New tag"
          onClick={onCreateTag}
        />
      </div>
    </>
  )
}

function QuickActionItem({
  icon,
  iconClassName,
  label,
  onClick,
}: {
  icon: React.ReactNode
  iconClassName: string
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-4 px-5 py-4 text-left text-[15px] font-semibold text-foreground/90 transition-colors active:bg-white/8"
    >
      <span className={cn("flex h-7 w-7 items-center justify-center", iconClassName)}>
        {icon}
      </span>
      <span className="flex-1">{label}</span>
    </button>
  )
}

function QuickContextSheet({
  mode,
  setMode,
  contacts,
  importedContacts,
  selectedRecipients,
  selectedImportedRecipients,
  selectedTags,
  selectedCalendarDates,
  onToggleRecipient,
  onToggleImportedRecipient,
  tags,
  customCategories,
  onToggleTag,
  onCalendarDatesChange,
  onCreateProject,
  onClose,
}: {
  mode: "menu" | "who" | "tag" | "date"
  setMode: (mode: "menu" | "who" | "tag" | "date") => void
  contacts: Contact[]
  importedContacts: ImportedContact[]
  selectedRecipients: string[]
  selectedImportedRecipients: string[]
  selectedTags: string[]
  selectedCalendarDates: string[]
  onToggleRecipient: (id: string) => void
  onToggleImportedRecipient: (id: string) => void
  tags: MessageTag[]
  customCategories: CategoryItem[]
  onToggleTag: (id: string) => void
  onCalendarDatesChange: (dates: string[]) => void
  onCreateProject: () => void
  onClose: () => void
}) {
  const [query, setQuery] = useState("")
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({})
  const { handlers: swipeHandlers, dragStyle } = useSwipeDismiss(onClose)
  const q = query.trim().toLowerCase()
  const selectableTags = tags.filter((tag) => tag.id !== systemTypeTagId("none"))
  const filteredContacts = contacts.filter((contact) =>
    !q || contact.name.toLowerCase().includes(q)
  )
  const unregisteredContacts = importedContacts.filter(
    (c) => c.status === "not_registered" &&
      (!q || c.name.toLowerCase().includes(q) || (c.email ?? "").toLowerCase().includes(q))
  )
  const filteredTags = selectableTags.filter((tag) =>
    !q || tag.name.toLowerCase().includes(q)
  )
  const tagGroups = groupTagsByCategory(filteredTags, customCategories)
  const selectedCount = selectedRecipients.length + selectedImportedRecipients.length + selectedTags.length + selectedCalendarDates.length
  const showSearchResults = q.length > 0

  const toggleCategory = (categoryId: string) =>
    setExpandedCategories((prev) => ({ ...prev, [categoryId]: !(prev[categoryId] ?? false) }))

  const handleCreateFromSearch = () => {
    onCreateProject()
    setQuery("")
  }

  const renderPeople = (compact = false) => (
    <div className={cn("flex flex-col", compact ? "max-h-[132px] overflow-y-auto pr-1 scrollbar-hide gap-0.5" : "gap-1")}>
      {filteredContacts.map((contact) => {
        const selected = selectedRecipients.includes(contact.id)
        return (
          <button
            key={contact.id}
            onClick={() => onToggleRecipient(contact.id)}
            className={cn(
              "flex items-center rounded-xl text-left transition-colors",
              compact ? "gap-2.5 px-3 py-2" : "gap-3 px-3 py-2.5",
              selected ? "bg-primary/15 text-primary" : "active:bg-white/5 text-foreground/90"
            )}
          >
            <span className={cn(
              "rounded-full flex items-center justify-center font-bold text-white shrink-0",
              "w-7 h-7 text-[10px]",
              contact.color
            )}>
              {contact.initials}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{contact.name}</span>
            {selected && <Check className="w-4 h-4 shrink-0 text-primary" />}
          </button>
        )
      })}
      {unregisteredContacts.length > 0 && (
        <>
          <p className="px-1 pt-3 pb-1 text-[10px] font-bold uppercase tracking-[1.8px] text-muted-foreground">Not registered</p>
          {unregisteredContacts.map((ic) => {
            const initials = ic.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()
            const selected = selectedImportedRecipients.includes(ic.id)
            return (
              <button
                key={ic.id}
                onClick={() => onToggleImportedRecipient(ic.id)}
                className={cn(
                  "flex items-center rounded-xl text-left transition-colors",
                  compact ? "gap-2.5 px-3 py-2" : "gap-3 px-3 py-2.5",
                  selected ? "bg-primary/15 text-primary" : "active:bg-white/5 text-foreground/70"
                )}
              >
                <span className={cn(
                  "rounded-full bg-white/10 border border-white/15 flex items-center justify-center font-bold text-muted-foreground shrink-0",
                  "w-7 h-7 text-[10px]"
                )}>
                  {initials}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{ic.name}</span>
                {selected && <Check className="w-4 h-4 shrink-0 text-primary" />}
              </button>
            )
          })}
        </>
      )}
      {filteredContacts.length === 0 && unregisteredContacts.length === 0 && (
        <p className="px-1 py-3 text-xs text-muted-foreground">No people found.</p>
      )}
    </div>
  )

  const renderTags = (compact = false) => (
    <div className={cn("flex flex-col", compact ? "gap-2.5 pb-1" : "gap-3 pb-1")}>
      {tagGroups.map((group) => {
        const expanded = showSearchResults || (expandedCategories[group.id] ?? false)
        const selectedInGroup = group.tags.filter((tag) => selectedTags.includes(tag.id)).length
        return (
          <div key={group.id} className="shrink-0 rounded-xl border border-white/10 bg-white/[0.035] overflow-hidden">
            <button
              type="button"
              onClick={() => toggleCategory(group.id)}
              className={cn(
                "flex w-full items-center gap-2 text-left active:bg-white/5",
                compact ? "min-h-10 px-3 py-2" : "min-h-11 px-3 py-2.5"
              )}
            >
              <CategoryIcon categoryId={group.id} />
              <span className="min-w-0 flex-1 text-xs font-bold uppercase tracking-[1.4px] text-foreground/80">
                {group.name}
              </span>
              <span className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                selectedInGroup > 0
                  ? "bg-primary/15 text-primary"
                  : "bg-white/5 text-muted-foreground/60"
              )}>
                {selectedInGroup > 0 ? `${selectedInGroup} selected` : group.tags.length}
              </span>
              {expanded ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
            </button>
            {expanded && (
              <div className="border-t border-white/10 p-1">
                {group.tags.map((tag) => {
                  const selected = selectedTags.includes(tag.id)
                  const isUnassigned = tag.id === systemTypeTagId("none")
                  return (
                    <button
                      key={tag.id}
                      onClick={() => onToggleTag(tag.id)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
                        selected ? isUnassigned ? "bg-feedback/15 text-feedback" : "bg-primary/15 text-primary" : "active:bg-white/5 text-foreground/90"
                      )}
                    >
                      <span className={cn("w-2 h-2 rounded-full shrink-0", tagDotClass(tag))} />
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold">{tag.name}</span>
                      {tag.isFavorited && <Star className="w-3.5 h-3.5 text-feedback fill-current shrink-0" />}
                      {selected && <Check className={cn("w-4 h-4 shrink-0", isUnassigned ? "text-feedback" : "text-primary")} />}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
      {tagGroups.length === 0 && (
        <div className="rounded-2xl border border-dashed border-white/15 bg-white/[0.025] px-3 py-4">
          <p className="text-xs text-muted-foreground">No tags found.</p>
          {q && (
            <button
              type="button"
              onClick={handleCreateFromSearch}
              className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/12 px-3 py-1.5 text-xs font-semibold text-primary active:scale-95"
            >
              <Plus className="w-3 h-3" />
              Create tag "{query.trim()}"
            </button>
          )}
        </div>
      )}
    </div>
  )

  const renderDates = () => (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setShowDatePicker(true)}
        className="flex items-center gap-2.5 rounded-xl border border-sky-400/15 bg-sky-400/[0.035] px-3 py-2 text-left text-sky-300/85 active:scale-[0.99]"
      >
        <span className="w-7 h-7 rounded-full border border-sky-400/20 bg-sky-400/8 flex items-center justify-center">
          <CalendarDays className="w-3.5 h-3.5" />
        </span>
        <span className="flex-1 text-xs font-semibold">
          {selectedCalendarDates.length > 0
            ? `${selectedCalendarDates.length} date${selectedCalendarDates.length !== 1 ? "s" : ""}`
            : "Add dates"}
        </span>
        <ChevronRight className="w-3.5 h-3.5 text-sky-300/45" />
      </button>
      {selectedCalendarDates.map((date) => (
        <button
          key={date}
          type="button"
          onClick={() => onCalendarDatesChange(selectedCalendarDates.filter((item) => item !== date))}
          className="inline-flex w-fit items-center gap-1.5 rounded-full border border-sky-400/25 bg-sky-400/10 px-2.5 py-1 text-[11px] font-semibold text-sky-400 active:scale-95"
        >
          {formatCalDate(date)}
          <X className="w-3 h-3" />
        </button>
      ))}
    </div>
  )

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex pointer-events-none flex-col justify-end md:items-center md:justify-center">
        <div
          style={dragStyle}
          className="pointer-events-auto relative h-[88dvh] w-full md:w-120 md:mb-6 glass-modal border-t md:border border-white/10 rounded-t-3xl md:rounded-3xl shadow-2xl animate-in slide-in-from-bottom duration-200 flex flex-col"
        >
          <div {...swipeHandlers} className="pt-3 pb-4 touch-none cursor-grab active:cursor-grabbing">
            <div className="w-10 h-1 bg-white/15 rounded-full mx-auto" />
          </div>
          <div className="px-4">
            <SheetHeader title="Add Context" onClose={onClose} />
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide px-4 pb-4">
            {selectedCount > 0 ? (
              <div className="mb-2 -mx-1 overflow-x-auto px-1 pb-1 scrollbar-hide">
                <div className="flex gap-1.5">
                  {selectedRecipients.map((id) => {
                    const contact = contacts.find((item) => item.id === id)
                    if (!contact) return null
                    return (
                      <button key={id} onClick={() => onToggleRecipient(id)} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-feedback/25 bg-feedback/10 px-2.5 text-[11px] font-semibold text-foreground/85 whitespace-nowrap">
                        <span className={cn("flex h-5 w-5 items-center justify-center rounded-full text-[8px] font-bold text-white", contact.color)}>
                          {contact.initials}
                        </span>
                        {contact.name.split(" ")[0]}
                        <X className="w-3 h-3" />
                      </button>
                    )
                  })}
                  {selectedImportedRecipients.map((id) => {
                    const contact = importedContacts.find((item) => item.id === id)
                    if (!contact) return null
                    return (
                      <button key={id} onClick={() => onToggleImportedRecipient(id)} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-feedback/25 bg-feedback/10 px-2.5 text-[11px] font-semibold text-foreground/85 whitespace-nowrap">
                        <User className="w-3 h-3 text-feedback" />
                        {contact.name.split(" ")[0]}
                        <X className="w-3 h-3" />
                      </button>
                    )
                  })}
                  {selectedTags.map((tagId) => {
                    const tag = selectableTags.find((item) => item.id === tagId)
                    if (!tag) return null
                    return (
                      <button key={tagId} onClick={() => onToggleTag(tagId)} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-2.5 text-[11px] font-semibold text-foreground/85 whitespace-nowrap">
                        <span className={cn("w-2 h-2 rounded-full", tagDotClass(tag))} />
                        {tag.name}
                        <X className="w-3 h-3" />
                      </button>
                    )
                  })}
                  {selectedCalendarDates.map((date) => (
                    <button
                      key={date}
                      onClick={() => onCalendarDatesChange(selectedCalendarDates.filter((item) => item !== date))}
                      className="inline-flex h-8 items-center gap-1.5 rounded-full border border-sky-400/25 bg-sky-400/10 px-2.5 text-[11px] font-semibold text-foreground/85 whitespace-nowrap"
                    >
                      <CalendarDays className="w-3 h-3 text-sky-400" />
                      {formatCalDate(date)}
                      <X className="w-3 h-3" />
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mb-2 rounded-xl border border-dashed border-white/12 bg-white/[0.025] px-3 py-2.5 text-xs font-semibold text-muted-foreground/70">
                No context selected
              </div>
            )}
            <SheetSearchInput value={query} onChange={setQuery} placeholder="Search people, tags, dates" />
            <div className="mb-3 flex gap-1.5 overflow-x-auto scrollbar-hide">
              <ContextModeChip active={mode === "menu"} icon={<LayoutGrid className="w-3.5 h-3.5" />} onClick={() => setMode("menu")}>All</ContextModeChip>
              <ContextModeChip active={mode === "who"} icon={<User className="w-3.5 h-3.5" />} onClick={() => setMode("who")}>People</ContextModeChip>
              <ContextModeChip active={mode === "tag"} icon={<Tag className="w-3.5 h-3.5" />} onClick={() => setMode("tag")}>Tags</ContextModeChip>
              <ContextModeChip active={mode === "date"} icon={<CalendarDays className="w-3.5 h-3.5" />} onClick={() => setMode("date")}>Dates</ContextModeChip>
            </div>

            {showSearchResults ? (
              <div className="space-y-4">
                {(filteredContacts.length > 0 || unregisteredContacts.length > 0) && (
                  <div>
                    <SectionMiniTitle>People</SectionMiniTitle>
                    {renderPeople(true)}
                  </div>
                )}
                {tagGroups.length > 0 && (
                  <div>
                    <SectionMiniTitle>Tags</SectionMiniTitle>
                    {renderTags(true)}
                  </div>
                )}
                {filteredContacts.length === 0 && unregisteredContacts.length === 0 && tagGroups.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-white/15 bg-white/[0.025] px-3 py-4">
                    <p className="text-xs text-muted-foreground">Nothing matched "{query.trim()}".</p>
                    <button
                      type="button"
                      onClick={handleCreateFromSearch}
                      className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/12 px-3 py-1.5 text-xs font-semibold text-primary active:scale-95"
                    >
                      <Plus className="w-3 h-3" />
                      Create tag
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                {mode === "menu" && (
                  <>
                    <div>
                      <SectionMiniTitle>People</SectionMiniTitle>
                      {renderPeople(true)}
                    </div>
                    <div>
                      <SectionMiniTitle>Tags by category</SectionMiniTitle>
                      {renderTags(true)}
                    </div>
                    <div>
                      <SectionMiniTitle>Dates</SectionMiniTitle>
                      {renderDates()}
                    </div>
                  </>
                )}
                {mode === "who" && renderPeople()}
                {mode === "tag" && renderTags()}
                {mode === "date" && renderDates()}
              </div>
            )}
          </div>

          <div className="shrink-0 bg-[#0d1c35]/95 backdrop-blur-xl px-4 pt-3 pb-2 border-t border-white/8 safe-area-pb">
            <button
              type="button"
              onClick={onClose}
              className="w-full rounded-2xl bg-primary py-3 text-sm font-semibold tracking-wide text-white shadow-[0_10px_28px_rgba(37,99,235,0.35)] transition-all active:scale-[0.98]"
            >
              Done
            </button>
          </div>
        </div>
      </div>
      {showDatePicker && (
        <DatePickerModal
          selectedDates={selectedCalendarDates}
          title="Schedule dates"
          onConfirm={(dates) => {
            onCalendarDatesChange(dates)
            setShowDatePicker(false)
          }}
          onClose={() => setShowDatePicker(false)}
        />
      )}
    </>
  )
}

function ContextModeChip({
  children,
  icon,
  active,
  onClick,
}: {
  children: React.ReactNode
  icon: React.ReactNode
  active?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-all active:scale-95",
        active
          ? "border-primary/35 bg-primary/15 text-primary"
          : "border-white/10 bg-white/5 text-muted-foreground hover:border-white/20 hover:text-foreground/80"
      )}
    >
      {icon}
      {children}
    </button>
  )
}

function SectionMiniTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 px-1 text-[10px] font-bold uppercase tracking-[1.8px] text-muted-foreground">
      {children}
    </p>
  )
}

function groupTagsByCategory(tags: MessageTag[], customCategories: CategoryItem[]) {
  const categoryMap = new Map<string, { id: string; name: string; order: number; tags: MessageTag[] }>()
  const orderedCategories = [
    { id: "systemType", name: "Status", isSystem: true },
    ...SYSTEM_CATEGORIES,
    ...customCategories,
  ]

  orderedCategories.forEach((category, index) => {
    categoryMap.set(category.id, {
      id: category.id,
      name: category.id === "systemType" ? "Status" : category.name,
      order: index,
      tags: [],
    })
  })

  tags.forEach((tag) => {
    const categoryId = tag.category || "custom"
    if (!categoryMap.has(categoryId)) {
      categoryMap.set(categoryId, {
        id: categoryId,
        name: getCategoryLabel(categoryId, customCategories),
        order: 100,
        tags: [],
      })
    }
    categoryMap.get(categoryId)?.tags.push(tag)
  })

  return Array.from(categoryMap.values())
    .filter((group) => group.tags.length > 0)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
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
      <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div
        style={dragStyle}
        className="fixed bottom-0 left-0 right-0 z-50 h-[60dvh] glass-modal border-t border-white/10 rounded-t-3xl px-4 pt-3 pb-6 shadow-2xl animate-in slide-in-from-bottom duration-200 flex flex-col"
      >
        <div {...swipeHandlers} className="-mx-4 -mt-3 shrink-0 pt-3 pb-4 touch-none cursor-grab active:cursor-grabbing">
          <div className="w-10 h-1 bg-white/15 rounded-full mx-auto" />
        </div>
        <div className="flex shrink-0 items-center justify-between mb-3">
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
        <div className="shrink-0">
          <SheetSearchInput value={query} onChange={onQueryChange} placeholder="Search tags" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-hide">
          <div className="flex flex-col gap-1">
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
      <div className="w-8 h-8 rounded-full bg-white/8 border border-white/10 shrink-0 backdrop-blur-md" />
      <div className={cn("max-w-[78%] md:max-w-[55%] flex flex-col gap-1", width, side === "right" && "items-end")}>
        {side === "left" && <div className="h-3 w-20 rounded-full bg-white/8" />}
        <div
          className={cn(
            "glass-message w-full border p-3",
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

function PeopleFilterSheet({
  contacts,
  importedContacts,
  currentUserId,
  userInitials,
  userColor,
  selectedPeople,
  onChange,
  onClose,
}: {
  contacts: Contact[]
  importedContacts: ImportedContact[]
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
  const q = query.trim().toLowerCase()
  const filtered = people.filter((person) => !q || person.name.toLowerCase().includes(q))
  // Only show unregistered imported contacts
  const unregistered = importedContacts
    .filter((c) => c.status === "not_registered" && c.ownerUserId)
    .filter((c) => !q || c.name.toLowerCase().includes(q) || (c.email ?? "").toLowerCase().includes(q))
  const toggle = (id: string) => {
    onChange(selectedPeople.includes(id) ? selectedPeople.filter((item) => item !== id) : [...selectedPeople, id])
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div
        style={dragStyle}
        className="fixed bottom-0 left-0 right-0 z-50 h-[60dvh] glass-modal border-t border-white/10 rounded-t-3xl px-5 pt-4 pb-10 shadow-2xl animate-in slide-in-from-bottom duration-200 flex flex-col"
      >
        <div {...swipeHandlers} className="-mx-4 -mt-3 shrink-0 pt-3 pb-4 touch-none cursor-grab active:cursor-grabbing">
          <div className="w-10 h-1 bg-white/15 rounded-full mx-auto" />
        </div>
        <div className="shrink-0">
          <SheetHeader title="People" onClose={onClose} />
          <SheetSearchInput value={query} onChange={setQuery} placeholder="Search people" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-hide">
          <div className="flex flex-col gap-1">
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
          {unregistered.length > 0 && (
            <>
              <p className="px-1 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                Not registered
              </p>
              {unregistered.map((c) => {
                const selected = selectedPeople.includes(c.id)
                return (
                  <button
                    key={c.id}
                    onClick={() => toggle(c.id)}
                    className={cn("flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors text-left", selected ? "bg-primary/15 text-primary" : "active:bg-white/5 text-foreground/60")}
                  >
                    <span className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white/50 shrink-0 bg-white/10 border border-white/15">
                      {(c.name.match(/\b\w/g) ?? []).slice(0, 2).join("").toUpperCase() || "?"}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{c.name}</p>
                      {c.email && <p className="text-[10px] text-muted-foreground truncate">{c.email}</p>}
                    </div>
                    {selected && <Check className="w-4 h-4 text-primary" />}
                  </button>
                )
              })}
            </>
          )}
          {filtered.length === 0 && unregistered.length === 0 && <p className="text-xs text-muted-foreground px-1 py-3">No people found.</p>}
          </div>
        </div>
      </div>
    </>
  )
}

function TagFilterSheet({
  tags,
  customCategories,
  selectedTags,
  onChange,
  onClose,
}: {
  tags: MessageTag[]
  customCategories: CategoryItem[]
  selectedTags: string[]
  onChange: (ids: string[]) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState("")
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({})
  const { handlers: swipeHandlers, dragStyle } = useSwipeDismiss(onClose)
  const queryText = query.trim().toLowerCase()
  const unassignedTag = tags.find(t => t.id === systemTypeTagId("none"))
  const filtered = tags
    .filter((tag) => {
      if (tag.id === systemTypeTagId("none")) return false  // shown separately as top pill
      if (!queryText) return true
      const categoryId = tag.category || "custom"
      const categoryLabel = getCategoryLabel(categoryId, customCategories)
      return tag.name.toLowerCase().includes(queryText) || categoryLabel.toLowerCase().includes(queryText)
    })
  const tagGroups = groupTagsByCategory(filtered, customCategories)
  const selectedTagObjects = tags.filter((tag) => selectedTags.includes(tag.id))
  const toggle = (id: string) => {
    onChange(selectedTags.includes(id) ? selectedTags.filter((item) => item !== id) : [...selectedTags, id])
  }
  const toggleCategory = (categoryId: string) =>
    setExpandedCategories((prev) => ({ ...prev, [categoryId]: !(prev[categoryId] ?? false) }))

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div
        style={dragStyle}
        className="fixed bottom-0 left-0 right-0 z-50 flex h-[60dvh] flex-col glass-modal border-t border-white/10 rounded-t-3xl px-4 pt-3 pb-6 shadow-2xl animate-in slide-in-from-bottom duration-200"
      >
        <div {...swipeHandlers} className="-mx-4 -mt-3 shrink-0 pt-3 pb-4 touch-none cursor-grab active:cursor-grabbing">
          <div className="w-10 h-1 bg-white/15 rounded-full mx-auto" />
        </div>
        <SheetHeader title="Filter Tags" onClose={onClose} />
        <SheetSearchInput value={query} onChange={setQuery} placeholder="Search tags or categories" />
        <div className="mb-3 flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => onChange([])}
            className={cn(
              "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-all active:scale-95",
              selectedTags.length === 0
                ? "border-primary/35 bg-primary/15 text-primary"
                : "border-white/10 bg-white/5 text-muted-foreground"
            )}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            All
          </button>
          {unassignedTag && (
            <button
              type="button"
              onClick={() => toggle(unassignedTag.id)}
              className={cn(
                "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-all active:scale-95",
                selectedTags.includes(unassignedTag.id)
                  ? "border-feedback/35 bg-feedback/15 text-feedback"
                  : "border-white/10 bg-white/5 text-muted-foreground"
              )}
            >
              <CircleSlash className="w-3.5 h-3.5" />
              Unassigned
            </button>
          )}
          {selectedTags.length > 0 && (
            <div className="min-w-0 flex-1 overflow-x-auto scrollbar-hide">
              <div className="flex gap-1.5">
                {selectedTagObjects.slice(0, 4).map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => toggle(tag.id)}
                    className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-2.5 text-[11px] font-semibold text-primary active:scale-95"
                  >
                    <span className={cn("h-2 w-2 rounded-full", tagDotClass(tag))} />
                    <span className="max-w-24 truncate">{tag.name}</span>
                    <X className="w-3 h-3" />
                  </button>
                ))}
                {selectedTags.length > 4 && (
                  <span className="inline-flex h-8 shrink-0 items-center rounded-full border border-white/10 bg-white/5 px-2.5 text-[11px] font-semibold text-muted-foreground">
                    +{selectedTags.length - 4}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="mb-2 flex shrink-0 items-center justify-between px-1">
          <p className="text-[10px] font-bold uppercase tracking-[1.6px] text-muted-foreground/65 font-mono">
            Categories
          </p>
          <span className="text-[10px] font-semibold text-muted-foreground/55">
            {tagGroups.length} categories
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pr-1 scrollbar-hide">
          <div className="flex flex-col gap-2.5 pb-2">
            <button
              onClick={() => onChange([])}
              className={cn(
                "flex shrink-0 items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors",
                selectedTags.length === 0
                  ? "border-primary/25 bg-primary/12 text-primary"
                  : "border-white/10 bg-white/[0.03] active:bg-white/5 text-foreground/90"
              )}
            >
              <span className="w-7 h-7 rounded-full bg-white/[0.035] border border-white/[0.07] flex items-center justify-center shrink-0">
                <LayoutGrid className="w-3.5 h-3.5 text-muted-foreground/70" />
              </span>
              <span className="text-sm font-semibold flex-1">All Tags</span>
              {selectedTags.length === 0 && <Check className="w-4 h-4 text-primary" />}
            </button>
            {tagGroups.map((group) => {
              const expanded = queryText.length > 0 || (expandedCategories[group.id] ?? false)
              const selectedInGroup = group.tags.filter((tag) => selectedTags.includes(tag.id)).length
              return (
                <div key={group.id} className="shrink-0 rounded-xl border border-white/10 bg-white/[0.035] overflow-hidden">
                  <button
                    type="button"
                    onClick={() => toggleCategory(group.id)}
                    className="flex min-h-11 w-full items-center gap-2 px-3 py-2.5 text-left active:bg-white/5"
                  >
                    <CategoryIcon categoryId={group.id} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-bold uppercase tracking-[1.4px] text-foreground/80 font-mono">
                        {group.name}
                      </p>
                      {selectedInGroup > 0 && (
                        <p className="mt-0.5 truncate text-[10px] font-semibold text-primary/80">
                          {selectedInGroup} selected
                        </p>
                      )}
                    </div>
                    <span className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                      selectedInGroup > 0 ? "bg-primary/15 text-primary" : "bg-white/5 text-muted-foreground/60"
                    )}>
                      {selectedInGroup > 0 ? selectedInGroup : group.tags.length}
                    </span>
                    {expanded ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
                  </button>
                  {expanded && (
                    <div className="max-h-56 overflow-y-auto border-t border-white/10 p-1 scrollbar-hide">
                      {group.tags.map((tag) => {
                        const selected = selectedTags.includes(tag.id)
                        const isUnassigned = tag.id === systemTypeTagId("none")
                        return (
                          <button
                            key={tag.id}
                            onClick={() => toggle(tag.id)}
                            className={cn(
                              "flex w-full items-center gap-3 px-3 py-2.5 rounded-xl transition-colors text-left",
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
                    </div>
                  )}
                </div>
              )
            })}
            {filtered.length === 0 && <p className="text-xs text-muted-foreground px-1 py-3">No tags found.</p>}
          </div>
        </div>
      </div>
    </>
  )
}

function SheetHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="w-8" />
      <p className="text-xs font-bold uppercase tracking-[2px] text-foreground/90">
        {title}
      </p>
      <button
        onClick={onClose}
        className="w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center"
      >
        <X className="w-4 h-4 text-muted-foreground" />
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
  return getCategoryDotClass(tag.category)
}

function messageTypeChipClass(type: MessageType): string {
  if (type === "progress") return "bg-progress/12 text-green-300 border-progress/35"
  if (type === "problem") return "bg-problem/12 text-red-300 border-problem/35"
  if (type === "feedback") return "bg-feedback/12 text-amber-300 border-feedback/35"
  if (type === "decision") return "bg-decision/12 text-blue-300 border-decision/35"
  return "bg-feedback/10 text-feedback border-feedback/25"
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
        "text-xs font-semibold px-3 py-1.5 rounded-full whitespace-nowrap shrink-0 tracking-wide transition-all duration-150 border flex items-center gap-1 active:scale-[0.98]",
        active && tone === "people"
          ? "glass-pill-people-active"
        : active
          ? "glass-pill-active"
        : highlight
          ? "glass-pill-people"
        : tone === "people"
          ? "glass-pill-people hover:bg-feedback/15 hover:border-feedback/35"
          : "glass-pill text-white/85 hover:border-primary/40 hover:text-blue-200"
      )}
    >
      {isFavorited && <Star className="w-2.5 h-2.5 fill-current text-feedback shrink-0" />}
      {icon}
      {children}
    </button>
  )
}

function ImageViewerModal({
  image,
  onClose,
}: {
  image: { url: string; name?: string }
  onClose: () => void
}) {
  const [displayZoom, setDisplayZoom] = useState(1)
  const imageRef = useRef<HTMLImageElement>(null)
  const transformRef = useRef({ zoom: 1, x: 0, y: 0 })
  const frameRef = useRef<number | null>(null)
  const lastLabelAt = useRef(0)
  const pendingLabelSync = useRef(false)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const lastPan = useRef<{ x: number; y: number } | null>(null)
  const lastPinchDistance = useRef<number | null>(null)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => {
      window.removeEventListener("keydown", onKeyDown)
      if (frameRef.current) cancelAnimationFrame(frameRef.current)
    }
  }, [onClose])

  const paintTransform = (syncLabel = false) => {
    if (syncLabel) pendingLabelSync.current = true
    if (frameRef.current) return
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null
      const { zoom, x, y } = transformRef.current
      if (imageRef.current) {
        imageRef.current.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${zoom})`
        imageRef.current.style.cursor = zoom > 1 ? "grab" : "zoom-in"
      }

      const now = performance.now()
      if (pendingLabelSync.current || now - lastLabelAt.current > 120) {
        pendingLabelSync.current = false
        lastLabelAt.current = now
        setDisplayZoom(zoom)
      }
    })
  }

  const setTransformZoom = (nextZoom: number, syncLabel = false) => {
    const zoom = Math.min(3, Math.max(1, nextZoom))
    transformRef.current.zoom = zoom
    if (zoom <= 1) {
      transformRef.current.x = 0
      transformRef.current.y = 0
    }
    paintTransform(syncLabel)
  }

  const resetZoom = () => {
    transformRef.current = { zoom: 1, x: 0, y: 0 }
    paintTransform(true)
  }

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.stopPropagation()
    setTransformZoom(transformRef.current.zoom + (event.deltaY < 0 ? 0.2 : -0.2), true)
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") return
    event.currentTarget.setPointerCapture(event.pointerId)
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pointers.current.size === 1) {
      lastPan.current = { x: event.clientX, y: event.clientY }
    }
    if (pointers.current.size === 2) {
      lastPinchDistance.current = getPointerDistance([...pointers.current.values()])
    }
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") return
    if (!pointers.current.has(event.pointerId)) return
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })

    if (pointers.current.size === 2) {
      const distance = getPointerDistance([...pointers.current.values()])
      const previousDistance = lastPinchDistance.current
      if (previousDistance) {
        setTransformZoom(transformRef.current.zoom * (distance / previousDistance))
      }
      lastPinchDistance.current = distance
      return
    }

    const previousPan = lastPan.current
    if (transformRef.current.zoom <= 1 || !previousPan) return
    transformRef.current.x += event.clientX - previousPan.x
    transformRef.current.y += event.clientY - previousPan.y
    paintTransform()
    lastPan.current = { x: event.clientX, y: event.clientY }
  }

  const handlePointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") return
    pointers.current.delete(event.pointerId)
    lastPinchDistance.current = null
    lastPan.current = null
  }

  const handleTouchStart = (event: ReactTouchEvent<HTMLDivElement>) => {
    const points = getTouchPoints(event.touches)
    if (points.length === 1) {
      lastPan.current = points[0]
    }
    if (points.length >= 2) {
      lastPinchDistance.current = getPointerDistance(points)
    }
  }

  const handleTouchMove = (event: ReactTouchEvent<HTMLDivElement>) => {
    const points = getTouchPoints(event.touches)
    if (points.length >= 2) {
      const distance = getPointerDistance(points)
      const previousDistance = lastPinchDistance.current
      if (previousDistance) {
        setTransformZoom(transformRef.current.zoom * (distance / previousDistance))
      }
      lastPinchDistance.current = distance
      return
    }

    const previousPan = lastPan.current
    if (transformRef.current.zoom <= 1 || points.length !== 1 || !previousPan) return
    transformRef.current.x += points[0].x - previousPan.x
    transformRef.current.y += points[0].y - previousPan.y
    paintTransform()
    lastPan.current = points[0]
  }

  const handleTouchEnd = (event: ReactTouchEvent<HTMLDivElement>) => {
    const points = getTouchPoints(event.touches)
    lastPinchDistance.current = points.length >= 2 ? getPointerDistance(points) : null
    lastPan.current = points.length === 1 ? points[0] : null
    paintTransform(true)
  }

  return (
    <div
      className="fixed inset-0 z-[70] bg-[#020817]/92 backdrop-blur-md animate-fade-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Image viewer"
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-[calc(env(safe-area-inset-top)+1rem)] z-[72] h-10 w-10 rounded-full border border-white/15 bg-[#0d1c35]/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] flex items-center justify-center active:scale-95"
        aria-label="Close image viewer"
      >
        <X className="h-5 w-5 text-white" />
      </button>

      <div
        className="flex h-full w-full items-center justify-center overflow-hidden px-1.5 py-11"
      >
        <div
          className="max-h-full max-w-full touch-none"
          onClick={(event) => event.stopPropagation()}
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchEnd}
          onDoubleClick={resetZoom}
        >
          <img
            ref={imageRef}
            src={image.url}
            alt={image.name || "Attached image"}
            draggable={false}
            className="max-h-[calc(100dvh-5.5rem)] max-w-[calc(100vw-0.75rem)] select-none rounded-2xl border border-white/10 bg-[#071326] object-contain shadow-2xl"
            style={{
              transform: "translate3d(0, 0, 0) scale(1)",
              cursor: "zoom-in",
              willChange: "transform",
            }}
          />
        </div>
      </div>

      <div className="absolute bottom-[calc(env(safe-area-inset-bottom)+1rem)] left-1/2 z-[72] flex -translate-x-1/2 items-center gap-1 rounded-full border border-white/15 bg-[#0d1c35]/90 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
        <button
          type="button"
          onClick={(event) => { event.stopPropagation(); setTransformZoom(transformRef.current.zoom - 0.25, true) }}
          className="h-10 w-10 rounded-full text-muted-foreground flex items-center justify-center active:scale-95 hover:bg-white/8 hover:text-white"
          aria-label="Zoom out"
        >
          <ZoomOut className="h-4 w-4" />
        </button>
        <span className="min-w-12 text-center text-[11px] font-bold text-foreground/80 font-mono">
          {Math.round(displayZoom * 100)}%
        </span>
        <button
          type="button"
          onClick={(event) => { event.stopPropagation(); setTransformZoom(transformRef.current.zoom + 0.25, true) }}
          className="h-10 w-10 rounded-full text-muted-foreground flex items-center justify-center active:scale-95 hover:bg-white/8 hover:text-white"
          aria-label="Zoom in"
        >
          <ZoomIn className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={(event) => { event.stopPropagation(); resetZoom() }}
          className="h-10 w-10 rounded-full text-muted-foreground flex items-center justify-center active:scale-95 hover:bg-white/8 hover:text-white"
          aria-label="Reset zoom"
        >
          <RotateCcw className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

function getPointerDistance(points: Array<{ x: number; y: number }>): number {
  if (points.length < 2) return 0
  return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y)
}

function getTouchPoints(touches: ReactTouchEvent<HTMLDivElement>["touches"]): Array<{ x: number; y: number }> {
  return Array.from(touches).map((touch) => ({ x: touch.clientX, y: touch.clientY }))
}


function MessageBubble({
  message, projects, contacts, currentUserId, userInitials, userColor, isAuthorActive, isSelected, isHighlighted, isFirstInGroup, isLastInGroup, onTap, onPressStart, onPressEnd, onImageOpen, onProjectTagTap, onReply, onReplyQuoteTap,
}: {
  message: Message
  projects: Project[]
  contacts: Contact[]
  currentUserId: string
  userInitials: string
  userColor: string
  isAuthorActive: boolean
  isSelected: boolean
  isHighlighted?: boolean
  isFirstInGroup?: boolean
  isLastInGroup?: boolean
  onTap: () => void
  onPressStart: () => void
  onPressEnd: () => void
  onImageOpen: (url: string, name?: string) => void
  onProjectTagTap?: (projectId: string) => void
  onReply?: (message: Message) => void
  onReplyQuoteTap?: (messageId: string) => void
}) {
  const first = isFirstInGroup ?? true
  const last = isLastInGroup ?? true
  const [isExpanded, setIsExpanded] = useState(false)
  const { swipeHandlers, swipeStyle, swipeTouchAction, swipeProgress } = useSwipeToReply(
    () => onReply?.(message),
    onPressEnd,  // cancel long-press selection when horizontal swipe is confirmed
  )
  const isLong = !!message.text && message.text.length > 360
  const isMe = message.senderId === currentUserId
  const contact = isMe
    ? { id: currentUserId, name: "Me", initials: userInitials, color: userColor }
    : (getContactFromList(message.senderId, contacts) ?? { id: message.senderId, name: "Unknown", initials: "?", color: "bg-white/10" })

  // Resolve the color of the user being replied to for the quote accent
  const replyAccentColor = message.replyPreview
    ? (message.replyPreview.authorId === currentUserId
        ? userColor
        : (getContactFromList(message.replyPreview.authorId, contacts)?.color ?? "bg-blue-400"))
    : "bg-blue-400"
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

  const hasDirectRecipients =
    (message.recipientIds ?? []).filter(Boolean).length > 0 ||
    (message.contactIds ?? []).filter(Boolean).length > 0
  const hasCalendarDates = (message.calendarDates ?? []).length > 0
  const visibleTagCount = messageTags.filter((tag) => tag.systemType !== "none").length

  // Tail is on the bottom-sender-side corner (WhatsApp style)
  const bubbleRadius = isMe
    ? (!first && !last) ? "rounded-[18px_4px_4px_18px]"
    : !first            ? "rounded-[18px_4px_18px_18px]"
    :                     "rounded-[18px_18px_4px_18px]"
    : (!first && !last) ? "rounded-[4px_18px_18px_4px]"
    : !first            ? "rounded-[4px_18px_18px_18px]"
    :                     "rounded-[18px_18px_18px_4px]"

  return (
    <div
      data-msg-id={message.id}
      className={cn("relative", first ? "mt-2 animate-fade-up" : "mt-0.5")}
      style={swipeTouchAction}
      {...swipeHandlers}
    >
      {/* Reply icon — revealed on right swipe, anchored to left */}
      <div
        aria-hidden
        className="absolute left-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-blue-500/20 border border-blue-400/30 flex items-center justify-center pointer-events-none"
        style={{ opacity: swipeProgress }}
      >
        <CornerDownLeft className="w-3.5 h-3.5 text-blue-300" />
      </div>
    <div
      className={cn(
        "flex gap-2.5 items-end select-none no-callout",
        isMe && "flex-row-reverse",
        isSelected && "opacity-90",
      )}
      style={swipeStyle}
    >
      {/* Avatar — only visible on first message in a group */}
      {first ? (
        <div className={cn(
          "relative w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 text-white border border-white/15 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_10px_24px_rgba(0,0,0,0.18)]",
          contact.color
        )}>
          {contact.initials}
          {isAuthorActive && (
            <span className="absolute -right-0.5 -bottom-0.5 w-3.5 h-3.5 rounded-full bg-emerald-400 border-[3px] border-[#05090f] shadow-[0_0_12px_rgba(52,211,153,0.72)]" />
          )}
        </div>
      ) : (
        <div className="w-7 shrink-0" />
      )}

      <div className={cn("max-w-[75%] md:max-w-[55%] flex flex-col gap-1", isMe && "items-end")}>
        {!isMe && first && (
          <span className="text-[10px] font-semibold text-muted-foreground/75 px-1 mb-0.5">{contact.name}</span>
        )}
        <div
          onPointerDown={(e) => { e.stopPropagation(); onPressStart() }}
          onPointerUp={() => { cancelAnimationFrame(0); onPressEnd() }}
          onPointerCancel={onPressEnd}
          onPointerLeave={onPressEnd}
          onClick={(e) => { e.stopPropagation(); onTap() }}
          onContextMenu={(e) => { e.preventDefault(); onPressStart(); setTimeout(onPressEnd, 0) }}
          className={cn(
            "border px-3 py-2 cursor-pointer transition-all duration-300",
            isMe
              ? cn("glass-message-me", bubbleRadius)
              : cn("glass-message", bubbleRadius),
            isSelected && "glass-message-selected",
            isHighlighted && "glass-message-highlighted"
          )}
        >
          {message.replyPreview && (
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                if (message.replyToId) onReplyQuoteTap?.(message.replyToId)
              }}
              className={cn("reply-quote", isMe && "reply-quote-me")}
            >
              <div className="flex items-stretch">
                <div className={cn("w-0.75 rounded-full shrink-0", replyAccentColor)} />
                <div className="reply-quote-inner flex-1">
                  <p className="reply-quote-author">{message.replyPreview.authorName}</p>
                  <p className="reply-quote-text">{message.replyPreview.text || "📷 Image"}</p>
                </div>
              </div>
            </button>
          )}
          {message.imageUrl && (
            <MessageImage
              src={message.imageUrl}
              alt={message.imageName || "Attached image"}
              width={message.imageWidth}
              height={message.imageHeight}
              blurHash={message.imageBlurHash}
              onClick={() => {
                onPressEnd()
                onImageOpen(message.imageUrl!, message.imageName)
              }}
            />
          )}
          {message.text && (
            <div>
              <p className={cn(
                "text-sm leading-snug text-foreground/90 no-callout",
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
          <div className="flex items-center gap-1 mt-1 flex-wrap">
            {/* Safety fallback: no tags computed AND no recipients AND no calendar dates → Unassigned */}
            {messageTags.length === 0 && !hasDirectRecipients && !hasCalendarDates && (
              <div className="w-1.5 h-1.5 rounded-full bg-feedback flex-shrink-0 shadow-[0_0_6px_rgba(245,158,11,0.5)] animate-pulse" />
            )}
            {messageTags.length === 0 && !hasDirectRecipients && !hasCalendarDates && (
              <span className="text-[10px] font-bold tracking-wide uppercase px-2 py-0.5 rounded-full font-mono flex-shrink-0 border border-feedback/25 bg-feedback/10 text-feedback no-callout backdrop-blur-md">
                Unassigned
              </span>
            )}
            {visibleTagCount === 0 && hasCalendarDates && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-sky-300 bg-sky-400/12 border border-sky-400/30 rounded-full px-2 py-0.5 font-mono no-callout backdrop-blur-md">
                <CalendarDays className="w-2.5 h-2.5 shrink-0" />
                Scheduled
              </span>
            )}
            {messageTags.map((tag) => {
              if (tag.systemType === "none") {
                // Don't show Unassigned if message has direct recipients or calendar dates
                if (hasDirectRecipients || hasCalendarDates) return null
                return (
                  <Fragment key={tag.id}>
                    <div className="w-1.5 h-1.5 rounded-full bg-feedback flex-shrink-0 shadow-[0_0_6px_rgba(245,158,11,0.5)] animate-pulse" />
                    <span className="text-[10px] font-bold tracking-wide uppercase px-2 py-0.5 rounded-full font-mono flex-shrink-0 border border-feedback/25 bg-feedback/10 text-feedback no-callout backdrop-blur-md">
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
                    "text-[10px] font-semibold tracking-wide border rounded-full px-2 py-0.5 font-mono active:bg-primary/20 transition-colors no-callout backdrop-blur-md",
                    tag.systemType
                      ? messageTypeChipClass(tag.systemType)
                      : "bg-primary/12 text-blue-300 border-primary/30"
                  )}
                >
                  {tag.isFavorited && <Star className="inline w-2 h-2 fill-current text-feedback mr-0.5 -mt-px" />}
                  {tag.name}
                </button>
              )
            })}
            {/* Calendar date chips */}
            {(message.calendarDates ?? []).map(cd => (
              <span key={cd.id ?? cd.date} className="inline-flex items-center gap-1 text-[10px] font-semibold text-sky-300 bg-sky-400/12 border border-sky-400/30 rounded-full px-2 py-0.5 font-mono no-callout backdrop-blur-md">
                <CalendarDays className="w-2.5 h-2.5 shrink-0" />
                {formatCalDate(cd.date)}
              </span>
            ))}
            {/* Direct recipients indicator — subtle yellow people icon */}
            {hasDirectRecipients && (
              <span className="flex items-center justify-center w-4 h-4 flex-shrink-0 text-amber-400/70">
                <Users className="w-3 h-3" />
              </span>
            )}
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
    </div>
  )
}
