"use client"

import { useState, useMemo } from "react"
import {
  ArrowLeft, Plus, FolderOpen, Trash2, Pencil, X, Check,
  ChevronRight, Search, Folder,
  MoreHorizontal, Lock, Info, Archive,
} from "lucide-react"
import { UniversalAddModal } from "@/components/universal-add-modal"
import { ToastNotification } from "@/components/toast-notification"
import { CategoryDot, CategoryIcon } from "@/components/category-icon"
import { cn } from "@/lib/utils"
import {
  type Project,
  type Message,
  type Contact,
  type TagCategory,
  type CategoryItem,
  messageHasProject,
  CATEGORY_CONFIG,
  CATEGORY_ORDER,
  SYSTEM_CATEGORIES,
  MESSAGE_TYPE_CONFIG,
  getCategoryLabel,
  isCategoryTimeBased,
  getMessageTagIds,
  systemTypeTagId,
} from "@/lib/store"
import { CreateProjectModal } from "@/components/create-project-modal"

// ── View & Sheet State Types ─────────────────────────────────────────────────

type TagsView =
  | { type: "home" }
  | { type: "category"; categoryId: string }

type ActionSheetState =
  | { type: "none" }
  | { type: "tagAction"; projectId: string }
  | { type: "moveToCategory"; projectId: string }

// ── Props ────────────────────────────────────────────────────────────────────

interface ProjectListScreenProps {
  projects: Project[]
  messages: Message[]
  onBack: () => void
  onProjectSelect: (projectId: string) => void
  onCreateProject: (name: string, memberIds: string[], category?: TagCategory) => void
  onDeleteProject: (id: string) => void
  onFavoriteProject: (id: string) => void
  onRenameProject: (id: string, name: string, category?: TagCategory) => void
  customCategories?: CategoryItem[]
  onCreateCategory?: (name: string) => Promise<void> | void
  className?: string
  contacts: Contact[]
}

// ── Helpers (pure, outside component) ────────────────────────────────────────

function isSystemLocked(categoryId: string): boolean {
  return categoryId === "status" || categoryId === "systemType"
}

// ── Tag Row (shared between search results and category detail) ───────────────

function TagRow({
  project, msgCount, contacts, onSelect, onAction,
}: {
  project: Project
  msgCount: number
  contacts: Contact[]
  onSelect: () => void
  onAction: () => void
}) {
  return (
    <div className="flex items-center gap-3 p-3.5 rounded-2xl bg-white/5 border border-white/10">
      <CategoryDot categoryId={project.tagCategory ?? "custom"} />
      <button className="flex-1 min-w-0 text-left" onClick={onSelect}>
        <p className="text-sm font-semibold text-foreground truncate">{project.name}</p>
      </button>
      {msgCount > 0 && (
        <span className="flex-shrink-0 text-[10px] font-bold font-mono text-muted-foreground bg-white/5 border border-white/10 rounded-full px-2 py-0.5">
          {msgCount} msg{msgCount !== 1 ? "s" : ""}
        </span>
      )}
      <button
        onClick={e => { e.stopPropagation(); onAction() }}
        className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground/50 active:bg-white/10 transition-colors flex-shrink-0"
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export function ProjectListScreen({
  projects, messages, onBack, onProjectSelect, onCreateProject,
  onDeleteProject, onFavoriteProject, onRenameProject,
  customCategories = [], onCreateCategory, className, contacts,
}: ProjectListScreenProps) {
  // View state
  const [view, setView] = useState<TagsView>({ type: "home" })
  const [homeQuery, setHomeQuery] = useState("")
  const [categoryQuery, setCategoryQuery] = useState("")

  // Sheet & modal state
  const [actionSheet, setActionSheet] = useState<ActionSheetState>({ type: "none" })
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [editingProject, setEditingProject] = useState<Project | null>(null)
  const [showUniversalAdd, setShowUniversalAdd] = useState(false)
  const [showCreateTag, setShowCreateTag] = useState(false)
  const [createInitialCategory, setCreateInitialCategory] = useState<TagCategory>("")

  // Local toast (for "Archive coming soon")
  const [localToast, setLocalToast] = useState<string | null>(null)
  const showLocalToast = (msg: string) => {
    setLocalToast(msg)
    setTimeout(() => setLocalToast(null), 2500)
  }

  const clearActionSheet = () => { setActionSheet({ type: "none" }); setConfirmDeleteId(null) }

  // ── Derived data ──────────────────────────────────────────────────────────

  // All categories in display order (system + custom, skip legacy order>=100)
  // "timedate" is skipped — normalized to "date" everywhere for V1 consistency
  const allDisplayCategories = useMemo((): Array<{ id: string; label: string }> => {
    const cats: Array<{ id: string; label: string }> = []
    // V1-deprecated categories — never shown in tag manager UI
    const SKIP = new Set(["timedate", "project", "report", "systemType"])
    for (const catId of CATEGORY_ORDER) {
      if (SKIP.has(catId)) continue
      const config = CATEGORY_CONFIG[catId]
      if (!config || config.order >= 100) continue
      cats.push({ id: catId, label: config.label })
    }
    for (const c of customCategories) {
      if (!cats.some(cat => cat.id === c.id)) {
        cats.push({ id: c.id, label: c.name })
      }
    }
    return cats
  }, [customCategories])

  const allCategoryIds = useMemo(
    () => new Set(allDisplayCategories.map(c => c.id)),
    [allDisplayCategories]
  )
  const customCategoryIds = useMemo(
    () => new Set(customCategories.map((c) => c.id)),
    [customCategories]
  )

  const effectiveCategory = (p: Project): string => {
    if (!p.tagCategory) return "custom"
    // Normalize legacy "timedate" → "date" (V1 migration)
    const normalized = p.tagCategory === "timedate" ? "date" : p.tagCategory
    return allCategoryIds.has(normalized) ? normalized : "custom"
  }

  // Projects grouped by category
  const projectsByCategory = useMemo(() => {
    const map = new Map<string, Project[]>()
    for (const p of projects) {
      const cat = effectiveCategory(p)
      if (!map.has(cat)) map.set(cat, [])
      map.get(cat)!.push(p)
    }
    return map
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, allCategoryIds])

  // Msg count per project
  const msgCountByProject = useMemo(
    () => new Map(projects.map(p => [p.id, messages.filter(m => messageHasProject(m, p.id)).length])),
    [projects, messages]
  )

  // Msg count for each system status tag (type:progress etc.)
  const systemTagMsgCounts = useMemo(() => {
    const types = ["progress", "decision", "feedback", "problem"] as const
    return new Map(types.map(type => [
      systemTypeTagId(type),
      messages.filter(m => getMessageTagIds(m).includes(systemTypeTagId(type))).length,
    ]))
  }, [messages])

  // Recently used: top 5 by lastUsedAt
  const recentProjects = useMemo(
    () => [...projects]
      .filter(p => p.lastUsedAt != null)
      .sort((a, b) => (b.lastUsedAt?.getTime() ?? 0) - (a.lastUsedAt?.getTime() ?? 0))
      .slice(0, 5),
    [projects]
  )

  // Home search results
  const homeSearchResults = useMemo(() => {
    const q = homeQuery.trim().toLowerCase()
    if (!q) return []
    return projects.filter(p => p.name.toLowerCase().includes(q))
  }, [projects, homeQuery])

  // Category detail projects (filtered by search)
  const categoryProjects = useMemo(() => {
    if (view.type !== "category") return []
    const all = projectsByCategory.get(view.categoryId) ?? []
    const q = categoryQuery.trim().toLowerCase()
    return q ? all.filter(p => p.name.toLowerCase().includes(q)) : all
  }, [view, projectsByCategory, categoryQuery])

  // ── View: Home ──────────────────────────────────────────────────────────

  const homeView = (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-white/10 animate-slide-down">
        <div className="max-w-2xl mx-auto px-4 md:px-6 app-topbar flex items-center gap-3">
          <button onClick={onBack} className="w-9 h-9 rounded-full bg-white/5 border border-white/10 flex items-center justify-center active:scale-95 hover:bg-white/8 transition-all duration-150">
            <ArrowLeft className="w-4 h-4 text-muted-foreground" />
          </button>
          <h1 className="text-base font-bold tracking-tight flex-1">Tags</h1>
          <button
            onClick={() => setShowUniversalAdd(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/15 border border-primary/30 text-primary text-xs font-semibold active:scale-95 hover:bg-primary/20 transition-all duration-150"
          >
            <Plus className="w-3.5 h-3.5" />
            Add
          </button>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide">
        <div className="max-w-2xl mx-auto px-4 md:px-6 py-3">

          {/* Search bar */}
          <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 mb-4">
            <Search className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            <input
              value={homeQuery}
              onChange={e => setHomeQuery(e.target.value)}
              placeholder="Search all tags..."
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
            />
            {homeQuery && (
              <button onClick={() => setHomeQuery("")}>
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            )}
          </label>

          {/* Search results */}
          {homeQuery.trim() ? (
            homeSearchResults.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">No tags found</p>
            ) : (
              <div className="flex flex-col gap-2">
                {homeSearchResults.map(p => (
                  <TagRow
                    key={p.id}
                    project={p}
                    msgCount={msgCountByProject.get(p.id) ?? 0}
                    contacts={contacts}
                    onSelect={() => onProjectSelect(p.id)}
                    onAction={() => setActionSheet({ type: "tagAction", projectId: p.id })}
                  />
                ))}
              </div>
            )
          ) : projects.length === 0 ? (
            /* Empty state */
            <div className="flex flex-col items-center justify-center gap-3 py-24 animate-fade-up">
              <div className="w-16 h-16 rounded-full bg-white/5 border border-white/10 flex items-center justify-center animate-float">
                <FolderOpen className="w-7 h-7 text-muted-foreground/40" />
              </div>
              <p className="text-sm text-muted-foreground">No tags yet</p>
              <button onClick={() => setShowUniversalAdd(true)} className="text-xs text-primary font-semibold active:opacity-70">
                Create your first tag →
              </button>
            </div>
          ) : (
            <>
              {/* Recently used */}
              {recentProjects.length > 0 && (
                <div className="mb-5">
                  <p className="text-[10px] font-bold tracking-[2px] uppercase text-muted-foreground/50 font-mono px-1 pb-2">
                    Recently Used
                  </p>
                  <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1 -mx-1 px-1">
                    {recentProjects.map(p => (
                      <button
                        key={p.id}
                        onClick={() => onProjectSelect(p.id)}
                        className="flex-shrink-0 flex flex-col items-center gap-1.5 px-3 py-2.5 rounded-2xl bg-white/5 border border-white/10 min-w-[80px] active:bg-white/8 transition-colors"
                      >
                        <CategoryDot categoryId={p.tagCategory ?? "custom"} className="h-7 w-7 rounded-full" />
                        <p className="text-xs font-semibold text-foreground truncate max-w-[72px]">{p.name}</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Categories */}
              <div>
                <p className="text-[10px] font-bold tracking-[2px] uppercase text-muted-foreground/50 font-mono px-1 pb-2">
                  Categories
                </p>
                <div className="flex flex-col gap-1.5">
                  {allDisplayCategories
                    .filter(cat =>
                      (projectsByCategory.get(cat.id)?.length ?? 0) > 0 ||
                      ["status", "task", "custom"].includes(cat.id) ||
                      customCategoryIds.has(cat.id)
                    )
                    .map(cat => {
                      const catProjects = projectsByCategory.get(cat.id) ?? []
                      const totalMsgs = catProjects.reduce((sum, p) => sum + (msgCountByProject.get(p.id) ?? 0), 0)
                      const locked = isSystemLocked(cat.id)
                      const isTimedate = isCategoryTimeBased(cat.id)
                      return (
                        <button
                          key={cat.id}
                          onClick={() => { setCategoryQuery(""); setView({ type: "category", categoryId: cat.id }) }}
                          className="w-full flex items-center gap-3 p-3.5 rounded-2xl bg-white/5 border border-white/10 active:bg-white/8 hover:bg-white/[0.06] transition-colors text-left"
                        >
                          <CategoryIcon categoryId={cat.id} />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-foreground">{cat.label}</p>
                            <p className="text-[11px] text-muted-foreground mt-0.5">
                              {cat.id === "status" ? catProjects.length + 4 : catProjects.length} tag{(cat.id === "status" ? catProjects.length + 4 : catProjects.length) !== 1 ? "s" : ""}
                            </p>
                          </div>
                          {locked ? (
                            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/40 font-mono border border-white/10 rounded-full px-2 py-0.5 flex-shrink-0">
                              system
                            </span>
                          ) : isTimedate ? (
                            <span className="text-[10px] font-bold uppercase tracking-wider text-sky-400/60 font-mono border border-sky-400/20 rounded-full px-2 py-0.5 flex-shrink-0">
                              calendar
                            </span>
                          ) : totalMsgs > 0 ? (
                            <span className="text-[10px] font-bold font-mono text-muted-foreground bg-white/5 border border-white/10 rounded-full px-2 py-0.5 flex-shrink-0">
                              {totalMsgs} msg{totalMsgs !== 1 ? "s" : ""}
                            </span>
                          ) : null}
                          <ChevronRight className="w-4 h-4 text-muted-foreground/40 flex-shrink-0" />
                        </button>
                      )
                    })}
                </div>
              </div>

              {/* Footer hint */}
              <div className="mt-6 mb-2 flex items-center gap-2 px-1">
                <Info className="w-3.5 h-3.5 text-muted-foreground/30 flex-shrink-0" />
                <p className="text-[11px] text-muted-foreground/40 leading-snug">
                  Manage tags by category · Organize, edit and move tags with ease.
                </p>
              </div>
            </>
          )}

          <div className="h-6" />
        </div>
      </div>
    </div>
  )

  // ── View: Category Detail ───────────────────────────────────────────────

  const categoryDetailView = view.type === "category" ? (() => {
    const { categoryId } = view
    const catLabel = getCategoryLabel(categoryId, customCategories)
    const locked = isSystemLocked(categoryId)

    return (
      <div className="flex-1 min-h-0 flex flex-col">
        {/* Header */}
        <div className="flex-shrink-0 border-b border-white/10 animate-slide-down">
          <div className="max-w-2xl mx-auto px-4 md:px-6 app-topbar flex items-center gap-3">
            <button
              onClick={() => { setView({ type: "home" }); clearActionSheet() }}
              className="w-9 h-9 rounded-full bg-white/5 border border-white/10 flex items-center justify-center active:scale-95 hover:bg-white/8 transition-all duration-150"
            >
              <ArrowLeft className="w-4 h-4 text-muted-foreground" />
            </button>
            <h1 className="text-base font-bold tracking-tight flex-1">{catLabel}</h1>
            {!locked && (
              <button
                onClick={() => { setCreateInitialCategory(categoryId); setShowCreateTag(true) }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/15 border border-primary/30 text-primary text-xs font-semibold active:scale-95 hover:bg-primary/20 transition-all duration-150"
              >
                <Plus className="w-3.5 h-3.5" />
                New
              </button>
            )}
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide">
          <div className="max-w-2xl mx-auto px-4 md:px-6 py-3">

            {/* Search bar */}
            <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 mb-4">
              <Search className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              <input
                value={categoryQuery}
                onChange={e => setCategoryQuery(e.target.value)}
                placeholder={`Search ${catLabel.toLowerCase()} tags...`}
                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
              />
              {categoryQuery && (
                <button onClick={() => setCategoryQuery("")}>
                  <X className="w-4 h-4 text-muted-foreground" />
                </button>
              )}
            </label>

            {/* Tag list */}

            {/* System status tags — always shown for status category */}
            {categoryId === "status" && (
              <div className="flex flex-col gap-2 mb-2">
                {(["progress", "decision", "feedback", "problem"] as const).map(type => {
                  const config = MESSAGE_TYPE_CONFIG[type]
                  const tagId = systemTypeTagId(type)
                  const count = systemTagMsgCounts.get(tagId) ?? 0
                  
                  // Map each type to its shell styling
                  const shellClasses: Record<typeof type, string> = {
                    progress: "border-progress/18 bg-progress/[0.08] shadow-[inset_0_1px_0_rgba(255,255,255,0.10),0_10px_26px_-18px_rgba(34,197,94,0.60)]",
                    problem: "border-problem/18 bg-problem/[0.08] shadow-[inset_0_1px_0_rgba(255,255,255,0.10),0_10px_26px_-18px_rgba(239,68,68,0.60)]",
                    feedback: "border-feedback/18 bg-feedback/[0.08] shadow-[inset_0_1px_0_rgba(255,255,255,0.10),0_10px_26px_-18px_rgba(245,158,11,0.60)]",
                    decision: "border-decision/18 bg-decision/[0.08] shadow-[inset_0_1px_0_rgba(255,255,255,0.10),0_10px_26px_-18px_rgba(168,85,247,0.60)]",
                  }
                  
                  return (
                    <div key={type} className="flex items-center gap-3 p-3.5 rounded-2xl bg-white/5 border border-white/10">
                      <CategoryDot 
                        categoryId="status" 
                        dotClassName={config.text.replace("text-", "bg-")}
                        shellClassName={shellClasses[type]}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-foreground truncate">{config.label}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">System tag</p>
                      </div>
                      {count > 0 && (
                        <span className="text-[10px] font-bold font-mono text-muted-foreground bg-white/5 border border-white/10 rounded-full px-2 py-0.5 flex-shrink-0">
                          {count} msg{count !== 1 ? "s" : ""}
                        </span>
                      )}
                      <Lock className="w-3.5 h-3.5 text-muted-foreground/30 flex-shrink-0" />
                    </div>
                  )
                })}
              </div>
            )}

            {categoryProjects.length === 0 && categoryId !== "status" ? (
              <div className="flex flex-col items-center gap-2 py-16 text-center animate-fade-up">
                <FolderOpen className="w-8 h-8 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">
                  {categoryQuery ? "No tags found" : `No tags in ${catLabel} yet`}
                </p>
                {!locked && !categoryQuery && (
                  <button
                    onClick={() => { setCreateInitialCategory(categoryId); setShowCreateTag(true) }}
                    className="text-xs text-primary font-semibold active:opacity-70"
                  >
                    Create one →
                  </button>
                )}
              </div>
            ) : categoryProjects.length > 0 ? (
              <div className="flex flex-col gap-2">
                {categoryProjects.map(p => (
                  <TagRow
                    key={p.id}
                    project={p}
                    msgCount={msgCountByProject.get(p.id) ?? 0}
                    contacts={contacts}
                    onSelect={() => onProjectSelect(p.id)}
                    onAction={() => setActionSheet({ type: "tagAction", projectId: p.id })}
                  />
                ))}
              </div>
            ) : null}

            {/* System locked notice */}
            {locked && (
              <div className="mt-4 flex items-center gap-2.5 p-3.5 rounded-xl bg-white/5 border border-white/10">
                <Lock className="w-3.5 h-3.5 text-muted-foreground/50 flex-shrink-0" />
                <p className="text-xs text-muted-foreground/60 leading-snug">
                  {catLabel} tags are system-managed and cannot be edited or moved.
                </p>
              </div>
            )}

            <div className="h-6" />
          </div>
        </div>
      </div>
    )
  })() : null

  // ── Tag Action Sheet ────────────────────────────────────────────────────

  const actionProject = actionSheet.type !== "none"
    ? projects.find(p => p.id === (actionSheet as { projectId: string }).projectId) ?? null
    : null

  const tagActionSheet = actionSheet.type === "tagAction" && actionProject ? (
    <div className="fixed inset-0 z-50 flex flex-col justify-end md:items-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onPointerDown={clearActionSheet} />
      <div className="relative z-10 w-full md:w-[420px] md:mb-6 md:rounded-3xl glass-modal border-t md:border border-white/10 rounded-t-3xl animate-slide-up safe-area-pb">
        {/* Handle */}
        <div className="w-10 h-1 rounded-full bg-white/20 mx-auto mt-3 mb-1" />

        {/* Tag identity */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-white/8">
          <CategoryDot categoryId={actionProject.tagCategory ?? "custom"} className="h-7 w-7 rounded-full" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-foreground truncate">{actionProject.name}</p>
          </div>
        </div>

        <p className="text-[10px] font-bold tracking-[2px] uppercase text-muted-foreground/50 font-mono px-5 pt-4 pb-2">
          Tag actions
        </p>

        {isSystemLocked(effectiveCategory(actionProject)) ? (
          <div className="flex items-center gap-3 mx-5 mb-5 p-3.5 rounded-xl bg-white/5 border border-white/10">
            <Lock className="w-4 h-4 text-muted-foreground/50 flex-shrink-0" />
            <p className="text-xs text-muted-foreground/60 leading-snug">
              Status tags are system-managed and cannot be edited or moved.
            </p>
          </div>
        ) : (
          <div className="flex flex-col pb-2">
            {/* Edit tag */}
            <button
              onClick={() => { setEditingProject(actionProject); clearActionSheet() }}
              className="flex items-center gap-4 w-full px-5 py-3.5 text-left active:bg-white/5 transition-colors"
            >
              <span className="w-8 h-8 rounded-xl bg-white/8 flex items-center justify-center flex-shrink-0">
                <Pencil className="w-4 h-4 text-foreground/70" />
              </span>
              <span className="text-sm font-semibold text-foreground">Edit tag</span>
            </button>
            <div className="h-px bg-white/8 mx-5" />

            {/* Move to category */}
            <button
              onClick={() => setActionSheet({ type: "moveToCategory", projectId: actionProject.id })}
              className="flex items-center gap-4 w-full px-5 py-3.5 text-left active:bg-white/5 transition-colors"
            >
              <span className="w-8 h-8 rounded-xl bg-white/8 flex items-center justify-center flex-shrink-0">
                <Folder className="w-4 h-4 text-foreground/70" />
              </span>
              <span className="text-sm font-semibold text-foreground">Move to category</span>
            </button>
            <div className="h-px bg-white/8 mx-5" />


            {/* Archive */}
            <button
              onClick={() => { showLocalToast("Archive coming soon"); clearActionSheet() }}
              className="flex items-center gap-4 w-full px-5 py-3.5 text-left active:bg-white/5 transition-colors"
            >
              <span className="w-8 h-8 rounded-xl bg-white/8 flex items-center justify-center flex-shrink-0">
                <Archive className="w-4 h-4 text-muted-foreground/60" />
              </span>
              <span className="text-sm font-semibold text-muted-foreground/60">Archive</span>
            </button>
            <div className="h-px bg-white/8 mx-5" />

            {/* Delete */}
            {confirmDeleteId === actionProject.id ? (
              <button
                onClick={() => { onDeleteProject(actionProject.id); clearActionSheet() }}
                className="flex items-center gap-4 w-full px-5 py-3.5 text-left active:bg-problem/5 transition-colors animate-pulse"
              >
                <span className="w-8 h-8 rounded-xl bg-problem/10 flex items-center justify-center flex-shrink-0">
                  <Trash2 className="w-4 h-4 text-problem" />
                </span>
                <span className="text-sm font-semibold text-problem">Confirm delete?</span>
              </button>
            ) : (
              <button
                onClick={() => setConfirmDeleteId(actionProject.id)}
                className="flex items-center gap-4 w-full px-5 py-3.5 text-left active:bg-problem/5 transition-colors"
              >
                <span className="w-8 h-8 rounded-xl bg-problem/10 flex items-center justify-center flex-shrink-0">
                  <Trash2 className="w-4 h-4 text-problem" />
                </span>
                <span className="text-sm font-semibold text-problem">Delete</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  ) : null

  // ── Move to Category Sheet ────────────────────────────────────────────────

  const moveToCategorySheet = actionSheet.type === "moveToCategory" && actionProject ? (
    <MoveToCategorySheet
      project={actionProject}
      allDisplayCategories={allDisplayCategories.filter(cat => cat.id !== "date")}
      effectiveCategoryId={effectiveCategory(actionProject)}
      customCategories={customCategories}
      onConfirm={(newCategoryId) => {
        onRenameProject(actionProject.id, actionProject.name, newCategoryId)
        clearActionSheet()
      }}
      onClose={clearActionSheet}
    />
  ) : null

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className={`flex-1 min-h-0 flex flex-col stream-glass-screen ${className ?? "animate-fade-in"}`}>
      {view.type === "home" ? homeView : categoryDetailView}

      {/* Bottom sheets */}
      {tagActionSheet}
      {moveToCategorySheet}

      {/* Universal Add modal */}
      {showUniversalAdd && (
        <UniversalAddModal
          onClose={() => setShowUniversalAdd(false)}
          onChooseTag={() => { setShowUniversalAdd(false); setCreateInitialCategory(""); setShowCreateTag(true) }}
          onCreateCategory={(name) => onCreateCategory?.(name)}
        />
      )}

      {/* Create tag modal */}
      {showCreateTag && (
        <CreateProjectModal
          contacts={contacts}
          customCategories={customCategories}
          initialCategory={createInitialCategory}
          onClose={() => { setShowCreateTag(false); setCreateInitialCategory("") }}
          onSubmit={(name, memberIds, category) => {
            onCreateProject(name, memberIds, category)
            setShowCreateTag(false)
            setCreateInitialCategory("")
          }}
        />
      )}

      {/* Edit tag modal */}
      {editingProject && (
        <EditProjectModal
          project={editingProject}
          customCategories={customCategories}
          onClose={() => setEditingProject(null)}
          onSave={(name, category) => {
            onRenameProject(editingProject.id, name, category)
            setEditingProject(null)
          }}
        />
      )}

      {/* Local toast */}
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

// ── MoveToCategorySheet ───────────────────────────────────────────────────────

function MoveToCategorySheet({
  project, allDisplayCategories, effectiveCategoryId, customCategories, onConfirm, onClose,
}: {
  project: Project
  allDisplayCategories: Array<{ id: string; label: string }>
  effectiveCategoryId: string
  customCategories: CategoryItem[]
  onConfirm: (newCategoryId: string) => void
  onClose: () => void
}) {
  const [pendingCategory, setPendingCategory] = useState<string>("")
  const [pendingTimedateCatId, setPendingTimedateCatId] = useState<string | null>(null)

  const handleCategoryTap = (catId: string) => {
    if (isSystemLocked(catId)) return
    if (isCategoryTimeBased(catId, customCategories) && pendingTimedateCatId !== catId) {
      setPendingTimedateCatId(catId)
      return
    }
    setPendingTimedateCatId(null)
    setPendingCategory(catId)
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end md:items-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onPointerDown={onClose} />
      <div className="relative z-10 w-full md:w-[420px] md:mb-6 md:rounded-3xl glass-modal border-t md:border border-white/10 rounded-t-3xl animate-slide-up safe-area-pb max-h-[85dvh] flex flex-col">
        {/* Handle */}
        <div className="w-10 h-1 rounded-full bg-white/20 mx-auto mt-3 mb-1 flex-shrink-0" />

        {/* Title */}
        <div className="px-5 py-3 flex-shrink-0">
          <p className="text-[10px] font-bold tracking-[2px] uppercase text-muted-foreground/50 font-mono mb-0.5">Move tag</p>
          <h3 className="text-base font-bold text-foreground truncate">&ldquo;{project.name}&rdquo; to...</h3>
        </div>

        {/* Category list */}
        <div className="flex-1 overflow-y-auto scrollbar-hide px-4 pb-2">
          {allDisplayCategories.map(cat => {
            const current = effectiveCategoryId === cat.id
            const locked = isSystemLocked(cat.id)
            const selected = pendingCategory === cat.id

            return (
              <div key={cat.id}>
                <button
                  onClick={() => handleCategoryTap(cat.id)}
                  disabled={locked}
                  className={cn(
                    "flex items-center gap-3 w-full px-3 py-3 rounded-xl transition-colors mb-0.5",
                    locked ? "opacity-40 cursor-not-allowed" : "active:bg-white/5",
                    selected ? "bg-primary/10 border border-primary/25" : "border border-transparent"
                  )}
                >
                  <div className={cn(
                    "w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0",
                    selected ? "border-primary bg-primary" : current ? "border-primary" : "border-white/20"
                  )}>
                    {(selected || current) && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                  </div>
                  <CategoryIcon categoryId={cat.id} />
                  <span className={cn("flex-1 text-sm font-semibold text-left", locked ? "text-muted-foreground" : "text-foreground")}>
                    {cat.label}
                  </span>
                  {current && !selected && (
                    <span className="text-[10px] font-bold uppercase tracking-wider text-primary/60 font-mono">current</span>
                  )}
                  {selected && (
                    <Check className="w-4 h-4 text-primary flex-shrink-0" />
                  )}
                  {locked && (
                    <Lock className="w-3 h-3 text-muted-foreground/30 flex-shrink-0" />
                  )}
                </button>

                {/* Time-based category warning inline */}
                {isCategoryTimeBased(cat.id) && pendingTimedateCatId === cat.id && !selected && (
                  <div className="mx-3 mb-2 p-3 rounded-xl bg-sky-400/8 border border-sky-400/20">
                    <p className="text-xs text-sky-300/80 leading-snug">
                      Moving to Date will make this tag trigger date selection when used in messages.
                    </p>
                    <button
                      onClick={() => { setPendingTimedateCatId(null); setPendingCategory(cat.id) }}
                      className="mt-2 text-xs font-semibold text-sky-400 active:opacity-70"
                    >
                      Move anyway →
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Confirm button */}
        {pendingCategory && pendingCategory !== effectiveCategoryId && (
          <div className="flex-shrink-0 px-4 pb-5 pt-3 border-t border-white/8">
            <button
              onClick={() => onConfirm(pendingCategory)}
              className="w-full py-3.5 rounded-xl text-sm font-semibold bg-primary text-white shadow-[0_4px_16px_rgba(37,99,235,0.4)] active:scale-[0.98] transition-all"
            >
              Move to {getCategoryLabel(pendingCategory, customCategories)}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── EditProjectModal ──────────────────────────────────────────────────────────

function EditProjectModal({
  project, customCategories, onClose, onSave,
}: {
  project: Project
  customCategories: CategoryItem[]
  onClose: () => void
  onSave: (name: string, category: TagCategory) => void
}) {
  const allCategories: CategoryItem[] = [
    ...SYSTEM_CATEGORIES,
    ...customCategories.filter(c => !SYSTEM_CATEGORIES.some(s => s.id === c.id)),
  ]
  const validIds = new Set(allCategories.map(c => c.id))
  const [name, setName] = useState(project.name)
  const [category, setCategory] = useState<string>(
    project.tagCategory && validIds.has(project.tagCategory)
      ? project.tagCategory
      : "custom"
  )
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-5">
      <button onClick={onClose} className="absolute inset-0 bg-black/60 backdrop-blur-sm" aria-label="Close" />
      <div className="relative z-10 w-full max-w-sm glass-modal rounded-3xl border border-white/10 shadow-2xl overflow-y-auto max-h-[90dvh] animate-spring-pop -translate-y-[5%] p-5">
        <div className="flex items-center justify-between mb-5">
          <div>
            <p className="text-[10px] font-bold tracking-[2px] uppercase text-muted-foreground font-mono mb-1">Manage Tag</p>
            <h2 className="text-xl font-bold">Edit tag</h2>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        <p className="text-[10px] font-bold tracking-[2px] uppercase text-muted-foreground font-mono mb-2">Name</p>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === "Enter" && name.trim() && onSave(name.trim(), category)}
          className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3.5 text-sm text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-primary/50 transition-colors mb-4"
        />

        <p className="text-[10px] font-bold tracking-[2px] uppercase text-muted-foreground font-mono mb-2">Category</p>
        <div className="flex flex-col gap-1.5 mb-5">
          {allCategories.map(cat => (
            <button
              key={cat.id}
              onClick={() => setCategory(cat.id)}
              className={cn(
                "flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-xs font-semibold transition-all active:scale-[0.98]",
                category === cat.id
                  ? "bg-primary/12 border-primary/35 text-foreground"
                  : "bg-white/[0.035] border-white/10 text-muted-foreground hover:border-white/20"
              )}
            >
              <CategoryIcon categoryId={cat.id} />
              <span className="min-w-0 flex-1 truncate">{cat.name}</span>
              {category === cat.id && <Check className="h-4 w-4 shrink-0 text-primary" />}
            </button>
          ))}
        </div>

        <button
          onClick={() => name.trim() && onSave(name.trim(), category)}
          disabled={!name.trim()}
          className={cn(
            "w-full py-3.5 rounded-xl text-sm font-semibold tracking-wide transition-all",
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
