"use client"

import { useState, useRef, useEffect, useMemo } from "react"
import { Bell, MessageCircle, Star, Trash2, FolderOpen, X, LayoutGrid, Copy, Filter } from "lucide-react"
import { cn, haptic } from "@/lib/utils"
import {
  type Message,
  type MessageType,
  type Project,
  type Contact,
  getContactFromList,
  formatTime,
} from "@/lib/store"
import { CreateProjectModal } from "@/components/create-project-modal"

const typeStyles: Record<MessageType, { bg: string; text: string; border: string; label: string }> = {
  progress: { bg: "bg-progress/10",  text: "text-progress",  border: "border-progress/20",  label: "Progress" },
  problem:  { bg: "bg-problem/10",   text: "text-problem",   border: "border-problem/20",   label: "Problem" },
  feedback: { bg: "bg-feedback/10",  text: "text-feedback",  border: "border-feedback/20",  label: "Feedback" },
  decision: { bg: "bg-decision/10",  text: "text-decision",  border: "border-decision/20",  label: "Decision" },
  none:     { bg: "bg-white/5",      text: "text-muted-foreground", border: "border-border", label: "Unsorted" },
}

interface StreamScreenProps {
  messages: Message[]
  activeFilter: string
  onFilterChange: (filter: string) => void
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
  onRemoveProjectTag: (messageId: string) => void
  onDeleteProject: (id: string) => void
  onFavoriteProject: (id: string) => void
  onProjects: () => void
  onCopyMessage: (text: string) => void
}

export function StreamScreen({
  messages,
  activeFilter,
  onFilterChange,
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
}: StreamScreenProps) {
  const [showCreateProject, setShowCreateProject] = useState(false)
  const [selectedMsgId, setSelectedMsgId] = useState<string | null>(null)
  const [projectTagCtx, setProjectTagCtx] = useState<{ projectId: string; messageId: string } | null>(null)
  const [selectedChipId, setSelectedChipId] = useState<string | null>(null)
  const [confirmDeleteChipId, setConfirmDeleteChipId] = useState<string | null>(null)
  const [confirmDeleteMsgId, setConfirmDeleteMsgId] = useState<string | null>(null)
  const [selectedType, setSelectedType] = useState<MessageType | "all">("all")
  const [showTypeSheet, setShowTypeSheet] = useState(false)
  const feedRef = useRef<HTMLDivElement>(null)
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isPinnedToBottom = useRef(true)

  const clearChipSelection = () => { setSelectedChipId(null); setConfirmDeleteChipId(null) }
  const clearMsgSelection = () => { setSelectedMsgId(null); setConfirmDeleteMsgId(null) }

  // Track whether user is near the bottom
  const handleScroll = () => {
    const el = feedRef.current
    if (!el) return
    isPinnedToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  // Only auto-scroll to bottom when pinned (i.e. user hasn't scrolled up)
  useEffect(() => {
    if (isPinnedToBottom.current) {
      feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" })
    }
  }, [messages.length])

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

  const unsortedCount = useMemo(() => messages.filter((m) => m.type === "none").length, [messages])
  const sortedMessages = useMemo(() => {
    const typeFiltered = selectedType === "all"
      ? messages
      : messages.filter((m) => m.type === selectedType)
    return [...typeFiltered].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
  }, [messages, selectedType])
  const selectedMsg = selectedMsgId ? messages.find((m) => m.id === selectedMsgId) : null

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-background animate-fade-in">
      {/* Header */}
      <div className="flex-shrink-0 px-4 py-3 flex items-center justify-between border-b border-white/10 animate-slide-down">
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
          {/* Projects shortcut */}
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
      <div className="flex-shrink-0 flex gap-2 overflow-x-auto px-4 py-2.5 border-b border-white/10 scrollbar-hide">
        <FilterChip active={activeFilter === "all"} onClick={() => onFilterChange("all")}>All</FilterChip>
        {[...projects.filter((p) => p.isFavorited), ...projects.filter((p) => !p.isFavorited)].map((project) => (
          <FilterChip
            key={project.id}
            active={activeFilter === project.id}
            isFavorited={!!project.isFavorited}
            onClick={() => {
              if (selectedChipId) { clearChipSelection(); return }
              onFilterChange(project.id)
            }}
            onLongPress={() => setSelectedChipId(project.id)}
          >
            {project.name}
          </FilterChip>
        ))}
        {/* Type filter button — replaces Unsorted chip, amber like it was */}
        <button
          onClick={() => setShowTypeSheet(true)}
          className={cn(
            "text-xs font-semibold px-3 py-1.5 rounded-full whitespace-nowrap shrink-0 tracking-wide transition-all border flex items-center gap-1.5 active:scale-95",
            selectedType !== "all"
              ? cn(typeStyles[selectedType].bg, typeStyles[selectedType].text, typeStyles[selectedType].border)
              : unsortedCount > 0
              ? "bg-feedback/10 border-feedback/25 text-feedback"
              : "bg-feedback/8 border-feedback/20 text-feedback/70"
          )}
        >
          <Filter className="w-3 h-3" />
          {selectedType !== "all"
            ? typeStyles[selectedType].label
            : unsortedCount > 0
            ? `Type (${unsortedCount})`
            : "Type"}
        </button>
        <button
          onClick={() => setShowCreateProject(true)}
          className="w-8 h-8 rounded-full shrink-0 transition-all border bg-white/5 border-dashed border-white/20 text-foreground/60 hover:border-primary/40 hover:text-primary active:bg-white/10 flex items-center justify-center text-lg font-light"
        >
          +
        </button>
      </div>

      {/* Feed */}
      <div
        ref={feedRef}
        onScroll={handleScroll}
        className="flex-1 min-h-0 overflow-y-auto px-4 py-3 flex flex-col gap-3 scrollbar-hide"
        onClick={() => selectedMsgId && clearMsgSelection()}
      >
        <div className="flex items-center gap-3 my-1">
          <div className="flex-1 h-px bg-white/10" />
          <span className="text-[10px] font-bold tracking-[2px] uppercase text-muted-foreground font-mono">Today</span>
          <div className="flex-1 h-px bg-white/10" />
        </div>

        {sortedMessages.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 py-16">
            <div className="w-16 h-16 rounded-full bg-white/5 border border-white/10 flex items-center justify-center animate-float">
              <MessageCircle className="w-7 h-7 text-muted-foreground/50" />
            </div>
            <p className="text-sm text-muted-foreground">Nothing sent yet</p>
            <p className="text-xs text-muted-foreground/50">Tap 🤔 to send your first message</p>
          </div>
        ) : (
          sortedMessages.map((msg) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              projects={projects}
              contacts={contacts}
              currentUserId={currentUserId}
              userInitials={userInitials}
              userColor={userColor}
              isSelected={selectedMsgId === msg.id}
              onTap={() => {
                if (selectedMsgId) { clearMsgSelection(); return }
                onMessageClick(msg)
              }}
              onPressStart={() => startPress(msg.id)}
              onPressEnd={cancelPress}
              onProjectTagTap={(projectId) => setProjectTagCtx({ projectId, messageId: msg.id })}
            />
          ))
        )}
        <div className="h-20" />
      </div>

      {/* Message action bar — appears on long press */}
      {selectedMsg && (
        <>
          <div className="fixed inset-0 z-20" onClick={clearMsgSelection} />
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
        </>
      )}

      {/* Project chip action bar — long-press on filter chip */}
      {selectedChipId && (() => {
        const proj = projects.find((p) => p.id === selectedChipId)
        if (!proj) return null
        return (
          <>
            <div className="fixed inset-0 z-20" onClick={clearChipSelection} />
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
          </>
        )
      })()}

      {/* Project tag action bar — tap on project badge */}
      {projectTagCtx && (() => {
        const proj = projects.find((p) => p.id === projectTagCtx.projectId)
        return (
          <>
            <div className="fixed inset-0 z-20" onClick={() => setProjectTagCtx(null)} />
            <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-30 animate-scale-in px-4 w-full max-w-sm">
              <div className="flex items-center justify-center gap-1 bg-[#0d1c35] border border-white/15 rounded-2xl p-1.5 shadow-2xl">
                {/* Project label */}
                <div className="flex items-center gap-1.5 px-3 py-2 shrink-0">
                  <div className={cn("w-2 h-2 rounded-full shrink-0", proj?.color ?? "bg-white/30")} />
                  <span className="text-xs font-bold text-foreground/70 truncate max-w-[90px]">{proj?.name ?? "Project"}</span>
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
                  onClick={() => { haptic.light(); setProjectTagCtx(null); onRemoveProjectTag(projectTagCtx.messageId) }}
                  className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-semibold text-problem hover:bg-problem/10 transition-all active:scale-95"
                >
                  <X className="w-4 h-4" />
                  Untag
                </button>
              </div>
            </div>
          </>
        )
      })()}

      {/* Create Project modal */}
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

      {/* Type Filter Bottom Sheet */}
      {showTypeSheet && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px]"
            onClick={() => setShowTypeSheet(false)}
          />
          <div className="fixed bottom-0 left-0 right-0 z-50 bg-[#0a1628] border-t border-white/10 rounded-t-3xl px-5 pt-4 pb-10 shadow-2xl animate-in slide-in-from-bottom duration-200">
            {/* Handle */}
            <div className="w-10 h-1 bg-white/15 rounded-full mx-auto mb-5" />
            <p className="text-[11px] font-bold uppercase tracking-[2px] text-muted-foreground mb-3 font-mono">
              Filter by Type
            </p>
            <div className="flex flex-wrap gap-2">
              {/* All Types chip */}
              <button
                onClick={() => { haptic.light(); setSelectedType("all"); setShowTypeSheet(false) }}
                className={cn(
                  "text-sm font-semibold px-4 py-2 rounded-full border transition-all active:scale-95",
                  selectedType === "all"
                    ? "bg-primary/20 border-primary/35 text-primary"
                    : "bg-white/5 border-white/10 text-muted-foreground"
                )}
              >
                All Types
              </button>
              {/* One chip per type */}
              {(Object.entries(typeStyles) as [MessageType, { bg: string; text: string; border: string; label: string }][]).map(([type, style]) => (
                <button
                  key={type}
                  onClick={() => { haptic.light(); setSelectedType(type); setShowTypeSheet(false) }}
                  className={cn(
                    "text-sm font-semibold px-4 py-2 rounded-full border transition-all active:scale-95",
                    selectedType === type
                      ? cn(style.bg, style.text, style.border, "ring-1 ring-current ring-offset-1 ring-offset-[#0a1628]")
                      : "bg-white/5 border-white/10 text-muted-foreground"
                  )}
                >
                  {style.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* FAB */}
      <button
        onClick={onCompose}
        className="fixed bottom-6 right-5 w-14 h-14 rounded-full bg-primary flex items-center justify-center shadow-[0_4px_20px_rgba(37,99,235,0.5)] hover:shadow-[0_6px_28px_rgba(37,99,235,0.65)] active:scale-95 hover:scale-105 transition-all duration-200 z-30 text-2xl animate-glow"
      >
        🤔
      </button>
    </div>
  )
}

function FilterChip({
  children, active, highlight, isFavorited, onClick, onLongPress,
}: {
  children: React.ReactNode
  active?: boolean
  highlight?: boolean
  isFavorited?: boolean
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
        active
          ? "bg-primary/20 border-primary/35 text-primary"
          : highlight
          ? "bg-feedback/10 border-feedback/25 text-feedback"
          : "bg-white/5 border-white/10 text-muted-foreground"
      )}
    >
      {isFavorited && <Star className="w-2.5 h-2.5 fill-current text-feedback shrink-0" />}
      {children}
    </button>
  )
}

function MessageBubble({
  message, projects, contacts, currentUserId, userInitials, userColor, isSelected, onTap, onPressStart, onPressEnd, onProjectTagTap,
}: {
  message: Message
  projects: Project[]
  contacts: Contact[]
  currentUserId: string
  userInitials: string
  userColor: string
  isSelected: boolean
  onTap: () => void
  onPressStart: () => void
  onPressEnd: () => void
  onProjectTagTap?: (projectId: string) => void
}) {
  const isMe = message.senderId === currentUserId
  const contact = isMe
    ? { id: currentUserId, name: "Me", initials: userInitials, color: userColor }
    : (getContactFromList(message.senderId, contacts) ?? { id: message.senderId, name: "Unknown", initials: "?", color: "bg-white/10" })
  const project = projects.find((p) => p.id === message.projectId) ?? null
  const style = typeStyles[message.type]

  return (
    <div
      className={cn(
        "flex gap-2 items-end animate-fade-up select-none no-callout",
        isMe && "flex-row-reverse",
        isSelected && "opacity-90"
      )}
    >
      <div className={cn(
        "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 text-white",
        contact.color
      )}>
        {contact.initials}
      </div>

      <div className={cn("max-w-[75%] md:max-w-[55%] flex flex-col gap-1", isMe && "items-end")}>
        {!isMe && (
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
              ? "bg-[#112a52] border-primary/25 rounded-[16px_16px_4px_16px]"
              : "bg-card border-white/10 rounded-[16px_16px_16px_4px]",
            isSelected && (isMe
              ? "bg-primary/25 border-primary/50 shadow-[0_0_0_2px_rgba(37,99,235,0.3)]"
              : "bg-primary/10 border-primary/30 shadow-[0_0_0_2px_rgba(37,99,235,0.2)]")
          )}
        >
          <p className="text-sm leading-relaxed text-foreground/90 no-callout">{message.text}</p>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {message.type === "none" && (
              <div className="w-1.5 h-1.5 rounded-full bg-feedback flex-shrink-0 shadow-[0_0_6px_rgba(245,158,11,0.5)] animate-pulse" />
            )}
            <span className={cn(
              "text-[10px] font-bold tracking-wide uppercase px-2 py-0.5 rounded-full font-mono flex-shrink-0 border no-callout",
              style.bg, style.text, style.border
            )}>
              {style.label}
            </span>
            {project && (
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); onProjectTagTap?.(project.id) }}
                className="text-[10px] font-semibold tracking-wide bg-primary/10 text-primary border border-primary/20 rounded px-2 py-0.5 font-mono active:bg-primary/20 transition-colors no-callout"
              >
                {project.isFavorited && <Star className="inline w-2 h-2 fill-current text-feedback mr-0.5 -mt-px" />}
                {project.name}
              </button>
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
  )
}
