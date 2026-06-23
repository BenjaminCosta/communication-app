"use client"

import { useEffect, useRef, useState } from "react"
import { CalendarDays, Hash, LayoutGrid, MessageSquare, Search, Users, X } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  type Contact,
  type ImportedContact,
  type Message,
  type Project,
  type Tag as MessageTag,
  type AppContext,
  formatTime,
  systemTypeTagId,
} from "@/lib/store"

interface GlobalSearchSheetProps {
  onClose: () => void
  messages?: Message[]
  contacts?: Contact[]
  importedContacts?: ImportedContact[]
  projects?: Project[]
  availableTags?: MessageTag[]
  contexts?: AppContext[]
  currentUserId?: string
  onMessageClick?: (message: Message) => void
  onPersonFilterClick?: (personId: string) => void
  onTagFilterClick?: (tagId: string) => void
  onContextFilterClick?: (contextId: string) => void
}

type ResultSection = "messages" | "people" | "tags" | "dates" | "contexts"

const SECTION_META: Record<ResultSection, {
  label: string
  icon: React.ReactNode
  color: string
  sectionBg: string
  iconBg: string
  activeBg: string
}> = {
  messages: {
    label: "Messages",
    icon: <MessageSquare className="w-3.5 h-3.5" />,
    color: "text-violet-400",
    sectionBg: "bg-violet-400/[0.07]",
    iconBg: "bg-violet-400/12 border-violet-400/20",
    activeBg: "active:bg-violet-400/10",
  },
  people: {
    label: "People",
    icon: <Users className="w-3.5 h-3.5" />,
    color: "text-amber-400",
    sectionBg: "bg-amber-400/[0.07]",
    iconBg: "bg-amber-400/12 border-amber-400/20",
    activeBg: "active:bg-amber-400/10",
  },
  tags: {
    label: "Tags",
    icon: <LayoutGrid className="w-3.5 h-3.5" />,
    color: "text-primary",
    sectionBg: "bg-primary/[0.07]",
    iconBg: "bg-primary/12 border-primary/20",
    activeBg: "active:bg-primary/10",
  },
  dates: {
    label: "Dates",
    icon: <CalendarDays className="w-3.5 h-3.5" />,
    color: "text-sky-400",
    sectionBg: "bg-sky-400/[0.07]",
    iconBg: "bg-sky-400/12 border-sky-400/20",
    activeBg: "active:bg-sky-400/10",
  },
  contexts: {
    label: "Contexts",
    icon: <Hash className="w-3.5 h-3.5" />,
    color: "text-emerald-400",
    sectionBg: "bg-emerald-400/[0.07]",
    iconBg: "bg-emerald-400/12 border-emerald-400/20",
    activeBg: "active:bg-emerald-400/10",
  },
}

export function GlobalSearchSheet({
  onClose,
  messages = [],
  contacts = [],
  importedContacts: _importedContacts = [],
  projects: _projects = [],
  availableTags = [],
  contexts = [],
  onMessageClick,
  onPersonFilterClick,
  onTagFilterClick,
  onContextFilterClick,
}: GlobalSearchSheetProps) {
  const [query, setQuery] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus input on mount
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 80)
    return () => clearTimeout(t)
  }, [])

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [onClose])

  const trimmed = query.trim().toLowerCase()
  const hasQuery = trimmed.length > 0

  // ── Search computations (client-side, real-time) ──────────────────────────

  const messageResults: SearchResult[] = hasQuery
    ? messages
        .filter((m) => m.text.toLowerCase().includes(trimmed))
        .slice(0, 5)
        .map((m) => ({
          id: m.id,
          primary: m.text.length > 80 ? m.text.slice(0, 80) + "…" : m.text,
          secondary: formatTime(m.timestamp),
          onClick: () => { onMessageClick?.(m); onClose() },
        }))
    : []

  const peopleResults: SearchResult[] = hasQuery
    ? contacts
        .filter((c) => c.name.toLowerCase().includes(trimmed))
        .slice(0, 5)
        .map((c) => ({
          id: c.id,
          primary: c.name,
          secondary: "Person",
          onClick: () => { onPersonFilterClick?.(c.id); onClose() },
        }))
    : []

  const tagResults: SearchResult[] = hasQuery
    ? availableTags
        .filter((t) => t.name.toLowerCase().includes(trimmed) && t.id !== systemTypeTagId("none"))
        .slice(0, 5)
        .map((t) => ({
          id: t.id,
          primary: t.name,
          secondary: "Tag",
          onClick: () => { onTagFilterClick?.(t.id); onClose() },
        }))
    : []

  const dateResults: SearchResult[] = hasQuery
    ? messages
        .filter((m) =>
          (m.calendarDates ?? []).some((cd) =>
            fmtDate(cd.date).toLowerCase().includes(trimmed) || cd.date.includes(trimmed)
          )
        )
        .slice(0, 5)
        .map((m) => {
          const matched = (m.calendarDates ?? []).find((cd) =>
            fmtDate(cd.date).toLowerCase().includes(trimmed) || cd.date.includes(trimmed)
          )
          return {
            id: `${m.id}:${matched?.date ?? ""}`,
            primary: fmtDate(matched?.date ?? ""),
            secondary: m.text.length > 60 ? m.text.slice(0, 60) + "…" : m.text,
            onClick: () => { onMessageClick?.(m); onClose() },
          }
        })
    : []

  const contextResults: SearchResult[] = hasQuery
    ? contexts
        .filter((c) =>
          c.name.toLowerCase().includes(trimmed) ||
          (c.description ?? "").toLowerCase().includes(trimmed) ||
          c.fields.some((f) => f.label.toLowerCase().includes(trimmed) || f.value.toLowerCase().includes(trimmed))
        )
        .slice(0, 5)
        .map((c) => ({
          id: c.id,
          primary: c.name,
          secondary: c.description || (c.fields.length > 0 ? `${c.fields.length} field${c.fields.length !== 1 ? "s" : ""}` : "Context"),
          onClick: () => { onContextFilterClick?.(c.id); onClose() },
        }))
    : []

  const hasResults = messageResults.length > 0 || peopleResults.length > 0 || tagResults.length > 0 || dateResults.length > 0 || contextResults.length > 0
  const resultSections: ResultSection[] = ["messages", "people", "tags", "dates", "contexts"]

  return (
    <div className="fixed inset-0 z-50 flex flex-col animate-fade-in">
      {/* Backdrop — stronger blur, consistent with nav modal */}
      <button
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        aria-label="Close search"
      />

      {/* Sheet card — dark glass, slides down from top */}
      <div className={cn(
        "relative z-10 flex flex-col w-full max-w-lg mx-auto mt-safe overflow-hidden animate-slide-down",
        "glass-modal",
        "rounded-b-3xl border-b border-x border-white/10",
        "shadow-[0_32px_80px_rgba(0,0,0,0.8),inset_0_1px_0_rgba(255,255,255,0.07)]",
      )}>
        {/* Top sheen */}
        <div className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-white/18 to-transparent pointer-events-none" />

        {/* ── Search bar ── */}
        <div className="flex items-center gap-3 px-4 pt-4 pb-3 border-b border-white/8">
          <Search className="w-4 h-4 text-white/35 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search messages, people, tags, contexts..."
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-white/25 outline-none"
          />
          {hasQuery && (
            <button
              onClick={() => setQuery("")}
              className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center active:scale-90 transition-transform shrink-0"
            >
              <X className="w-3 h-3 text-white/50" />
            </button>
          )}
          <button
            onClick={onClose}
            className="text-xs font-semibold text-primary/80 active:opacity-60 transition-opacity shrink-0 pl-1"
          >
            Cancel
          </button>
        </div>

        {/* ── Results area ── */}
        <div className="overflow-y-auto max-h-[68dvh] pb-safe scrollbar-hide">
          {!hasQuery ? (
            /* Empty state — no query yet */
            <div className="flex flex-col items-center justify-center gap-3 py-14 px-8 animate-fade-up">
              <div className="w-14 h-14 rounded-full bg-white/8 border border-white/12 flex items-center justify-center">
                <Search className="w-6 h-6 text-white/25" />
              </div>
              <p className="text-sm font-semibold text-white/50">Search everything</p>
              <p className="text-xs text-white/30 text-center leading-relaxed">
                Messages, people, tags, dates and contexts
              </p>
              {/* Scope hints */}
              <div className="flex flex-wrap items-center justify-center gap-2 mt-2">
                {resultSections.map((s) => (
                  <span
                    key={s}
                    className={cn(
                      "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold",
                      "bg-white/6 border border-white/10",
                      SECTION_META[s].color,
                    )}
                  >
                    {SECTION_META[s].icon}
                    {SECTION_META[s].label}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            /* Results — one section per type */
            <div className="flex flex-col divide-y divide-white/8">
              <SearchResultSection section="messages" results={messageResults} />
              <SearchResultSection section="people" results={peopleResults} />
              <SearchResultSection section="tags" results={tagResults} />
              <SearchResultSection section="dates" results={dateResults} />
              <SearchResultSection section="contexts" results={contextResults} />
              {!hasResults && (
                <div className="flex flex-col items-center justify-center gap-2 py-10 px-8 animate-fade-up">
                  <Hash className="w-5 h-5 text-white/20" />
                  <p className="text-sm text-white/45">
                    No results for{" "}
                    <span className="text-white/70 font-semibold">&ldquo;{query}&rdquo;</span>
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Helpers ─────────────────────────────────────────────────────────────────

type SearchResult = { id: string; primary: string; secondary?: string; onClick?: () => void }

function fmtDate(dateStr: string): string {
  if (!dateStr) return ""
  const [y, m, d] = dateStr.split("-").map(Number)
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

// ── Sub-component: one result section ──────────────────────────────────────

interface SearchResultSectionProps {
  section: ResultSection
  results: SearchResult[]
}

function SearchResultSection({ section, results }: SearchResultSectionProps) {
  const meta = SECTION_META[section]

  if (results.length === 0) return null

  return (
    <div className={cn("py-3", meta.sectionBg)}>
      {/* Section label */}
      <div className={cn("flex items-center gap-1.5 px-4 pb-2", meta.color)}>
        {meta.icon}
        <span className="text-[10px] font-bold tracking-[1.5px] uppercase font-mono">{meta.label}</span>
      </div>

      {/* Result rows */}
      {results.map((item) => (
        <button
          key={item.id}
          onClick={item.onClick}
          className={cn("w-full flex items-center gap-3 px-4 py-2.5 transition-colors text-left", meta.activeBg)}
        >
          <div
            className={cn(
              "w-7 h-7 rounded-lg border flex items-center justify-center shrink-0",
              meta.iconBg,
              meta.color,
            )}
          >
            {meta.icon}
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-semibold text-white/90 truncate">{item.primary}</span>
            {item.secondary && (
              <span className="text-xs text-white/40 truncate">{item.secondary}</span>
            )}
          </div>
        </button>
      ))}
    </div>
  )
}
