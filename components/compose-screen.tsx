"use client"

import { useEffect, useRef, useState } from "react"
import { X, User, Tag, Building, Check, Image as ImageIcon, Trash2, Search } from "lucide-react"
import { cn, haptic } from "@/lib/utils"
import { useSwipeDismiss } from "@/hooks/use-swipe-dismiss"
import {
  type MessageType,
  type MessageDraft,
  type Contact,
  type Project,
  MESSAGE_TYPE_CONFIG,
} from "@/lib/store"
import { CreateProjectModal } from "@/components/create-project-modal"

interface ComposeScreenProps {
  onCancel: () => void
  onSend: (draft: MessageDraft) => Promise<void>
  projects: Project[]
  onCreateProject: (name: string, memberIds?: string[]) => Promise<Project>
  mode?: "fullscreen" | "sheet"
  contacts: Contact[]
  initialProjectId?: string | null
}

export function ComposeScreen({ onCancel, onSend, projects, onCreateProject, mode = "sheet", contacts, initialProjectId }: ComposeScreenProps) {
  const { handlers: swipeHandlers, dragStyle } = useSwipeDismiss(onCancel)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const firstFocusRef = useRef(true)
  const [text, setText] = useState("")
  const [selectedContacts, setSelectedContacts] = useState<string[]>([])
  const [selectedProjects, setSelectedProjects] = useState<string[]>(initialProjectId ? [initialProjectId] : [])
  const [selectedType, setSelectedType] = useState<MessageType>("none")
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [showContacts, setShowContacts] = useState(false)
  const [showProjects, setShowProjects] = useState(false)
  const [showTypes, setShowTypes] = useState(false)
  const [showCreateProject, setShowCreateProject] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [contactSearch, setContactSearch] = useState("")
  const [projectSearch, setProjectSearch] = useState("")

  useEffect(() => {
    return () => {
      if (imagePreview) URL.revokeObjectURL(imagePreview)
    }
  }, [imagePreview])

  const toggleContact = (id: string) => {
    setSelectedContacts((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    )
  }

  const toggleProject = (id: string) => {
    setSelectedProjects((prev) =>
      prev.includes(id) ? prev.filter((projectId) => projectId !== id) : [...prev, id]
    )
  }

  const handlePickImage = (file: File | null) => {
    if (!file) return
    setImageFile(file)
    setImagePreview((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return URL.createObjectURL(file)
    })
  }

  const clearImage = () => {
    if (imagePreview) URL.revokeObjectURL(imagePreview)
    setImageFile(null)
    setImagePreview(null)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  const handleSend = async () => {
    if ((!text.trim() && !imageFile) || isSending) return
    haptic.success()
    setIsSending(true)
    try {
      await onSend({
        text: text.trim(),
        contactIds: selectedContacts,
        projectIds: selectedProjects,
        type: selectedType,
        imageFile,
      })
      clearImage()
    } finally {
      setIsSending(false)
    }
  }

  const selectedContactNames = selectedContacts
    .map((id) => contacts.find((c) => c.id === id)?.name)
    .filter(Boolean)
    .join(", ")

  const selectedProjectNames = selectedProjects
    .map((id) => projects.find((p) => p.id === id)?.name)
    .filter(Boolean)
    .join(", ")

  const filteredContacts = contacts.filter((contact) =>
    contact.name.toLowerCase().includes(contactSearch.trim().toLowerCase())
  )

  const filteredProjects = projects.filter((project) =>
    project.name.toLowerCase().includes(projectSearch.trim().toLowerCase())
  )

  const typeLabels: Record<MessageType, string> = {
    none: "Type",
    progress: "Progress",
    problem: "Problem",
    feedback: "Feedback",
    decision: "Decision",
  }

  const handleFirstFocus = () => {
    if (!firstFocusRef.current) return
    firstFocusRef.current = false
    const el = textareaRef.current
    if (el) {
      try {
        el.focus({ preventScroll: true })
      } catch {
        el.focus()
      }
    }
    window.scrollTo(0, 0)
  }

  return (
    <div
      style={mode === "sheet" ? dragStyle : undefined}
      className={cn(
        "h-full flex flex-col bg-background overflow-hidden",
        mode === "sheet" ? "rounded-t-3xl" : ""
      )}
    >
      {/* Handle — only in sheet mode */}
      {mode === "sheet" && (
        <div
          {...swipeHandlers}
          className="w-10 h-1 rounded-full bg-white/20 mx-auto mt-3 mb-1 shrink-0 cursor-grab active:cursor-grabbing touch-none"
        />
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
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-4 p-4 scrollbar-hide scroll-smooth">
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
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onFocus={handleFirstFocus}
            className="flex-1 min-h-30 bg-transparent border-none outline-none resize-none text-sm font-light text-foreground/90 leading-relaxed placeholder:text-muted-foreground"
            placeholder={"Type your message...\n\nContext is optional.\nSend first, tag later."}
          />
          {imagePreview && (
            <div className="relative mt-3 overflow-hidden rounded-xl border border-white/10 bg-black/20">
              <img src={imagePreview} alt="Attachment preview" className="max-h-56 w-full object-cover" />
              <button
                type="button"
                onClick={clearImage}
                className="absolute right-2 top-2 w-8 h-8 rounded-full bg-black/55 border border-white/15 flex items-center justify-center active:scale-95"
              >
                <Trash2 className="w-4 h-4 text-white" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Pickers — sit between textarea and chips, above keyboard */}
      {showContacts && (
        <div className="shrink-0 px-4 pb-2 animate-fade-up">
          <PickerCard title="Select contacts" onClose={() => setShowContacts(false)}>
            <SearchInput
              value={contactSearch}
              onChange={setContactSearch}
              placeholder="Search users"
            />
            <div className="flex flex-wrap gap-2">
              {filteredContacts.map((contact) => (
                <ContactChip
                  key={contact.id}
                  contact={contact}
                  selected={selectedContacts.includes(contact.id)}
                  onClick={() => toggleContact(contact.id)}
                />
              ))}
              {filteredContacts.length === 0 && (
                <p className="text-xs text-muted-foreground px-1 py-2">No users found.</p>
              )}
            </div>
          </PickerCard>
        </div>
      )}
      {showTypes && (
        <div className="shrink-0 px-4 pb-2 animate-fade-up">
          <PickerCard title="Message type" onClose={() => setShowTypes(false)}>
            <div className="flex flex-wrap gap-2">
              {(["progress", "problem", "feedback", "decision", "none"] as MessageType[]).map((type) => (
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
          <PickerCard title="Assign to project" onClose={() => setShowProjects(false)}>
            <SearchInput
              value={projectSearch}
              onChange={setProjectSearch}
              placeholder="Search projects/categories"
            />
            <div className="flex flex-col gap-1 max-h-[126px] overflow-y-auto scrollbar-hide">
              {filteredProjects.map((project) => (
                <ProjectRow
                  key={project.id}
                  project={project}
                  selected={selectedProjects.includes(project.id)}
                  onClick={() => toggleProject(project.id)}
                />
              ))}
              {projects.length === 0 && (
                <p className="text-xs text-muted-foreground px-1 py-2">No projects yet. Create one below.</p>
              )}
              {projects.length > 0 && filteredProjects.length === 0 && (
                <p className="text-xs text-muted-foreground px-1 py-2">No projects found.</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => { setShowProjects(false); setShowCreateProject(true) }}
              className="mt-3 w-full text-xs font-semibold text-primary/70 border border-dashed border-primary/25 rounded-xl py-2.5 active:bg-primary/5 transition-colors"
            >
              + New project
            </button>
          </PickerCard>
        </div>
      )}

      {/* Create Project modal — triggered from picker */}
      {showCreateProject && (
        <CreateProjectModal
          contacts={contacts}
          onClose={() => setShowCreateProject(false)}
          onSubmit={async (name, memberIds) => {
            const p = await onCreateProject(name, memberIds)
            setSelectedProjects((prev) => [...new Set([...prev, p.id])])
            setShowCreateProject(false)
          }}
        />
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
          active={selectedProjects.length > 0}
          onClick={() => { setShowProjects(!showProjects); setShowContacts(false); setShowTypes(false) }}
        >
          {selectedProjectNames || "Project"}
        </OptionChip>
        <OptionChip
          icon={<ImageIcon className="w-3.5 h-3.5" />}
          active={!!imageFile}
          onClick={() => fileInputRef.current?.click()}
        >
          {imageFile ? imageFile.name : "Image"}
        </OptionChip>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => handlePickImage(e.target.files?.[0] ?? null)}
        />
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
            disabled={(!text.trim() && !imageFile) || isSending}
            className={cn(
              "rounded-full px-6 py-3 text-sm font-semibold tracking-wide transition-all min-w-[90px] flex items-center justify-center gap-2",
              (text.trim() || imageFile) && !isSending
                ? "bg-primary text-white shadow-[0_4px_14px_rgba(37,99,235,0.4)] active:scale-95"
                : "bg-white/10 text-muted-foreground"
            )}
          >
            {isSending ? (
              <>
                <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                <span>Sending</span>
              </>
            ) : "Send →"}
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

function SearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
}) {
  return (
    <label className="mb-3 flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
      <Search className="w-4 h-4 text-muted-foreground" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
      />
    </label>
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
  const style = MESSAGE_TYPE_CONFIG[type]

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
      {style.label}
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
