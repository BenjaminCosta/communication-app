"use client"

import { useState, useRef } from "react"
import { ArrowLeft, UserPlus, Star, Trash2, Tag, Copy } from "lucide-react"
import { cn, haptic } from "@/lib/utils"
import {
  type Project,
  type Message,
  type MessageDraft,
  type MessageType,
  type Contact,
  getContactFromList,
  formatTime,
  messageHasProject,
  MESSAGE_TYPE_CONFIG,
  projectTagId,
} from "@/lib/store"
import { AddMembersModal } from "@/components/add-members-modal"
import { MessageInputBar } from "@/components/message-input-bar"

const typeStyles = MESSAGE_TYPE_CONFIG

interface ProjectDetailScreenProps {
  project: Project
  messages: Message[]
  onBack: () => void
  onUpdateMembers: (projectId: string, memberIds: string[]) => void
  onMessageClick: (message: Message) => void
  onDeleteMessage: (id: string) => void
  onFavoriteMessage: (id: string) => void
  onCopyMessage: (text: string) => void
  onCompose: (projectId: string) => void
  onSendMessage: (draft: MessageDraft) => Promise<void>
  className?: string
  contacts: Contact[]
  currentUserId: string
  currentUser: Contact | null
}

export function ProjectDetailScreen({
  project,
  messages,
  onBack,
  onUpdateMembers,
  onMessageClick,
  onDeleteMessage,
  onFavoriteMessage,
  onCopyMessage,
  onCompose,
  onSendMessage,
  className,
  contacts,
  currentUserId,
  currentUser,
}: ProjectDetailScreenProps) {
  const [showMembers, setShowMembers] = useState(false)
  const [selectedMsgId, setSelectedMsgId] = useState<string | null>(null)
  const [confirmDeleteMsgId, setConfirmDeleteMsgId] = useState<string | null>(null)
  const [quickText, setQuickText] = useState("")
  const [isQuickSending, setIsQuickSending] = useState(false)
  const [isQuickSent, setIsQuickSent] = useState(false)
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearSelection = () => { setSelectedMsgId(null); setConfirmDeleteMsgId(null) }

  const startPress = (msgId: string) => {
    pressTimer.current = setTimeout(() => {
      setSelectedMsgId(msgId)
      navigator?.vibrate?.(12)
    }, 450)
  }
  const cancelPress = () => {
    if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null }
  }

  const handleQuickSend = async () => {
    if (!quickText.trim() || isQuickSending) return
    haptic.success()
    setIsQuickSending(true)
    try {
      await onSendMessage({
        text: quickText.trim(),
        contactIds: [],
        projectIds: [project.id],
        tagIds: [projectTagId(project.id)],
        type: "none",
        imageFile: null,
      })
      setQuickText("")
      setIsQuickSent(true)
      setTimeout(() => setIsQuickSent(false), 1400)
    } finally {
      setIsQuickSending(false)
    }
  }

  // Include current user in lookup so their avatar/name resolves correctly
  const allContacts = currentUser ? [...contacts, currentUser] : contacts

  const projectMessages = [...messages]
    .filter((m) => messageHasProject(m, project.id))
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())

  const memberContacts = project.members
    .map((id) => allContacts.find((c) => c.id === id))
    .filter(Boolean) as Contact[]

  const selectedMsg = selectedMsgId ? projectMessages.find((m) => m.id === selectedMsgId) : null

  return (
    <div className={`flex-1 min-h-0 flex flex-col bg-background ${className ?? "animate-fade-in"}`}>
      {/* Header */}
      <div className="flex-shrink-0 border-b border-white/10 animate-slide-down">
        <div className="max-w-2xl mx-auto px-4 md:px-6 app-topbar flex items-center gap-3">
          <button
            onClick={onBack}
            className="w-9 h-9 rounded-full bg-white/5 border border-white/10 flex items-center justify-center active:scale-95 hover:bg-white/8 transition-all duration-150"
          >
            <ArrowLeft className="w-4 h-4 text-muted-foreground" />
          </button>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className={cn("w-2.5 h-2.5 rounded-full shrink-0", project.color)} />
            <h1 className="text-base font-bold tracking-tight truncate">{project.name}</h1>
          </div>
          <button
            onClick={() => setShowMembers(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-muted-foreground text-xs font-semibold active:scale-95 hover:bg-white/8 transition-all duration-150"
          >
            <UserPlus className="w-3.5 h-3.5" />
            People
          </button>
        </div>
      </div>

      {/* Members strip */}
      <div className="flex-shrink-0 border-b border-white/5">
        <div className="max-w-2xl mx-auto px-4 md:px-6 py-3">
          {memberContacts.length === 0 ? (
            <button
              onClick={() => setShowMembers(true)}
              className="flex items-center gap-2 text-xs text-muted-foreground/50 active:opacity-70 transition-opacity"
            >
              <div className="w-7 h-7 rounded-full border border-dashed border-white/20 flex items-center justify-center">
                <UserPlus className="w-3.5 h-3.5" />
              </div>
              <span>Add people to this tag</span>
            </button>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex -space-x-2">
                {memberContacts.slice(0, 5).map((contact) => (
                  <div
                    key={contact.id}
                    title={contact.name}
                    className={cn(
                      "w-7 h-7 rounded-full border-2 border-background flex items-center justify-center text-[10px] font-bold text-white shrink-0",
                      contact.color
                    )}
                  >
                    {contact.initials}
                  </div>
                ))}
                {memberContacts.length > 5 && (
                  <div className="w-7 h-7 rounded-full border-2 border-background bg-white/10 flex items-center justify-center text-[10px] font-bold text-muted-foreground">
                    +{memberContacts.length - 5}
                  </div>
                )}
              </div>
              <div className="flex flex-col">
                <span className="text-[11px] font-semibold text-foreground/80 leading-tight">
                  {memberContacts.length === 1
                    ? memberContacts[0].name
                    : memberContacts.slice(0, 2).map(c => c.name.split(" ")[0]).join(", ") +
                      (memberContacts.length > 2 ? ` +${memberContacts.length - 2}` : "")}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {memberContacts.length} {memberContacts.length !== 1 ? "people" : "person"}
                </span>
              </div>
              <button
                onClick={() => setShowMembers(true)}
                className="ml-auto text-[11px] text-primary/70 font-semibold active:opacity-70 transition-opacity"
              >
                Edit
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Message feed */}
      <div
        className="flex-1 min-h-0 overflow-y-auto scrollbar-hide"
        onClick={() => selectedMsgId && clearSelection()}
      >
        <div className="max-w-2xl mx-auto px-4 md:px-6 py-3 flex flex-col gap-3">
          <div className="flex items-center gap-3 my-1">
            <div className="flex-1 h-px bg-white/10" />
            <span className="text-[10px] font-bold tracking-[2px] uppercase text-muted-foreground font-mono">
              {project.name}
            </span>
            <div className="flex-1 h-px bg-white/10" />
          </div>

          {projectMessages.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-20 animate-fade-up">
              <div className="w-14 h-14 rounded-full bg-white/5 border border-white/10 flex items-center justify-center animate-float">
                <span className="text-2xl">💬</span>
              </div>
              <p className="text-sm text-muted-foreground">No messages yet</p>
              <p className="text-xs text-muted-foreground/50">Messages with this tag appear here</p>
            </div>
          ) : (
            projectMessages.map((msg, i) => (
              <ProjectMessageBubble
                key={msg.id}
                message={msg}
                index={i}
                contacts={allContacts}
                currentUserId={currentUserId}
                isSelected={selectedMsgId === msg.id}
                onTap={() => {
                  if (selectedMsgId) { clearSelection(); return }
                  onMessageClick(msg)
                }}
                onPressStart={() => startPress(msg.id)}
                onPressEnd={cancelPress}
              />
            ))
          )}
          <div className="h-3" />
        </div>
      </div>

      <MessageInputBar
        text={quickText}
        setText={setQuickText}
        contacts={contacts}
        projects={[project]}
        recipients={[]}
        projectIds={[project.id]}
        type="none"
        imageFile={null}
        imagePreview={null}
        isSending={isQuickSending}
        isSent={isQuickSent}
        onOpenSheet={() => onCompose(project.id)}
        onRemoveRecipient={() => {}}
        onRemoveProject={() => {}}
        onClearType={() => {}}
        onClearImage={() => {}}
        onSend={handleQuickSend}
        showProjectChips={false}
      />

      {/* Message action bar */}
      {/* Persistent backdrop — never unmounts (iOS hit-test cache fix) */}
      <div
        className={cn("fixed inset-0 z-20", selectedMsg ? "pointer-events-auto" : "pointer-events-none")}
        onClick={clearSelection}
      />
      <div className={cn(
        "fixed bottom-24 left-1/2 -translate-x-1/2 z-30 px-3 w-full max-w-md transition-all duration-150",
        selectedMsg ? "pointer-events-auto" : "pointer-events-none opacity-0 translate-y-2"
      )}>
        {selectedMsg && (
          <div className="flex items-center justify-center gap-1 bg-[#0d1c35] border border-white/15 rounded-2xl p-1.5 shadow-2xl animate-scale-in">
            {/* Tag / add context */}
            <button
              onClick={() => { clearSelection(); onMessageClick(selectedMsg) }}
              className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold text-muted-foreground hover:bg-white/5 hover:text-foreground transition-all active:scale-95"
            >
              <Tag className="w-4 h-4" />
              Tag
            </button>
            <div className="w-px h-6 bg-white/15 shrink-0" />
            {/* Copy */}
            <button
              onClick={() => { haptic.light(); onCopyMessage(selectedMsg.text); clearSelection() }}
              className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold text-muted-foreground hover:bg-white/5 hover:text-foreground transition-all active:scale-95"
            >
              <Copy className="w-4 h-4" />
              Copy
            </button>
            <div className="w-px h-6 bg-white/15 shrink-0" />
            {/* Favorite */}
            <button
              onClick={() => { haptic.light(); onFavoriteMessage(selectedMsg.id); clearSelection() }}
              className={cn(
                "flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all active:scale-95",
                selectedMsg.isFavorited
                  ? "bg-feedback/15 text-feedback"
                  : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
              )}
            >
              <Star className={cn("w-4 h-4", selectedMsg.isFavorited && "fill-current")} />
              {selectedMsg.isFavorited ? "Unstar" : "Star"}
            </button>
            {selectedMsg.senderId === currentUserId && (
              <>
                <div className="w-px h-6 bg-white/15 shrink-0" />
                {confirmDeleteMsgId === selectedMsg.id ? (
                  <button
                    onClick={() => { haptic.destructive(); onDeleteMessage(selectedMsg.id); clearSelection() }}
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
        )}
      </div>

      {/* Add Members modal */}
      {showMembers && (
        <AddMembersModal
          contacts={contacts}
          currentMembers={project.members}
          onSave={(ids) => {
            onUpdateMembers(project.id, ids)
            setShowMembers(false)
          }}
          onClose={() => setShowMembers(false)}
        />
      )}

    </div>
  )
}

function ProjectMessageBubble({
  message, index, contacts, currentUserId, isSelected, onTap, onPressStart, onPressEnd,
}: {
  message: Message
  index: number
  contacts: Contact[]
  currentUserId: string
  isSelected: boolean
  onTap: () => void
  onPressStart: () => void
  onPressEnd: () => void
}) {
  const isMe = message.senderId === currentUserId
  const contact = getContactFromList(message.senderId, contacts) ?? { id: message.senderId, name: "Unknown", initials: "?", color: "bg-white/10" }
  const style = typeStyles[message.type]

  return (
    <div
      className={cn("flex gap-2 items-end animate-fade-up select-none no-callout", isMe && "flex-row-reverse")}
      style={{ animationDelay: `${index * 30}ms` }}
    >
      <div className={cn(
        "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 text-white",
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
          {message.imageUrl && (
            <img
              src={message.imageUrl}
              alt={message.imageName || "Attached image"}
              className="mb-2 max-h-72 w-full rounded-xl object-cover border border-white/10 bg-black/20"
            />
          )}
          {message.text && <p className="text-sm leading-relaxed text-foreground/90 no-callout">{message.text}</p>}
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {message.type === "none" && (
              <div className="w-1.5 h-1.5 rounded-full bg-feedback shrink-0 shadow-[0_0_6px_rgba(245,158,11,0.5)] animate-pulse" />
            )}
            <span className={cn(
              "text-[10px] font-bold tracking-wide uppercase px-2 py-0.5 rounded-full font-mono shrink-0 border no-callout",
              message.type === "none"
                ? "border-white/10 bg-white/5 text-muted-foreground"
                : cn(style.bg, style.text, style.border)
            )}>
              {style.label}
            </span>
            {message.isFavorited && (
              <Star className="w-3 h-3 text-feedback fill-current ml-0.5 shrink-0" />
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
