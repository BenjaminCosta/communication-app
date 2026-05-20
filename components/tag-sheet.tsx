"use client"

import { useState } from "react"
import { Check, Search, X } from "lucide-react"
import { cn, haptic } from "@/lib/utils"
import { useSwipeDismiss } from "@/hooks/use-swipe-dismiss"
import {
  type Message,
  type Project,
  type Contact,
  type ImportedContact,
  type Tag as MessageTag,
  getContactFromList,
  formatTime,
  getMessagePeopleIds,
  getMessageProjectIds,
  getMessageTagIds,
  getAvailableTags,
  parseProjectTagId,
  parseSystemTypeTagId,
  projectTagId,
  systemTypeTagId,
} from "@/lib/store"

interface TagSheetProps {
  message: Message
  onApply: (peopleIds: string[], tagIds: string[], importedContactIds: string[]) => void
  onClose: () => void
  projects: Project[]
  onCreateProject: (name: string, memberIds?: string[]) => Promise<Project>
  contacts: Contact[]
  importedContacts?: ImportedContact[]
  availableTags?: MessageTag[]
}

export function TagSheet({ message, onApply, onClose, projects, contacts, importedContacts = [], availableTags }: TagSheetProps) {
  const tags = availableTags ?? getAvailableTags(projects)
  const [selectedTags, setSelectedTags] = useState<string[]>(getMessageTagIds(message))
  // Pre-populate with existing participants minus the sender
  const [selectedParticipants, setSelectedParticipants] = useState<string[]>(
    getMessagePeopleIds(message)
  )
  const [selectedImported, setSelectedImported] = useState<string[]>(
    (message.contactIds ?? []).filter(Boolean)
  )
  const [userSearch, setUserSearch] = useState("")
  const [tagSearch, setTagSearch] = useState("")
  const [showTagPicker, setShowTagPicker] = useState(false)

  const isEditing = selectedTags.length > 0 || selectedParticipants.length > 0
  const contact = getContactFromList(message.senderId, contacts) ?? { id: message.senderId, name: "Unknown", initials: "?", color: "bg-white/10" }

  const toggleParticipant = (id: string) =>
    setSelectedParticipants((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    )

  const toggleImported = (id: string) =>
    setSelectedImported((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    )

  const toggleTag = (id: string) =>
    setSelectedTags((prev) =>
      prev.includes(id) ? prev.filter((tagId) => tagId !== id) : [...prev, id]
    )

  const filteredContacts = contacts.filter((c) =>
    c.name.toLowerCase().includes(userSearch.trim().toLowerCase())
  )
  const unregistered = importedContacts.filter(
    (c) => c.status === "not_registered" &&
      c.name.toLowerCase().includes(userSearch.trim().toLowerCase())
  )
  const filteredTags = tags.filter((tag) =>
    tag.name.toLowerCase().includes(tagSearch.trim().toLowerCase())
  )

  const { handlers: swipeHandlers, dragStyle } = useSwipeDismiss(onClose)

  const handleApply = () => {
    haptic.success()
    onApply(selectedParticipants, selectedTags, selectedImported)
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
        <div className="flex items-center justify-between px-4 mb-3">
          <h3 className="text-xs font-bold tracking-[1.5px] uppercase text-muted-foreground">
            {isEditing ? "Edit Message" : "Add Context"}
          </h3>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center"
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* Selected Message */}
        <div className="mx-4 mb-3 bg-card border border-white/10 rounded-xl p-2.5">
          <p className="text-xs font-bold text-muted-foreground mb-1">
            {contact.name} · {formatTime(message.timestamp)}
          </p>
          <p className="text-sm text-foreground/90 leading-snug max-h-16 overflow-hidden">
            {message.text}
          </p>
        </div>

        {/* People */}
        <h4 className="text-xs font-bold tracking-[1.5px] uppercase text-muted-foreground px-4 mb-2">
          People
        </h4>
        <div className="px-4 pb-2">
          <SearchInput
            value={userSearch}
            onChange={setUserSearch}
            placeholder="Search users"
          />
        </div>
        <div className="flex flex-wrap gap-2 px-4 pb-3 max-h-20 overflow-y-auto scrollbar-hide">
          {filteredContacts.length === 0 && unregistered.length === 0 && (
            <p className="text-xs text-muted-foreground py-1 px-1">No other users yet.</p>
          )}
          {filteredContacts.map((c) => {
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
          {unregistered.map((c) => {
            const active = selectedImported.includes(c.id)
            const initials = (c.name.match(/\b\w/g) ?? []).slice(0, 2).join("").toUpperCase() || "?"
            return (
              <button
                key={c.id}
                onClick={() => toggleImported(c.id)}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-semibold transition-all active:scale-95",
                  active
                    ? "bg-primary/15 border-primary/30 text-primary"
                    : "bg-white/5 border-white/10 text-muted-foreground/70"
                )}
              >
                <div className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center text-[10px] font-bold text-white/50">
                  {initials}
                </div>
                {c.name.split(" ")[0]}
                {active && <Check className="w-3 h-3" />}
              </button>
            )
          })}
        </div>

        {/* Divider */}
        <div className="h-px bg-white/10 mx-4 mb-3" />
        <h4 className="text-xs font-bold tracking-[1.5px] uppercase text-muted-foreground px-4 mb-2">
          Tags
        </h4>
        {selectedTags.length > 0 && (
          <div className="px-4 pb-2 flex gap-1.5 overflow-x-auto scrollbar-hide">
            {selectedTags.map((tagId) => {
              const tag = tags.find((item) => item.id === tagId)
              if (!tag) return null
              const isUnassigned = tag.id === systemTypeTagId("none")
              return (
                <button
                  key={tagId}
                  onClick={() => toggleTag(tagId)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap",
                    isUnassigned
                      ? "border-feedback/25 bg-feedback/12 text-feedback"
                      : "border-primary/25 bg-primary/12 text-primary"
                  )}
                >
                  <span>{tag.name}</span>
                  <X className="w-3 h-3" />
                </button>
              )
            })}
          </div>
        )}
        <div className="px-4 pb-2">
          <SearchInput
            value={tagSearch}
            onChange={setTagSearch}
            onFocus={() => setShowTagPicker(true)}
            onBlur={() => setTimeout(() => {
              if (selectedTags.length === 0) setShowTagPicker(false)
            }, 120)}
            placeholder="Search tags"
          />
        </div>
        {(showTagPicker || selectedTags.length > 0) && (
          <div className="flex flex-col gap-1 px-4 max-h-[140px] overflow-y-auto scrollbar-hide">
            {filteredTags.map((tag) => {
              const selected = selectedTags.includes(tag.id)
              const isUnassigned = tag.id === systemTypeTagId("none")
              return (
                <button
                  key={tag.id}
                  onClick={() => toggleTag(tag.id)}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 rounded-xl transition-colors",
                    selected ? isUnassigned ? "bg-feedback/15" : "bg-primary/15" : "active:bg-white/5"
                  )}
                >
                  <div className={cn("w-2 h-2 rounded-full flex-shrink-0", tagDotClass(tag))} />
                  <span className={cn("text-sm font-semibold flex-1 text-left", selected ? isUnassigned ? "text-feedback" : "text-primary" : "text-foreground/90")}>
                    {tag.name}
                  </span>
                  {selected && (
                    <Check className={cn("w-4 h-4", isUnassigned ? "text-feedback" : "text-primary")} />
                  )}
                </button>
              )
            })}
            {filteredTags.length === 0 && (
              <p className="text-xs text-muted-foreground py-2 px-1">No tags found.</p>
            )}
          </div>
        )}

        {/* Apply Button */}
        <button
          onClick={handleApply}
          className={cn(
            "mx-4 mt-4 w-[calc(100%-32px)] rounded-xl py-3 text-sm font-semibold tracking-wide transition-all",
            "bg-primary text-white shadow-[0_4px_14px_rgba(37,99,235,0.4)] active:scale-[0.98]"
          )}
        >
          {isEditing ? "Save →" : "Apply →"}
        </button>
      </div>
    </div>
  )
}

function tagDotClass(tag: MessageTag): string {
  const systemType = parseSystemTypeTagId(tag.id)
  if (systemType === "progress") return "bg-progress"
  if (systemType === "problem") return "bg-problem"
  if (systemType === "feedback") return "bg-feedback"
  if (systemType === "decision") return "bg-decision"
  const projectId = parseProjectTagId(tag.id)
  if (projectId) return tag.color
  return tag.color || "bg-primary"
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
    <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
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
