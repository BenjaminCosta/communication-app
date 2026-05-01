"use client"

import { useState } from "react"
import { X, User, Tag, Building, Check } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  type MessageType,
  type Contact,
  type Project,
  CONTACTS,
} from "@/lib/store"

interface ComposeScreenProps {
  onCancel: () => void
  onSend: (text: string, contactIds: string[], projectId: string | null, type: MessageType) => void
  projects: Project[]
  onCreateProject: (name: string) => Project
  mode?: "fullscreen" | "sheet"
}

export function ComposeScreen({ onCancel, onSend, projects, onCreateProject, mode = "sheet" }: ComposeScreenProps) {
  const [text, setText] = useState("")
  const [selectedContacts, setSelectedContacts] = useState<string[]>([])
  const [selectedProject, setSelectedProject] = useState<string | null>(null)
  const [selectedType, setSelectedType] = useState<MessageType>("none")
  
  const [showContacts, setShowContacts] = useState(false)
  const [showProjects, setShowProjects] = useState(false)
  const [showTypes, setShowTypes] = useState(false)
  const [newProjectName, setNewProjectName] = useState("")
  const [showNewProjectInput, setShowNewProjectInput] = useState(false)

  const toggleContact = (id: string) => {
    setSelectedContacts((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    )
  }

  const handleSend = () => {
    if (!text.trim()) return
    onSend(text.trim(), selectedContacts, selectedProject, selectedType)
  }

  const selectedContactNames = selectedContacts
    .map((id) => CONTACTS.find((c) => c.id === id)?.name)
    .filter(Boolean)
    .join(", ")

  const selectedProjectName = projects.find((p) => p.id === selectedProject)?.name

  const typeLabels: Record<MessageType, string> = {
    none: "Type",
    progress: "Progress",
    problem: "Problem",
    feedback: "Feedback",
    decision: "Decision",
  }

  return (
    <div className={cn(
      "h-full flex flex-col bg-background overflow-hidden",
      mode === "sheet" ? "rounded-t-3xl" : ""
    )}>
      {/* Handle — only in sheet mode */}
      {mode === "sheet" && (
        <div className="w-10 h-1 rounded-full bg-white/20 mx-auto mt-3 mb-1 shrink-0" />
      )}
      {/* Header */}
      <div className="shrink-0 px-4 py-3 flex items-center justify-between border-b border-white/10">
        <h1 className="text-base font-bold">
          New <span className="text-primary">Message</span>
        </h1>
        <button
          onClick={onCancel}
          className="w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center"
        >
          <X className="w-4 h-4 text-muted-foreground" />
        </button>
      </div>

      {/* Scrollable area — only icon + textarea, so Send never scrolls away */}
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-4 p-4 scrollbar-hide">
        {/* Icon */}
        <div className="flex flex-col items-center gap-3 py-2">
          <div className="w-16 h-16 rounded-full bg-white/5 border border-white/10 flex items-center justify-center animate-float">
            <span className="text-3xl">{"🤔"}</span>
          </div>
          <span className="text-sm text-muted-foreground font-light">
            {"What's on your mind?"}
          </span>
        </div>

        {/* Textarea Card */}
        <div className="bg-card border border-white/10 rounded-2xl p-4 min-h-40 flex flex-col">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="flex-1 min-h-30 bg-transparent border-none outline-none resize-none text-sm font-light text-foreground/90 leading-relaxed placeholder:text-muted-foreground"
            placeholder={"Type your message...\n\nContext is optional.\nSend first, tag later."}
          />
        </div>
      </div>

      {/* Pickers — sit between textarea and chips, above keyboard */}
      {showContacts && (
        <div className="shrink-0 px-4 pb-2 animate-fade-up">
          <PickerCard title="Select contacts" onClose={() => setShowContacts(false)}>
            <div className="flex flex-wrap gap-2">
              {CONTACTS.map((contact) => (
                <ContactChip
                  key={contact.id}
                  contact={contact}
                  selected={selectedContacts.includes(contact.id)}
                  onClick={() => toggleContact(contact.id)}
                />
              ))}
            </div>
          </PickerCard>
        </div>
      )}
      {showTypes && (
        <div className="shrink-0 px-4 pb-2 animate-fade-up">
          <PickerCard title="Message type" onClose={() => setShowTypes(false)}>
            <div className="flex flex-wrap gap-2">
              {(["progress", "problem", "feedback", "decision"] as MessageType[]).map((type) => (
                <TypeChip
                  key={type}
                  type={type}
                  selected={selectedType === type}
                  onClick={() => {
                    setSelectedType(type)
                    setShowTypes(false)
                  }}
                />
              ))}
            </div>
          </PickerCard>
        </div>
      )}
      {showProjects && (
        <div className="shrink-0 px-4 pb-2 animate-fade-up">
          <PickerCard title="Assign to project" onClose={() => { setShowProjects(false); setShowNewProjectInput(false); setNewProjectName("") }}>
            <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
              {projects.map((project) => (
                <ProjectRow
                  key={project.id}
                  project={project}
                  selected={selectedProject === project.id}
                  onClick={() => {
                    setSelectedProject(project.id)
                    setShowProjects(false)
                  }}
                />
              ))}
              {projects.length === 0 && !showNewProjectInput && (
                <p className="text-xs text-muted-foreground px-1 py-2">No projects yet. Create one below.</p>
              )}
            </div>
            {showNewProjectInput ? (
              <div className="flex gap-2 mt-3">
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
                      setShowProjects(false)
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
                    setShowProjects(false)
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
                className="mt-3 w-full text-xs font-semibold text-primary/70 border border-dashed border-primary/25 rounded-xl py-2.5 active:bg-primary/5 transition-colors"
              >
                + New project
              </button>
            )}
          </PickerCard>
        </div>
      )}

      {/* Option Chips — always visible above send button */}
      <div className="shrink-0 px-4 pt-2 pb-1 flex gap-2 flex-wrap border-t border-white/5">
        <OptionChip
          icon={<User className="w-3.5 h-3.5" />}
          active={selectedContacts.length > 0}
          onClick={() => { setShowContacts(!showContacts); setShowTypes(false); setShowProjects(false) }}
        >
          {selectedContacts.length > 0 ? selectedContactNames : "+ Who"}
        </OptionChip>
        <OptionChip
          icon={<Tag className="w-3.5 h-3.5" />}
          active={selectedType !== "none"}
          onClick={() => { setShowTypes(!showTypes); setShowContacts(false); setShowProjects(false) }}
        >
          {typeLabels[selectedType]}
        </OptionChip>
        <OptionChip
          icon={<Building className="w-3.5 h-3.5" />}
          active={!!selectedProject}
          onClick={() => { setShowProjects(!showProjects); setShowContacts(false); setShowTypes(false) }}
        >
          {selectedProjectName || "Project"}
        </OptionChip>
      </div>

      {/* Bottom Action Bar */}
      <div className="flex-shrink-0 border-t border-white/10 bg-[#0d1c35] px-4 py-4 safe-area-pb">
        <div className="flex justify-between items-center gap-4">
          <span className="text-xs text-muted-foreground font-light">
            {text.length > 0 ? `${text.length} chars` : "Context optional"}
          </span>
          <button
            type="button"
            onClick={handleSend}
            disabled={!text.trim()}
            className={cn(
              "rounded-full px-6 py-3 text-sm font-semibold tracking-wide transition-all",
              text.trim()
                ? "bg-primary text-white shadow-[0_4px_14px_rgba(37,99,235,0.4)] active:scale-95"
                : "bg-white/10 text-muted-foreground"
            )}
          >
            {"Send →"}
          </button>
        </div>
      </div>
    </div>
  )
}

function OptionChip({
  children,
  icon,
  active,
  onClick,
}: {
  children: React.ReactNode
  icon?: React.ReactNode
  active?: boolean
  onClick?: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "text-xs font-semibold px-3 py-1.5 rounded-full border flex items-center gap-1.5 transition-all active:scale-95",
        active
          ? "bg-primary/15 border-primary/30 text-primary"
          : "border-dashed border-white/15 text-muted-foreground"
      )}
    >
      {icon}
      <span className="max-w-[120px] truncate">{children}</span>
    </button>
  )
}

function PickerCard({
  title,
  children,
  onClose,
}: {
  title: string
  children: React.ReactNode
  onClose: () => void
}) {
  return (
    <div className="bg-[#0d1c35] border border-white/10 rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-xs font-bold tracking-[1.5px] uppercase text-muted-foreground">
          {title}
        </h4>
        <button
          onClick={onClose}
          className="w-6 h-6 rounded-full bg-white/5 flex items-center justify-center"
        >
          <X className="w-3 h-3 text-muted-foreground" />
        </button>
      </div>
      {children}
    </div>
  )
}

function ContactChip({
  contact,
  selected,
  onClick,
}: {
  contact: Contact
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 px-3 py-1.5 rounded-full border transition-all",
        selected
          ? "bg-primary/15 border-primary/30"
          : "bg-white/5 border-white/10"
      )}
    >
      <div
        className={cn(
          "w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white",
          contact.color
        )}
      >
        {contact.initials}
      </div>
      <span
        className={cn(
          "text-xs font-semibold",
          selected ? "text-primary" : "text-foreground/90"
        )}
      >
        {contact.name}
      </span>
      {selected && <Check className="w-3 h-3 text-primary" />}
    </button>
  )
}

function TypeChip({
  type,
  selected,
  onClick,
}: {
  type: MessageType
  selected: boolean
  onClick: () => void
}) {
  const styles: Record<string, { bg: string; text: string; border: string }> = {
    progress: { bg: "bg-progress/10", text: "text-progress", border: "border-progress/25" },
    problem: { bg: "bg-problem/10", text: "text-problem", border: "border-problem/25" },
    feedback: { bg: "bg-feedback/10", text: "text-feedback", border: "border-feedback/25" },
    decision: { bg: "bg-decision/10", text: "text-decision", border: "border-decision/25" },
  }

  const style = styles[type]

  return (
    <button
      onClick={onClick}
      className={cn(
        "px-4 py-2 rounded-xl text-xs font-bold tracking-wide uppercase font-mono transition-all border",
        selected
          ? cn(style.bg, style.text, style.border)
          : "bg-white/5 border-white/10 text-muted-foreground"
      )}
    >
      {type}
    </button>
  )
}

function ProjectRow({
  project,
  selected,
  onClick,
}: {
  project: Project
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors",
        selected ? "bg-primary/15" : "active:bg-white/5"
      )}
    >
      <div className={cn("w-2 h-2 rounded-full flex-shrink-0", project.color)} />
      <span
        className={cn(
          "text-sm font-semibold flex-1 text-left",
          selected ? "text-primary" : "text-foreground/90"
        )}
      >
        {project.name}
      </span>
      {selected && <Check className="w-4 h-4 text-primary" />}
    </button>
  )
}
