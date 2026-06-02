"use client"

import { useMemo, useState } from "react"
import {
  ArrowLeft,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
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
  getContactFromList,
  formatTime,
  getMessagePeopleIds,
  getMessageTagIds,
  getAvailableTags,
  parseProjectTagId,
  parseSystemTypeTagId,
  systemTypeTagId,
  isCategoryTimeBased,
  SYSTEM_CATEGORIES,
  getCategoryLabel,
} from "@/lib/store"
import { DatePickerModal } from "@/components/date-picker-modal"
import { CreateProjectModal } from "@/components/create-project-modal"
import { CategoryIcon, getCategoryDotClass } from "@/components/category-icon"

interface TagSheetProps {
  message: Message
  onApply: (peopleIds: string[], tagIds: string[], importedContactIds: string[], calendarDates?: string[]) => void
  onClose: () => void
  projects: Project[]
  onCreateProject: (name: string, memberIds?: string[], category?: string) => Promise<Project>
  contacts: Contact[]
  importedContacts?: ImportedContact[]
  availableTags?: MessageTag[]
  customCategories?: CategoryItem[]
  activeStreamFilters?: { peopleIds: string[]; tagIds: string[] }
  recentUserMessages?: Message[]
}

type SheetView =
  | { type: "main" }
  | { type: "people" }
  | { type: "tags" }
  | { type: "category"; categoryId: string; title: string }
  | { type: "dates" }

type TagGroup = { id: string; name: string; order: number; tags: MessageTag[] }

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
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [showCreateTagModal, setShowCreateTagModal] = useState(false)

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
  const tagGroups = useMemo(() => groupTagsByCategory(tags, customCategories), [tags, customCategories])
  const filteredTagGroups = useMemo(() => groupTagsByCategory(filteredTags, customCategories), [filteredTags, customCategories])

  const selectedPeopleCount = selectedParticipants.length + selectedImported.length
  const selectedContextCount = selectedPeopleCount + selectedTags.length + selectedCalendarDates.length
  const selectedTagObjects = selectedTags.map((id) => tags.find((tag) => tag.id === id)).filter(Boolean) as MessageTag[]
  const summaryItems = buildSummaryItems({
    contacts,
    importedContacts,
    selectedParticipants,
    selectedImported,
    selectedTagObjects,
    selectedCalendarDates,
    onParticipant: toggleParticipant,
    onImported: toggleImported,
    onTag: toggleTag,
    onDate: (date) => setSelectedCalendarDates((prev) => prev.filter((item) => item !== date)),
  })
  const suggestedItems = buildSmartSuggestions({
    contacts,
    importedContacts,
    tags,
    selectedParticipants,
    selectedImported,
    selectedTags,
    selectedCalendarDates,
    activeStreamFilters,
    recentUserMessages,
    messageText: message.text,
    onPerson: toggleParticipant,
    onImported: toggleImported,
    onTag: toggleTag,
    onDate: () => setShowDatePicker(true),
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

  function handleApply() {
    haptic.success()
    onApply(selectedParticipants, selectedTags, selectedImported, selectedCalendarDates)
  }

  function handleBack() {
    if (view.type === "category") {
      setView({ type: "tags" })
      return
    }
    setView({ type: "main" })
  }

  const title = view.type === "main"
    ? (selectedContextCount > 0 ? "Edit Message" : "Add Context")
    : view.type === "category"
      ? view.title
      : view.type === "people"
        ? "People"
        : view.type === "dates"
          ? "Dates"
          : "Tags"

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end md:items-center md:justify-center">
      <div onPointerDown={onClose} className="absolute inset-0 bg-black/60 backdrop-blur-sm cursor-default" />

      <div
        style={dragStyle}
        className="relative z-10 w-full md:w-120 md:mb-6 md:rounded-3xl glass-modal border-t md:border border-white/10 rounded-t-3xl animate-slide-up md:shadow-2xl max-h-[88dvh] flex flex-col"
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
            filteredTagGroups={filteredTagGroups}
            selectedParticipants={selectedParticipants}
            selectedImported={selectedImported}
            selectedTags={selectedTags}
            selectedCalendarDates={selectedCalendarDates}
            summaryItems={summaryItems}
            suggestedItems={suggestedItems}
            selectedPeopleCount={selectedPeopleCount}
            selectedContextCount={selectedContextCount}
            onToggleParticipant={toggleParticipant}
            onToggleImported={toggleImported}
            onToggleTag={toggleTag}
            onRemoveDate={(date) => setSelectedCalendarDates((prev) => prev.filter((item) => item !== date))}
            onOpenPeople={() => setView({ type: "people" })}
            onOpenTags={() => setView({ type: "tags" })}
            onOpenDates={() => setView({ type: "dates" })}
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
          <TagsCategoryView
            groups={tagGroups}
            selectedTags={selectedTags}
            selectedCalendarDates={selectedCalendarDates}
            onOpenCategory={(group) => setView({ type: "category", categoryId: group.id, title: group.name })}
            onCreateTag={() => setShowCreateTagModal(true)}
          />
        )}

        {view.type === "category" && (
          <TagCategoryDetailView
            group={tagGroups.find((group) => group.id === view.categoryId)}
            selectedTags={selectedTags}
            onToggleTag={toggleTag}
          />
        )}

        {view.type === "dates" && (
          <DatesDetailView
            selectedCalendarDates={selectedCalendarDates}
            onAddDate={() => setShowDatePicker(true)}
            onRemoveDate={(date) => setSelectedCalendarDates((prev) => prev.filter((item) => item !== date))}
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
          customCategories={customCategories}
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
  filteredTagGroups,
  selectedParticipants,
  selectedImported,
  selectedTags,
  selectedCalendarDates,
  summaryItems,
  suggestedItems,
  selectedPeopleCount,
  selectedContextCount,
  onToggleParticipant,
  onToggleImported,
  onToggleTag,
  onRemoveDate,
  onOpenPeople,
  onOpenTags,
  onOpenDates,
  onOpenDatePicker,
}: {
  message: Message
  contact: Contact
  query: string
  onQueryChange: (value: string) => void
  isSearching: boolean
  filteredContacts: Contact[]
  filteredImported: ImportedContact[]
  filteredTagGroups: TagGroup[]
  selectedParticipants: string[]
  selectedImported: string[]
  selectedTags: string[]
  selectedCalendarDates: string[]
  summaryItems: SummaryItem[]
  suggestedItems: SuggestedItem[]
  selectedPeopleCount: number
  selectedContextCount: number
  onToggleParticipant: (id: string) => void
  onToggleImported: (id: string) => void
  onToggleTag: (id: string) => void
  onRemoveDate: (date: string) => void
  onOpenPeople: () => void
  onOpenTags: () => void
  onOpenDates: () => void
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
        <SearchInput value={query} onChange={onQueryChange} placeholder="Search people, tags, dates..." />
      </div>

      {isSearching ? (
        <SearchResultsView
          filteredContacts={filteredContacts}
          filteredImported={filteredImported}
          filteredTagGroups={filteredTagGroups}
          selectedParticipants={selectedParticipants}
          selectedImported={selectedImported}
          selectedTags={selectedTags}
          onToggleParticipant={onToggleParticipant}
          onToggleImported={onToggleImported}
          onToggleTag={onToggleTag}
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
                    className="rounded-xl border border-white/10 bg-white/[0.04] px-1.5 py-2.5 text-center active:scale-[0.98] active:bg-white/8"
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
  filteredTagGroups,
  selectedParticipants,
  selectedImported,
  selectedTags,
  onToggleParticipant,
  onToggleImported,
  onToggleTag,
  onOpenDatePicker,
}: {
  filteredContacts: Contact[]
  filteredImported: ImportedContact[]
  filteredTagGroups: TagGroup[]
  selectedParticipants: string[]
  selectedImported: string[]
  selectedTags: string[]
  onToggleParticipant: (id: string) => void
  onToggleImported: (id: string) => void
  onToggleTag: (id: string) => void
  onOpenDatePicker: () => void
}) {
  const hasResults = filteredContacts.length > 0 || filteredImported.length > 0 || filteredTagGroups.length > 0
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
        {filteredTagGroups.flatMap((group) =>
          group.tags.map((tag) => (
            <SearchResultRow
              key={tag.id}
              selected={selectedTags.includes(tag.id)}
              icon={<span className={cn("h-2.5 w-2.5 rounded-full", tagDotClass(tag))} />}
              label={tag.name}
              typeLabel={group.name}
              onClick={() => onToggleTag(tag.id)}
            />
          ))
        )}
        <SearchResultRow
          selected={false}
          icon={<CalendarDays className="w-4 h-4 text-sky-400" />}
          label="Add date"
          typeLabel="Calendar"
          onClick={onOpenDatePicker}
        />
        {!hasResults && (
          <p className="px-1 py-3 text-xs text-muted-foreground">No people or tags found.</p>
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

function TagsCategoryView({
  groups,
  selectedTags,
  selectedCalendarDates,
  onOpenCategory,
  onCreateTag,
}: {
  groups: TagGroup[]
  selectedTags: string[]
  selectedCalendarDates: string[]
  onOpenCategory: (group: TagGroup) => void
  onCreateTag: () => void
}) {
  const [query, setQuery] = useState("")
  const q = query.trim().toLowerCase()
  const visibleGroups = q
    ? groups.filter((group) =>
        group.name.toLowerCase().includes(q) ||
        group.tags.some((tag) => tag.name.toLowerCase().includes(q))
      )
    : groups

  return (
    <div className="px-4 pb-4">
      <SearchInput value={query} onChange={setQuery} placeholder="Search tags..." />
      <div className="mt-3 flex flex-col gap-2">
        {visibleGroups.map((group) => (
          <CategoryRow
            key={group.id}
            group={group}
            selectedTags={selectedTags}
            selectedCalendarDates={selectedCalendarDates}
            onClick={() => onOpenCategory(group)}
          />
        ))}
        {visibleGroups.length === 0 && (
          <p className="px-1 py-3 text-xs text-muted-foreground">No categories found.</p>
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

function TagCategoryDetailView({
  group,
  selectedTags,
  onToggleTag,
}: {
  group?: TagGroup
  selectedTags: string[]
  onToggleTag: (id: string) => void
}) {
  if (!group) {
    return <p className="px-4 py-6 text-xs text-muted-foreground">No tags found.</p>
  }
  return (
    <div className="px-4 pb-4">
      <div className="rounded-2xl border border-white/10 bg-white/[0.035] overflow-hidden">
        <div className="flex items-center gap-3 border-b border-white/10 px-3 py-2">
          <CategoryIcon categoryId={group.id} />
          <span className="text-sm font-semibold text-foreground">{group.name}</span>
          <span className="ml-auto text-xs text-muted-foreground">{selectedTags.filter((id) => group.tags.some((tag) => tag.id === id)).length} selected</span>
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        </div>
        <div className="p-1">
          {group.tags.map((tag) => {
            const selected = selectedTags.includes(tag.id)
            return (
              <button
                key={tag.id}
                type="button"
                onClick={() => onToggleTag(tag.id)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
                  selected ? "bg-primary/15 text-primary" : "text-foreground/90 active:bg-white/5"
                )}
              >
                <span className={cn("h-3 w-3 rounded-full", tagDotClass(tag))} />
                <span className="flex-1 text-sm font-semibold">{tag.name}</span>
                <span className={cn(
                  "h-5 w-5 rounded-full border flex items-center justify-center",
                  selected ? "border-primary bg-primary text-white" : "border-white/20"
                )}>
                  {selected && <Check className="w-3.5 h-3.5" />}
                </span>
              </button>
            )
          })}
        </div>
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

type SummaryItem = {
  id: string
  label: string
  kind: "person" | "tag" | "date"
  tone?: "primary" | "date"
  icon?: React.ReactNode
  avatar?: React.ReactNode
  onRemove?: () => void
}

type SuggestedItem = {
  id: string
  label: string
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
}: {
  items: SummaryItem[]
  count: number
  onRemoveDate: (date: string) => void
  onOpenPeople: () => void
  onOpenTags: () => void
  onOpenDates: () => void
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
  tone: "people" | "tags" | "dates"
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

function CategoryRow({
  group,
  selectedTags,
  selectedCalendarDates,
  onClick,
}: {
  group: TagGroup
  selectedTags: string[]
  selectedCalendarDates: string[]
  onClick: () => void
}) {
  const selected = group.tags.filter((tag) => selectedTags.includes(tag.id))
  const detail = selected.length > 0
    ? selected.slice(0, 2).map((tag) => tag.name).join(", ") + (selected.length > 2 ? `, +${selected.length - 2}` : "")
    : (group.id === "timedate" || group.id === "date") && selectedCalendarDates.length > 0
      ? `${selectedCalendarDates.length} date${selectedCalendarDates.length !== 1 ? "s" : ""}`
      : "None"

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-left active:bg-white/8"
    >
      <CategoryIcon categoryId={group.id} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-foreground">{group.name}</span>
        <span className="block truncate text-xs text-muted-foreground">{detail}</span>
      </span>
      <span className="text-xs font-semibold text-muted-foreground">{selected.length} selected</span>
      <ChevronDown className="w-4 h-4 text-muted-foreground" />
    </button>
  )
}

function groupTagsByCategory(tags: MessageTag[], customCategories: CategoryItem[]): TagGroup[] {
  const categoryMap = new Map<string, TagGroup>()
  const orderedCategories = [
    ...SYSTEM_CATEGORIES,
    ...customCategories,
  ]

  orderedCategories.forEach((category, index) => {
    categoryMap.set(category.id, {
      id: category.id,
      name: category.name,
      order: index,
      tags: [],
    })
  })

  tags.forEach((tag) => {
    // Normalize legacy/system aliases so the UI never renders duplicate category rows.
    const rawCategory = tag.category || "custom"
    const categoryId = rawCategory === "timedate"
      ? "date"
      : rawCategory === "systemType"
        ? "status"
        : rawCategory
    if (!categoryMap.has(categoryId)) {
      categoryMap.set(categoryId, {
        id: categoryId,
        name: getCategoryLabel(categoryId, customCategories),
        order: 100,
        tags: [],
      })
    }
    categoryMap.get(categoryId)?.tags.push(tag)
  })

  return Array.from(categoryMap.values())
    .filter((group) =>
      group.tags.length > 0 ||
      group.id === "status" ||
      group.id === "custom" ||
      customCategories.some((category) => category.id === group.id)
    )
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
}

function buildSummaryItems({
  contacts,
  importedContacts,
  selectedParticipants,
  selectedImported,
  selectedTagObjects,
  selectedCalendarDates,
  onParticipant,
  onImported,
  onTag,
  onDate,
}: {
  contacts: Contact[]
  importedContacts: ImportedContact[]
  selectedParticipants: string[]
  selectedImported: string[]
  selectedTagObjects: MessageTag[]
  selectedCalendarDates: string[]
  onParticipant: (id: string) => void
  onImported: (id: string) => void
  onTag: (id: string) => void
  onDate: (date: string) => void
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

  return [...people, ...imported, ...tagItems, ...dateItems]
}

function buildSmartSuggestions({
  contacts,
  importedContacts,
  tags,
  selectedParticipants,
  selectedImported,
  selectedTags,
  selectedCalendarDates,
  activeStreamFilters,
  recentUserMessages,
  messageText,
  onPerson,
  onImported,
  onTag,
  onDate,
}: {
  contacts: Contact[]
  importedContacts: ImportedContact[]
  tags: MessageTag[]
  selectedParticipants: string[]
  selectedImported: string[]
  selectedTags: string[]
  selectedCalendarDates: string[]
  activeStreamFilters?: { peopleIds: string[]; tagIds: string[] }
  recentUserMessages: Message[]
  messageText: string
  onPerson: (id: string) => void
  onImported: (id: string) => void
  onTag: (id: string) => void
  onDate: () => void
}): SuggestedItem[] {
  const MAX = 4
  const seen = new Set<string>()
  const items: SuggestedItem[] = []

  function pushPerson(c: Contact) {
    if (seen.has(`p:${c.id}`)) return
    seen.add(`p:${c.id}`)
    items.push({
      id: `person:${c.id}`,
      label: c.name.split(" ")[0],
      icon: <AvatarMini initials={c.initials} color={c.color} />,
      iconBg: "bg-transparent",
      onClick: () => onPerson(c.id),
    })
  }

  function pushImported(c: ImportedContact) {
    if (seen.has(`pi:${c.id}`)) return
    seen.add(`pi:${c.id}`)
    items.push({
      id: `imported:${c.id}`,
      label: c.name.split(" ")[0],
      icon: <AvatarMini initials={(c.name.match(/\b\w/g) ?? []).slice(0, 2).join("").toUpperCase() || "?"} color="bg-white/10" muted />,
      iconBg: "bg-transparent",
      onClick: () => onImported(c.id),
    })
  }

  function pushTag(t: MessageTag) {
    if (seen.has(`t:${t.id}`)) return
    seen.add(`t:${t.id}`)
    items.push({
      id: `tag:${t.id}`,
      label: t.name,
      icon: <span className={cn("h-4 w-4 rounded-full", tagDotClass(t))} />,
      iconBg: "bg-white/5",
      onClick: () => onTag(t.id),
    })
  }

  function pushDate() {
    if (seen.has("date:add")) return
    seen.add("date:add")
    items.push({
      id: "date:add",
      label: selectedCalendarDates.length > 0 ? "Dates" : "Add date",
      icon: <CalendarDays className="w-4 h-4 text-sky-400" />,
      iconBg: "bg-sky-400/10",
      onClick: onDate,
    })
  }

  // ── Source 1: Active stream filters ──────────────────────────────────────
  for (const pid of activeStreamFilters?.peopleIds ?? []) {
    if (items.length >= MAX) break
    if (selectedParticipants.includes(pid)) continue
    const c = contacts.find((c) => c.id === pid)
    if (c) pushPerson(c)
  }
  for (const tid of activeStreamFilters?.tagIds ?? []) {
    if (items.length >= MAX) break
    if (selectedTags.includes(tid)) continue
    const t = tags.find((t) => t.id === tid)
    if (t) pushTag(t)
  }

  // ── Source 2: Top recent people by frequency ──────────────────────────────
  const tagFreq: Record<string, number> = {}
  const peopleFreq: Record<string, number> = {}
  for (const msg of recentUserMessages) {
    for (const tid of msg.tagIds ?? []) tagFreq[tid] = (tagFreq[tid] ?? 0) + 1
    for (const pid of [...(msg.peopleIds ?? []), ...(msg.recipientIds ?? [])])
      peopleFreq[pid] = (peopleFreq[pid] ?? 0) + 1
  }
  const sortedPeopleIds = Object.entries(peopleFreq).sort((a, b) => b[1] - a[1]).map(([id]) => id)
  const sortedTagIds = Object.entries(tagFreq).sort((a, b) => b[1] - a[1]).map(([id]) => id)

  for (const pid of sortedPeopleIds) {
    if (items.length >= MAX) break
    if (selectedParticipants.includes(pid) || seen.has(`p:${pid}`)) continue
    const c = contacts.find((c) => c.id === pid)
    if (c) pushPerson(c)
  }

  // ── Source 3: Keyword heuristics on message text ──────────────────────────
  if (items.length < MAX) {
    const text = messageText.toLowerCase()
    const hintMap: Array<[RegExp, string]> = [
      [/mañana|tomorrow|next.?week|later|deadline|follow.?up|schedule/i, "timedate"],
      [/done|progress|advance|completed|finished/i, "progress"],
      [/problem|issue|bug|blocked|error|crash|broken/i, "problem"],
      [/decision|decided|approved|resolved/i, "decision"],
      [/feedback|review|check|revisit/i, "feedback"],
      [/daily|report|update|standup/i, "report"],
      [/task|todo|pending|assign/i, "task"],
    ]
    for (const [regex, hint] of hintMap) {
      if (items.length >= MAX) break
      if (!regex.test(text)) continue
      if (hint === "timedate") {
        pushDate()
        continue
      }
      const matched =
        tags.find((t) => parseSystemTypeTagId(t.id) === hint && !selectedTags.includes(t.id) && !seen.has(`t:${t.id}`)) ??
        tags.find((t) => t.category === hint && !selectedTags.includes(t.id) && !seen.has(`t:${t.id}`))
      if (matched) pushTag(matched)
    }
  }

  // ── Source 4: Top recent tags by frequency ────────────────────────────────
  for (const tid of sortedTagIds) {
    if (items.length >= MAX) break
    if (selectedTags.includes(tid) || seen.has(`t:${tid}`)) continue
    const t = tags.find((t) => t.id === tid)
    if (t) pushTag(t)
  }

  // Fallback: date chip
  if (items.length < MAX) pushDate()

  // Fallback: any unselected tag
  for (const t of tags) {
    if (items.length >= MAX) break
    if (selectedTags.includes(t.id) || seen.has(`t:${t.id}`)) continue
    pushTag(t)
  }

  // Hide rule: need ≥ 2 candidates
  if (items.length < 2) return []
  return items.slice(0, MAX)
}

function tagDotClass(tag: MessageTag): string {
  const systemType = parseSystemTypeTagId(tag.id)
  if (systemType === "progress") return "bg-progress"
  if (systemType === "problem") return "bg-problem"
  if (systemType === "feedback") return "bg-feedback"
  if (systemType === "decision") return "bg-decision"
  return getCategoryDotClass(tag.category)
}

function formatDateShort(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number)
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" })
}
