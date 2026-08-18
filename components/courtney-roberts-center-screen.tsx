"use client"

import { useEffect, useMemo, useState } from "react"
import { Search, MessageCircleOff, Lock } from "lucide-react"
import { cn, getUserAvatarColor } from "@/lib/utils"
import { deriveInitials } from "@/lib/store"
import { ModuleSwitcher, type SvcModule } from "@/components/module-switcher"
import { fetchCourtneyRobertsCenterConversations, CourtneyRobertsCenterClientError } from "@/lib/courtney-roberts-center/client"
import type { CourtneyRobertsCenterConversationSummary } from "@/lib/courtney-roberts-center/types"

interface CourtneyRobertsCenterScreenProps {
  onSelectConversation: (conversationId: string) => void
  onSwitchToStream: () => void
  onSwitchToDirectory: () => void
  onSwitchToApplications: () => void
  onSwitchToQuestCoral: () => void
  onSwitchToByeByeDpr: () => void
  className?: string
}

type FilterKey = "all" | "internal" | "public"

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "internal", label: "Internal" },
  { key: "public", label: "Public" },
]

// Admin tool, small conversation count expected — one page covers the real
// need without building pagination UI for it. See lib/courtney-roberts-center/read-api.ts.
const LIST_PAGE_SIZE = 100

function formatTimestamp(ms: number): string {
  if (!ms) return ""
  const date = new Date(ms)
  const now = new Date()
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
  }
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday"
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

export function CourtneyRobertsCenterScreen({
  onSelectConversation,
  onSwitchToStream,
  onSwitchToDirectory,
  onSwitchToApplications,
  onSwitchToQuestCoral,
  onSwitchToByeByeDpr,
  className,
}: CourtneyRobertsCenterScreenProps) {
  const [conversations, setConversations] = useState<CourtneyRobertsCenterConversationSummary[] | null>(null)
  const [errorStatus, setErrorStatus] = useState<number | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [filter, setFilter] = useState<FilterKey>("all")
  const [query, setQuery] = useState("")

  useEffect(() => {
    let cancelled = false
    setConversations(null)
    setErrorStatus(null)
    setErrorMessage(null)
    fetchCourtneyRobertsCenterConversations({ limit: LIST_PAGE_SIZE })
      .then((page) => {
        if (!cancelled) setConversations(page.conversations)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setConversations([])
        setErrorStatus(err instanceof CourtneyRobertsCenterClientError ? err.status : null)
        setErrorMessage(err instanceof CourtneyRobertsCenterClientError ? err.message : "Unable to load conversations.")
      })
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = useMemo(() => {
    const list = conversations ?? []
    const byFilter = filter === "all" ? list : list.filter((c) => c.identityStatus === filter)
    const q = query.trim().toLowerCase()
    if (!q) return byFilter
    return byFilter.filter((c) => c.displayName.toLowerCase().includes(q) || (c.phoneLast4 ?? "").includes(q))
  }, [conversations, filter, query])

  const isLoading = conversations === null
  const isDenied = errorStatus === 401 || errorStatus === 403

  return (
    <div className={cn("flex-1 min-h-0 flex flex-col courtney-roberts-center-glass-screen", className ?? "animate-fade-in")}>
      {/* Header — same ModuleSwitcher-based topbar every other module uses, not a back arrow: this is a peer module now, reached from the switcher itself. */}
      <div className="glass-panel shrink-0 border-b border-white/10 animate-slide-down">
        <div className="max-w-2xl mx-auto px-4 md:px-6 app-topbar flex items-center">
          <ModuleSwitcher
            activeModule={"courtney-roberts-center" as SvcModule}
            showCourtneyRobertsCenter
            onSelect={(module) => {
              if (module === "communications") onSwitchToStream()
              if (module === "directory") onSwitchToDirectory()
              if (module === "applications") onSwitchToApplications()
              if (module === "quest-coral") onSwitchToQuestCoral()
              if (module === "bye-bye-dpr") onSwitchToByeByeDpr()
            }}
          />
        </div>
      </div>

      {!isDenied && (
        <div className="shrink-0 max-w-2xl mx-auto w-full px-4 md:px-6 pt-3 pb-2 flex flex-col gap-3">
          <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-full px-3.5 py-2.5">
            <Search className="w-4 h-4 text-muted-foreground/60 shrink-0" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search conversations"
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
            />
          </div>
          <div className="flex items-center gap-2">
            {FILTERS.map(({ key, label }) => {
              const active = filter === key
              return (
                <button
                  key={key}
                  onClick={() => setFilter(key)}
                  className={cn(
                    "px-3.5 py-1.5 rounded-full text-xs font-semibold border transition-all duration-150 active:scale-95",
                    active ? "glass-pill-crc-active" : "glass-pill text-muted-foreground",
                  )}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* List */}
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide">
        <div className="max-w-2xl mx-auto w-full">
          {isDenied ? (
            <EmptyState
              icon={<Lock className="w-5 h-5" />}
              title="Not approved"
              description={errorMessage ?? "You are not approved to view Courtney Roberts Center."}
            />
          ) : isLoading ? (
            <ListSkeleton />
          ) : errorMessage ? (
            <EmptyState icon={<MessageCircleOff className="w-5 h-5" />} title="Can't load conversations" description={errorMessage} />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<MessageCircleOff className="w-5 h-5" />}
              title={conversations && conversations.length > 0 ? "No matches" : "No conversations yet"}
              description={
                conversations && conversations.length > 0
                  ? "Try a different search or filter."
                  : "WhatsApp conversations with Courtney will show up here."
              }
            />
          ) : (
            <div className="flex flex-col divide-y divide-white/8">
              {filtered.map((conversation) => (
                <ConversationRow
                  key={conversation.id}
                  conversation={conversation}
                  onSelect={() => onSelectConversation(conversation.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ConversationRow({
  conversation,
  onSelect,
}: {
  conversation: CourtneyRobertsCenterConversationSummary
  onSelect: () => void
}) {
  const initials = deriveInitials(conversation.displayName)
  const avatarColor = getUserAvatarColor(conversation.id)
  return (
    <button
      onClick={onSelect}
      className="w-full flex items-center gap-3 px-4 md:px-6 py-3 text-left active:bg-white/5 transition-colors duration-150"
    >
      <div className={cn("w-11 h-11 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0", avatarColor)}>
        {initials}
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-sm font-semibold truncate block">{conversation.displayName}</span>
        <p className="text-xs text-muted-foreground/70 truncate mt-0.5">
          {conversation.lastMessageRole === "assistant" && <span className="text-muted-foreground/50">Courtney: </span>}
          {conversation.lastMessagePreview || "No messages yet"}
        </p>
        <span
          className={cn(
            "inline-flex mt-1.5 items-center rounded-full px-2 py-0.5 text-[10px] font-medium border",
            conversation.identityStatus === "internal"
              ? "border-emerald-500/40 text-emerald-400 bg-emerald-500/10"
              : "border-white/15 text-muted-foreground/60 bg-white/5",
          )}
        >
          {conversation.identityStatus === "internal" ? "Internal" : "Public"}
        </span>
      </div>
      <span className="text-[11px] text-muted-foreground/50 shrink-0 self-start pt-0.5">
        {formatTimestamp(conversation.lastMessageAtMs)}
      </span>
    </button>
  )
}

function ListSkeleton() {
  return (
    <div className="flex flex-col divide-y divide-white/8">
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} className="flex items-center gap-3 px-4 md:px-6 py-3 animate-pulse">
          <div className="w-11 h-11 rounded-full bg-white/8 shrink-0" />
          <div className="flex-1 flex flex-col gap-2">
            <div className="h-3 w-32 rounded bg-white/8" />
            <div className="h-2.5 w-48 rounded bg-white/6" />
          </div>
        </div>
      ))}
    </div>
  )
}

function EmptyState({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="flex flex-col items-center text-center gap-2 px-6 py-16">
      <div className="w-12 h-12 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-muted-foreground/50">
        {icon}
      </div>
      <p className="text-sm font-semibold">{title}</p>
      <p className="text-xs text-muted-foreground/60 max-w-[240px]">{description}</p>
    </div>
  )
}
