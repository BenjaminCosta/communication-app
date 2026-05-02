"use client"

import { useState } from "react"
import { ArrowLeft, Plus, FolderOpen } from "lucide-react"
import { cn } from "@/lib/utils"
import { type Project, type Message, CONTACTS } from "@/lib/store"
import { CreateProjectModal } from "@/components/create-project-modal"

interface ProjectListScreenProps {
  projects: Project[]
  messages: Message[]
  onBack: () => void
  onProjectSelect: (projectId: string) => void
  onCreateProject: (name: string, memberIds: string[]) => void
}

export function ProjectListScreen({
  projects,
  messages,
  onBack,
  onProjectSelect,
  onCreateProject,
}: ProjectListScreenProps) {
  const [showCreate, setShowCreate] = useState(false)

  const msgCount = (projectId: string) =>
    messages.filter((m) => m.projectId === projectId).length

  return (
    <div className="flex-1 flex flex-col bg-background animate-fade-in">
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
      <div className="flex-1 overflow-y-auto scrollbar-hide">
        <div className="max-w-2xl mx-auto px-4 md:px-6 py-3 flex flex-col gap-2">
          {projects.length === 0 ? (
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
            projects.map((project, i) => (
              <button
                key={project.id}
                onClick={() => onProjectSelect(project.id)}
                className="w-full flex items-center gap-3 p-4 rounded-2xl bg-card border border-white/10 active:bg-white/5 hover:bg-white/[0.04] transition-colors duration-150 animate-fade-up text-left"
                style={{ animationDelay: `${i * 40}ms` }}
              >
                {/* Color dot */}
                <div className={cn("w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center", project.color, "bg-opacity-20")}>
                  <div className={cn("w-3 h-3 rounded-full", project.color)} />
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate">{project.name}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {project.members.length === 0
                      ? "No members"
                      : project.members.length === 1
                      ? `${CONTACTS.find(c => c.id === project.members[0])?.name ?? "1 member"}`
                      : `${project.members.length} members`}
                  </p>
                </div>

                {/* Message count */}
                {msgCount(project.id) > 0 && (
                  <span className="flex-shrink-0 text-[10px] font-bold font-mono text-muted-foreground bg-white/5 border border-white/10 rounded-full px-2 py-0.5">
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

      {/* Create new project sheet */}
      {showCreate && (
        <CreateProjectModal
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
