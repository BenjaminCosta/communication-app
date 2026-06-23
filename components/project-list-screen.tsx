"use client"

import { useMemo, useState } from "react"
import {
  Archive,
  ArrowLeft,
  Check,
  FolderOpen,
  Lock,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Star,
  Trash2,
  X,
} from "lucide-react"
import { ToastNotification } from "@/components/toast-notification"
import { CategoryDot } from "@/components/category-icon"
import { cn } from "@/lib/utils"
import {
  type Contact,
  type Message,
  type Project,
  type TagCategory,
  getMessageTagIds,
  MESSAGE_TYPE_CONFIG,
  messageHasProject,
  systemTypeTagId,
} from "@/lib/store"
import { CreateProjectModal } from "@/components/create-project-modal"

type ActionSheetState = { type: "none" } | { type: "tagAction"; projectId: string }

interface ProjectListScreenProps {
  projects: Project[]
  messages: Message[]
  onBack: () => void
  onProjectSelect: (projectId: string) => void
  onCreateProject: (name: string, memberIds: string[], category?: TagCategory) => void
  onDeleteProject: (id: string) => void
  onFavoriteProject: (id: string) => void
  onRenameProject: (id: string, name: string, category?: TagCategory) => void
  className?: string
  contacts: Contact[]
}

function TagRow({
  project,
  msgCount,
  onSelect,
  onAction,
}: {
  project: Project
  msgCount: number
  onSelect: () => void
  onAction: () => void
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3.5">
      <CategoryDot categoryId="custom" />
      <button className="min-w-0 flex-1 text-left" onClick={onSelect}>
        <p className="truncate text-sm font-semibold text-foreground">{project.name}</p>
      </button>
      {project.isFavorited && <Star className="h-3.5 w-3.5 shrink-0 fill-current text-feedback" />}
      {msgCount > 0 && (
        <span className="shrink-0 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-[10px] font-bold text-muted-foreground">
          {msgCount} msg{msgCount !== 1 ? "s" : ""}
        </span>
      )}
      <button
        onClick={(e) => {
          e.stopPropagation()
          onAction()
        }}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground/50 transition-colors active:bg-white/10"
        aria-label={`Actions for ${project.name}`}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
    </div>
  )
}

function SystemTagRow({
  type,
  count,
}: {
  type: Exclude<keyof typeof MESSAGE_TYPE_CONFIG, "none">
  count: number
}) {
  const config = MESSAGE_TYPE_CONFIG[type]
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.035] p-3.5 opacity-90">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04]">
        <span className={cn("h-3 w-3 rounded-full", config.text.replace("text-", "bg-"))} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">{config.label}</p>
      </div>
      {count > 0 && (
        <span className="shrink-0 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-[10px] font-bold text-muted-foreground">
          {count} msg{count !== 1 ? "s" : ""}
        </span>
      )}
      <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground/35" />
    </div>
  )
}

export function ProjectListScreen({
  projects,
  messages,
  onBack,
  onProjectSelect,
  onCreateProject,
  onDeleteProject,
  onFavoriteProject,
  onRenameProject,
  className,
  contacts,
}: ProjectListScreenProps) {
  const [query, setQuery] = useState("")
  const [actionSheet, setActionSheet] = useState<ActionSheetState>({ type: "none" })
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [editingProject, setEditingProject] = useState<Project | null>(null)
  const [showCreateTag, setShowCreateTag] = useState(false)
  const [localToast, setLocalToast] = useState<string | null>(null)

  const showLocalToast = (msg: string) => {
    setLocalToast(msg)
    setTimeout(() => setLocalToast(null), 2500)
  }

  const clearActionSheet = () => {
    setActionSheet({ type: "none" })
    setConfirmDeleteId(null)
  }

  const msgCountByProject = useMemo(
    () => new Map(projects.map((p) => [p.id, messages.filter((m) => messageHasProject(m, p.id)).length])),
    [projects, messages]
  )

  const systemTagMsgCounts = useMemo(() => {
    const types = ["progress", "decision", "feedback", "problem"] as const
    return new Map(types.map((type) => [
      systemTypeTagId(type),
      messages.filter((m) => getMessageTagIds(m).includes(systemTypeTagId(type))).length,
    ]))
  }, [messages])

  const recentProjects = useMemo(
    () => [...projects]
      .filter((p) => p.lastUsedAt != null)
      .sort((a, b) => (b.lastUsedAt?.getTime() ?? 0) - (a.lastUsedAt?.getTime() ?? 0))
      .slice(0, 5),
    [projects]
  )

  const filteredProjects = useMemo(() => {
    const q = query.trim().toLowerCase()
    const sorted = [...projects].sort((a, b) => {
      if (!!a.isFavorited !== !!b.isFavorited) return a.isFavorited ? -1 : 1
      const activityDiff = (b.lastUsedAt?.getTime() ?? 0) - (a.lastUsedAt?.getTime() ?? 0)
      if (activityDiff !== 0) return activityDiff
      return a.name.localeCompare(b.name)
    })
    return q ? sorted.filter((p) => p.name.toLowerCase().includes(q)) : sorted
  }, [projects, query])

  const actionProject = actionSheet.type === "tagAction"
    ? projects.find((p) => p.id === actionSheet.projectId) ?? null
    : null

  return (
    <div className={`flex-1 min-h-0 flex flex-col stream-glass-screen ${className ?? "animate-fade-in"}`}>
      <div className="shrink-0 border-b border-white/10 animate-slide-down">
        <div className="app-topbar mx-auto flex max-w-2xl items-center gap-3 px-4 md:px-6">
          <button onClick={onBack} className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 transition-all duration-150 active:scale-95 hover:bg-white/8">
            <ArrowLeft className="h-4 w-4 text-muted-foreground" />
          </button>
          <h1 className="flex-1 text-base font-bold tracking-tight">Tags</h1>
          <button
            onClick={() => setShowCreateTag(true)}
            className="flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/15 px-3 py-1.5 text-xs font-semibold text-primary transition-all duration-150 active:scale-95 hover:bg-primary/20"
          >
            <Plus className="h-3.5 w-3.5" />
            Add
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-hide">
        <div className="mx-auto max-w-2xl px-4 py-3 md:px-6">
          <label className="mb-4 flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search tags..."
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
            />
            {query && (
              <button onClick={() => setQuery("")} aria-label="Clear search">
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            )}
          </label>

          {!query.trim() && recentProjects.length > 0 && (
            <div className="mb-5">
              <p className="px-1 pb-2 font-mono text-[10px] font-bold uppercase tracking-[2px] text-muted-foreground/50">
                Recently Used
              </p>
              <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 scrollbar-hide">
                {recentProjects.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => onProjectSelect(p.id)}
                    className="flex min-w-[80px] shrink-0 flex-col items-center gap-1.5 rounded-2xl border border-white/10 bg-white/5 px-3 py-2.5 transition-colors active:bg-white/8"
                  >
                    <CategoryDot categoryId="custom" className="h-7 w-7 rounded-full" />
                    <p className="max-w-[72px] truncate text-xs font-semibold text-foreground">{p.name}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {projects.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-24 animate-fade-up">
              <div className="flex h-16 w-16 items-center justify-center rounded-full border border-white/10 bg-white/5 animate-float">
                <FolderOpen className="h-7 w-7 text-muted-foreground/40" />
              </div>
              <p className="text-sm text-muted-foreground">No tags yet</p>
              <button onClick={() => setShowCreateTag(true)} className="text-xs font-semibold text-primary active:opacity-70">
                Create your first tag
              </button>
            </div>
          ) : filteredProjects.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No tags found</p>
          ) : (
            <div className="flex flex-col gap-5">
              {!query.trim() && (
                <section>
                  <p className="px-1 pb-2 font-mono text-[10px] font-bold uppercase tracking-[2px] text-muted-foreground/50">
                    System Tags
                  </p>
                  <div className="flex flex-col gap-2">
                    {(["progress", "decision", "feedback", "problem"] as const).map((type) => (
                      <SystemTagRow
                        key={type}
                        type={type}
                        count={systemTagMsgCounts.get(systemTypeTagId(type)) ?? 0}
                      />
                    ))}
                  </div>
                </section>
              )}

              <section>
                <p className="px-1 pb-2 font-mono text-[10px] font-bold uppercase tracking-[2px] text-muted-foreground/50">
                  All Tags
                </p>
                <div className="flex flex-col gap-2">
                  {filteredProjects.map((p) => (
                    <TagRow
                      key={p.id}
                      project={p}
                      msgCount={msgCountByProject.get(p.id) ?? 0}
                      onSelect={() => onProjectSelect(p.id)}
                      onAction={() => setActionSheet({ type: "tagAction", projectId: p.id })}
                    />
                  ))}
                </div>
              </section>
            </div>
          )}

          <div className="h-6" />
        </div>
      </div>

      {actionSheet.type === "tagAction" && actionProject && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end md:items-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onPointerDown={clearActionSheet} />
          <div className="relative z-10 w-full rounded-t-3xl border-t border-white/10 glass-modal animate-slide-up safe-area-pb md:mb-6 md:w-[420px] md:rounded-3xl md:border">
            <div className="mx-auto mb-1 mt-3 h-1 w-10 rounded-full bg-white/20" />
            <div className="flex items-center gap-3 border-b border-white/8 px-5 py-3">
              <CategoryDot categoryId="custom" className="h-7 w-7 rounded-full" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-foreground">{actionProject.name}</p>
              </div>
              {actionProject.isFavorited && <Star className="h-3.5 w-3.5 fill-current text-feedback" />}
            </div>

            <p className="px-5 pb-2 pt-4 font-mono text-[10px] font-bold uppercase tracking-[2px] text-muted-foreground/50">
              Tag actions
            </p>
            <div className="flex flex-col pb-2">
              <button
                onClick={() => {
                  setEditingProject(actionProject)
                  clearActionSheet()
                }}
                className="flex w-full items-center gap-4 px-5 py-3.5 text-left transition-colors active:bg-white/5"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/8">
                  <Pencil className="h-4 w-4 text-foreground/70" />
                </span>
                <span className="text-sm font-semibold text-foreground">Edit tag</span>
              </button>
              <div className="mx-5 h-px bg-white/8" />

              <button
                onClick={() => {
                  onFavoriteProject(actionProject.id)
                  clearActionSheet()
                }}
                className="flex w-full items-center gap-4 px-5 py-3.5 text-left transition-colors active:bg-white/5"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/8">
                  <Star className={cn("h-4 w-4", actionProject.isFavorited ? "fill-current text-feedback" : "text-foreground/70")} />
                </span>
                <span className="text-sm font-semibold text-foreground">
                  {actionProject.isFavorited ? "Remove favorite" : "Favorite"}
                </span>
              </button>
              <div className="mx-5 h-px bg-white/8" />

              <button
                onClick={() => {
                  showLocalToast("Archive coming soon")
                  clearActionSheet()
                }}
                className="flex w-full items-center gap-4 px-5 py-3.5 text-left transition-colors active:bg-white/5"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/8">
                  <Archive className="h-4 w-4 text-muted-foreground/60" />
                </span>
                <span className="text-sm font-semibold text-muted-foreground/60">Archive</span>
              </button>
              <div className="mx-5 h-px bg-white/8" />

              {confirmDeleteId === actionProject.id ? (
                <button
                  onClick={() => {
                    onDeleteProject(actionProject.id)
                    clearActionSheet()
                  }}
                  className="flex w-full items-center gap-4 px-5 py-3.5 text-left transition-colors active:bg-problem/5 animate-pulse"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-problem/10">
                    <Trash2 className="h-4 w-4 text-problem" />
                  </span>
                  <span className="text-sm font-semibold text-problem">Confirm delete?</span>
                </button>
              ) : (
                <button
                  onClick={() => setConfirmDeleteId(actionProject.id)}
                  className="flex w-full items-center gap-4 px-5 py-3.5 text-left transition-colors active:bg-problem/5"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-problem/10">
                    <Trash2 className="h-4 w-4 text-problem" />
                  </span>
                  <span className="text-sm font-semibold text-problem">Delete</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {showCreateTag && (
        <CreateProjectModal
          contacts={contacts}
          onClose={() => setShowCreateTag(false)}
          onSubmit={(name, memberIds, category) => {
            onCreateProject(name, memberIds, category)
            setShowCreateTag(false)
          }}
        />
      )}

      {editingProject && (
        <EditProjectModal
          project={editingProject}
          onClose={() => setEditingProject(null)}
          onSave={(name) => {
            onRenameProject(editingProject.id, name)
            setEditingProject(null)
          }}
        />
      )}

      {localToast && (
        <ToastNotification
          message={localToast}
          duration={2500}
          onDismiss={() => setLocalToast(null)}
        />
      )}
    </div>
  )
}

function EditProjectModal({
  project,
  onClose,
  onSave,
}: {
  project: Project
  onClose: () => void
  onSave: (name: string) => void
}) {
  const [name, setName] = useState(project.name)
  const dotClass = "bg-violet-500"

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-5">
      <button onClick={onClose} className="absolute inset-0 bg-black/60 backdrop-blur-sm" aria-label="Close" />
      <div className="relative z-10 max-h-[90dvh] w-full max-w-sm overflow-y-auto rounded-3xl border border-white/10 p-5 glass-modal shadow-2xl animate-spring-pop -translate-y-[5%]">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <p className="mb-1 font-mono text-[10px] font-bold uppercase tracking-[2px] text-muted-foreground">Manage Tag</p>
            <h2 className="text-xl font-bold">Edit tag</h2>
          </div>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/5">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        <p className="mb-2 font-mono text-[10px] font-bold uppercase tracking-[2px] text-muted-foreground">Name</p>
        <label className="mb-5 flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3.5">
          <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", dotClass)} />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && name.trim() && onSave(name.trim())}
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/40"
          />
        </label>

        <button
          onClick={() => name.trim() && onSave(name.trim())}
          disabled={!name.trim()}
          className={cn(
            "w-full rounded-xl py-3.5 text-sm font-semibold tracking-wide transition-all",
            name.trim()
              ? "bg-primary text-white shadow-[0_4px_16px_rgba(37,99,235,0.4)] active:scale-[0.98]"
              : "bg-white/5 text-muted-foreground/40"
          )}
        >
          Save
        </button>
      </div>
    </div>
  )
}
