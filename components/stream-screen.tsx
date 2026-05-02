"use client"

import { useState, useRef, useEffect } from "react"
import { Bell, MessageCircle, Star, Trash2 } from "lucide-react"
import { cn, haptic } from "@/lib/utils"
import {
  type Message,
  type MessageType,
  type Project,
  getContact,
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
  projects: Project[]
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
  projects,
}: StreamScreenProps) {
  const [showCreateProject, setShowCreateProject] = useState(false)
  const [selectedMsgId, setSelectedMsgId] = useState<string | null>(null)
  const feedRef = useRef<HTMLDivElement>(null)
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight })
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

  const unsortedCount = messages.filter((m) => m.type === "none").length
  const sortedMessages = [...messages].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
  const selectedMsg = selectedMsgId ? messages.find((m) => m.id === selectedMsgId) : null

  return (
    <div className="flex-1 flex flex-col bg-background animate-fade-in">
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
          {/* Profile avatar */}
          <button
            onClick={onProfile}
            className="w-9 h-9 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center active:scale-95 hover:bg-primary/20 transition-all duration-150"
          >
            <span className="text-[11px] font-bold text-primary">{userInitials}</span>
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex-shrink-0 flex gap-2 overflow-x-auto px-4 py-2.5 border-b border-white/10 scrollbar-hide">
        <FilterChip active={activeFilter === "all"} onClick={() => onFilterChange("all")}>All</FilterChip>
        {projects.map((project) => (
          <FilterChip
            key={project.id}
            active={activeFilter === project.id}
            onClick={() => onFilterChange(project.id)}
          >
            {project.name}
          </FilterChip>
        ))}
        <FilterChip
          active={activeFilter === "unsorted"}
          onClick={() => onFilterChange("unsorted")}
          highlight={unsortedCount > 0}
        >
          Unsorted {unsortedCount > 0 && `(${unsortedCount})`}
        </FilterChip>
        <button
          onClick={() => setShowCreateProject(true)}
          className="text-xs font-semibold px-3 py-1.5 rounded-full whitespace-nowrap shrink-0 tracking-wide transition-all border bg-white/5 border-dashed border-white/20 text-muted-foreground hover:border-white/30 active:bg-white/10"
        >
          + Project
        </button>
      </div>

      {/* Feed */}
      <div
        ref={feedRef}
        className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3 scrollbar-hide"
        onClick={() => selectedMsgId && setSelectedMsgId(null)}
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
              isSelected={selectedMsgId === msg.id}
              onTap={() => {
                if (selectedMsgId) { setSelectedMsgId(null); return }
                onMessageClick(msg)
              }}
              onPressStart={() => startPress(msg.id)}
              onPressEnd={cancelPress}
            />
          ))
        )}
        <div className="h-20" />
      </div>

      {/* Message action bar — appears on long press */}
      {selectedMsg && (
        <>
          {/* invisible backdrop to deselect */}
          <div className="fixed inset-0 z-20" onClick={() => setSelectedMsgId(null)} />
          <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-30 animate-scale-in px-4 w-full max-w-xs">
            <div className="flex items-center justify-center gap-1 bg-[#0d1c35] border border-white/15 rounded-2xl p-1.5 shadow-2xl">
              <button
                onClick={() => { haptic.light(); onFavoriteMessage(selectedMsg.id); setSelectedMsgId(null) }}
                className={cn(
                  "flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all active:scale-95",
                  selectedMsg.isFavorited
                    ? "bg-feedback/15 text-feedback"
                    : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
                )}
              >
                <Star className={cn("w-4 h-4", selectedMsg.isFavorited && "fill-current")} />
                {selectedMsg.isFavorited ? "Unfavorite" : "Favorite"}
              </button>
              <div className="w-px h-6 bg-white/15 flex-shrink-0" />
              <button
                onClick={() => { haptic.destructive(); onDeleteMessage(selectedMsg.id); setSelectedMsgId(null) }}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-problem hover:bg-problem/10 transition-all active:scale-95"
              >
                <Trash2 className="w-4 h-4" />
                Delete
              </button>
            </div>
          </div>
        </>
      )}

      {/* Create Project modal */}
      {showCreateProject && (
        <CreateProjectModal
          onClose={() => setShowCreateProject(false)}
          onSubmit={(name, memberIds) => {
            onNewProject(name, memberIds)
            setShowCreateProject(false)
          }}
        />
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
  children, active, highlight, onClick,
}: {
  children: React.ReactNode
  active?: boolean
  highlight?: boolean
  onClick?: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "text-xs font-semibold px-3 py-1.5 rounded-full whitespace-nowrap flex-shrink-0 tracking-wide transition-all border",
        active
          ? "bg-primary/20 border-primary/35 text-primary"
          : highlight
          ? "bg-feedback/10 border-feedback/25 text-feedback"
          : "bg-white/5 border-white/10 text-muted-foreground"
      )}
    >
      {children}
    </button>
  )
}

function MessageBubble({
  message, projects, isSelected, onTap, onPressStart, onPressEnd,
}: {
  message: Message
  projects: Project[]
  isSelected: boolean
  onTap: () => void
  onPressStart: () => void
  onPressEnd: () => void
}) {
  const contact = getContact(message.contactId)
  const project = projects.find((p) => p.id === message.projectId) ?? null
  const style = typeStyles[message.type]

  return (
    <div
      className={cn(
        "flex gap-2 items-end animate-fade-up select-none",
        message.isMe && "flex-row-reverse",
        isSelected && "opacity-90"
      )}
    >
      <div className={cn(
        "w-8 h-8 rounded-full border border-white/10 flex items-center justify-center text-xs font-bold flex-shrink-0",
        message.isMe ? "bg-[#1a3460]" : "bg-card"
      )}>
        {contact.initials}
      </div>

      <div className={cn("max-w-[75%] md:max-w-[55%] flex flex-col gap-1", message.isMe && "items-end")}>
        {!message.isMe && (
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
            message.isMe
              ? "bg-[#112a52] border-primary/25 rounded-[16px_16px_4px_16px]"
              : "bg-card border-white/10 rounded-[16px_16px_16px_4px]",
            isSelected && (message.isMe
              ? "bg-primary/25 border-primary/50 shadow-[0_0_0_2px_rgba(37,99,235,0.3)]"
              : "bg-primary/10 border-primary/30 shadow-[0_0_0_2px_rgba(37,99,235,0.2)]")
          )}
        >
          <p className="text-sm leading-relaxed text-foreground/90">{message.text}</p>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {message.type === "none" && (
              <div className="w-1.5 h-1.5 rounded-full bg-feedback flex-shrink-0 shadow-[0_0_6px_rgba(245,158,11,0.5)] animate-pulse" />
            )}
            <span className={cn(
              "text-[10px] font-bold tracking-wide uppercase px-2 py-0.5 rounded-full font-mono flex-shrink-0 border",
              style.bg, style.text, style.border
            )}>
              {style.label}
            </span>
            {project && (
              <span className="text-[10px] font-semibold tracking-wide bg-primary/10 text-primary border border-primary/20 rounded px-2 py-0.5 font-mono">
                {project.name}
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
  )
}
