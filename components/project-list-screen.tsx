"use client"

import { useState, useRef } from "react"
import { ArrowLeft, Plus, FolderOpen, Star, Trash2, Pencil, X, Check } from "lucide-react"
import { UniversalAddModal } from "@/components/universal-add-modal"
import { cn, haptic } from "@/lib/utils"
import {
  type Project,
  type Message,
  type Contact,
  type TagCategory,
  type CategoryItem,
  messageHasProject,
  CATEGORY_CONFIG,
  CATEGORY_ORDER,
  USER_SELECTABLE_CATEGORIES,
  SYSTEM_CATEGORIES,
} from "@/lib/store"
import { CreateProjectModal } from "@/components/create-project-modal"

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
  onCreateCategory?: (name: string) => void
  className?: string
  contacts: Contact[]
}

export function ProjectListScreen({
  projects, messages, onBack, onProjectSelect, onCreateProject,
  onDeleteProject, onFavoriteProject, onRenameProject,
  customCategories = [], onCreateCategory, className, contacts,
}: ProjectListScreenProps) {
  const [showUniversalAdd, setShowUniversalAdd] = useState(false)
  const [showCreateTag, setShowCreateTag] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [editingProject, setEditingProject] = useState<Project | null>(null)
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const msgCount = (projectId: string) =>
    messages.filter((m) => messageHasProject(m, projectId)).length

  const startPress = (projectId: string) => {
    pressTimer.current = setTimeout(() => {
      setSelectedId(projectId)
      navigator?.vibrate?.(12)
    }, 450)
  }
  const cancelPress = () => {
    if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null }
  }
  const clearSelection = () => { setSelectedId(null); setConfirmDeleteId(null) }

  // All available categories for display (system + user-created)
  const allCategories: CategoryItem[] = [
    ...SYSTEM_CATEGORIES,
    ...customCategories,
    { id: "custom", name: "Custom", isSystem: true },
  ]

  // Build full display order: system order + custom categories + legacy
  const displayOrder = [
    ...allCategories.map(c => c.id),
    ...CATEGORY_ORDER.filter(k => !allCategories.some(c => c.id === k)),
  ]

  const validCats = new Set(displayOrder)
  const effectiveCategory = (p: Project): string =>
    p.tagCategory && validCats.has(p.tagCategory) ? p.tagCategory : "custom"

  const grouped: Array<{ catId: string; label: string; items: Project[] }> = []
  for (const catId of displayOrder) {
    const catProjects = projects.filter(p => effectiveCategory(p) === catId)
    if (catProjects.length === 0) continue
    const label = allCategories.find(c => c.id === catId)?.name
      ?? CATEGORY_CONFIG[catId]?.label
      ?? "Custom"
    const sorted = [
      ...catProjects.filter(p => p.isFavorited === true),
      ...catProjects.filter(p => p.isFavorited !== true),
    ]
    grouped.push({ catId, label, items: sorted })
  }

  const selectedProject = selectedId ? projects.find(p => p.id === selectedId) : null
  let globalIndex = 0

  return (
    <div className={`flex-1 min-h-0 flex flex-col bg-background ${className ?? "animate-fade-in"}`}>
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

      {/* List */}
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide" onClick={() => selectedId && clearSelection()}>
        <div className="max-w-2xl mx-auto px-4 md:px-6 py-3 flex flex-col gap-1">
          {projects.length === 0 ? (
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
            grouped.map(({ catId, label, items }) => (
              <div key={catId} className="mb-3">
                <p className="text-[10px] font-bold tracking-[2px] uppercase text-muted-foreground/50 font-mono px-1 pb-1.5 pt-2">
                  {label}
                </p>
                <div className="flex flex-col gap-2">
                  {items.map(project => {
                    const animIndex = globalIndex++
                    return (
                      <button
                        key={project.id}
                        onClick={e => {
                          e.stopPropagation()
                          if (selectedId) { clearSelection(); return }
                          onProjectSelect(project.id)
                        }}
                        onPointerDown={e => { e.stopPropagation(); startPress(project.id) }}
                        onPointerUp={cancelPress}
                        onPointerLeave={cancelPress}
                        onPointerCancel={cancelPress}
                        className={cn(
                          "w-full flex items-center gap-3 p-4 rounded-2xl bg-card border border-white/10 active:bg-white/5 hover:bg-white/[0.04] transition-colors duration-150 animate-fade-up text-left",
                          selectedId === project.id && "ring-2 ring-primary/40 bg-primary/5"
                        )}
                        style={{ animationDelay: `${animIndex * 40}ms` }}
                      >
                        <div className={cn("w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center", project.color, "bg-opacity-20")}>
                          <div className={cn("w-3 h-3 rounded-full", project.color)} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="text-sm font-semibold text-foreground truncate no-callout">{project.name}</p>
                            {project.isFavorited && <Star className="w-3.5 h-3.5 text-feedback fill-current flex-shrink-0" />}
                          </div>
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            {project.members.length === 0
                              ? "No people"
                              : project.members.length === 1
                              ? contacts.find(c => c.id === project.members[0])?.name ?? "1 person"
                              : `${project.members.length} people`}
                          </p>
                        </div>
                        {msgCount(project.id) > 0 && (
                          <span className="flex-shrink-0 text-[10px] font-bold font-mono text-muted-foreground bg-white/5 border border-white/10 rounded-full px-2 py-0.5 no-callout">
                            {msgCount(project.id)} msg{msgCount(project.id) !== 1 ? "s" : ""}
                          </span>
                        )}
                        <span className="text-muted-foreground/30 text-lg ml-1">›</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))
          )}
          <div className="h-6" />
        </div>
      </div>

      {/* Floating action bar */}
      {selectedProject && (
        <>
          <div className="fixed inset-0 z-20" onClick={clearSelection} />
          <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-30 animate-scale-in px-4 w-full max-w-xs">
            <div className="flex items-center justify-center gap-1 bg-[#0d1c35] border border-white/15 rounded-2xl p-1.5 shadow-2xl">
              <button
                onClick={() => { onFavoriteProject(selectedProject.id); clearSelection() }}
                className={cn(
                  "flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all active:scale-95",
                  selectedProject.isFavorited ? "bg-feedback/15 text-feedback" : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
                )}
              >
                <Star className={cn("w-4 h-4", selectedProject.isFavorited && "fill-current")} />
                {selectedProject.isFavorited ? "Unfavorite" : "Favorite"}
              </button>
              <div className="w-px h-6 bg-white/15 flex-shrink-0" />
              <button
                onClick={() => { setEditingProject(selectedProject); clearSelection() }}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-muted-foreground hover:bg-white/5 hover:text-foreground transition-all active:scale-95"
              >
                <Pencil className="w-4 h-4" />
                Edit
              </button>
              <div className="w-px h-6 bg-white/15 flex-shrink-0" />
              {confirmDeleteId === selectedProject.id ? (
                <button
                  onClick={() => { onDeleteProject(selectedProject.id); clearSelection() }}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-problem hover:bg-problem/10 transition-all active:scale-95 animate-pulse"
                >
                  <Trash2 className="w-4 h-4" />
                  Confirm?
                </button>
              ) : (
                <button
                  onClick={() => setConfirmDeleteId(selectedProject.id)}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-problem hover:bg-problem/10 transition-all active:scale-95"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete
                </button>
              )}
            </div>
          </div>
        </>
      )}

      {/* Universal Add modal */}
      {showUniversalAdd && (
        <UniversalAddModal
          onClose={() => setShowUniversalAdd(false)}
          onChooseTag={() => { setShowUniversalAdd(false); setShowCreateTag(true) }}
          onCreateCategory={(name) => {
            onCreateCategory?.(name)
            setShowUniversalAdd(false)
          }}
        />
      )}

      {/* Create tag modal */}
      {showCreateTag && (
        <CreateProjectModal
          contacts={contacts}
          customCategories={customCategories}
          onClose={() => setShowCreateTag(false)}
          onSubmit={(name, memberIds, category) => {
            onCreateProject(name, memberIds, category)
            setShowCreateTag(false)
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
    </div>
  )
}

// ── EditProjectModal ────────────────────────────────────────────────────────

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
    ...customCategories,
    { id: "custom", name: "Custom", isSystem: true },
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
      <button onClick={onClose} className="absolute inset-0 bg-black/65 backdrop-blur-sm" aria-label="Close" />
      <div className="relative z-10 w-full max-w-sm bg-[#0d1c35] rounded-3xl border border-white/10 shadow-2xl overflow-y-auto max-h-[90dvh] animate-spring-pop -translate-y-[5%] p-5">
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
        <div className="flex flex-wrap gap-1.5 mb-5">
          {allCategories.map(cat => (
            <button
              key={cat.id}
              onClick={() => setCategory(cat.id)}
              className={cn(
                "px-3 py-1.5 rounded-full text-xs font-semibold border transition-all active:scale-95",
                category === cat.id
                  ? "bg-primary/15 border-primary/40 text-primary"
                  : "bg-white/5 border-white/10 text-muted-foreground hover:border-white/20"
              )}
            >
              {cat.name}
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
