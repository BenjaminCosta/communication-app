"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { X, User, Tag, Check, Image as ImageIcon, Trash2, Search } from "lucide-react"
import { cn, haptic } from "@/lib/utils"
import { useSwipeDismiss } from "@/hooks/use-swipe-dismiss"
import {
  type MessageType,
  type MessageDraft,
  type Contact,
  type Project,
  type Tag as MessageTag,
  MESSAGE_TYPE_CONFIG,
  parseProjectTagId,
  parseSystemTypeTagId,
  projectTagId,
  systemTypeTagId,
} from "@/lib/store"

interface ComposeScreenProps {
  onCancel: () => void
  onSend: (draft: MessageDraft) => Promise<void>
  projects: Project[]
  onCreateProject: (name: string, memberIds?: string[]) => Promise<Project>
  mode?: "fullscreen" | "sheet"
  contacts: Contact[]
  initialProjectId?: string | null
  availableTags?: MessageTag[]
}

export function ComposeScreen({ onCancel, onSend, projects, mode = "sheet", contacts, initialProjectId, availableTags }: ComposeScreenProps) {
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

  const [isSending, setIsSending] = useState(false)
  const [isSent, setIsSent] = useState(false)
  const [globalSearch, setGlobalSearch] = useState("")
  const [activeAssociation, setActiveAssociation] = useState<"who" | "tag" | null>(null)

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

  const selectedTagIds = useMemo(() => [
    ...(selectedType !== "none" ? [systemTypeTagId(selectedType)].filter(Boolean) as string[] : []),
    ...selectedProjects.map(projectTagId),
  ], [selectedProjects, selectedType])

  const displayTags = useMemo<MessageTag[]>(() => availableTags ?? [
    ...(["progress", "problem", "feedback", "decision"] as Exclude<MessageType, "none">[]).map((type) => ({
      id: systemTypeTagId(type) ?? type,
      name: MESSAGE_TYPE_CONFIG[type].label,
      category: "systemType" as const,
      color: MESSAGE_TYPE_CONFIG[type].text,
      systemType: type,
    })),
    ...projects.map((project) => ({
      id: projectTagId(project.id),
      name: project.name,
      category: "project" as const,
      color: project.color,
      projectId: project.id,
      isFavorited: project.isFavorited,
    })),
  ], [availableTags, projects])

  const toggleTag = (tagId: string) => {
    const systemType = parseSystemTypeTagId(tagId)
    if (systemType) {
      setSelectedType((prev) => prev === systemType ? "none" : systemType)
      return
    }
    const projectId = parseProjectTagId(tagId)
    if (projectId) toggleProject(projectId)
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
    setIsSent(true)
    try {
      await onSend({
        text: text.trim(),
        contactIds: selectedContacts,
        peopleIds: selectedContacts,
        projectIds: selectedProjects,
        tagIds: selectedTagIds,
        type: selectedType,
        imageFile,
      })
      clearImage()
    } finally {
      setIsSending(false)
    }
  }

  const selectedPeople = selectedContacts
    .map((id) => contacts.find((contact) => contact.id === id))
    .filter(Boolean) as Contact[]

  const selectedTags = selectedTagIds
    .map((id) => displayTags.find((tag) => tag.id === id))
    .filter(Boolean) as MessageTag[]

  const searchQuery = globalSearch.trim().toLowerCase()
  const searchPeople = searchQuery
    ? contacts
        .filter((contact) => contact.name.toLowerCase().includes(searchQuery))
        .slice(0, 4)
    : []
  const searchTags = searchQuery
    ? displayTags
        .filter((tag) => tag.name.toLowerCase().includes(searchQuery))
        .slice(0, 6)
    : []
  const hasSearchResults = searchQuery.length > 0 && (searchPeople.length > 0 || searchTags.length > 0)

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
      <div className="shrink-0 px-4 app-topbar flex items-center justify-between border-b border-white/10">
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

      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3 p-4 scrollbar-hide scroll-smooth">
        <div className="relative">
          <SearchInput
            value={globalSearch}
            onChange={setGlobalSearch}
            placeholder="Search people or tags"
          />
          {searchQuery && (
            <div className="absolute left-0 right-0 top-[calc(100%-6px)] z-20 rounded-2xl border border-white/10 bg-[#0d1c35] p-2 shadow-2xl animate-fade-up">
              {hasSearchResults ? (
                <div className="flex max-h-56 flex-col gap-1 overflow-y-auto scrollbar-hide">
                  {searchPeople.map((contact) => (
                    <SearchResultButton
                      key={contact.id}
                      label={contact.name}
                      typeLabel="Person"
                      selected={selectedContacts.includes(contact.id)}
                      icon={
                        <span className={cn("w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white", contact.color)}>
                          {contact.initials}
                        </span>
                      }
                      onClick={() => {
                        toggleContact(contact.id)
                        setGlobalSearch("")
                      }}
                    />
                  ))}
                  {searchTags.map((tag) => (
                    <SearchResultButton
                      key={tag.id}
                      label={tag.name}
                      typeLabel="Tag"
                      selected={selectedTagIds.includes(tag.id)}
                      icon={<span className={cn("w-2.5 h-2.5 rounded-full", tagDotClass(tag))} />}
                      onClick={() => {
                        toggleTag(tag.id)
                        setGlobalSearch("")
                      }}
                    />
                  ))}
                </div>
              ) : (
                <p className="px-2 py-3 text-xs text-muted-foreground">No people or tags found.</p>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-col items-center gap-3 py-1">
          <div className="w-16 h-16 rounded-full bg-white/5 border border-white/10 flex items-center justify-center animate-float">
            <span className="text-3xl">{"🤔"}</span>
          </div>
          <span className="text-sm text-muted-foreground font-light">
            {"What's on your mind?"}
          </span>
        </div>

        <div className="bg-card border border-white/10 rounded-2xl p-4 min-h-[150px] flex flex-col">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onFocus={handleFirstFocus}
            className="flex-1 min-h-28 bg-transparent border-none outline-none resize-none text-sm font-light text-foreground/90 leading-relaxed placeholder:text-muted-foreground"
            placeholder={"Type your message...\n\nContext is optional.\nSend first, tag later."}
          />
          {imagePreview && (
            <div className="relative mt-3 overflow-hidden rounded-xl border border-white/10 bg-black/20">
              <img src={imagePreview} alt="Attachment preview" className="max-h-44 w-full object-cover" />
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

        {(selectedPeople.length > 0 || selectedTags.length > 0) && (
          <div className="flex flex-wrap gap-1.5">
            {selectedPeople.map((contact) => (
              <SelectedChip key={contact.id} onRemove={() => toggleContact(contact.id)}>
                <User className="w-3 h-3" />
                {contact.name}
              </SelectedChip>
            ))}
            {selectedTags.map((tag) => (
              <SelectedChip key={tag.id} onRemove={() => toggleTag(tag.id)}>
                <Tag className="w-3 h-3" />
                {tag.name}
              </SelectedChip>
            ))}
          </div>
        )}

        {activeAssociation && (
          <div className="rounded-3xl border border-white/10 bg-[#0d1c35] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] animate-fade-up">
            {activeAssociation === "who" ? (
              <div className="max-h-52 overflow-y-auto scrollbar-hide">
                <div className="flex flex-wrap gap-2">
                  {contacts.map((contact) => (
                    <PersonCard
                      key={contact.id}
                      contact={contact}
                      selected={selectedContacts.includes(contact.id)}
                      onClick={() => toggleContact(contact.id)}
                    />
                  ))}
                  {contacts.length === 0 && (
                    <p className="px-2 py-8 text-center text-xs text-muted-foreground">No people available yet.</p>
                  )}
                </div>
              </div>
            ) : (
              <div className="max-h-52 overflow-y-auto pr-1 scrollbar-hide">
                <div className="grid grid-cols-2 gap-2">
                  {displayTags.map((tag, index) => (
                    <TagCard
                      key={tag.id}
                      tag={tag}
                      selected={selectedTagIds.includes(tag.id)}
                      onClick={() => toggleTag(tag.id)}
                      offset={index % 3 === 1}
                    />
                  ))}
                  {displayTags.length === 0 && (
                    <p className="col-span-2 px-2 py-8 text-center text-xs text-muted-foreground">No tags available yet.</p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => handlePickImage(e.target.files?.[0] ?? null)}
        />
      </div>

      <div className="flex-shrink-0 border-t border-white/10 bg-background px-4 py-3">
        <div className="flex gap-2 flex-wrap">
          <OptionChip
            icon={<User className="w-3.5 h-3.5" />}
            active={activeAssociation === "who" || selectedContacts.length > 0}
            onClick={() => setActiveAssociation((current) => current === "who" ? null : "who")}
          >
            {selectedContacts.length > 0 ? `${selectedContacts.length} Who` : "+ Who"}
          </OptionChip>
          <OptionChip
            icon={<Tag className="w-3.5 h-3.5" />}
            active={activeAssociation === "tag" || selectedTagIds.length > 0}
            onClick={() => setActiveAssociation((current) => current === "tag" ? null : "tag")}
          >
            {selectedTagIds.length > 0 ? `${selectedTagIds.length} Tags` : "Tag"}
          </OptionChip>
          <OptionChip
            icon={<ImageIcon className="w-3.5 h-3.5" />}
            active={!!imageFile}
            onClick={() => fileInputRef.current?.click()}
          >
            {imageFile ? imageFile.name : "Image"}
          </OptionChip>
        </div>
      </div>

      {/* Bottom Action Bar */}
      <div className="flex-shrink-0 bg-[#0d1c35] px-4 py-4 safe-area-pb">
        <div className="flex justify-between items-center gap-4">
          <span className="text-xs text-muted-foreground font-light">
            {text.length > 0 ? `${text.length} chars` : "Context optional"}
          </span>
          <button
            type="button"
            onClick={handleSend}
            disabled={(!text.trim() && !imageFile) || isSending || isSent}
            className={cn(
              "rounded-full px-6 py-3 text-sm font-semibold tracking-wide transition-colors min-w-[90px] flex items-center justify-center gap-2",
              isSent
                ? "bg-progress text-white shadow-[0_4px_14px_rgba(34,197,94,0.45)] animate-sent-pop"
                : (text.trim() || imageFile) && !isSending
                  ? "bg-primary text-white shadow-[0_4px_14px_rgba(37,99,235,0.4)] active:scale-95"
                  : "bg-white/10 text-muted-foreground"
            )}
          >
            {isSent ? (
              <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none">
                <path
                  d="M3 8.5L6.5 12L13 4.5"
                  stroke="white"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="animate-check-draw"
                />
              </svg>
            ) : isSending ? (
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

function SearchInput({
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

function PersonCard({
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
        "flex min-w-[calc(50%-0.25rem)] flex-1 items-center gap-2 rounded-2xl border px-3 py-2.5 text-left transition-all active:scale-[0.98]",
        selected
          ? "border-primary/35 bg-primary/15 text-primary"
          : "border-white/10 bg-white/[0.045] text-foreground/90 active:bg-white/8"
      )}
    >
      <span className={cn("w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0", contact.color)}>
        {contact.initials}
      </span>
      <span className="min-w-0 flex-1 truncate text-xs font-bold">{contact.name}</span>
      {selected && <Check className="w-4 h-4 shrink-0" />}
    </button>
  )
}

function SearchResultButton({
  label,
  typeLabel,
  icon,
  selected,
  onClick,
}: {
  label: string
  typeLabel: "Person" | "Tag"
  icon: React.ReactNode
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all active:scale-[0.99]",
        selected
          ? "bg-primary/15 text-primary"
          : "text-foreground/90 active:bg-white/5"
      )}
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{label}</span>
        <span className="text-[10px] font-bold uppercase tracking-[1.4px] text-muted-foreground font-mono">{typeLabel}</span>
      </span>
      {selected && <Check className="w-4 h-4 shrink-0 text-primary" />}
    </button>
  )
}

function SelectedChip({ children, onRemove }: { children: React.ReactNode; onRemove: () => void }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-primary/25 bg-primary/12 px-2.5 py-1 text-[11px] font-semibold text-primary">
      <span className="inline-flex min-w-0 items-center gap-1 truncate">{children}</span>
      <button type="button" onClick={onRemove} className="shrink-0 rounded-full active:scale-90">
        <X className="w-3 h-3" />
      </button>
    </span>
  )
}

function TagCard({
  tag,
  selected,
  onClick,
  offset,
}: {
  tag: MessageTag
  selected: boolean
  onClick: () => void
  offset?: boolean
}) {
  const systemStyle = tag.systemType ? MESSAGE_TYPE_CONFIG[tag.systemType] : null
  return (
    <button
      onClick={onClick}
      className={cn(
        "min-h-10 rounded-2xl border px-3 py-1.5 text-left transition-all active:scale-[0.98]",
        offset && "translate-y-0.5",
        selected
          ? tag.systemType && systemStyle
            ? cn(systemStyle.bg, systemStyle.text, systemStyle.border, "ring-1 ring-current/20")
            : "border-primary/35 bg-primary/15 text-primary"
          : "border-white/10 bg-white/[0.045] text-foreground/90 active:bg-white/8"
      )}
    >
      <span className="flex items-center gap-2">
        <span className={cn("h-2 w-2 shrink-0 rounded-full", tagDotClass(tag))} />
        <span className="min-w-0 flex-1">
          <span className="line-clamp-1 text-xs font-bold leading-snug">{tag.name}</span>
        </span>
        {selected && <Check className="h-4 w-4 shrink-0" />}
      </span>
    </button>
  )
}

function tagDotClass(tag: MessageTag): string {
  if (tag.systemType === "progress") return "bg-progress"
  if (tag.systemType === "problem") return "bg-problem"
  if (tag.systemType === "feedback") return "bg-feedback"
  if (tag.systemType === "decision") return "bg-decision"
  return tag.color || "bg-primary"
}
