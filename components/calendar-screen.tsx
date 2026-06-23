"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { ArrowLeft, CalendarDays, ChevronLeft, ChevronRight, Check, Clock, Plus, Search, X } from "lucide-react"
import { cn, haptic } from "@/lib/utils"
import { useSwipeDismiss } from "@/hooks/use-swipe-dismiss"
import {
  type Contact,
  type ImportedContact,
  type Message,
  type Project,
  type Tag as MessageTag,
  getAvailableTags,
  getMessageTagIds,
  getMessagePeopleIds,
  parseProjectTagId,
  parseSystemTypeTagId,
  systemTypeTagId,
  MESSAGE_TYPE_CONFIG,
} from "@/lib/store"

interface CalendarScreenProps {
  messages: Message[]
  contacts: Contact[]
  importedContacts?: ImportedContact[]
  projects: Project[]
  currentUserId: string
  onBack: () => void
  onSendMessage: (text: string, date: string, peopleIds: string[], tagIds: string[], importedContactIds: string[]) => Promise<void>
  onMessageClick: (message: Message) => void
  className?: string
}

// ── Calendar utilities ──────────────────────────────────────────────────────

const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
]
const DAY_SHORT = ["Su","Mo","Tu","We","Th","Fr","Sa"]

function toDateStr(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2,"0")}-${String(day).padStart(2,"0")}`
}

function todayStr(): string {
  const d = new Date()
  return toDateStr(d.getFullYear(), d.getMonth(), d.getDate())
}

function formatDayLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number)
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })
}

function tagDotClass(tag: MessageTag): string {
  const systemType = parseSystemTypeTagId(tag.id)
  if (systemType === "progress") return "bg-progress"
  if (systemType === "problem") return "bg-problem"
  if (systemType === "feedback") return "bg-feedback"
  if (systemType === "decision") return "bg-decision"
  return "bg-violet-500"
}

// ── CalendarScreen ──────────────────────────────────────────────────────────

export function CalendarScreen({
  messages, contacts, importedContacts = [], projects, currentUserId,
  onBack, onSendMessage, onMessageClick, className,
}: CalendarScreenProps) {
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())
  const [selectedDate, setSelectedDate] = useState<string>(todayStr())
  const [showComposeSheet, setShowComposeSheet] = useState(false)

  const iso = todayStr()

  const messagesByDate = useMemo(() => {
    const map = new Map<string, Message[]>()
    for (const msg of messages) {
      if (!Array.isArray(msg.calendarDates) || msg.calendarDates.length === 0) continue
      for (const cd of msg.calendarDates) {
        if (!cd.date) continue
        const existing = map.get(cd.date) ?? []
        if (!existing.some((m) => m.id === msg.id)) map.set(cd.date, [...existing, msg])
      }
    }
    return map
  }, [messages])

  const monthEventCount = useMemo(() => {
    let count = 0
    for (let d = 1; d <= new Date(year, month + 1, 0).getDate(); d++) {
      count += messagesByDate.get(toDateStr(year, month, d))?.length ?? 0
    }
    return count
  }, [year, month, messagesByDate])

  const prevMonth = () => {
    if (month === 0) { setYear(y => y - 1); setMonth(11) } else setMonth(m => m - 1)
  }
  const nextMonth = () => {
    if (month === 11) { setYear(y => y + 1); setMonth(0) } else setMonth(m => m + 1)
  }

  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const firstWeekday = new Date(year, month, 1).getDay()
  const cells: (number | null)[] = [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  const dayMessages = messagesByDate.get(selectedDate) ?? []

  return (
    <div className={cn("flex-1 min-h-0 flex flex-col stream-glass-screen", className ?? "animate-fade-in")}>
      {/* Header */}
      <div className="flex-shrink-0 border-b border-white/10 animate-slide-down">
        <div className="max-w-2xl mx-auto px-4 md:px-6 app-topbar flex items-center gap-3">
          <button onClick={onBack} className="w-9 h-9 rounded-full bg-white/5 border border-white/10 flex items-center justify-center active:scale-95 hover:bg-white/8 transition-all duration-150">
            <ArrowLeft className="w-4 h-4 text-muted-foreground" />
          </button>
          <h1 className="text-base font-bold tracking-tight flex-1">Calendar</h1>
          {monthEventCount > 0 && (
            <span className="text-[10px] font-bold font-mono text-muted-foreground bg-white/5 border border-white/10 rounded-full px-2 py-0.5">
              {monthEventCount} item{monthEventCount !== 1 ? "s" : ""}
            </span>
          )}
          <CalendarDays className="w-4 h-4 text-muted-foreground/30" />
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide">
        <div className="max-w-2xl mx-auto px-4 md:px-6">
          {/* Month navigator */}
          <div className="flex items-center justify-between py-4">
            <button onClick={prevMonth} className="w-9 h-9 rounded-full bg-white/5 border border-white/10 flex items-center justify-center active:scale-95 transition-all">
              <ChevronLeft className="w-4 h-4 text-muted-foreground" />
            </button>
            <h2 className="text-base font-bold text-foreground">{MONTH_NAMES[month]} {year}</h2>
            <button onClick={nextMonth} className="w-9 h-9 rounded-full bg-white/5 border border-white/10 flex items-center justify-center active:scale-95 transition-all">
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>

          {/* Day-of-week headers */}
          <div className="grid grid-cols-7 mb-1">
            {DAY_SHORT.map(d => (
              <div key={d} className="text-center text-[10px] font-bold uppercase tracking-wider text-muted-foreground/35 py-1">{d}</div>
            ))}
          </div>

          {/* Calendar cells */}
          <div className="grid grid-cols-7 gap-y-1 mb-5">
            {cells.map((day, i) => {
              if (!day) return <div key={`e-${i}`} className="aspect-square" />
              const dateStr = toDateStr(year, month, day)
              const isSelected = dateStr === selectedDate
              const isToday = dateStr === iso
              const count = messagesByDate.get(dateStr)?.length ?? 0
              return (
                <button
                  key={dateStr}
                  onClick={() => setSelectedDate(dateStr)}
                  className={cn(
                    "aspect-square rounded-xl flex flex-col items-center justify-center gap-[3px] transition-all active:scale-90 select-none",
                    isSelected ? "bg-primary text-white shadow-[0_2px_14px_rgba(37,99,235,0.45)]"
                    : isToday ? "bg-white/10 text-foreground"
                    : "text-foreground/65 hover:bg-white/5"
                  )}
                >
                  <span className="text-sm font-semibold leading-none">{day}</span>
                  {count > 0 && (
                    <div className="flex items-center gap-[3px]">
                      {Array.from({ length: Math.min(count, 3) }).map((_, di) => (
                        <div key={di} className={cn("w-[5px] h-[5px] rounded-full", isSelected ? "bg-white/60" : "bg-primary/70")} />
                      ))}
                    </div>
                  )}
                </button>
              )
            })}
          </div>

          {/* Day detail panel */}
          <div className="border-t border-white/10 pt-4 pb-28">
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-[10px] font-bold tracking-[2px] uppercase text-muted-foreground/50 font-mono mb-0.5">
                  {dayMessages.length > 0 ? `${dayMessages.length} item${dayMessages.length !== 1 ? "s" : ""}` : "No items"}
                </p>
                <p className="text-sm font-semibold text-foreground">{formatDayLabel(selectedDate)}</p>
              </div>
              <button
                onClick={() => setShowComposeSheet(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/15 border border-primary/30 text-primary text-xs font-semibold active:scale-95 hover:bg-primary/20 transition-all mt-0.5"
              >
                <Plus className="w-3.5 h-3.5" />
                Add
              </button>
            </div>

            {dayMessages.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-10">
                <div className="w-14 h-14 rounded-full bg-white/5 border border-white/10 flex items-center justify-center">
                  <Clock className="w-6 h-6 text-muted-foreground/30" />
                </div>
                <p className="text-sm text-muted-foreground">Nothing scheduled</p>
                <button onClick={() => setShowComposeSheet(true)} className="text-xs text-primary font-semibold active:opacity-70">
                  Add an item →
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {dayMessages.map(msg => (
                  <CalendarMessageCard
                    key={msg.id}
                    message={msg}
                    contacts={contacts}
                    projects={projects}
                    currentUserId={currentUserId}
                    onClick={() => onMessageClick(msg)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Compose sheet */}
      {showComposeSheet && (
        <CalendarComposeSheet
          date={selectedDate}
          contacts={contacts}
          importedContacts={importedContacts}
          projects={projects}
          onSend={onSendMessage}
          onClose={() => setShowComposeSheet(false)}
        />
      )}
    </div>
  )
}

// ── CalendarComposeSheet ────────────────────────────────────────────────────

function CalendarComposeSheet({
  date, contacts, importedContacts, projects, onSend, onClose,
}: {
  date: string
  contacts: Contact[]
  importedContacts: ImportedContact[]
  projects: Project[]
  onSend: (text: string, date: string, peopleIds: string[], tagIds: string[], importedContactIds: string[]) => Promise<void>
  onClose: () => void
}) {
  const [text, setText] = useState("")
  const [sending, setSending] = useState(false)
  const [selectedParticipants, setSelectedParticipants] = useState<string[]>([])
  const [selectedImported, setSelectedImported] = useState<string[]>([])
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [userSearch, setUserSearch] = useState("")
  const [tagSearch, setTagSearch] = useState("")
  const [showTagPicker, setShowTagPicker] = useState(false)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const t = setTimeout(() => textareaRef.current?.focus({ preventScroll: true }), 80)
    return () => clearTimeout(t)
  }, [])

  const tags = getAvailableTags(projects)
  const { handlers: swipeHandlers, dragStyle } = useSwipeDismiss(onClose)

  const filteredContacts = contacts.filter(c =>
    c.name.toLowerCase().includes(userSearch.trim().toLowerCase())
  )
  const unregistered = importedContacts.filter(
    c => c.status === "not_registered" &&
      c.name.toLowerCase().includes(userSearch.trim().toLowerCase())
  )
  const filteredTags = tags.filter(tag =>
    tag.name.toLowerCase().includes(tagSearch.trim().toLowerCase())
  )

  const toggleParticipant = (id: string) =>
    setSelectedParticipants(prev => prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id])

  const toggleImported = (id: string) =>
    setSelectedImported(prev => prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id])

  const toggleTag = (id: string) =>
    setSelectedTags(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id])

  const handleSend = async () => {
    if (!text.trim() || sending) return
    haptic.success()
    setSending(true)
    try {
      await onSend(text.trim(), date, selectedParticipants, selectedTags, selectedImported)
      onClose()
    } finally {
      setSending(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleSend() }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end md:items-center md:justify-center">
      <div onPointerDown={onClose} className="absolute inset-0 bg-black/60 backdrop-blur-sm cursor-default" />

      <div
        style={dragStyle}
        className="relative z-10 w-full md:w-120 md:mb-6 md:rounded-3xl glass-modal border-t md:border border-white/10 rounded-t-3xl animate-slide-up md:shadow-2xl max-h-[85dvh] overflow-y-auto scrollbar-hide safe-area-pb"
      >
        {/* Drag handle */}
        <div {...swipeHandlers} className="py-3 touch-none cursor-grab active:cursor-grabbing">
          <div className="w-10 h-1 rounded-full bg-white/20 mx-auto" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-4 mb-3">
          <h3 className="text-xs font-bold tracking-[1.5px] uppercase text-muted-foreground">Add to Calendar</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* Date chip */}
        <div className="px-4 mb-3">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-sky-400 bg-sky-400/10 border border-sky-400/25 rounded-full px-2.5 py-1">
            <CalendarDays className="w-3 h-3" />
            {formatDayLabel(date)}
          </span>
        </div>

        {/* Text area */}
        <div className="px-4 mb-4">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="What's happening on this day?"
            rows={3}
            className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none resize-none focus:border-white/20 transition-colors"
          />
        </div>

        {/* Divider */}
        <div className="h-px bg-white/10 mx-4 mb-3" />

        {/* People */}
        <h4 className="text-xs font-bold tracking-[1.5px] uppercase text-muted-foreground px-4 mb-2">People</h4>
        <div className="px-4 pb-2">
          <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
            <Search className="w-4 h-4 text-muted-foreground" />
            <input
              value={userSearch}
              onChange={e => setUserSearch(e.target.value)}
              placeholder="Search users"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
            />
          </label>
        </div>
        <div className="flex flex-wrap gap-2 px-4 pb-3 max-h-20 overflow-y-auto scrollbar-hide">
          {filteredContacts.length === 0 && unregistered.length === 0 && (
            <p className="text-xs text-muted-foreground py-1 px-1">No other users yet.</p>
          )}
          {filteredContacts.map(c => {
            const active = selectedParticipants.includes(c.id)
            return (
              <button
                key={c.id}
                onClick={() => toggleParticipant(c.id)}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-semibold transition-all active:scale-95",
                  active ? "bg-primary/15 border-primary/30 text-primary" : "bg-white/5 border-white/10 text-muted-foreground"
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
          {unregistered.map(c => {
            const active = selectedImported.includes(c.id)
            const initials = (c.name.match(/\b\w/g) ?? []).slice(0, 2).join("").toUpperCase() || "?"
            return (
              <button
                key={c.id}
                onClick={() => toggleImported(c.id)}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-semibold transition-all active:scale-95",
                  active ? "bg-primary/15 border-primary/30 text-primary" : "bg-white/5 border-white/10 text-muted-foreground/70"
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

        {/* Tags */}
        <h4 className="text-xs font-bold tracking-[1.5px] uppercase text-muted-foreground px-4 mb-2">Tags</h4>
        {selectedTags.length > 0 && (
          <div className="px-4 pb-2 flex gap-1.5 overflow-x-auto scrollbar-hide">
            {selectedTags.map(tagId => {
              const tag = tags.find(t => t.id === tagId)
              if (!tag) return null
              const isUnassigned = tag.id === systemTypeTagId("none")
              return (
                <button
                  key={tagId}
                  onClick={() => toggleTag(tagId)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap",
                    isUnassigned ? "border-feedback/25 bg-feedback/12 text-feedback" : "border-primary/25 bg-primary/12 text-primary"
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
          <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
            <Search className="w-4 h-4 text-muted-foreground" />
            <input
              value={tagSearch}
              onChange={e => setTagSearch(e.target.value)}
              onFocus={() => setShowTagPicker(true)}
              onBlur={() => setTimeout(() => { if (selectedTags.length === 0) setShowTagPicker(false) }, 120)}
              placeholder="Search tags"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
            />
          </label>
        </div>
        {(showTagPicker || selectedTags.length > 0) && (
          <div className="flex flex-col gap-1 px-4 max-h-[120px] overflow-y-auto scrollbar-hide">
            {filteredTags.map(tag => {
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
                  <div className={cn("w-2 h-2 rounded-full shrink-0", tagDotClass(tag))} />
                  <span className={cn("text-sm font-semibold flex-1 text-left", selected ? isUnassigned ? "text-feedback" : "text-primary" : "text-foreground/90")}>
                    {tag.name}
                  </span>
                  {selected && <Check className={cn("w-4 h-4 shrink-0", isUnassigned ? "text-feedback" : "text-primary")} />}
                </button>
              )
            })}
            {filteredTags.length === 0 && <p className="text-xs text-muted-foreground py-2 px-1">No tags found.</p>}
          </div>
        )}

        {/* Save button */}
        <button
          onClick={handleSend}
          disabled={!text.trim() || sending}
          className={cn(
            "mx-4 mt-4 mb-2 w-[calc(100%-32px)] rounded-xl py-3 text-sm font-semibold tracking-wide transition-all active:scale-[0.98]",
            "bg-primary text-white shadow-[0_4px_14px_rgba(37,99,235,0.4)] disabled:opacity-40 disabled:shadow-none"
          )}
        >
          {sending ? "Saving…" : "Save →"}
        </button>
      </div>
    </div>
  )
}

// ── CalendarMessageCard ─────────────────────────────────────────────────────

function CalendarMessageCard({
  message, contacts, projects, currentUserId, onClick,
}: {
  message: Message
  contacts: Contact[]
  projects: Project[]
  currentUserId: string
  onClick: () => void
}) {
  const isMe = message.senderId === currentUserId || message.authorId === currentUserId
  const author = contacts.find(c => c.id === message.senderId || c.id === message.authorId)
  const authorName = isMe ? "You" : (author?.name ?? "Unknown")
  const authorColor = isMe ? "bg-primary" : (author?.color ?? "bg-slate-600")
  const authorInitials = isMe ? "Me" : (author?.initials ?? "?")

  const tagIds = getMessageTagIds(message)
  const projectTagPills = tagIds
    .map(id => {
      const projectId = parseProjectTagId(id)
      if (!projectId) return null
      const proj = projects.find(p => p.id === projectId)
      if (!proj) return null
      return { name: proj.name, dotClass: "bg-violet-500" }
    })
    .filter(Boolean) as { name: string; dotClass: string }[]

  const typeTagId = tagIds.find(id => !!parseSystemTypeTagId(id))
  const typeTag = typeTagId ? parseSystemTypeTagId(typeTagId) : null
  const typeConfig = typeTag ? MESSAGE_TYPE_CONFIG[typeTag] : null
  const recipientCount = (message.recipientIds ?? []).length

  return (
    <button
      onClick={onClick}
      className="w-full p-4 rounded-2xl bg-card border border-white/10 hover:bg-white/[0.04] active:bg-white/5 transition-colors text-left group"
    >
      <div className="flex items-center gap-2 mb-2">
        <div className={cn("w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-[10px] font-bold text-white", authorColor)}>
          {authorInitials}
        </div>
        <span className="text-xs font-semibold text-foreground/70">{authorName}</span>
        {typeConfig && typeTag && (typeTag as string) !== "none" && (
          <span className={cn("text-[10px] font-bold uppercase tracking-wide font-mono", typeConfig.text)}>{typeConfig.label}</span>
        )}
        {recipientCount > 0 && (
          <span className="text-[10px] text-muted-foreground/50 ml-auto">{recipientCount} {recipientCount === 1 ? "person" : "people"}</span>
        )}
      </div>
      <p className="text-sm text-foreground/90 leading-relaxed line-clamp-3 mb-2">
        {message.text || message.content || "(no text)"}
      </p>
      {projectTagPills.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {projectTagPills.map((tag, i) => (
            <span key={i} className="inline-flex items-center gap-1 text-[10px] font-semibold text-muted-foreground/60 bg-white/5 border border-white/10 rounded-full px-2 py-0.5">
              <span className={cn("w-1.5 h-1.5 rounded-full", tag.dotClass)} />
              {tag.name}
            </span>
          ))}
        </div>
      )}
      <p className="text-[10px] text-muted-foreground/30 mt-2 group-hover:text-muted-foreground/50 transition-colors">
        Tap to edit context →
      </p>
    </button>
  )
}
