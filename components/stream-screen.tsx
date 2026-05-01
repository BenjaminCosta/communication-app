"use client"

import { useState } from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  type Message,
  type MessageType,
  type Project,
  getContact,
  formatTime,
} from "@/lib/store"

const typeStyles: Record<MessageType, { bg: string; text: string; border: string; label: string }> = {
  progress: {
    bg: "bg-progress/10",
    text: "text-progress",
    border: "border-progress/20",
    label: "Progress",
  },
  problem: {
    bg: "bg-problem/10",
    text: "text-problem",
    border: "border-problem/20",
    label: "Problem",
  },
  feedback: {
    bg: "bg-feedback/10",
    text: "text-feedback",
    border: "border-feedback/20",
    label: "Feedback",
  },
  decision: {
    bg: "bg-decision/10",
    text: "text-decision",
    border: "border-decision/20",
    label: "Decision",
  },
  none: {
    bg: "bg-white/5",
    text: "text-muted-foreground",
    border: "border-border",
    label: "Unsorted",
  },
}

interface StreamScreenProps {
  messages: Message[]
  activeFilter: string
  onFilterChange: (filter: string) => void
  onCompose: () => void
  onMessageClick: (message: Message) => void
  onNewProject: (name: string) => void
  onProfile: () => void
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
  userInitials,
  projects,
}: StreamScreenProps) {
  const [showNewProject, setShowNewProject] = useState(false)
  const [newProjectName, setNewProjectName] = useState("")

  const handleCreateProject = () => {
    if (!newProjectName.trim()) return
    onNewProject(newProjectName.trim())
    setNewProjectName("")
    setShowNewProject(false)
  }
  // Count unsorted messages
  const unsortedCount = messages.filter((m) => m.type === "none").length

  // Sort messages by timestamp (newest last)
  const sortedMessages = [...messages].sort(
    (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
  )

  return (
    <div className="flex-1 flex flex-col bg-background animate-fade-in">
      {/* Header */}
      <div className="flex-shrink-0 px-4 py-3 flex items-center justify-between border-b border-white/10">
        <h1 className="text-lg font-bold tracking-tight">
          SVC <span className="text-primary">Stream</span>
        </h1>
        <button
          onClick={onProfile}
          className="w-9 h-9 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center active:scale-95 transition-transform"
        >
          <span className="text-[11px] font-bold text-primary">{userInitials}</span>
        </button>
      </div>

      {/* Filter Bar */}
      <div className="flex-shrink-0 flex gap-2 overflow-x-auto px-4 py-2.5 border-b border-white/10 scrollbar-hide">
        <FilterChip
          active={activeFilter === "all"}
          onClick={() => onFilterChange("all")}
        >
          All
        </FilterChip>
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
        {/* New project button */}
        <button
          onClick={() => setShowNewProject(true)}
          className="text-xs font-semibold px-3 py-1.5 rounded-full whitespace-nowrap shrink-0 tracking-wide transition-all border bg-white/5 border-dashed border-white/20 text-muted-foreground active:bg-white/10"
        >
          + Project
        </button>
      </div>

      {/* Feed */}
      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3 scrollbar-hide">
        {/* Date Separator */}
        <div className="flex items-center gap-3 my-1">
          <div className="flex-1 h-px bg-white/10" />
          <span className="text-[10px] font-bold tracking-[2px] uppercase text-muted-foreground font-mono">
            Today
          </span>
          <div className="flex-1 h-px bg-white/10" />
        </div>

        {sortedMessages.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 py-12">
            <div className="w-16 h-16 rounded-full bg-white/5 border border-white/10 flex items-center justify-center">
              <span className="text-2xl">💬</span>
            </div>
            <p className="text-sm text-muted-foreground">Nothing sent yet</p>
            <p className="text-xs text-muted-foreground/50">Tap 🤔 to send your first message</p>
          </div>
        ) : (
          sortedMessages.map((msg) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              onClick={() => onMessageClick(msg)}
              projects={projects}
            />
          ))
        )}
      </div>

      {/* New project mini-sheet */}
      {showNewProject && (
        <>
          <button
            onClick={() => { setShowNewProject(false); setNewProjectName("") }}
            className="fixed inset-0 z-40"
            aria-label="Close"
          />
          <div className="fixed bottom-0 left-0 right-0 md:left-auto md:right-8 md:bottom-24 md:w-80 z-50 bg-[#0d1c35] border-t md:border border-white/10 px-4 pt-5 pb-8 md:pb-5 rounded-t-2xl md:rounded-2xl animate-slide-up shadow-2xl">
            <div className="w-10 h-1 rounded-full bg-white/20 mx-auto mb-4 md:hidden" />
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-bold tracking-[1.5px] uppercase text-muted-foreground">New Project</p>
              <button
                onClick={() => { setShowNewProject(false); setNewProjectName("") }}
                className="w-6 h-6 rounded-full bg-white/5 border border-white/10 flex items-center justify-center active:scale-95 transition-transform"
                aria-label="Close"
              >
                <X className="w-3.5 h-3.5 text-muted-foreground" />
              </button>
            </div>
            <div className="flex gap-2">
              <input
                autoFocus
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateProject()
                  if (e.key === "Escape") { setShowNewProject(false); setNewProjectName("") }
                }}
                placeholder="Project name..."
                className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/40 transition-colors"
              />
              <button
                onClick={handleCreateProject}
                disabled={!newProjectName.trim()}
                className="px-5 py-3 bg-primary text-white text-sm font-semibold rounded-xl disabled:opacity-30 active:scale-95 transition-all"
              >
                Create
              </button>
            </div>
          </div>
        </>
      )}

      {/* FAB — opens Compose */}
      <button
        onClick={onCompose}
        className="fixed bottom-6 right-5 w-14 h-14 rounded-full bg-primary flex items-center justify-center shadow-[0_4px_20px_rgba(37,99,235,0.5)] active:scale-95 transition-transform z-30 text-2xl"
      >
        🤔
      </button>
    </div>
  )
}

function FilterChip({
  children,
  active,
  highlight,
  onClick,
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
  message,
  onClick,
  projects,
}: {
  message: Message
  onClick?: () => void
  projects: Project[]
}) {
  const contact = getContact(message.contactId)
  const project = projects.find((p) => p.id === message.projectId) ?? null
  const style = typeStyles[message.type]

  return (
    <div
      className={cn(
        "flex gap-2 items-end animate-fade-up",
        message.isMe && "flex-row-reverse"
      )}
    >
      <div
        className={cn(
          "w-8 h-8 rounded-full border border-white/10 flex items-center justify-center text-xs font-bold flex-shrink-0",
          message.isMe ? "bg-[#1a3460]" : "bg-card"
        )}
      >
        {contact.initials}
      </div>
      <div
        className={cn(
          "max-w-[75%] flex flex-col gap-1",
          message.isMe && "items-end"
        )}
      >
        {!message.isMe && (
          <span className="text-xs font-semibold text-muted-foreground px-1">
            {contact.name}
          </span>
        )}
        <button
          onClick={onClick}
          className={cn(
            "border p-3 px-3.5 text-left",
            message.isMe
              ? "bg-[#112a52] border-primary/25 rounded-[16px_16px_4px_16px]"
              : "bg-card border-white/10 rounded-[16px_16px_16px_4px]",
            "active:opacity-70 transition-opacity"
          )}
        >
          <p className="text-sm leading-relaxed text-foreground/90">
            {message.text}
          </p>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {message.type === "none" && (
              <div className="w-1.5 h-1.5 rounded-full bg-feedback flex-shrink-0 shadow-[0_0_6px_rgba(245,158,11,0.5)] animate-pulse" />
            )}
            <span
              className={cn(
                "text-[10px] font-bold tracking-wide uppercase px-2 py-0.5 rounded-full font-mono flex-shrink-0 border",
                style.bg,
                style.text,
                style.border
              )}
            >
              {style.label}
            </span>
            {project && (
              <span className="text-[10px] font-semibold tracking-wide bg-primary/10 text-primary border border-primary/20 rounded px-2 py-0.5 font-mono">
                {project.name}
              </span>
            )}
            <span className="text-[10px] text-muted-foreground font-mono ml-auto">
              {formatTime(message.timestamp)}
            </span>
          </div>
        </button>
      </div>
    </div>
  )
}
