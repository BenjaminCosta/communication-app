"use client"

import { useState, useRef } from "react"
import { ArrowLeft, Plus, FolderOpen, Star, Trash2 } from "lucide-react"
import { cn, haptic } from "@/lib/utils"
import { type Project, type Message, type Contact } from "@/lib/store"
import { CreateProjectModal } from "@/components/create-project-modal"

interface ProjectListScreenProps {
  projects: Project[]
  messages: Message[]
  onBack: () => void
  onProjectSelect: (projectId: string) => void
  onCreateProject: (name: string, memberIds: string[]) => void
  onDeleteProject: (id: string) => void
  onFavoriteProject: (id: string) => void
  className?: string
  contacts: Contact[]
}

export function ProjectListScreen({
  projects,
  messages,
  onBack,
  onProjectSelect,
  onCreateProject,
  onDeleteProject,
  onFavoriteProject,
  className,
  contacts,
}: ProjectListScreenProps) {
  const [showCreate, setShowCreate] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const msgCount = (projectId: string) =>
    messages.filter((m) => m.projectId === projectId).length

  const startPress = (projectId: string) => {
    pressTimer.current = setTimeout(() => {
      setSelectedId(projectId)
      navigator?.vibrate?.(12)
    }, 450)
  }

  const cancelPress = () => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current)
      pressTimer.current = null
    }
  }

  const clearSelection = () => {
    setSelectedId(null)
    setConfirmDeleteId(null)
  }

  // Sort: favorites first, preserve relative order within each group
  const sortedProjects = [
    ...projects.filter((p) => p.isFavorited === true),
    ...projects.filter((p) => p.isFavorited !== true),
  ]

  const selectedProject = selectedId ? projects.find((p) => p.id === selectedId) : null

  return (
    <div className={`flex-1 flex flex-col bg-background ${className ?? "animate-fade-in"}`}>
      {/* Header */}
      <div className="flex-shrink-0 border-b border-white/10 animate-slide-down">
        <div className="max-w-2xl mx-auto px-4 md:px-6 py-3 flex items-center gap-3">
          <button
            onClick={onBack}
            className="w-9 h-9 rounded-full bg-white/5 border border-white/10 flex items-center justify-center active:scale-95 hover:bg-white/8 transition-all duration-150"
          >
            <ArrowLeft className="w-4 h-4 text-muted-foreground" />
          </button>
          <h1 className="text-base font-bold tracking-tight flex-1">Projects</h1>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/15 border border-primary/30 text-primary text-xs font-semibold active:scale-95 hover:bg-primary/20 transition-all duration-150"
          >
            <Plus className="w-3.5 h-3.5" />
            New
          </button>
        </div>
      </div>

      {/* List */}
      <div
        className="flex-1 overflow-y-auto scrollbar-hide"
        onClick={() => selectedId && clearSelection()}
      >
        <div className="max-w-2xl mx-auto px-4 md:px-6 py-3 flex flex-col gap-2">
          {sortedProjects.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-24 animate-fade-up">
              <div className="w-16 h-16 rounded-full bg-white/5 border border-white/10 flex items-center justify-center animate-float">
                <FolderOpen className="w-7 h-7 text-muted-foreground/40" />
              </div>
              <p className="text-sm text-muted-foreground">No projects yet</p>
              <button
                onClick={() => setShowCreate(true)}
                className="text-xs text-primary font-semibold active:opacity-70"
              >
                Create your first project →
              </button>
            </div>
          ) : (
            sortedProjects.map((project, i) => (
              <button
                key={project.id}
                onClick={(e) => {
                  e.stopPropagation()
                  if (selectedId) { clearSelection(); return }
                  onProjectSelect(project.id)
                }}
                onPointerDown={(e) => { e.stopPropagation(); startPress(project.id) }}
                onPointerUp={cancelPress}
                onPointerLeave={cancelPress}
                onPointerCancel={cancelPress}
                className={cn(
                  "w-full flex items-center gap-3 p-4 rounded-2xl bg-card border border-white/10 active:bg-white/5 hover:bg-white/[0.04] transition-colors duration-150 animate-fade-up text-left",
                  selectedId === project.id && "ring-2 ring-primary/40 bg-primary/5"
                )}
                style={{ animationDelay: `${i * 40}ms` }}
              >
                {/* Color dot */}
                <div className={cn("w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center", project.color, "bg-opacity-20")}>
                  <div className={cn("w-3 h-3 rounded-full", project.color)} />
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-semibold text-foreground truncate no-callout">{project.name}</p>
                    {project.isFavorited && (
                      <Star className="w-3.5 h-3.5 text-feedback fill-current flex-shrink-0" />
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {project.members.length === 0
                      ? "No members"
                      : project.members.length === 1
                      ? `${contacts.find(c => c.id === project.members[0])?.name ?? "1 member"}`
                      : `${project.members.length} members`}
                  </p>
                </div>

                {/* Message count */}
                {msgCount(project.id) > 0 && (
                  <span className="flex-shrink-0 text-[10px] font-bold font-mono text-muted-foreground bg-white/5 border border-white/10 rounded-full px-2 py-0.5 no-callout">
                    {msgCount(project.id)} msg{msgCount(project.id) !== 1 ? "s" : ""}
                  </span>
                )}

                <span className="text-muted-foreground/30 text-lg ml-1">›</span>
              </button>
            ))
          )}
          <div className="h-6" />
        </div>
      </div>

      {/* Floating action bar — shown when a project is selected */}
      {selectedProject && (
        <>
          <div className="fixed inset-0 z-20" onClick={clearSelection} />
          <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-30 animate-scale-in px-4 w-full max-w-xs">
            <div className="flex items-center justify-center gap-1 bg-[#0d1c35] border border-white/15 rounded-2xl p-1.5 shadow-2xl">
              {/* Favorite button */}
              <button
                onClick={() => {
                  onFavoriteProject(selectedProject.id)
                  clearSelection()
                }}
                className={cn(
                  "flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all active:scale-95",
                  selectedProject.isFavorited
                    ? "bg-feedback/15 text-feedback"
                    : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
                )}
              >
                <Star className={cn("w-4 h-4", selectedProject.isFavorited && "fill-current")} />
                {selectedProject.isFavorited ? "Unfavorite" : "Favorite"}
              </button>

              <div className="w-px h-6 bg-white/15 flex-shrink-0" />

              {/* Delete button — 2-step confirmation */}
              {confirmDeleteId === selectedProject.id ? (
                <button
                  onClick={() => {
                    onDeleteProject(selectedProject.id)
                    clearSelection()
                  }}
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

      {/* Create new project sheet */}
      {showCreate && (
        <CreateProjectModal
          contacts={contacts}
          onClose={() => setShowCreate(false)}
          onSubmit={(name, memberIds) => {
            onCreateProject(name, memberIds)
            setShowCreate(false)
          }}
        />
      )}
    </div>
  )
}
