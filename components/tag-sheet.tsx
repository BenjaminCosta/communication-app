"use client"

import { useState } from "react"
import { Check, X } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  type Message,
  type MessageType,
  type Project,
  getContact,
  formatTime,
} from "@/lib/store"

type TagType = "progress" | "problem" | "feedback" | "decision"

interface TagSheetProps {
  message: Message
  onApply: (type: MessageType, projectId: string | null) => void
  onClose: () => void
  projects: Project[]
  onCreateProject: (name: string) => Project
}

export function TagSheet({ message, onApply, onClose, projects, onCreateProject }: TagSheetProps) {
  const [selectedType, setSelectedType] = useState<TagType | null>(
    message.type !== "none" ? (message.type as TagType) : null
  )
  const [selectedProject, setSelectedProject] = useState<string | null>(
    message.projectId
  )
  const [showNewProjectInput, setShowNewProjectInput] = useState(false)
  const [newProjectName, setNewProjectName] = useState("")

  const isEditing = message.type !== "none"
  const contact = getContact(message.contactId)

  const handleApply = () => {
    if (selectedType) {
      onApply(selectedType, selectedProject)
    }
  }

  return (
    <div className="flex-1 flex flex-col relative bg-background overflow-hidden">
      {/* Dimmed Background */}
      <button
        onClick={onClose}
        className="absolute inset-0 bg-black/60"
        aria-label="Close"
      />

      {/* Bottom Sheet — full width mobile, centered on desktop */}
      <div className="absolute bottom-0 left-0 right-0 md:left-1/2 md:-translate-x-1/2 md:w-120 md:bottom-6 md:rounded-3xl bg-[#0d1c35] border-t md:border border-white/10 rounded-t-3xl pb-8 animate-slide-up safe-area-pb md:shadow-2xl">
        {/* Handle */}
        <div className="w-10 h-1 rounded-full bg-white/20 mx-auto mt-3 mb-5" />

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

        {/* Project */}
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
          {projects.length === 0 && !showNewProjectInput && (
            <p className="text-xs text-muted-foreground py-2 px-1">No projects yet.</p>
          )}
        </div>

        {/* Inline new project input */}
        {showNewProjectInput ? (
          <div className="flex gap-2 mt-3 px-4">
            <input
              autoFocus
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  if (!newProjectName.trim()) return
                  const p = onCreateProject(newProjectName)
                  setSelectedProject(p.id)
                  setNewProjectName("")
                  setShowNewProjectInput(false)
                }
                if (e.key === "Escape") { setShowNewProjectInput(false); setNewProjectName("") }
              }}
              placeholder="Project name..."
              className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/40 transition-colors"
            />
            <button
              type="button"
              onClick={() => {
                if (!newProjectName.trim()) return
                const p = onCreateProject(newProjectName)
                setSelectedProject(p.id)
                setNewProjectName("")
                setShowNewProjectInput(false)
              }}
              className="px-3 py-2 bg-primary/20 border border-primary/30 text-primary text-xs font-semibold rounded-lg active:scale-95 transition-all"
            >
              Create
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowNewProjectInput(true)}
            className="mx-4 mt-3 w-[calc(100%-32px)] text-xs font-semibold text-primary/70 border border-dashed border-primary/25 rounded-xl py-2.5 active:bg-primary/5 transition-colors"
          >
            + New project
          </button>
        )}

        {/* Apply Button */}
        <button
          onClick={handleApply}
          disabled={!selectedType}
          className={cn(
            "mx-4 mt-5 w-[calc(100%-32px)] rounded-xl py-3.5 text-sm font-semibold tracking-wide transition-all",
            selectedType
              ? "bg-primary text-white shadow-[0_4px_14px_rgba(37,99,235,0.4)] active:scale-[0.98]"
              : "bg-white/10 text-muted-foreground"
          )}
        >
          {selectedType ? (isEditing ? "Save →" : "Apply →") : "Select a type"}
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
