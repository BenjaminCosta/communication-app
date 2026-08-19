"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { X, User, Tag, Check, Image as ImageIcon, Trash2, Search, CalendarDays, Hash, Plus, Loader2, FileText } from "lucide-react"
import { HelpTooltip } from "@/components/help-tooltip"
import { cn, haptic } from "@/lib/utils"
import { validateImageFile } from "@/lib/image-upload"
import { formatCalendarDateLabel } from "@/lib/datetime"
import { useSwipeDismiss } from "@/hooks/use-swipe-dismiss"
import {
  type MessageType,
  type MessageDraft,
  type Contact,
  type Project,
  type Tag as MessageTag,
  type ImportedContact,
  type TagCategory,
  type AppContext,
  type MessageFileAttachment,
  messageAttachmentKindLabel,
  MESSAGE_TYPE_CONFIG,
  parseProjectTagId,
  parseSystemTypeTagId,
  projectTagId,
  systemTypeTagId,
  isCategoryTimeBased,
} from "@/lib/store"
import { DatePickerModal } from "@/components/date-picker-modal"
import { ModuleSwitcher } from "@/components/module-switcher"

interface ComposeScreenProps {
  onCancel: () => void
  onSend: (draft: MessageDraft) => Promise<void>
  projects: Project[]
  onCreateProject: (name: string, memberIds?: string[], category?: TagCategory) => Promise<Project>
  mode?: "fullscreen" | "sheet"
  contacts: Contact[]
  importedContacts?: ImportedContact[]
  initialProjectId?: string | null
  initialText?: string
  initialContextIds?: string[]
  /** Pre-uploaded file attachment (e.g. outlook PDF) to send with the message */
  initialAttachment?: MessageFileAttachment | null
  /** Pre-selected calendar dates (from Calendar screen "Add" flow) */
  initialCalendarDates?: string[]
  availableTags?: MessageTag[]
  contexts?: AppContext[]
  onCreateContext?: (name: string) => Promise<AppContext>
  isContactsLoading?: boolean
  isContextsLoading?: boolean
  onDirectory?: () => void
  onApplications?: () => void
  onQuestCoral?: () => void
  onByeByeDpr?: () => void
  onCourtneyRobertsCenter?: () => void
}

// Max items shown in browse panels before requiring search
const MAX_PANEL_ITEMS = 30

export function ComposeScreen({ onCancel, onSend, projects, onCreateProject, mode = "sheet", contacts, importedContacts = [], initialProjectId, initialText = "", initialContextIds = [], initialAttachment = null, initialCalendarDates, availableTags, contexts = [], onCreateContext, isContactsLoading = false, isContextsLoading = false, onDirectory, onApplications, onQuestCoral, onByeByeDpr, onCourtneyRobertsCenter }: ComposeScreenProps) {
  const { handlers: swipeHandlers, dragStyle } = useSwipeDismiss(onCancel)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const firstFocusRef = useRef(true)
  const associationPanelRef = useRef<HTMLDivElement>(null)
  const optionBarRef = useRef<HTMLDivElement>(null)
  const [text, setText] = useState(initialText)
  const [selectedContacts, setSelectedContacts] = useState<string[]>([])
  const [selectedImportedContacts, setSelectedImportedContacts] = useState<string[]>([])
  const [selectedProjects, setSelectedProjects] = useState<string[]>(initialProjectId ? [initialProjectId] : [])
  const [selectedType, setSelectedType] = useState<MessageType>("none")
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [attachment, setAttachment] = useState<MessageFileAttachment | null>(initialAttachment)
  const [imageError, setImageError] = useState<string | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [isSending, setIsSending] = useState(false)
  const [isSent, setIsSent] = useState(false)
  const [globalSearch, setGlobalSearch] = useState("")
  const [activeAssociation, setActiveAssociation] = useState<"who" | "tag" | "context" | null>(null)
  const [quickCreateKind, setQuickCreateKind] = useState<"tag" | "context" | null>(null)
  const [quickCreateName, setQuickCreateName] = useState("")
  const [isQuickCreating, setIsQuickCreating] = useState(false)
  const [quickCreateError, setQuickCreateError] = useState<string | null>(null)
  const [associationPanelMaxHeight, setAssociationPanelMaxHeight] = useState<number | null>(null)
  // Calendar dates: "YYYY-MM-DD" strings
  const [selectedCalendarDates, setSelectedCalendarDates] = useState<string[]>(initialCalendarDates ?? [])
  const [showDatePicker, setShowDatePicker] = useState(false)
  // Contexts
  const [selectedContextIds, setSelectedContextIds] = useState<string[]>(initialContextIds)

  useEffect(() => {
    return () => {
      if (imagePreview) URL.revokeObjectURL(imagePreview)
    }
  }, [imagePreview])

  useEffect(() => {
    if (!activeAssociation) {
      setAssociationPanelMaxHeight(null)
      return
    }

    let frame = 0
    const updatePanelHeight = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const panel = associationPanelRef.current
        const optionBar = optionBarRef.current
        if (!panel || !optionBar) return
        const panelTop = panel.getBoundingClientRect().top
        const optionTop = optionBar.getBoundingClientRect().top
        const available = Math.floor(optionTop - panelTop - 12)
        // Floor kept low (96) so under heavy Android zoom the panel never
        // exceeds the visible space above the option bar — otherwise its
        // bottom (and the chips inside) hides behind the bar and, due to the
        // inner overscroll-contain, can't be scrolled into view.
        setAssociationPanelMaxHeight(Math.max(96, Math.min(available, 520)))
      })
    }

    updatePanelHeight()
    window.addEventListener("resize", updatePanelHeight)
    window.visualViewport?.addEventListener("resize", updatePanelHeight)
    window.visualViewport?.addEventListener("scroll", updatePanelHeight)

    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener("resize", updatePanelHeight)
      window.visualViewport?.removeEventListener("resize", updatePanelHeight)
      window.visualViewport?.removeEventListener("scroll", updatePanelHeight)
    }
  }, [
    activeAssociation,
    quickCreateKind,
    selectedContacts.length,
    selectedImportedContacts.length,
    selectedProjects.length,
    selectedCalendarDates.length,
    selectedContextIds.length,
    imagePreview,
    sendError,
  ])

  // When an association panel (Who / Tag / Context) opens, scroll it into view
  // so its options are visible even under heavy zoom, where it would otherwise
  // open below the fold and behind the option bar.
  useEffect(() => {
    if (!activeAssociation) return
    const id = requestAnimationFrame(() => {
      associationPanelRef.current?.scrollIntoView({ block: "nearest" })
    })
    return () => cancelAnimationFrame(id)
  }, [activeAssociation])

  const toggleContact = (id: string) => {
    setSelectedContacts((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    )
  }

  const toggleImportedContact = (id: string) => {
    setSelectedImportedContacts((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    )
  }

  const toggleProject = (id: string) => {
    setSelectedProjects((prev) =>
      prev.includes(id) ? prev.filter((projectId) => projectId !== id) : [...prev, id]
    )
  }

  const selectedTagIds = useMemo(() => [
    ...(selectedType !== "none" ? [systemTypeTagId(selectedType)] : []),
    ...selectedProjects.map(projectTagId),
  ], [selectedProjects, selectedType])

  const displayTags = useMemo<MessageTag[]>(() => {
    const tags = availableTags ?? [
      ...(["progress", "problem", "feedback", "decision", "red_team_review"] as Exclude<MessageType, "none">[]).map((type) => ({
        id: systemTypeTagId(type),
        name: MESSAGE_TYPE_CONFIG[type].label,
        category: "systemType" as const,
        color: MESSAGE_TYPE_CONFIG[type].text,
        systemType: type,
      })),
      ...projects.map((project) => ({
        id: projectTagId(project.id),
        name: project.name,
        category: (project.tagCategory ?? "custom") as TagCategory,
        color: project.color,
        projectId: project.id,
        isFavorited: project.isFavorited,
      })),
    ]
    return tags.filter((tag) => tag.id !== systemTypeTagId("none"))
  }, [availableTags, projects])

  const toggleTag = (tagId: string) => {
    const systemType = parseSystemTypeTagId(tagId)
    if (systemType) {
      setSelectedType((prev) => prev === systemType ? "none" : systemType)
      return
    }
    if (tagId === systemTypeTagId("none")) {
      setSelectedType("none")
      return
    }
    const projectId = parseProjectTagId(tagId)
    if (projectId) {
      const isCurrentlySelected = selectedProjects.includes(projectId)
      toggleProject(projectId)
      // If selecting (not deselecting) a timedate-category tag, open date picker
      if (!isCurrentlySelected) {
        const tag = displayTags.find((t) => t.id === tagId)
        if (isCategoryTimeBased(tag?.category ?? "")) {
          setShowDatePicker(true)
        }
      }
    }
  }

  const startQuickCreate = (kind: "tag" | "context") => {
    setActiveAssociation(kind)
    setQuickCreateKind((current) => current === kind ? null : kind)
    setQuickCreateName(globalSearch.trim())
    setQuickCreateError(null)
  }

  const cancelQuickCreate = () => {
    setQuickCreateKind(null)
    setQuickCreateName("")
    setQuickCreateError(null)
  }

  const handleQuickCreate = async () => {
    const name = quickCreateName.trim()
    if (!name || !quickCreateKind || isQuickCreating) return
    setIsQuickCreating(true)
    setQuickCreateError(null)
    try {
      if (quickCreateKind === "tag") {
        const project = await onCreateProject(name, [], "custom")
        setSelectedProjects((prev) => prev.includes(project.id) ? prev : [...prev, project.id])
      } else if (onCreateContext) {
        const context = await onCreateContext(name)
        setSelectedContextIds((prev) => prev.includes(context.id) ? prev : [...prev, context.id])
      } else {
        throw new Error("Context creation is not available here.")
      }
      haptic.success()
      setGlobalSearch("")
      cancelQuickCreate()
    } catch {
      setQuickCreateError(`Could not create ${quickCreateKind}. Please try again.`)
    } finally {
      setIsQuickCreating(false)
    }
  }

  const handlePickImage = (file: File | null) => {
    setSendError(null)
    const validationError = validateImageFile(file)
    if (validationError) {
      setImageError(validationError)
      if (fileInputRef.current) fileInputRef.current.value = ""
      return
    }
    if (!file) return
    setImageError(null)
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
    setImageError(null)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  const handleSend = async () => {
    if ((!text.trim() && !imageFile && !attachment) || isSending) return
    haptic.success()
    setIsSending(true)
    setIsSent(true)
    setSendError(null)
    try {
      await onSend({
        text: text.trim(),
        contactIds: selectedContacts,
        peopleIds: selectedContacts,
        importedContactIds: selectedImportedContacts,
        projectIds: selectedProjects,
        tagIds: selectedTagIds,
        type: selectedType,
        imageFile,
        attachment,
        calendarDates: selectedCalendarDates.length > 0 ? selectedCalendarDates : undefined,
        contextIds: selectedContextIds.length > 0 ? selectedContextIds : undefined,
      })
      clearImage()
      setAttachment(null)
    } catch {
      setIsSent(false)
      setSendError("Could not send the message. Please try again.")
    } finally {
      setIsSending(false)
    }
  }

  const selectedPeople = selectedContacts
    .map((id) => contacts.find((contact) => contact.id === id))
    .filter(Boolean) as Contact[]

  const selectedImportedPeople = selectedImportedContacts
    .map((id) => importedContacts.find((c) => c.id === id))
    .filter(Boolean) as ImportedContact[]

  const selectedTags = selectedTagIds
    .map((id) => displayTags.find((tag) => tag.id === id))
    .filter(Boolean) as MessageTag[]

  const searchQuery = useMemo(() => globalSearch.trim().toLowerCase(), [globalSearch])
  const searchPeople = useMemo(() =>
    searchQuery ? contacts.filter((c) => c.name.toLowerCase().includes(searchQuery)).slice(0, 4) : [],
    [contacts, searchQuery]
  )
  const searchImported = useMemo(() =>
    searchQuery
      ? importedContacts
          .filter((c) => c.status === "not_registered" &&
            (c.name.toLowerCase().includes(searchQuery) || (c.email ?? "").toLowerCase().includes(searchQuery)))
          .slice(0, 3)
      : [],
    [importedContacts, searchQuery]
  )
  const searchTags = useMemo(() =>
    searchQuery ? displayTags.filter((t) => t.name.toLowerCase().includes(searchQuery)).slice(0, 6) : [],
    [displayTags, searchQuery]
  )
  const searchContexts = useMemo(() =>
    searchQuery ? contexts.filter((ctx) => ctx.name.toLowerCase().includes(searchQuery)).slice(0, 4) : [],
    [contexts, searchQuery]
  )
  const hasSearchResults = searchQuery.length > 0 && (
    searchPeople.length > 0 ||
    searchTags.length > 0 ||
    searchImported.length > 0 ||
    searchContexts.length > 0
  )

  // Sliced lists for browse panels — avoids rendering thousands of DOM nodes at once
  const notRegisteredContacts = useMemo(
    () => importedContacts.filter((c) => c.status === "not_registered"),
    [importedContacts]
  )
  const panelImported = useMemo(() => notRegisteredContacts.slice(0, MAX_PANEL_ITEMS), [notRegisteredContacts])
  const panelContexts = useMemo(() => contexts.slice(0, MAX_PANEL_ITEMS), [contexts])

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
        "stream-glass-screen h-full flex flex-col overflow-hidden",
        mode === "sheet" ? "rounded-t-3xl" : ""
      )}
    >
      {/* Handle — only in sheet mode */}
      {mode === "sheet" && (
        <div
          {...swipeHandlers}
          className="w-10 h-1 rounded-full bg-white/25 mx-auto mt-3 mb-1 shrink-0 cursor-grab active:cursor-grabbing touch-none shadow-[0_1px_10px_rgba(255,255,255,0.12)]"
        />
      )}
      {/* Header */}
      <div className="glass-panel shrink-0 px-3 app-topbar flex items-center justify-between border-b">
        <ModuleSwitcher
          activeModule="communications"
          showCourtneyRobertsCenter={Boolean(onCourtneyRobertsCenter)}
          onSelect={(module) => {
            if (module === "directory") onDirectory?.()
            if (module === "applications") onApplications?.()
            if (module === "quest-coral") onQuestCoral?.()
            if (module === "bye-bye-dpr") onByeByeDpr?.()
            if (module === "courtney-roberts-center") onCourtneyRobertsCenter?.()
          }}
        />
        <button
          onClick={onCancel}
          className="glass-button w-8 h-8 rounded-full border flex items-center justify-center active:scale-[0.98] transition-all duration-150"
        >
          <X className="w-4 h-4 text-white/75" />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2.5 p-3 scrollbar-hide scroll-smooth">
        <div className="relative">
          <SearchInput
            value={globalSearch}
            onChange={setGlobalSearch}
            placeholder="Search people, tags or contexts"
          />
          {searchQuery && (
            <div className="glass-panel absolute left-0 right-0 top-[calc(100%-6px)] z-20 rounded-2xl border p-2 animate-fade-up">
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
                  {searchImported.map((c) => (
                    <SearchResultButton
                      key={c.id}
                      label={c.name}
                      typeLabel="Not registered"
                      selected={selectedImportedContacts.includes(c.id)}
                      icon={
                        <span className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white/50 bg-white/10 border border-white/15">
                          {(c.name.match(/\b\w/g) ?? []).slice(0, 2).join("").toUpperCase() || "?"}
                        </span>
                      }
                      onClick={() => {
                        toggleImportedContact(c.id)
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
                  {searchContexts.map((ctx) => (
                    <SearchResultButton
                      key={ctx.id}
                      label={ctx.name}
                      typeLabel="Context"
                      selected={selectedContextIds.includes(ctx.id)}
                      icon={<Hash className="w-4 h-4 text-emerald-400" />}
                      onClick={() => {
                        setSelectedContextIds((prev) =>
                          prev.includes(ctx.id) ? prev.filter((id) => id !== ctx.id) : [...prev, ctx.id]
                        )
                        setGlobalSearch("")
                      }}
                    />
                  ))}
                </div>
              ) : (
                <p className="px-2 py-3 text-xs text-muted-foreground">No results found. Try a different search.</p>
              )}
            </div>
          )}
        </div>

        <div className="-mt-0.5 flex flex-col items-center">
          <span className="text-[11px] text-muted-foreground/85 font-light leading-none">
            {"What's on your mind?"}
          </span>
        </div>

        <div className="glass-message border rounded-2xl p-3 min-h-[112px] flex flex-col">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onFocus={handleFirstFocus}
            className="flex-1 min-h-20 bg-transparent border-none outline-none resize-none text-sm font-light text-foreground/90 leading-relaxed placeholder:text-muted-foreground"
            placeholder="Type your message..."
          />
          {imagePreview && (
            <div className="relative mt-3 overflow-hidden rounded-xl border border-white/10 bg-black/20 shadow-[0_14px_34px_rgba(0,0,0,0.18)]">
              <img src={imagePreview} alt="Attachment preview" className="max-h-44 w-full object-cover" />
              <button
                type="button"
                onClick={clearImage}
                className="glass-button absolute right-2 top-2 w-8 h-8 rounded-full border flex items-center justify-center active:scale-[0.98]"
              >
                <Trash2 className="w-4 h-4 text-white" />
              </button>
            </div>
          )}
          {attachment && (
            <div className="relative mt-3 flex items-center gap-3 overflow-hidden rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-red-400/25 bg-red-400/10 text-red-300">
                <FileText className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground/90">{attachment.name}</span>
                <span className="block text-[10px] uppercase tracking-wide text-muted-foreground/60">{messageAttachmentKindLabel(attachment)} attachment</span>
              </span>
              <button
                type="button"
                onClick={() => setAttachment(null)}
                className="glass-button flex h-8 w-8 shrink-0 items-center justify-center rounded-full border active:scale-[0.98]"
                aria-label="Remove attachment"
              >
                <Trash2 className="h-4 w-4 text-white" />
              </button>
            </div>
          )}
          {imageError && (
            <p className="mt-3 rounded-xl border border-destructive/25 bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive">
              {imageError}
            </p>
          )}
        </div>

        {sendError && (
          <p className="rounded-xl border border-destructive/25 bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive">
            {sendError}
          </p>
        )}

        {(selectedPeople.length > 0 || selectedImportedPeople.length > 0 || selectedTags.length > 0 || selectedCalendarDates.length > 0 || selectedContextIds.length > 0) && (
          <div className="rounded-2xl border border-white/8 bg-white/[0.025] px-2 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.045)]">
            <div className="flex min-h-8 gap-1.5 overflow-x-auto scrollbar-hide">
              {selectedPeople.map((contact) => (
                <SelectedChip key={contact.id} onRemove={() => toggleContact(contact.id)}>
                  <User className="w-3 h-3" />
                  {contact.name}
                </SelectedChip>
              ))}
              {selectedImportedPeople.map((c) => (
                <SelectedChip key={c.id} onRemove={() => toggleImportedContact(c.id)}>
                  <User className="w-3 h-3 opacity-50" />
                  <span className="opacity-70">{c.name}</span>
                </SelectedChip>
              ))}
              {selectedTags.map((tag) => (
                <SelectedChip key={tag.id} onRemove={() => toggleTag(tag.id)}>
                  <Tag className="w-3 h-3" />
                  {tag.name}
                </SelectedChip>
              ))}
              {selectedCalendarDates.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowDatePicker(true)}
                  className="inline-flex h-8 max-w-[190px] shrink-0 items-center gap-1.5 rounded-full border border-sky-400/35 bg-sky-400/14 px-2.5 text-[11px] font-semibold text-sky-300 active:scale-[0.98] transition-transform backdrop-blur-md"
                >
                  <CalendarDays className="w-3 h-3 shrink-0" />
                  <span className="truncate">
                    {selectedCalendarDates.length === 1
                      ? formatDateChip(selectedCalendarDates[0])
                      : `${selectedCalendarDates.length} dates`}
                  </span>
                  <X
                    className="w-3 h-3 ml-0.5 shrink-0"
                    onClick={(e) => { e.stopPropagation(); setSelectedCalendarDates([]) }}
                  />
                </button>
              )}
              {selectedContextIds.map((id) => {
                const ctx = contexts.find((c) => c.id === id)
                if (!ctx) return null
                return (
                  <SelectedChip key={id} onRemove={() => setSelectedContextIds((prev) => prev.filter((x) => x !== id))}>
                    <Hash className="w-3 h-3" />
                    {ctx.name}
                  </SelectedChip>
                )
              })}
            </div>
          </div>
        )}

        {activeAssociation && (
          <div
            ref={associationPanelRef}
            className="glass-panel rounded-2xl border p-2.5 animate-fade-up overflow-hidden"
            style={associationPanelMaxHeight ? { maxHeight: associationPanelMaxHeight } : undefined}
          >
            {activeAssociation === "context" ? (
              <div className="max-h-full overflow-y-auto overscroll-contain pr-1 scrollbar-hide">
                <AssociationPanelHeader
                  title="Contexts"
                  actionLabel="New"
                  active={quickCreateKind === "context"}
                  onAction={() => startQuickCreate("context")}
                />
                {quickCreateKind === "context" && (
                  <QuickCreateForm
                    kind="context"
                    value={quickCreateName}
                    loading={isQuickCreating}
                    error={quickCreateError}
                    onChange={setQuickCreateName}
                    onSubmit={handleQuickCreate}
                    onCancel={cancelQuickCreate}
                  />
                )}
                {isContextsLoading ? (
                  <div className="flex flex-wrap gap-2">
                    {[...Array(4)].map((_, i) => (
                      <div key={i} className="flex min-w-[calc(50%-0.25rem)] flex-1 h-10 rounded-2xl border border-white/8 bg-white/5 animate-pulse" />
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {panelContexts.map((ctx) => {
                      const selected = selectedContextIds.includes(ctx.id)
                      return (
                        <button
                          key={ctx.id}
                          onClick={() => {
                            setSelectedContextIds((p) => selected ? p.filter((x) => x !== ctx.id) : [...p, ctx.id])
                          }}
                          className={cn(
                            "flex min-w-[calc(50%-0.25rem)] flex-1 items-center gap-2 rounded-2xl border px-3 py-2.5 text-left text-xs font-semibold transition-all active:scale-[0.98]",
                            selected
                              ? "border-emerald-400/30 bg-emerald-400/15 text-emerald-300"
                              : "glass-menu-item text-foreground/90 active:bg-white/8"
                          )}
                        >
                          <Hash className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
                          <span className="min-w-0 flex-1 truncate">{ctx.name}</span>
                          {selected && <Check className="w-4 h-4 shrink-0" />}
                        </button>
                      )
                    })}
                    {contexts.length === 0 && (
                      <p className="w-full px-2 py-8 text-center text-xs text-muted-foreground">No contexts available yet.</p>
                    )}
                    {contexts.length > MAX_PANEL_ITEMS && (
                      <p className="w-full px-2 py-2 text-center text-[10px] text-muted-foreground/50">
                        Showing {MAX_PANEL_ITEMS} of {contexts.length} — search above to find more
                      </p>
                    )}
                  </div>
                )}
              </div>
            ) : activeAssociation === "who" ? (
              <div className="max-h-full overflow-y-auto overscroll-contain pr-1 scrollbar-hide">
                <div className="flex flex-wrap gap-2">
                  {contacts.map((contact) => (
                    <PersonCard
                      key={contact.id}
                      contact={contact}
                      selected={selectedContacts.includes(contact.id)}
                      onClick={() => toggleContact(contact.id)}
                    />
                  ))}
                  {contacts.length === 0 && notRegisteredContacts.length === 0 && !isContactsLoading && (
                    <p className="px-2 py-8 text-center text-xs text-muted-foreground">No people yet. Add or import contacts so they can be used as recipients.</p>
                  )}
                </div>
                {isContactsLoading ? (
                  <>
                    <p className="px-1 pt-3 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">Not registered</p>
                    <div className="flex flex-wrap gap-2">
                      {[...Array(4)].map((_, i) => (
                        <div key={i} className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-white/8 bg-white/5 animate-pulse h-8 w-32" />
                      ))}
                    </div>
                  </>
                ) : notRegisteredContacts.length > 0 && (
                  <>
                    <p className="px-1 pt-3 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">Not registered</p>
                    <div className="flex flex-wrap gap-2">
                      {panelImported.map((c) => (
                        <button
                          key={c.id}
                          onClick={() => toggleImportedContact(c.id)}
                          className={cn(
                            "flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all active:scale-[0.98]",
                            selectedImportedContacts.includes(c.id)
                              ? "glass-pill-active"
                              : "glass-pill text-white/75"
                          )}
                        >
                          <span className="w-[18px] h-[18px] rounded-full bg-white/10 border border-white/15 flex items-center justify-center text-[8px] font-bold text-white/50">
                            {(c.name.match(/\b\w/g) ?? []).slice(0, 2).join("").toUpperCase() || "?"}
                          </span>
                          {c.name}
                          {selectedImportedContacts.includes(c.id) && <Check className="w-3 h-3 shrink-0" />}
                        </button>
                      ))}
                    </div>
                    {notRegisteredContacts.length > MAX_PANEL_ITEMS && (
                      <p className="px-2 pt-2 pb-1 text-center text-[10px] text-muted-foreground/50">
                        Showing {MAX_PANEL_ITEMS} of {notRegisteredContacts.length} — search above to find more
                      </p>
                    )}
                  </>
                )}
              </div>
            ) : (
              <div className="max-h-full overflow-y-auto overscroll-contain pr-1 scrollbar-hide">
                <AssociationPanelHeader
                  title="Tags"
                  actionLabel="New"
                  active={quickCreateKind === "tag"}
                  onAction={() => startQuickCreate("tag")}
                />
                {quickCreateKind === "tag" && (
                  <QuickCreateForm
                    kind="tag"
                    value={quickCreateName}
                    loading={isQuickCreating}
                    error={quickCreateError}
                    onChange={setQuickCreateName}
                    onSubmit={handleQuickCreate}
                    onCancel={cancelQuickCreate}
                  />
                )}
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
                    <p className="col-span-2 px-2 py-8 text-center text-xs text-muted-foreground">No tags yet. Tags help organize messages by type, like Task or Follow Up.</p>
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

      <div ref={optionBarRef} className="glass-compose flex-shrink-0 px-4 py-3">
        <div className="flex gap-2 flex-wrap">
          <OptionChip
            icon={<User className="w-3.5 h-3.5" />}
            active={activeAssociation === "who" || selectedContacts.length > 0 || selectedImportedContacts.length > 0}
            onClick={() => setActiveAssociation((current) => current === "who" ? null : "who")}
            hint="Recipients are the people who can see this message."
          >
            {(selectedContacts.length + selectedImportedContacts.length) > 0 ? `${selectedContacts.length + selectedImportedContacts.length} Who` : "+ Who"}
          </OptionChip>
          <OptionChip
            icon={<Tag className="w-3.5 h-3.5" />}
            active={activeAssociation === "tag" || selectedTagIds.length > 0}
            onClick={() => setActiveAssociation((current) => current === "tag" ? null : "tag")}
            hint="Tags help classify messages, like Task, Follow Up, Question, or Important."
          >
            {selectedTagIds.length > 0 ? `${selectedTagIds.length} Tags` : "Tag"}
          </OptionChip>
          <OptionChip
            icon={<ImageIcon className="w-3.5 h-3.5" />}
            active={!!imageFile}
            onClick={() => fileInputRef.current?.click()}
            hint="Attach a photo to give more context to the message."
          >
            {imageFile ? imageFile.name : "Image"}
          </OptionChip>
          <OptionChip
            icon={<CalendarDays className="w-3.5 h-3.5" />}
            active={selectedCalendarDates.length > 0}
            onClick={() => setShowDatePicker(true)}
            hint="Add a date when this message needs follow-up, action, or attention."
          >
            {selectedCalendarDates.length > 0
              ? selectedCalendarDates.length === 1
                ? formatDateChip(selectedCalendarDates[0])
                : `${selectedCalendarDates.length} dates`
              : "Date"}
          </OptionChip>
          <OptionChip
            icon={<Hash className="w-3.5 h-3.5" />}
            active={activeAssociation === "context" || selectedContextIds.length > 0}
            onClick={() => setActiveAssociation((current) => current === "context" ? null : "context")}
            hint="Contexts show what a message is related to, like a project, company, topic, or workflow."
          >
            {selectedContextIds.length > 0 ? `${selectedContextIds.length} Context${selectedContextIds.length !== 1 ? "s" : ""}` : "Context"}
          </OptionChip>
        </div>
      </div>

      {/* Bottom Action Bar */}
      <div className="flex-shrink-0 bg-[rgba(8,14,25,0.68)] px-4 py-4 safe-area-pb backdrop-blur-2xl border-t border-white/8 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
        <div className="flex justify-between items-center gap-4">
          <span className="text-xs text-muted-foreground font-light">
            {text.length > 0 ? `${text.length} chars` : "Context optional"}
          </span>
          <button
            type="button"
            onClick={handleSend}
            disabled={(!text.trim() && !imageFile && !attachment) || isSending || isSent}
            className={cn(
              "rounded-full px-6 py-3 text-sm font-semibold tracking-wide transition-colors min-w-[90px] flex items-center justify-center gap-2",
              isSent
                ? "bg-progress text-white shadow-[0_4px_14px_rgba(34,197,94,0.45)] animate-sent-pop"
                : (text.trim() || imageFile || attachment) && !isSending
                  ? "border border-primary/30 bg-[linear-gradient(135deg,rgba(37,99,235,0.96),rgba(99,102,241,0.92))] text-white glow-blue active:scale-[0.98]"
                  : "glass-button border text-muted-foreground"
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

      {/* Date picker modal */}
      {showDatePicker && (
        <DatePickerModal
          selectedDates={selectedCalendarDates}
          title="Schedule dates"
          onConfirm={(dates) => {
            setSelectedCalendarDates(dates)
            setShowDatePicker(false)
          }}
          onClose={() => setShowDatePicker(false)}
        />
      )}
    </div>
  )
}

function OptionChip({
  children,
  icon,
  active,
  onClick,
  hint,
}: {
  children: React.ReactNode
  icon?: React.ReactNode
  active?: boolean
  onClick?: () => void
  hint?: string
}) {
  return (
    <span className="relative inline-flex items-center">
      <button
        onClick={onClick}
        className={cn(
          "min-h-8 text-xs font-semibold pl-3 pr-8 py-1.5 rounded-full border flex items-center gap-1.5 transition-all active:scale-[0.98]",
          active
            ? "glass-pill-active"
            : "glass-pill border-dashed text-white/75 hover:text-blue-200"
        )}
      >
        {icon}
        <span className="max-w-[120px] truncate">{children}</span>
      </button>
      {hint && (
        <HelpTooltip
          text={hint}
          tone="chip"
          className="absolute right-2 top-1/2 -translate-y-1/2"
        />
      )}
    </span>
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
    <label className="glass-compose-pill mb-3 flex items-center gap-2 rounded-xl border px-3 py-2">
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
        "flex min-w-[calc(50%-0.25rem)] flex-1 items-center gap-1.5 rounded-xl border px-2.5 py-2 text-left transition-all active:scale-[0.98]",
        selected
          ? "glass-pill-active"
          : "glass-menu-item text-foreground/90 active:bg-white/8"
      )}
    >
      <span className={cn("w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0", contact.color)}>
        {contact.initials}
      </span>
      <span className="min-w-0 flex-1 truncate text-[11px] font-bold">{contact.name}</span>
      {selected && <Check className="w-3.5 h-3.5 shrink-0" />}
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
  typeLabel: "Person" | "Tag" | string
  icon: React.ReactNode
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-all active:scale-[0.99]",
        selected
          ? "border-primary/35 bg-primary/18 text-blue-200"
          : "border-transparent text-foreground/90 active:bg-white/5"
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
    <span className="inline-flex h-8 max-w-[190px] shrink-0 items-center gap-1.5 rounded-full border border-primary/30 bg-primary/14 px-2.5 text-[11px] font-semibold text-blue-300 backdrop-blur-md">
      <span className="inline-flex min-w-0 items-center gap-1 truncate leading-none">{children}</span>
      <button type="button" onClick={onRemove} className="shrink-0 rounded-full active:scale-90">
        <X className="w-3 h-3" />
      </button>
    </span>
  )
}

function AssociationPanelHeader({
  title,
  actionLabel,
  active,
  onAction,
}: {
  title: string
  actionLabel: string
  active?: boolean
  onAction: () => void
}) {
  return (
    <div className="mb-2 flex items-center justify-between gap-3 px-1">
      <p className="font-mono text-[10px] font-bold uppercase tracking-[1.7px] text-muted-foreground/70">{title}</p>
      <button
        type="button"
        onClick={onAction}
        className={cn(
          "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-bold transition-all active:scale-[0.98]",
          active
            ? "border-primary/35 bg-primary/18 text-blue-200"
            : "border-white/10 bg-white/5 text-white/75 active:bg-white/8"
        )}
      >
        <Plus className="h-3.5 w-3.5" />
        {actionLabel}
      </button>
    </div>
  )
}

function QuickCreateForm({
  kind,
  value,
  loading,
  error,
  onChange,
  onSubmit,
  onCancel,
}: {
  kind: "tag" | "context"
  value: string
  loading: boolean
  error: string | null
  onChange: (value: string) => void
  onSubmit: () => void
  onCancel: () => void
}) {
  const isContext = kind === "context"
  const trimmed = value.trim()

  return (
    <div className="mb-2 rounded-2xl border border-white/10 bg-white/[0.04] p-2 animate-fade-up">
      <div className="flex items-center gap-2">
        <span className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border",
          isContext ? "border-emerald-400/20 bg-emerald-400/10" : "border-violet-400/20 bg-violet-400/10"
        )}>
          {isContext ? <Hash className="h-4 w-4 text-emerald-300" /> : <Tag className="h-4 w-4 text-violet-300" />}
        </span>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && trimmed) onSubmit()
            if (e.key === "Escape") onCancel()
          }}
          autoFocus
          placeholder={isContext ? "Context name" : "Tag name"}
          className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-foreground outline-none placeholder:text-muted-foreground/45"
        />
        <button
          type="button"
          onClick={onCancel}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground/60 active:bg-white/8"
          aria-label="Cancel"
        >
          <X className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={!trimmed || loading}
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all",
            trimmed && !loading
              ? isContext
                ? "bg-emerald-500 text-white shadow-[0_6px_18px_rgba(52,211,153,0.25)] active:scale-[0.96]"
                : "bg-primary text-white shadow-[0_6px_18px_rgba(37,99,235,0.28)] active:scale-[0.96]"
              : "bg-white/5 text-muted-foreground/35"
          )}
          aria-label={isContext ? "Create context" : "Create tag"}
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
        </button>
      </div>
      {error && <p className="mt-2 px-1 text-[11px] font-semibold text-destructive">{error}</p>}
    </div>
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
            ? cn(systemStyle.bg, systemStyle.text, systemStyle.border, "ring-1 ring-current/20 backdrop-blur-md")
            : "glass-pill-active"
          : "glass-menu-item text-foreground/90 active:bg-white/8"
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
  if (tag.systemType === "red_team_review") return "bg-red-team-review"
  return "bg-violet-500"
}

const formatDateChip = formatCalendarDateLabel
