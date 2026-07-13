"use client"

import { useMemo, useState, useEffect } from "react"
import { ArrowLeft, Hash, Plus, Search, X } from "lucide-react"
import { cn } from "@/lib/utils"
import type { AppContext, Message } from "@/lib/store"
import { CreateContextModal } from "@/components/create-context-modal"
import { buildContextActivityStats, compareBySearchScore, scoreContextSearch } from "@/lib/smart-search"

interface ContextsScreenProps {
  contexts: AppContext[]
  messages: Message[]
  isLoading?: boolean
  onBack: () => void
  onContextSelect: (id: string) => void
  onCreateContext: (name: string, description?: string) => Promise<AppContext>
  className?: string
}

function ContextRowSkeleton() {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="w-8 h-8 rounded-xl bg-white/8 animate-pulse shrink-0" />
      <div className="flex flex-col gap-1.5 flex-1">
        <div className="h-3.5 w-28 rounded bg-white/8 animate-pulse" />
        <div className="h-3 w-40 rounded bg-white/6 animate-pulse" />
      </div>
    </div>
  )
}

export function ContextsScreen({
  contexts,
  messages,
  isLoading = false,
  onBack,
  onContextSelect,
  onCreateContext,
  className,
}: ContextsScreenProps) {
  const [query, setQuery] = useState("")
  const [creating, setCreating] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [visibleCount, setVisibleCount] = useState(50)

  const q = query.trim().toLowerCase()
  const contextActivity = useMemo(() => buildContextActivityStats(messages), [messages])

  // When no query: skip scoring/sorting (saves ~150ms on 2,617 contexts)
  const filtered = useMemo(() => {
    if (!q) return contexts
    return contexts
      .map((ctx) => ({
        item: ctx,
        score: scoreContextSearch(ctx, query, contextActivity.get(ctx.id)),
        label: ctx.name,
        activity: contextActivity.get(ctx.id),
      }))
      .filter((entry) => entry.score > 0)
      .sort(compareBySearchScore)
      .map((entry) => entry.item)
  }, [contextActivity, contexts, q, query])

  // Reset pagination when query changes
  useEffect(() => { setVisibleCount(50) }, [q])

  const visibleContexts = filtered.slice(0, visibleCount)

  const exactMatch = contexts.some((c) => c.name.toLowerCase() === q)
  const showCreate = q.length > 0 && !exactMatch

  const handleCreate = async () => {
    if (!query.trim() || creating) return
    setCreating(true)
    try {
      await onCreateContext(query.trim())
      setQuery("")
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className={cn("flex-1 flex flex-col stream-glass-screen overflow-hidden", className)}>
      {/* Header */}
      <div className="flex-shrink-0 border-b border-white/10 animate-slide-down">
        <div className="max-w-2xl mx-auto px-4 md:px-6 app-topbar flex items-center gap-3">
          <button
            onClick={onBack}
            className="w-9 h-9 rounded-full bg-white/5 border border-white/10 flex items-center justify-center active:scale-95 hover:bg-white/8 transition-all duration-150"
          >
            <ArrowLeft className="w-4 h-4 text-muted-foreground" />
          </button>
          <h1 className="text-base font-bold tracking-tight flex-1">Contexts</h1>
          <button
            onClick={() => setShowCreateModal(true)}
            className="w-8 h-8 rounded-full bg-emerald-400/15 border border-emerald-400/25 flex items-center justify-center active:scale-95 hover:bg-emerald-400/20 transition-all duration-150"
          >
            <Plus className="w-3.5 h-3.5 text-emerald-400" />
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="max-w-2xl mx-auto w-full px-4 md:px-6 pt-4 pb-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40 pointer-events-none" />
          <input
            type="text"
            placeholder="Search or create context..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && showCreate) handleCreate() }}
            autoFocus
            className="w-full bg-white/5 border border-white/10 rounded-xl pl-9 pr-9 py-2.5 text-sm placeholder:text-muted-foreground/60 outline-none focus:border-emerald-400/40 focus:bg-white/8 transition-all"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide">
        <div className="max-w-2xl mx-auto px-4 md:px-6 pb-10">

          {/* Create suggestion */}
          {showCreate && (
            <div className="mb-4">
              <button
                onClick={handleCreate}
                disabled={creating}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl border border-dashed border-emerald-400/35 bg-emerald-400/8 hover:bg-emerald-400/12 active:scale-[0.99] transition-all disabled:opacity-50"
              >
                <div className="w-8 h-8 rounded-xl border border-emerald-400/30 bg-emerald-400/15 flex items-center justify-center shrink-0">
                  <Plus className="w-4 h-4 text-emerald-400" />
                </div>
                <div className="text-left">
                  <span className="text-sm font-semibold text-emerald-300">
                    {creating ? "Creating…" : `Create "${query.trim()}"`}
                  </span>
                  <p className="text-xs text-muted-foreground/60 mt-0.5">New global context</p>
                </div>
              </button>
            </div>
          )}

          {/* Context list */}
          {isLoading && !q ? (
            <div className="rounded-2xl bg-card border border-white/10 overflow-hidden divide-y divide-white/8">
              {[...Array(6)].map((_, i) => <ContextRowSkeleton key={i} />)}
            </div>
          ) : filtered.length === 0 && !showCreate ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center">
                <Hash className="w-5 h-5 text-muted-foreground/50" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground/70">
                  {q ? "No contexts found" : "No contexts yet"}
                </p>
                <p className="text-xs text-muted-foreground/50 mt-1">
                  {q
                    ? "No results found. Try a different search or clear some filters."
                    : "Contexts help connect messages to a project, company, or topic."}
                </p>
              </div>
            </div>
          ) : filtered.length > 0 ? (
            <>
              <div className="rounded-2xl bg-card border border-white/10 overflow-hidden divide-y divide-white/8">
                {visibleContexts.map((ctx) => (
                  <button
                    key={ctx.id}
                    onClick={() => onContextSelect(ctx.id)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 active:bg-white/8 transition-colors text-left"
                  >
                    <div className="w-8 h-8 rounded-xl border border-emerald-400/25 bg-emerald-400/10 flex items-center justify-center shrink-0">
                      <Hash className="w-3.5 h-3.5 text-emerald-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-semibold truncate block">{ctx.name}</span>
                      {ctx.description && (
                        <span className="text-xs text-muted-foreground/60 truncate block">
                          {ctx.description}
                        </span>
                      )}
                      {(ctx.fieldCount ?? ctx.fields.length) > 0 && (
                        <span className="text-xs text-muted-foreground/40">
                          {ctx.fieldCount ?? ctx.fields.length} field{(ctx.fieldCount ?? ctx.fields.length) !== 1 ? "s" : ""}
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
              {filtered.length > visibleCount && (
                <button
                  onClick={() => setVisibleCount((v) => v + 50)}
                  className="w-full mt-3 py-2.5 rounded-xl border border-white/10 bg-white/3 text-xs text-muted-foreground/60 hover:text-muted-foreground hover:bg-white/5 transition-all active:scale-[0.99]"
                >
                  Load 50 more · {filtered.length - visibleCount} remaining
                </button>
              )}
            </>
          ) : null}
        </div>
      </div>

      {showCreateModal && (
        <CreateContextModal
          onClose={() => setShowCreateModal(false)}
          onSubmit={async (name, description) => {
            await onCreateContext(name, description || undefined)
            setTimeout(() => setShowCreateModal(false), 900)
          }}
        />
      )}
    </div>
  )
}
