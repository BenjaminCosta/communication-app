"use client"

import { useMemo, useState } from "react"
import {
  ArrowLeft,
  CalendarDays,
  Check,
  ChevronRight,
  Hash,
  Plus,
  Search,
  Tag,
  Users,
  X,
} from "lucide-react"
import { cn, haptic } from "@/lib/utils"
import { useSwipeDismiss } from "@/hooks/use-swipe-dismiss"
import {
  type Message,
  type Project,
  type Contact,
  type ImportedContact,
  type Tag as MessageTag,
  type CategoryItem,
  type AppContext,
  getContactFromList,
  formatTime,
  getMessagePeopleIds,
  getMessageTagIds,
  getAvailableTags,
  parseProjectTagId,
  parseSystemTypeTagId,
  systemTypeTagId,
  isCategoryTimeBased,
  getCategoryLabel,
} from "@/lib/store"
import { DatePickerModal } from "@/components/date-picker-modal"
import { CreateProjectModal } from "@/components/create-project-modal"
import { CreateContextModal } from "@/components/create-context-modal"

interface TagSheetProps {
  message: Message
  onApply: (peopleIds: string[], tagIds: string[], importedContactIds: string[], calendarDates?: string[], contextIds?: string[]) => void
  onClose: () => void
  projects: Project[]
  onCreateProject: (name: string, memberIds?: string[], category?: string) => Promise<Project>
  contacts: Contact[]
  importedContacts?: ImportedContact[]
  availableTags?: MessageTag[]
  customCategories?: CategoryItem[]
  activeStreamFilters?: { peopleIds: string[]; tagIds: string[]; contextIds?: string[] }
  recentUserMessages?: Message[]
  contexts?: AppContext[]
  onCreateContext?: (name: string, description?: string) => Promise<AppContext>
}

type SheetView =
  | { type: "main" }
  | { type: "people" }
  | { type: "tags" }
  | { type: "dates" }
  | { type: "contexts" }

export function TagSheet({
  message,
  onApply,
  onClose,
  projects,
  onCreateProject,
  contacts,
  importedContacts = [],
  availableTags,
  customCategories = [],
  activeStreamFilters,
  recentUserMessages = [],
  contexts = [],
  onCreateContext,
}: TagSheetProps) {
  const allTags = availableTags ?? getAvailableTags(projects)
  const tags = allTags.filter((tag) => tag.id !== systemTypeTagId("none"))
  const [view, setView] = useState<SheetView>({ type: "main" })
  const [query, setQuery] = useState("")
  const [selectedTags, setSelectedTags] = useState<string[]>(
    getMessageTagIds(message).filter((tagId) => tagId !== systemTypeTagId("none"))
  )
  const [selectedParticipants, setSelectedParticipants] = useState<string[]>(getMessagePeopleIds(message))
  const [selectedImported, setSelectedImported] = useState<string[]>((message.contactIds ?? []).filter(Boolean))
  const [selectedCalendarDates, setSelectedCalendarDates] = useState<string[]>(
    (message.calendarDates ?? []).map((d) => d.date).filter(Boolean)
  )
  const [selectedContextIds, setSelectedContextIds] = useState<string[]>(
    (message.contextIds ?? []).filter(Boolean)
  )
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [showCreateTagModal, setShowCreateTagModal] = useState(false)
  const [showCreateContextModal, setShowCreateContextModal] = useState(false)

  const contact = getContactFromList(message.senderId, contacts) ?? {
    id: message.senderId,
    name: "Unknown",
    initials: "?",
    color: "bg-white/10",
  }
  const { handlers: swipeHandlers, dragStyle } = useSwipeDismiss(onClose)
  const q = query.trim().toLowerCase()

  const filteredContacts = contacts.filter((c) => !q || c.name.toLowerCase().includes(q))
  const filteredImported = importedContacts.filter(
    (c) => c.status === "not_registered" &&
      (!q || c.name.toLowerCase().includes(q) || (c.email ?? "").toLowerCase().includes(q))
  )
  const filteredTags = tags.filter((tag) => !q || tag.name.toLowerCase().includes(q))
  const filteredContexts = contexts.filter((c) =>
    !q || c.name.toLowerCase().includes(q) || (c.description ?? "").toLowerCase().includes(q)
  )
  const sortedTags = useMemo(() => sortTagList(tags), [tags])
  const sortedFilteredTags = useMemo(() => sortTagList(filteredTags), [filteredTags])

  const selectedPeopleCount = selectedParticipants.length + selectedImported.length
  const selectedContextCount = selectedPeopleCount + selectedTags.length + selectedCalendarDates.length + selectedContextIds.length
  const selectedTagObjects = selectedTags.map((id) => tags.find((tag) => tag.id === id)).filter(Boolean) as MessageTag[]
  const summaryItems = buildSummaryItems({
    contacts,
    importedContacts,
    selectedParticipants,
    selectedImported,
    selectedTagObjects,
    selectedCalendarDates,
    selectedContextIds,
    allContexts: contexts,
    onParticipant: toggleParticipant,
    onImported: toggleImported,
    onTag: toggleTag,
    onDate: (date) => setSelectedCalendarDates((prev) => prev.filter((item) => item !== date)),
    onContext: toggleContext,
  })
  const suggestedItems = buildSmartSuggestions({
    tags,
    contexts,
    customCategories,
    selectedTags,
    selectedCalendarDates,
    selectedContextIds,
    activeStreamFilters,
    recentUserMessages,
    messageText: message.text,
    messageTimestamp: message.timestamp,
    onTag: toggleTag,
    onContext: toggleContext,
    onDate: (date) => {
      setSelectedCalendarDates((prev) => prev.includes(date) ? prev : [...prev, date])
    },
  })

  function toggleParticipant(id: string) {
    setSelectedParticipants((prev) => prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id])
  }

  function toggleImported(id: string) {
    setSelectedImported((prev) => prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id])
  }

  function toggleTag(id: string) {
    const isCurrentlySelected = selectedTags.includes(id)
    setSelectedTags((prev) => isCurrentlySelected ? prev.filter((tagId) => tagId !== id) : [...prev, id])
    if (!isCurrentlySelected) {
      const projectId = parseProjectTagId(id)
      const project = projectId ? projects.find((p) => p.id === projectId) : null
      const tag = tags.find((item) => item.id === id)
      if (isCategoryTimeBased(tag?.category ?? project?.tagCategory ?? "", customCategories)) {
        setShowDatePicker(true)
      }
    }
  }

  function toggleContext(id: string) {
    setSelectedContextIds((prev) => prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id])
  }

  function handleApply() {
    haptic.success()
    onApply(selectedParticipants, selectedTags, selectedImported, selectedCalendarDates, selectedContextIds)
  }

  function handleBack() {
    setView({ type: "main" })
  }

  const title = view.type === "main"
    ? (selectedContextCount > 0 ? "Edit Message" : "Add Context")
    : view.type === "people"
        ? "People"
        : view.type === "dates"
          ? "Dates"
          : view.type === "contexts"
            ? "Contexts"
            : "Tags"

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end md:items-center md:justify-center">
      <div onPointerDown={onClose} className="absolute inset-0 bg-black/60 backdrop-blur-sm cursor-default" />

      <div
        style={dragStyle}
        className="relative z-10 w-full md:w-120 md:mb-6 md:rounded-3xl glass-modal border-t md:border border-white/10 rounded-t-3xl animate-slide-up md:shadow-2xl h-[88dvh] flex flex-col"
      >
        <div {...swipeHandlers} className="py-3 touch-none cursor-grab active:cursor-grabbing">
          <div className="w-10 h-1 rounded-full bg-white/20 mx-auto" />
        </div>

        <div className="flex items-center justify-between px-4 mb-2">
          {view.type === "main" ? (
            <div className="w-8" />
          ) : (
            <button
              type="button"
              onClick={handleBack}
              className="w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center"
            >
              <ArrowLeft className="w-4 h-4 text-muted-foreground" />
            </button>
          )}
          <h3 className="text-xs font-bold tracking-[2px] uppercase text-foreground/90">
            {title}
          </h3>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center"
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide">
        {view.type === "main" && (
          <MainContextView
            message={message}
            contact={contact}
            query={query}
            onQueryChange={setQuery}
            isSearching={q.length > 0}
            filteredContacts={filteredContacts}
            filteredImported={filteredImported}
            filteredTags={sortedFilteredTags}
            filteredContexts={filteredContexts}
            selectedParticipants={selectedParticipants}
            selectedImported={selectedImported}
            selectedTags={selectedTags}
            selectedCalendarDates={selectedCalendarDates}
            selectedContextIds={selectedContextIds}
            contexts={contexts}
            summaryItems={summaryItems}
            suggestedItems={suggestedItems}
            selectedPeopleCount={selectedPeopleCount}
            selectedContextCount={selectedContextCount}
            onToggleParticipant={toggleParticipant}
            onToggleImported={toggleImported}
            onToggleTag={toggleTag}
            onToggleContext={toggleContext}
            onRemoveDate={(date) => setSelectedCalendarDates((prev) => prev.filter((item) => item !== date))}
            onOpenPeople={() => setView({ type: "people" })}
            onOpenTags={() => setView({ type: "tags" })}
            onOpenDates={() => setView({ type: "dates" })}
            onOpenContexts={() => setView({ type: "contexts" })}
            onOpenDatePicker={() => setShowDatePicker(true)}
          />
        )}

        {view.type === "people" && (
          <PeopleDetailView
            contacts={filteredContacts}
            importedContacts={filteredImported}
            query={query}
            selectedParticipants={selectedParticipants}
            selectedImported={selectedImported}
            onQueryChange={setQuery}
            onToggleParticipant={toggleParticipant}
            onToggleImported={toggleImported}
          />
        )}

        {view.type === "tags" && (
          <TagsListView
            tags={sortedTags}
            selectedTags={selectedTags}
            onToggleTag={toggleTag}
            onCreateTag={() => setShowCreateTagModal(true)}
          />
        )}

        {view.type === "dates" && (
          <DatesDetailView
            selectedCalendarDates={selectedCalendarDates}
            onAddDate={() => setShowDatePicker(true)}
            onRemoveDate={(date) => setSelectedCalendarDates((prev) => prev.filter((item) => item !== date))}
          />
        )}

        {view.type === "contexts" && (
          <ContextsDetailView
            contexts={contexts}
            selectedContextIds={selectedContextIds}
            onToggleContext={toggleContext}
            onCreateContext={onCreateContext ? () => setShowCreateContextModal(true) : undefined}
          />
        )}
        </div>

        <div className="shrink-0 bg-[#0d1c35]/95 backdrop-blur-xl px-4 pt-3 pb-2 border-t border-white/8 safe-area-pb">
          <button
            onClick={handleApply}
            className="w-full rounded-2xl py-3 text-sm font-semibold tracking-wide transition-all bg-primary text-white shadow-[0_10px_28px_rgba(37,99,235,0.35)] active:scale-[0.98]"
          >
            Save changes <span className="ml-1">→</span>
          </button>
        </div>
      </div>

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

      {showCreateTagModal && (
        <CreateProjectModal
          contacts={contacts}
          onClose={() => setShowCreateTagModal(false)}
          onSubmit={async (name, memberIds, category) => {
            setShowCreateTagModal(false)
            if (!onCreateProject) return
            const project = await onCreateProject(name, memberIds, category)
            if (project) {
              const tagId = `project:${project.id}`
              setSelectedTags((prev) => prev.includes(tagId) ? prev : [...prev, tagId])
            }
          }}
        />
      )}

      {showCreateContextModal && onCreateContext && (
        <CreateContextModal
          onClose={() => setShowCreateContextModal(false)}
          onSubmit={async (name, description) => {
            const ctx = await onCreateContext(name, description || undefined)
            setSelectedContextIds((prev) => prev.includes(ctx.id) ? prev : [...prev, ctx.id])
            setTimeout(() => setShowCreateContextModal(false), 900)
          }}
        />
      )}
    </div>
  )
}

function MainContextView({
  message,
  contact,
  query,
  onQueryChange,
  isSearching,
  filteredContacts,
  filteredImported,
  filteredTags,
  filteredContexts,
  selectedParticipants,
  selectedImported,
  selectedTags,
  selectedCalendarDates,
  selectedContextIds,
  contexts,
  summaryItems,
  suggestedItems,
  selectedPeopleCount,
  selectedContextCount,
  onToggleParticipant,
  onToggleImported,
  onToggleTag,
  onToggleContext,
  onRemoveDate,
  onOpenPeople,
  onOpenTags,
  onOpenDates,
  onOpenContexts,
  onOpenDatePicker,
}: {
  message: Message
  contact: Contact
  query: string
  onQueryChange: (value: string) => void
  isSearching: boolean
  filteredContacts: Contact[]
  filteredImported: ImportedContact[]
  filteredTags: MessageTag[]
  filteredContexts: AppContext[]
  selectedParticipants: string[]
  selectedImported: string[]
  selectedTags: string[]
  selectedCalendarDates: string[]
  selectedContextIds: string[]
  contexts: AppContext[]
  summaryItems: SummaryItem[]
  suggestedItems: SuggestedItem[]
  selectedPeopleCount: number
  selectedContextCount: number
  onToggleParticipant: (id: string) => void
  onToggleImported: (id: string) => void
  onToggleTag: (id: string) => void
  onToggleContext: (id: string) => void
  onRemoveDate: (date: string) => void
  onOpenPeople: () => void
  onOpenTags: () => void
  onOpenDates: () => void
  onOpenContexts: () => void
  onOpenDatePicker: () => void
}) {
  return (
    <>
      <div className="mx-4 mb-2 bg-card/80 border border-white/10 rounded-xl px-3 py-2.5">
        <p className="text-[10px] font-bold text-muted-foreground mb-0.5">
          {contact.name} · {formatTime(message.timestamp)}
        </p>
        <p className="text-xs text-foreground/85 leading-snug max-h-9 overflow-hidden">
          {message.text}
        </p>
      </div>

      <div className="px-4 pb-3">
        <SearchInput value={query} onChange={onQueryChange} placeholder="Search people, tags, contexts..." />
      </div>

      {isSearching ? (
        <SearchResultsView
          filteredContacts={filteredContacts}
          filteredImported={filteredImported}
          filteredTags={filteredTags}
          filteredContexts={filteredContexts}
          selectedParticipants={selectedParticipants}
          selectedImported={selectedImported}
          selectedTags={selectedTags}
          selectedContextIds={selectedContextIds}
          onToggleParticipant={onToggleParticipant}
          onToggleImported={onToggleImported}
          onToggleTag={onToggleTag}
          onToggleContext={onToggleContext}
          onOpenDatePicker={onOpenDatePicker}
        />
      ) : (
        <>
          <section className="px-4 pb-2.5">
            <SectionTitle>Selected context</SectionTitle>
            <CompactContextSummary
              items={summaryItems}
              count={selectedContextCount}
              onRemoveDate={onRemoveDate}
              onOpenPeople={onOpenPeople}
              onOpenTags={onOpenTags}
              onOpenDates={onOpenDates}
              onOpenContexts={onOpenContexts}
            />
          </section>

          {suggestedItems.length > 0 && (
            <section className="px-4 pb-2.5">
              <SectionTitle>Suggested</SectionTitle>
              <div className="grid grid-cols-4 gap-1.5">
                {suggestedItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={item.onClick}
                    title={item.detail}
                    aria-label={`${item.label}, ${item.detail}`}
                    className="rounded-xl border border-white/10 bg-white/[0.04] px-1.5 py-2.5 text-center transition-colors active:scale-[0.98] active:bg-white/8"
                  >
                    <span className={cn("mx-auto mb-1.5 flex h-7 w-7 items-center justify-center rounded-full", item.iconBg)}>
                      {item.icon}
                    </span>
                    <span className="block truncate text-[11px] font-semibold text-foreground/85">{item.label}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          <div className="h-px bg-white/10 mx-4 mb-2.5" />

          <section className="px-4 pb-2">
            <SectionTitle>Organize</SectionTitle>
            <div className="flex flex-col gap-2">
              <OrganizeRow
                icon={<Users className="w-4 h-4" />}
                iconClassName="bg-feedback/16 text-feedback"
                label="People"
                detail={selectedPeopleCount > 0 ? `${selectedPeopleCount} selected` : "None"}
                onClick={onOpenPeople}
              />
              <OrganizeRow
                icon={<Tag className="w-4 h-4" />}
                iconClassName="bg-primary/18 text-primary"
                label="Tags"
                detail={selectedTags.length > 0 ? `${selectedTags.length} selected` : "None"}
                onClick={onOpenTags}
              />
              <OrganizeRow
                icon={<CalendarDays className="w-4 h-4" />}
                iconClassName="bg-sky-400/16 text-sky-400"
                label="Dates"
                detail={selectedCalendarDates.length > 0 ? `${selectedCalendarDates.length} selected` : "None"}
                onClick={onOpenDates}
              />
              <OrganizeRow
                icon={<Hash className="w-4 h-4" />}
                iconClassName="bg-emerald-400/16 text-emerald-400"
                label="Contexts"
                detail={selectedContextIds.length > 0 ? `${selectedContextIds.length} selected` : "None"}
                onClick={onOpenContexts}
              />
            </div>
          </section>
        </>
      )}
    </>
  )
}

function SearchResultsView({
  filteredContacts,
  filteredImported,
  filteredTags,
  filteredContexts,
  selectedParticipants,
  selectedImported,
  selectedTags,
  selectedContextIds,
  onToggleParticipant,
  onToggleImported,
  onToggleTag,
  onToggleContext,
  onOpenDatePicker,
}: {
  filteredContacts: Contact[]
  filteredImported: ImportedContact[]
  filteredTags: MessageTag[]
  filteredContexts: AppContext[]
  selectedParticipants: string[]
  selectedImported: string[]
  selectedTags: string[]
  selectedContextIds: string[]
  onToggleParticipant: (id: string) => void
  onToggleImported: (id: string) => void
  onToggleTag: (id: string) => void
  onToggleContext: (id: string) => void
  onOpenDatePicker: () => void
}) {
  const hasResults = filteredContacts.length > 0 || filteredImported.length > 0 || filteredTags.length > 0 || filteredContexts.length > 0
  return (
    <div className="px-4 pb-4">
      <SectionTitle>Results</SectionTitle>
      <div className="flex flex-col gap-1">
        {filteredContacts.map((contact) => (
          <SearchResultRow
            key={contact.id}
            selected={selectedParticipants.includes(contact.id)}
            icon={<AvatarMini initials={contact.initials} color={contact.color} />}
            label={contact.name}
            typeLabel="Person"
            onClick={() => onToggleParticipant(contact.id)}
          />
        ))}
        {filteredImported.map((contact) => (
          <SearchResultRow
            key={contact.id}
            selected={selectedImported.includes(contact.id)}
            icon={<AvatarMini initials={(contact.name.match(/\b\w/g) ?? []).slice(0, 2).join("").toUpperCase() || "?"} color="bg-white/10" muted />}
            label={contact.name}
            typeLabel="Not registered"
            onClick={() => onToggleImported(contact.id)}
          />
        ))}
        {filteredTags.map((tag) => (
          <SearchResultRow
            key={tag.id}
            selected={selectedTags.includes(tag.id)}
            icon={<span className={cn("h-2.5 w-2.5 rounded-full", tagDotClass(tag))} />}
            label={tag.name}
            typeLabel="Tag"
            onClick={() => onToggleTag(tag.id)}
          />
        ))}
        {filteredContexts.map((ctx) => (
          <SearchResultRow
            key={ctx.id}
            selected={selectedContextIds.includes(ctx.id)}
            icon={<Hash className="w-4 h-4 text-emerald-400" />}
            label={ctx.name}
            typeLabel="Context"
            onClick={() => onToggleContext(ctx.id)}
          />
        ))}
        <SearchResultRow
          selected={false}
          icon={<CalendarDays className="w-4 h-4 text-sky-400" />}
          label="Add date"
          typeLabel="Calendar"
          onClick={onOpenDatePicker}
        />
        {!hasResults && (
          <p className="px-1 py-3 text-xs text-muted-foreground">No results found.</p>
        )}
      </div>
    </div>
  )
}

function PeopleDetailView({
  contacts,
  importedContacts,
  query,
  selectedParticipants,
  selectedImported,
  onQueryChange,
  onToggleParticipant,
  onToggleImported,
}: {
  contacts: Contact[]
  importedContacts: ImportedContact[]
  query: string
  selectedParticipants: string[]
  selectedImported: string[]
  onQueryChange: (value: string) => void
  onToggleParticipant: (id: string) => void
  onToggleImported: (id: string) => void
}) {
  return (
    <div className="px-4 pb-4">
      <SearchInput value={query} onChange={onQueryChange} placeholder="Search people..." />
      <div className="mt-3 flex flex-col gap-1">
        {contacts.map((contact) => (
          <SearchResultRow
            key={contact.id}
            selected={selectedParticipants.includes(contact.id)}
            icon={<AvatarMini initials={contact.initials} color={contact.color} />}
            label={contact.name}
            typeLabel="Person"
            onClick={() => onToggleParticipant(contact.id)}
          />
        ))}
        {importedContacts.map((contact) => (
          <SearchResultRow
            key={contact.id}
            selected={selectedImported.includes(contact.id)}
            icon={<AvatarMini initials={(contact.name.match(/\b\w/g) ?? []).slice(0, 2).join("").toUpperCase() || "?"} color="bg-white/10" muted />}
            label={contact.name}
            typeLabel="Not registered"
            onClick={() => onToggleImported(contact.id)}
          />
        ))}
      </div>
    </div>
  )
}

function TagsListView({
  tags,
  selectedTags,
  onToggleTag,
  onCreateTag,
}: {
  tags: MessageTag[]
  selectedTags: string[]
  onToggleTag: (id: string) => void
  onCreateTag: () => void
}) {
  const [query, setQuery] = useState("")
  const q = query.trim().toLowerCase()
  const visibleTags = q ? tags.filter((tag) => tag.name.toLowerCase().includes(q)) : tags

  return (
    <div className="px-4 pb-4">
      <SearchInput value={query} onChange={setQuery} placeholder="Search tags..." />
      <div className="mt-3 flex flex-col gap-2">
        {visibleTags.map((tag) => {
          const selected = selectedTags.includes(tag.id)
          return (
            <button
              key={tag.id}
              type="button"
              onClick={() => onToggleTag(tag.id)}
              className={cn(
                "flex w-full items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition-colors",
                selected
                  ? "border-primary/25 bg-primary/12 text-primary"
                  : "border-white/10 bg-white/[0.04] text-foreground/90 active:bg-white/8"
              )}
            >
              <span className={cn("h-3 w-3 shrink-0 rounded-full", tagDotClass(tag))} />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{tag.name}</span>
              <span className={cn(
                "flex h-5 w-5 items-center justify-center rounded-full border",
                selected ? "border-primary bg-primary text-white" : "border-white/20"
              )}>
                {selected && <Check className="h-3.5 w-3.5" />}
              </span>
            </button>
          )
        })}
        {visibleTags.length === 0 && (
          <p className="px-1 py-3 text-xs text-muted-foreground">No tags found.</p>
        )}
        <button
          type="button"
          onClick={onCreateTag}
          className="mt-2 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.035] px-3 py-2.5 text-left text-primary active:bg-white/8"
        >
          <Plus className="w-4 h-4" />
          <span className="text-sm font-semibold">Create tag</span>
        </button>
      </div>
    </div>
  )
}

function DatesDetailView({
  selectedCalendarDates,
  onAddDate,
  onRemoveDate,
}: {
  selectedCalendarDates: string[]
  onAddDate: () => void
  onRemoveDate: (date: string) => void
}) {
  return (
    <div className="px-4 pb-4">
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={onAddDate}
          className="flex items-center gap-3 rounded-2xl border border-sky-400/20 bg-sky-400/[0.08] px-3 py-2.5 text-left text-sky-400 active:bg-sky-400/12"
        >
          <CalendarDays className="w-5 h-5" />
          <span className="flex-1 text-sm font-semibold">Add date</span>
          <ChevronRight className="w-4 h-4" />
        </button>
        {selectedCalendarDates.map((date) => (
          <button
            key={date}
            type="button"
            onClick={() => onRemoveDate(date)}
            className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.035] px-3 py-2.5 text-left active:bg-white/8"
          >
            <CalendarDays className="w-4 h-4 text-sky-400" />
            <span className="flex-1 text-sm font-semibold">{formatDateShort(date)}</span>
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        ))}
      </div>
    </div>
  )
}

function ContextsDetailView({
  contexts,
  selectedContextIds,
  onToggleContext,
  onCreateContext,
}: {
  contexts: AppContext[]
  selectedContextIds: string[]
  onToggleContext: (id: string) => void
  onCreateContext?: () => void
}) {
  return (
    <div className="px-4 pb-4">
      <div className="flex flex-col gap-2">
        {contexts.map((ctx) => {
          const selected = selectedContextIds.includes(ctx.id)
          return (
            <button
              key={ctx.id}
              type="button"
              onClick={() => onToggleContext(ctx.id)}
              className={cn(
                "flex items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition-colors active:scale-[0.99]",
                selected
                  ? "border-emerald-400/30 bg-emerald-400/[0.08] text-emerald-300"
                  : "border-white/10 bg-white/[0.035] text-foreground/85"
              )}
            >
              <Hash className={cn("w-4 h-4 shrink-0", selected ? "text-emerald-400" : "text-muted-foreground/50")} />
              <div className="flex-1 min-w-0">
                <span className="block text-sm font-semibold truncate">{ctx.name}</span>
                {ctx.description && (
                  <span className="block text-xs text-muted-foreground/60 truncate">{ctx.description}</span>
                )}
              </div>
              {selected && <Check className="w-4 h-4 text-emerald-400 shrink-0" />}
            </button>
          )
        })}
        {contexts.length === 0 && (
          <p className="text-xs text-muted-foreground/40 text-center py-4">No contexts available</p>
        )}
        {onCreateContext && (
          <button
            type="button"
            onClick={onCreateContext}
            className="mt-2 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.035] px-3 py-2.5 text-left text-emerald-400 active:bg-white/8"
          >
            <Plus className="w-4 h-4" />
            <span className="text-sm font-semibold">Create context</span>
          </button>
        )}
      </div>
    </div>
  )
}

type SummaryItem = {
  id: string
  label: string
  kind: "person" | "tag" | "date" | "context"
  tone?: "primary" | "date"
  icon?: React.ReactNode
  avatar?: React.ReactNode
  onRemove?: () => void
}

type SuggestedItem = {
  kind: "tag" | "context" | "date"
  id: string
  label: string
  detail: string
  score: number
  icon: React.ReactNode
  iconBg: string
  onClick: () => void
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
    <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
      <Search className="w-4 h-4 text-muted-foreground shrink-0" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
      />
    </label>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="mb-2 text-[10px] font-bold tracking-[1.8px] uppercase text-muted-foreground">
      {children}
    </h4>
  )
}

function CompactContextSummary({
  items,
  count,
  onRemoveDate,
  onOpenPeople,
  onOpenTags,
  onOpenDates,
  onOpenContexts,
}: {
  items: SummaryItem[]
  count: number
  onRemoveDate: (date: string) => void
  onOpenPeople: () => void
  onOpenTags: () => void
  onOpenDates: () => void
  onOpenContexts: () => void
}) {
  if (count === 0) {
    return (
      <div className="rounded-xl border border-dashed border-white/12 bg-white/[0.025] px-3 py-2.5 text-xs font-semibold text-muted-foreground/70">
        No context selected
      </div>
    )
  }

  const people = items.filter((item) => item.kind === "person")
  const tags = items.filter((item) => item.kind === "tag")
  const dates = items.filter((item) => item.kind === "date")
  const contexts = items.filter((item) => item.kind === "context")

  return (
    <div className="-mx-1 overflow-x-auto px-1 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="flex min-w-0 gap-2">
        {people.length > 0 && (
          <SummaryGroupPill
            tone="people"
            icon={<Users className="w-3.5 h-3.5" />}
            items={people}
            onOpen={onOpenPeople}
            onRemoveDate={onRemoveDate}
          />
        )}
        {tags.length > 0 && (
          <SummaryGroupPill
            tone="tags"
            icon={<Tag className="w-3.5 h-3.5" />}
            items={tags}
            onOpen={onOpenTags}
            onRemoveDate={onRemoveDate}
          />
        )}
        {dates.length > 0 && (
          <SummaryGroupPill
            tone="dates"
            icon={<CalendarDays className="w-3.5 h-3.5" />}
            items={dates}
            onOpen={onOpenDates}
            onRemoveDate={onRemoveDate}
          />
        )}
        {contexts.length > 0 && (
          <SummaryGroupPill
            tone="contexts"
            icon={<Hash className="w-3.5 h-3.5" />}
            items={contexts}
            onOpen={onOpenContexts}
            onRemoveDate={onRemoveDate}
          />
        )}
      </div>
    </div>
  )
}

function SummaryGroupPill({
  tone,
  icon,
  items,
  onOpen,
  onRemoveDate,
}: {
  tone: "people" | "tags" | "dates" | "contexts"
  icon: React.ReactNode
  items: SummaryItem[]
  onOpen: () => void
  onRemoveDate: (date: string) => void
}) {
  const styles = {
    people: {
      shell: "border-feedback/25 bg-feedback/10",
      icon: "bg-feedback/15 text-feedback",
      more: "border-feedback/20 bg-feedback/15 text-feedback",
    },
    tags: {
      shell: "border-primary/25 bg-primary/10",
      icon: "bg-primary/15 text-primary",
      more: "border-primary/20 bg-primary/15 text-primary",
    },
    contexts: {
      shell: "border-emerald-400/25 bg-emerald-400/10",
      icon: "bg-emerald-400/15 text-emerald-400",
      more: "border-emerald-400/20 bg-emerald-400/15 text-emerald-300",
    },
    dates: {
      shell: "border-sky-400/25 bg-sky-400/10",
      icon: "bg-sky-400/15 text-sky-400",
      more: "border-sky-400/20 bg-sky-400/15 text-sky-400",
    },
  }[tone]
  const first = items[0]
  const overflow = Math.max(0, items.length - 1)

  return (
    <div className={cn("flex h-9 shrink-0 items-center gap-1 rounded-full border px-1.5", styles.shell)}>
      <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full", styles.icon)}>
        {first.avatar ?? first.icon ?? icon}
      </span>
      <span className="max-w-[92px] truncate pr-0.5 text-xs font-semibold text-foreground/85">
        {first.label}
      </span>
      <button
        type="button"
        onClick={() => first.onRemove?.() ?? (first.kind === "date" ? onRemoveDate(first.id.replace("date:", "")) : undefined)}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground/75 active:scale-95 active:bg-white/10"
        aria-label={`Remove ${first.label}`}
      >
        <X className="w-3 h-3" />
      </button>
      {overflow > 0 && (
        <button
          type="button"
          onClick={onOpen}
          className={cn("flex h-6 shrink-0 items-center rounded-full border px-2 text-[11px] font-bold active:scale-95", styles.more)}
          aria-label={`Open ${tone}`}
        >
          +{overflow}
        </button>
      )}
    </div>
  )
}

function OrganizeRow({
  icon,
  iconClassName,
  label,
  detail,
  onClick,
}: {
  icon: React.ReactNode
  iconClassName: string
  label: string
  detail: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-left active:bg-white/8"
    >
      <span className={cn("flex h-8 w-8 items-center justify-center rounded-full", iconClassName)}>
        {icon}
      </span>
      <span className="flex-1 text-sm font-semibold text-foreground">{label}</span>
      <span className="text-xs font-semibold text-muted-foreground">{detail}</span>
      <ChevronRight className="w-4 h-4 text-muted-foreground" />
    </button>
  )
}

function SearchResultRow({
  selected,
  icon,
  label,
  typeLabel,
  onClick,
}: {
  selected: boolean
  icon: React.ReactNode
  label: string
  typeLabel: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
        selected ? "bg-primary/15 text-primary" : "text-foreground/90 active:bg-white/5"
      )}
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{label}</span>
        <span className="block text-[10px] font-bold uppercase tracking-[1.2px] text-muted-foreground/55">{typeLabel}</span>
      </span>
      {selected && <Check className="w-4 h-4 shrink-0 text-primary" />}
    </button>
  )
}

function AvatarMini({ initials, color, muted }: { initials: string; color: string; muted?: boolean }) {
  return (
    <span className={cn(
      "flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold text-white",
      color,
      muted && "border border-white/15 text-white/60"
    )}>
      {initials}
    </span>
  )
}

function sortTagList(tags: MessageTag[]): MessageTag[] {
  return [...tags].sort((a, b) => {
    const aSystem = !!parseSystemTypeTagId(a.id)
    const bSystem = !!parseSystemTypeTagId(b.id)
    if (aSystem !== bSystem) return aSystem ? -1 : 1
    if (!!a.isFavorited !== !!b.isFavorited) return a.isFavorited ? -1 : 1
    const activityDiff = (b.lastUsedAt?.getTime() ?? 0) - (a.lastUsedAt?.getTime() ?? 0)
    if (activityDiff !== 0) return activityDiff
    return a.name.localeCompare(b.name)
  })
}

function buildSummaryItems({
  contacts,
  importedContacts,
  selectedParticipants,
  selectedImported,
  selectedTagObjects,
  selectedCalendarDates,
  selectedContextIds,
  allContexts,
  onParticipant,
  onImported,
  onTag,
  onDate,
  onContext,
}: {
  contacts: Contact[]
  importedContacts: ImportedContact[]
  selectedParticipants: string[]
  selectedImported: string[]
  selectedTagObjects: MessageTag[]
  selectedCalendarDates: string[]
  selectedContextIds: string[]
  allContexts: AppContext[]
  onParticipant: (id: string) => void
  onImported: (id: string) => void
  onTag: (id: string) => void
  onDate: (date: string) => void
  onContext: (id: string) => void
}): SummaryItem[] {
  const people = selectedParticipants.map((id) => {
    const person = contacts.find((contact) => contact.id === id)
    if (!person) return null
    return {
      id: `person:${id}`,
      label: person.name.split(" ")[0],
      kind: "person" as const,
      avatar: <AvatarMini initials={person.initials} color={person.color} />,
      onRemove: () => onParticipant(id),
    }
  }).filter(Boolean) as SummaryItem[]

  const imported = selectedImported.map((id) => {
    const person = importedContacts.find((contact) => contact.id === id)
    if (!person) return null
    return {
      id: `imported:${id}`,
      label: person.name.split(" ")[0],
      kind: "person" as const,
      avatar: <AvatarMini initials={(person.name.match(/\b\w/g) ?? []).slice(0, 2).join("").toUpperCase() || "?"} color="bg-white/10" muted />,
      onRemove: () => onImported(id),
    }
  }).filter(Boolean) as SummaryItem[]

  const tagItems = selectedTagObjects.map((tag) => ({
    id: `tag:${tag.id}`,
    label: tag.name,
    kind: "tag" as const,
    icon: <span className={cn("h-2 w-2 rounded-full", tagDotClass(tag))} />,
    onRemove: () => onTag(tag.id),
  }))

  const dateItems = selectedCalendarDates.map((date) => ({
    id: `date:${date}`,
    label: formatDateShort(date),
    kind: "date" as const,
    tone: "date" as const,
    icon: <CalendarDays className="w-3 h-3" />,
    onRemove: () => onDate(date),
  }))

  const contextItems = selectedContextIds.map((id) => {
    const ctx = allContexts.find((c) => c.id === id)
    if (!ctx) return null
    return {
      id: `context:${id}`,
      label: ctx.name,
      kind: "context" as const,
      icon: <Hash className="w-3 h-3" />,
      onRemove: () => onContext(id),
    }
  }).filter(Boolean) as SummaryItem[]

  return [...people, ...imported, ...tagItems, ...dateItems, ...contextItems]
}

function buildSmartSuggestions({
  tags,
  contexts,
  customCategories,
  selectedTags,
  selectedCalendarDates,
  selectedContextIds,
  activeStreamFilters,
  recentUserMessages,
  messageText,
  messageTimestamp,
  onTag,
  onContext,
  onDate,
}: {
  tags: MessageTag[]
  contexts: AppContext[]
  customCategories: CategoryItem[]
  selectedTags: string[]
  selectedCalendarDates: string[]
  selectedContextIds: string[]
  activeStreamFilters?: { peopleIds: string[]; tagIds: string[]; contextIds?: string[] }
  recentUserMessages: Message[]
  messageText: string
  messageTimestamp: Date
  onTag: (id: string) => void
  onContext: (id: string) => void
  onDate: (date: string) => void
}): SuggestedItem[] {
  const MAX = 4
  const text = normalizeSuggestionText(messageText)
  const textTokens = tokenizeSuggestionText(messageText)
  const activeTagIds = new Set(activeStreamFilters?.tagIds ?? [])
  const activeContextIds = new Set(activeStreamFilters?.contextIds ?? [])
  const tagStats = buildRecentAssociationStats(recentUserMessages, "tag")
  const contextStats = buildRecentAssociationStats(recentUserMessages, "context")
  const candidates: SuggestedItem[] = []

  for (const tag of tags) {
    if (selectedTags.includes(tag.id) || tag.id === systemTypeTagId("none")) continue

    const systemType = parseSystemTypeTagId(tag.id)
    const categoryId = normalizeTagCategoryId(tag.category)
    const stats = tagStats.get(tag.id)
    const textScore = scoreTextEvidence(text, textTokens, [
      tag.name,
      getCategoryLabel(categoryId, customCategories),
      ...getTagSemanticAliases(tag, categoryId, systemType),
    ])
    const score =
      textScore +
      (activeTagIds.has(tag.id) ? 90 : 0) +
      scoreRecentStats(stats, messageTimestamp) +
      Math.min((tag.usageCount ?? 0) * 2, 26) +
      (tag.isFavorited ? 24 : 0) +
      scoreRecency(tag.lastUsedAt ?? null, messageTimestamp) +
      scoreSelectedTagCooccurrence(tag.id, selectedTags, recentUserMessages)

    if (score < 24) continue
    candidates.push({
      kind: "tag",
      id: `tag:${tag.id}`,
      label: tag.name,
      detail: "Tag",
      score,
      icon: <span className={cn("h-4 w-4 rounded-full", tagDotClass(tag))} />,
      iconBg: "bg-white/5",
      onClick: () => onTag(tag.id),
    })
  }

  for (const ctx of contexts) {
    if (selectedContextIds.includes(ctx.id)) continue

    const stats = contextStats.get(ctx.id)
    const fieldValues = ctx.fields.flatMap((field) => [field.label, field.value])
    const textScore = scoreTextEvidence(text, textTokens, [
      ctx.name,
      ctx.description ?? "",
      ...fieldValues,
    ])
    const score =
      textScore +
      (activeContextIds.has(ctx.id) ? 96 : 0) +
      scoreRecentStats(stats, messageTimestamp) +
      scoreContextCooccurrence(ctx.id, selectedTags, recentUserMessages) +
      scoreRecency(ctx.updatedAt, messageTimestamp, 12)

    if (score < 28) continue
    candidates.push({
      kind: "context",
      id: `context:${ctx.id}`,
      label: ctx.name,
      detail: "Context",
      score,
      icon: <Hash className="h-4 w-4 text-emerald-400" />,
      iconBg: "bg-emerald-400/10",
      onClick: () => onContext(ctx.id),
    })
  }

  for (const dateHit of extractExplicitDateSuggestions(messageText, messageTimestamp)) {
    if (selectedCalendarDates.includes(dateHit.date)) continue
    candidates.push({
      kind: "date",
      id: `date:${dateHit.date}`,
      label: formatDateShort(dateHit.date),
      detail: `Date / ${dateHit.detail}`,
      score: dateHit.score,
      icon: <CalendarDays className="h-4 w-4 text-sky-400" />,
      iconBg: "bg-sky-400/10",
      onClick: () => onDate(dateHit.date),
    })
  }

  const bestById = new Map<string, SuggestedItem>()
  for (const item of candidates) {
    const current = bestById.get(item.id)
    if (!current || item.score > current.score) bestById.set(item.id, item)
  }

  return [...bestById.values()]
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
    .slice(0, MAX)
}

type RecentAssociationStats = { count: number; last: number }

function buildRecentAssociationStats(messages: Message[], kind: "tag" | "context"): Map<string, RecentAssociationStats> {
  const stats = new Map<string, RecentAssociationStats>()
  for (const message of messages) {
    const ids = kind === "tag" ? getMessageTagIds(message) : (message.contextIds ?? [])
    const time = (message.updatedAt ?? message.createdAt ?? message.timestamp).getTime()
    for (const id of ids) {
      const current = stats.get(id) ?? { count: 0, last: 0 }
      stats.set(id, { count: current.count + 1, last: Math.max(current.last, time) })
    }
  }
  return stats
}

function normalizeTagCategoryId(categoryId: string): string {
  if (categoryId === "systemType") return "status"
  if (categoryId === "timedate") return "date"
  return categoryId || "custom"
}

function normalizeSuggestionText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function tokenizeSuggestionText(value: string): Set<string> {
  const stopWords = new Set([
    "the", "and", "for", "with", "this", "that", "you", "your", "from",
    "una", "uno", "para", "con", "que", "del", "las", "los", "por", "este", "esta",
  ])
  return new Set(
    normalizeSuggestionText(value)
      .split(" ")
      .filter((token) => token.length > 1 && !stopWords.has(token))
  )
}

function scoreTextEvidence(text: string, textTokens: Set<string>, rawPhrases: string[]): number {
  if (!text) return 0
  let score = 0
  for (const rawPhrase of rawPhrases) {
    const phrase = normalizeSuggestionText(rawPhrase)
    if (!phrase) continue
    const phraseTokens = phrase.split(" ").filter(Boolean)
    if (` ${text} ` === ` ${phrase} `) score = Math.max(score, 120)
    else if (` ${text} `.includes(` ${phrase} `)) score = Math.max(score, phraseTokens.length > 1 ? 88 : 66)
    else {
      const matched = phraseTokens.filter((token) => textTokens.has(token)).length
      if (matched > 0) {
        const ratio = matched / phraseTokens.length
        score = Math.max(score, Math.round(24 + ratio * 36 + Math.min(matched, 3) * 5))
      }
    }
  }
  return score
}

function getTagSemanticAliases(
  tag: MessageTag,
  categoryId: string,
  systemType: ReturnType<typeof parseSystemTypeTagId>
): string[] {
  const aliases: string[] = []
  if (systemType === "progress") aliases.push("progress", "avance", "update", "actualizacion", "done", "completed", "finished")
  if (systemType === "problem") aliases.push("problem", "issue", "bug", "blocked", "bloqueado", "error", "crash", "broken")
  if (systemType === "decision") aliases.push("decision", "decided", "approved", "resolved", "aprobado", "decidido")
  if (systemType === "feedback") aliases.push("feedback", "review", "revision", "check", "comment", "notes")
  if (categoryId === "task") aliases.push("task", "todo", "to do", "pending", "pendiente", "accion", "action")
  if (categoryId === "date") aliases.push("date", "fecha", "calendar", "calendario")
  if (categoryId === "report") aliases.push("report", "daily", "weekly", "standup", "analytics", "reporte", "informe")
  if (categoryId === "custom") aliases.push(tag.name)
  return aliases
}

function scoreRecentStats(stats: RecentAssociationStats | undefined, baseDate: Date): number {
  if (!stats) return 0
  return Math.min(stats.count * 14, 54) + scoreTimestampRecency(stats.last, baseDate, 22)
}

function scoreRecency(date: Date | null | undefined, baseDate: Date, max = 18): number {
  if (!date) return 0
  return scoreTimestampRecency(date.getTime(), baseDate, max)
}

function scoreTimestampRecency(time: number, baseDate: Date, max: number): number {
  if (!time) return 0
  const ageDays = Math.max(0, (baseDate.getTime() - time) / 86400000)
  if (ageDays <= 1) return max
  if (ageDays <= 7) return Math.round(max * 0.75)
  if (ageDays <= 30) return Math.round(max * 0.45)
  if (ageDays <= 90) return Math.round(max * 0.2)
  return 0
}

function scoreSelectedTagCooccurrence(tagId: string, selectedTags: string[], messages: Message[]): number {
  if (selectedTags.length === 0) return 0
  let matches = 0
  for (const message of messages) {
    const ids = getMessageTagIds(message)
    if (ids.includes(tagId) && selectedTags.some((selected) => ids.includes(selected))) matches += 1
  }
  return Math.min(matches * 16, 44)
}

function scoreContextCooccurrence(contextId: string, selectedTags: string[], messages: Message[]): number {
  if (selectedTags.length === 0) return 0
  let matches = 0
  for (const message of messages) {
    const contextIds = message.contextIds ?? []
    if (!contextIds.includes(contextId)) continue
    const tagIds = getMessageTagIds(message)
    if (selectedTags.some((selected) => tagIds.includes(selected))) matches += 1
  }
  return Math.min(matches * 18, 48)
}

type DateSuggestionHit = {
  date: string
  detail: string
  score: number
}

function extractExplicitDateSuggestions(text: string, baseDate: Date): DateSuggestionHit[] {
  const hits = new Map<string, DateSuggestionHit>()

  function add(date: Date, detail: string, score: number) {
    const iso = toDateInputValue(date)
    const current = hits.get(iso)
    if (!current || score > current.score) hits.set(iso, { date: iso, detail, score })
  }

  const isoRegex = /\b((?:19|20)\d{2})-(0?[1-9]|1[0-2])-([0-2]?\d|3[01])\b/g
  for (const match of text.matchAll(isoRegex)) {
    const date = buildValidDate(Number(match[1]), Number(match[2]), Number(match[3]))
    if (date) add(date, "Exact date", 150)
  }

  const numericRegex = /\b([0-2]?\d|3[01])[/.](0?[1-9]|1[0-2])(?:[/.]((?:19|20)?\d{2}))?\b/g
  for (const match of text.matchAll(numericRegex)) {
    const day = Number(match[1])
    const month = Number(match[2])
    const year = normalizeMatchedYear(match[3], baseDate)
    const date = buildValidDate(year, month, day)
    if (date) add(rollForwardIfYearMissing(date, baseDate, !match[3]), "Exact date", 146)
  }

  const englishMonthRegex = /\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|sept|october|oct|november|nov|december|dec)\s+([0-2]?\d|3[01])(?:st|nd|rd|th)?(?:,?\s+((?:19|20)\d{2}))?\b/gi
  for (const match of text.matchAll(englishMonthRegex)) {
    const month = MONTH_NAME_TO_INDEX[normalizeSuggestionText(match[1])]
    const day = Number(match[2])
    const year = match[3] ? Number(match[3]) : baseDate.getFullYear()
    const date = buildValidDate(year, month, day)
    if (date) add(rollForwardIfYearMissing(date, baseDate, !match[3]), "Exact date", 146)
  }

  const englishDayMonthRegex = /\b([0-2]?\d|3[01])(?:st|nd|rd|th)?\s+(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|sept|october|oct|november|nov|december|dec)(?:,?\s+((?:19|20)\d{2}))?\b/gi
  for (const match of text.matchAll(englishDayMonthRegex)) {
    const day = Number(match[1])
    const month = MONTH_NAME_TO_INDEX[normalizeSuggestionText(match[2])]
    const year = match[3] ? Number(match[3]) : baseDate.getFullYear()
    const date = buildValidDate(year, month, day)
    if (date) add(rollForwardIfYearMissing(date, baseDate, !match[3]), "Exact date", 144)
  }

  const spanishMonthRegex = /\b([0-2]?\d|3[01])\s+(?:de\s+)?(enero|ene|febrero|feb|marzo|mar|abril|abr|mayo|may|junio|jun|julio|jul|agosto|ago|septiembre|setiembre|sep|sept|octubre|oct|noviembre|nov|diciembre|dic)(?:\s+(?:de\s+)?((?:19|20)\d{2}))?\b/gi
  for (const match of text.matchAll(spanishMonthRegex)) {
    const day = Number(match[1])
    const month = MONTH_NAME_TO_INDEX[normalizeSuggestionText(match[2])]
    const year = match[3] ? Number(match[3]) : baseDate.getFullYear()
    const date = buildValidDate(year, month, day)
    if (date) add(rollForwardIfYearMissing(date, baseDate, !match[3]), "Exact date", 144)
  }

  if (/\b(tomorrow|manana)\b/i.test(normalizeSuggestionText(text))) {
    const tomorrow = startOfLocalDay(baseDate)
    tomorrow.setDate(tomorrow.getDate() + 1)
    add(tomorrow, "Tomorrow", 132)
  }

  const normalizedText = normalizeSuggestionText(text)
  for (const weekday of WEEKDAY_ALIASES) {
    const regex = new RegExp(`\\b(?:next\\s+|proximo\\s+|proxima\\s+)?(?:${weekday.alias})\\b`, "i")
    const match = normalizedText.match(regex)
    if (!match) continue
    const nextDate = nextWeekdayDate(baseDate, weekday.day, /^\s*(next|proximo|proxima)\b/i.test(match[0]))
    add(nextDate, capitalizeFirst(weekday.label), 128)
  }

  return [...hits.values()].sort((a, b) => b.score - a.score || a.date.localeCompare(b.date))
}

const MONTH_NAME_TO_INDEX: Record<string, number> = {
  january: 1, jan: 1, enero: 1, ene: 1,
  february: 2, feb: 2, febrero: 2,
  march: 3, mar: 3, marzo: 3,
  april: 4, apr: 4, abril: 4, abr: 4,
  may: 5, mayo: 5,
  june: 6, jun: 6, junio: 6,
  july: 7, jul: 7, julio: 7,
  august: 8, aug: 8, agosto: 8, ago: 8,
  september: 9, sep: 9, sept: 9, septiembre: 9, setiembre: 9,
  october: 10, oct: 10, octubre: 10,
  november: 11, nov: 11, noviembre: 11,
  december: 12, dec: 12, diciembre: 12, dic: 12,
}

const WEEKDAY_ALIASES = [
  { alias: "sunday|domingo", day: 0, label: "Sunday" },
  { alias: "monday|lunes", day: 1, label: "Monday" },
  { alias: "tuesday|martes", day: 2, label: "Tuesday" },
  { alias: "wednesday|miercoles", day: 3, label: "Wednesday" },
  { alias: "thursday|jueves", day: 4, label: "Thursday" },
  { alias: "friday|viernes", day: 5, label: "Friday" },
  { alias: "saturday|sabado", day: 6, label: "Saturday" },
]

function normalizeMatchedYear(value: string | undefined, baseDate: Date): number {
  if (!value) return baseDate.getFullYear()
  const year = Number(value)
  if (value.length === 2) return year >= 70 ? 1900 + year : 2000 + year
  return year
}

function buildValidDate(year: number, month: number, day: number): Date | null {
  if (!year || !month || !day) return null
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null
  return date
}

function rollForwardIfYearMissing(date: Date, baseDate: Date, yearMissing: boolean): Date {
  if (!yearMissing) return date
  const base = startOfLocalDay(baseDate)
  const next = new Date(date)
  if (next.getTime() < base.getTime()) next.setFullYear(next.getFullYear() + 1)
  return next
}

function nextWeekdayDate(baseDate: Date, targetDay: number, explicitNext: boolean): Date {
  const date = startOfLocalDay(baseDate)
  let delta = (targetDay - date.getDay() + 7) % 7
  if (explicitNext && delta === 0) delta = 7
  date.setDate(date.getDate() + delta)
  return date
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function toDateInputValue(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function capitalizeFirst(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function tagDotClass(tag: MessageTag): string {
  const systemType = parseSystemTypeTagId(tag.id)
  if (systemType === "progress") return "bg-progress"
  if (systemType === "problem") return "bg-problem"
  if (systemType === "feedback") return "bg-feedback"
  if (systemType === "decision") return "bg-decision"
  return "bg-violet-500"
}

function formatDateShort(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number)
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" })
}
