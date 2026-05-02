"use client"

import { useState } from "react"
import { Check, X } from "lucide-react"
import { cn, haptic } from "@/lib/utils"
import { useSwipeDismiss } from "@/hooks/use-swipe-dismiss"
import {
  type Message,
  type MessageType,
  type Project,
  type Contact,
  getContactFromList,
  formatTime,
} from "@/lib/store"
import { CreateProjectModal } from "@/components/create-project-modal"

type TagType = "progress" | "problem" | "feedback" | "decision"

interface TagSheetProps {
  message: Message
  onApply: (type: MessageType, projectId: string | null, participantIds: string[]) => void
  onClose: () => void
  projects: Project[]
  onCreateProject: (name: string, memberIds?: string[]) => Promise<Project>
  contacts: Contact[]
}

export function TagSheet({ message, onApply, onClose, projects, onCreateProject, contacts }: TagSheetProps) {
  const [selectedType, setSelectedType] = useState<TagType | null>(
    message.type !== "none" ? (message.type as TagType) : null
  )
  const [selectedProject, setSelectedProject] = useState<string | null>(
    message.projectId
  )
  // Pre-populate with existing participants minus the sender
  const [selectedParticipants, setSelectedParticipants] = useState<string[]>(
    message.participants.filter((id) => id !== message.senderId)
  )
  const [showCreateProject, setShowCreateProject] = useState(false)

  const isEditing = message.type !== "none"
  const contact = getContactFromList(message.senderId, contacts) ?? { id: message.senderId, name: "Unknown", initials: "?", color: "bg-white/10" }

  const toggleParticipant = (id: string) =>
    setSelectedParticipants((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    )

  const canApply = !!(selectedType || selectedProject || selectedParticipants.length > 0)

  const { handlers: swipeHandlers, dragStyle } = useSwipeDismiss(onClose)

  const handleApply = () => {
    if (!canApply) return
    haptic.success()
    // Build final participants: always include sender + selected
    const participants = [...new Set([message.senderId, ...selectedParticipants])]
    onApply(selectedType ?? "none", selectedProject, participants)
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end md:items-center md:justify-center">
      {/* Dimmed Background */}
      <div
        onPointerDown={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-[1px] cursor-default"
      />

      {/* Bottom Sheet — full width mobile, centered on desktop */}
      <div
        style={dragStyle}
        className="relative z-10 w-full md:w-120 md:mb-6 md:rounded-3xl bg-[#0d1c35] border-t md:border border-white/10 rounded-t-3xl animate-slide-up md:shadow-2xl max-h-[85dvh] overflow-y-auto scrollbar-hide safe-area-pb"
      >
        {/* Handle — drag here to swipe-dismiss */}
        <div
          {...swipeHandlers}
          className="py-3 touch-none cursor-grab active:cursor-grabbing"
        >
          <div className="w-10 h-1 rounded-full bg-white/20 mx-auto" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-4 mb-4">
          <h3 className="text-xs font-bold tracking-[1.5px] uppercase text-muted-foreground">
            {isEditing ? "Edit Context" : "Add Context"}
          </h3>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center"
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* Selected Message */}
        <div className="mx-4 mb-4 bg-card border border-white/10 rounded-xl p-3">
          <p className="text-xs font-bold text-muted-foreground mb-1">
            {contact.name} · {formatTime(message.timestamp)}
          </p>
          <p className="text-sm text-foreground/90 leading-snug">
            {message.text}
          </p>
        </div>

        {/* Message Type */}
        <h4 className="text-xs font-bold tracking-[1.5px] uppercase text-muted-foreground px-4 mb-3">
          Message type
        </h4>
        <div className="flex gap-2 overflow-x-auto px-4 pb-4 scrollbar-hide">
          <TypeButton
            type="progress"
            selected={selectedType === "progress"}
            onClick={() => setSelectedType("progress")}
          />
          <TypeButton
            type="problem"
            selected={selectedType === "problem"}
            onClick={() => setSelectedType("problem")}
          />
          <TypeButton
            type="feedback"
            selected={selectedType === "feedback"}
            onClick={() => setSelectedType("feedback")}
          />
          <TypeButton
            type="decision"
            selected={selectedType === "decision"}
            onClick={() => setSelectedType("decision")}
          />
        </div>

        {/* Divider */}
        <div className="h-px bg-white/10 mx-4 mb-4" />

        {/* Recipients */}
        <h4 className="text-xs font-bold tracking-[1.5px] uppercase text-muted-foreground px-4 mb-3">
          Recipients
        </h4>
        <div className="flex flex-wrap gap-2 px-4 pb-4">
          {contacts.length === 0 && (
            <p className="text-xs text-muted-foreground py-1 px-1">No other users yet.</p>
          )}
          {contacts.map((c) => {
            const active = selectedParticipants.includes(c.id)
            return (
              <button
                key={c.id}
                onClick={() => toggleParticipant(c.id)}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-semibold transition-all active:scale-95",
                  active
                    ? "bg-primary/15 border-primary/30 text-primary"
                    : "bg-white/5 border-white/10 text-muted-foreground"
                )}
              >
                <div className={cn("w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white", c.color)}>
                  {c.initials}
                </div>
                {c.name.split(" ")[0]}
                {active && <Check className="w-3 h-3" />}
              </button>
            )
          })}
        </div>

        {/* Divider */}
        <div className="h-px bg-white/10 mx-4 mb-4" />
        <h4 className="text-xs font-bold tracking-[1.5px] uppercase text-muted-foreground px-4 mb-3">
          Assign to project
        </h4>
        <div className="flex flex-col gap-1 px-4 max-h-[180px] overflow-y-auto">
          {projects.map((project) => (
            <button
              key={project.id}
              onClick={() =>
                setSelectedProject(
                  selectedProject === project.id ? null : project.id
                )
              }
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors",
                selectedProject === project.id
                  ? "bg-primary/15"
                  : "active:bg-white/5"
              )}
            >
              <div
                className={cn(
                  "w-2 h-2 rounded-full flex-shrink-0",
                  project.color
                )}
              />
              <span
                className={cn(
                  "text-sm font-semibold flex-1 text-left",
                  selectedProject === project.id
                    ? "text-primary"
                    : "text-foreground/90"
                )}
              >
                {project.name}
              </span>
              {selectedProject === project.id && (
                <Check className="w-4 h-4 text-primary" />
              )}
            </button>
          ))}
          {projects.length === 0 && (
            <p className="text-xs text-muted-foreground py-2 px-1">No projects yet.</p>
          )}
        </div>

        <button
          type="button"
          onClick={() => setShowCreateProject(true)}
          className="mx-4 mt-3 w-[calc(100%-32px)] text-xs font-semibold text-primary/70 border border-dashed border-primary/25 rounded-xl py-2.5 active:bg-primary/5 transition-colors"
        >
          + New project
        </button>

        {showCreateProject && (
          <CreateProjectModal            contacts={contacts}            onClose={() => setShowCreateProject(false)}
            onSubmit={async (name, memberIds) => {
              const p = await onCreateProject(name, memberIds)
              setSelectedProject(p.id)
              setShowCreateProject(false)
            }}
          />
        )}

        {/* Apply Button */}
        <button
          onClick={handleApply}
          disabled={!canApply}
          className={cn(
            "mx-4 mt-5 w-[calc(100%-32px)] rounded-xl py-3.5 text-sm font-semibold tracking-wide transition-all",
            canApply
              ? "bg-primary text-white shadow-[0_4px_14px_rgba(37,99,235,0.4)] active:scale-[0.98]"
              : "bg-white/10 text-muted-foreground"
          )}
        >
          {canApply ? (isEditing ? "Save →" : "Apply →") : "Select type, project or recipients"}
        </button>
      </div>
    </div>
  )
}

function TypeButton({

  type,
  selected,
  onClick,
}: {
  type: TagType
  selected: boolean
  onClick: () => void
}) {
  const styles: Record<TagType, { bg: string; text: string; border: string }> = {
    progress: {
      bg: "bg-progress/10",
      text: "text-progress",
      border: "border-progress/25",
    },
    problem: {
      bg: "bg-problem/10",
      text: "text-problem",
      border: "border-problem/25",
    },
    feedback: {
      bg: "bg-feedback/10",
      text: "text-feedback",
      border: "border-feedback/25",
    },
    decision: {
      bg: "bg-decision/10",
      text: "text-decision",
      border: "border-decision/25",
    },
  }

  const style = styles[type]

  return (
    <button
      onClick={onClick}
      className={cn(
        "flex-shrink-0 px-4 py-2 rounded-xl text-xs font-bold tracking-wide uppercase font-mono transition-all border",
        selected
          ? cn(style.bg, style.text, style.border)
          : "bg-white/5 border-white/10 text-muted-foreground"
      )}
    >
      {type.charAt(0).toUpperCase() + type.slice(1)}
    </button>
  )
}
