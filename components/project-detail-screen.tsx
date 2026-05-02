"use client"

import { useState } from "react"
import { ArrowLeft, UserPlus } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  type Project,
  type Message,
  type MessageType,
  type Contact,
  getContactFromList,
  formatTime,
} from "@/lib/store"
import { AddMembersModal } from "@/components/add-members-modal"

const typeStyles: Record<MessageType, { bg: string; text: string; border: string; label: string }> = {
  progress:  { bg: "bg-progress/10",  text: "text-progress",  border: "border-progress/20",  label: "Progress" },
  problem:   { bg: "bg-problem/10",   text: "text-problem",   border: "border-problem/20",   label: "Problem" },
  feedback:  { bg: "bg-feedback/10",  text: "text-feedback",  border: "border-feedback/20",  label: "Feedback" },
  decision:  { bg: "bg-decision/10",  text: "text-decision",  border: "border-decision/20",  label: "Decision" },
  none:      { bg: "bg-white/5",      text: "text-muted-foreground", border: "border-border", label: "Unsorted" },
}

interface ProjectDetailScreenProps {
  project: Project
  messages: Message[]
  onBack: () => void
  onUpdateMembers: (projectId: string, memberIds: string[]) => void
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
  className,
  contacts,
  currentUserId,
  currentUser,
}: ProjectDetailScreenProps) {
  const [showMembers, setShowMembers] = useState(false)

  // Include current user in lookup so their avatar/name resolves correctly
  const allContacts = currentUser ? [...contacts, currentUser] : contacts

  const projectMessages = [...messages]
    .filter((m) => m.projectId === project.id)
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())

  const memberContacts = project.members
    .map((id) => allContacts.find((c) => c.id === id))
    .filter(Boolean) as Contact[]

  return (
    <div className={`flex-1 flex flex-col bg-background ${className ?? "animate-fade-in"}`}>
      {/* Header */}
      <div className="flex-shrink-0 border-b border-white/10 animate-slide-down">
        <div className="max-w-2xl mx-auto px-4 md:px-6 py-3 flex items-center gap-3">
          <button
            onClick={onBack}
            className="w-9 h-9 rounded-full bg-white/5 border border-white/10 flex items-center justify-center active:scale-95 hover:bg-white/8 transition-all duration-150"
          >
            <ArrowLeft className="w-4 h-4 text-muted-foreground" />
          </button>
          {/* Project name + color */}
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className={cn("w-2.5 h-2.5 rounded-full flex-shrink-0", project.color)} />
            <h1 className="text-base font-bold tracking-tight truncate">{project.name}</h1>
          </div>
          {/* Add members button */}
          <button
            onClick={() => setShowMembers(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-muted-foreground text-xs font-semibold active:scale-95 hover:bg-white/8 transition-all duration-150"
          >
            <UserPlus className="w-3.5 h-3.5" />
            Members
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
              <span>Add members to this project</span>
            </button>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex -space-x-2">
                {memberContacts.slice(0, 5).map((contact) => (
                  <div
                    key={contact.id}
                    title={contact.name}
                    className={cn(
                      "w-7 h-7 rounded-full border-2 border-background flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0",
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
                  {memberContacts.length} member{memberContacts.length !== 1 ? "s" : ""}
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
      <div className="flex-1 overflow-y-auto scrollbar-hide">
        <div className="max-w-2xl mx-auto px-4 md:px-6 py-3 flex flex-col gap-3">
          {/* Date separator */}
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
              <p className="text-xs text-muted-foreground/50">Messages tagged with this project appear here</p>
            </div>
          ) : (
            projectMessages.map((msg, i) => (
              <ProjectMessageBubble key={msg.id} message={msg} index={i} contacts={allContacts} currentUserId={currentUserId} />
            ))
          )}
          <div className="h-6" />
        </div>
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

function ProjectMessageBubble({ message, index, contacts, currentUserId }: { message: Message; index: number; contacts: Contact[]; currentUserId: string }) {
  const isMe = message.senderId === currentUserId
  const contact = getContactFromList(message.senderId, contacts) ?? { id: message.senderId, name: "Unknown", initials: "?", color: "bg-white/10" }
  const style = typeStyles[message.type]

  return (
    <div
      className={cn("flex gap-2 items-end animate-fade-up", isMe && "flex-row-reverse")}
      style={{ animationDelay: `${index * 30}ms` }}
    >
      <div className={cn(
        "w-8 h-8 rounded-full border border-white/10 flex items-center justify-center text-xs font-bold flex-shrink-0",
        isMe ? "bg-[#1a3460]" : "bg-card"
      )}>
        {contact.initials}
      </div>

      <div className={cn("max-w-[75%] md:max-w-[55%] flex flex-col gap-1", isMe && "items-end")}>
        {!isMe && (
          <span className="text-xs font-semibold text-muted-foreground px-1">{contact.name}</span>
        )}
        <div className={cn(
          "border p-3 px-3.5",
          isMe
            ? "bg-[#112a52] border-primary/25 rounded-[16px_16px_4px_16px]"
            : "bg-card border-white/10 rounded-[16px_16px_16px_4px]"
        )}>
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
            <span className="text-[10px] text-muted-foreground font-mono ml-auto">
              {formatTime(message.timestamp)}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
