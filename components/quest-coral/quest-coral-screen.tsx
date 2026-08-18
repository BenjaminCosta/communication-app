"use client"

/**
 * Quest Coral — Projects Home.
 *
 * No bottom navigation: the module switcher in the header is the only way
 * out, matching Communications, Directory and Applications.
 */

import { memo, useCallback, useMemo, useState } from "react"
import { useGeneratingReveal } from "@/hooks/use-generating-reveal"
import {
  ArrowUp,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleArrowRight,
  Info,
  MoreVertical,
  Pencil,
  Plus,
  Search,
  Share2,
  Sparkles,
  Target,
  Trash2,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { ModuleSwitcher } from "@/components/module-switcher"
import { QcSheet } from "@/components/quest-coral/ui/quest-coral-sheet"
import { Avatar, MissionFitDots, ProgressRing, QcButton, QcCard } from "@/components/quest-coral/ui/quest-coral-primitives"
import { projectAccent, type ProjectAccent } from "@/components/quest-coral/ui/project-accent"
import { TONE_STYLES } from "@/components/quest-coral/ui/tone"
import { AboutQuestCoralScreen } from "@/components/quest-coral/about-quest-coral-screen"
import { CreateProjectSheet } from "@/components/quest-coral/create-project-sheet"
import { EditProjectDetailsSheet } from "@/components/quest-coral/edit-project-details-sheet"
import { QuestCoralAskGenerating } from "@/components/quest-coral/ui/quest-coral-ask-generating"
import { answerPortfolioQuestion } from "@/features/quest-coral/quest-coral-mock-ai"
import { effectiveProjectStatus, missionFitLabel, PROJECT_STATUS_META, PROJECT_STATUS_ORDER, type Project, type ProjectStatus } from "@/lib/quest-coral-core"
import { emptyQuestCoralFilters, type QuestCoralDashboard } from "@/features/quest-coral/use-quest-coral-dashboard"
import { projectToAskPayload } from "@/features/quest-coral/use-quest-coral-ask"
import {
  createQuestCoralAiIdempotencyKey,
  QuestCoralAiClientError,
  requestQuestCoralAsk,
} from "@/features/quest-coral/ai/client/quest-coral-ai-client"
import { QUEST_CORAL_AI_ENABLED } from "@/lib/quest-coral-flags"
import { QUEST_CORAL_AI_LIMITS } from "@/lib/ai/config-public"
import type { Contact, ImportedContact } from "@/lib/store"

interface QuestCoralScreenProps {
  dashboard: QuestCoralDashboard
  contacts: Contact[]
  importedContacts: ImportedContact[]
  className?: string
  onOpenProject: (id: string) => void
  onSwitchToStream: () => void
  onSwitchToDirectory: () => void
  onSwitchToApplications: () => void
  onSwitchToByeByeDpr: () => void
  onCourtneyRobertsCenter?: () => void
}

function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

function StatTile({
  value,
  label,
  tone,
}: {
  value: number
  label: string
  tone: keyof typeof TONE_STYLES
}) {
  return (
    <div className="quest-coral-card flex min-w-[4.75rem] flex-1 flex-col items-center rounded-xl px-2 py-2.5">
      <span className={cn("text-lg font-bold leading-none tabular-nums", TONE_STYLES[tone].text)}>{value}</span>
      <span className="mt-1 text-center text-[0.625rem] font-medium leading-tight text-[var(--coral-text-muted)]">{label}</span>
    </div>
  )
}

function ProjectStatusBadge({ project, accent }: { project: Project; accent: ProjectAccent }) {
  const meta = PROJECT_STATUS_META[effectiveProjectStatus(project)]
  return (
    <span
      className="inline-flex shrink-0 rounded-full px-2.25 py-0.75 text-[0.625rem] font-semibold leading-none"
      style={{ backgroundColor: accent.soft, border: `1px solid ${accent.border}`, color: accent.text }}
    >
      {meta.label}
    </span>
  )
}

// Same reasoning as ApplicationCard (components/applications/dashboard/application-card.tsx):
// `onOpen` is passed by reference (id-based) so this memo holds — typing in
// search or in the Ask AI box on this screen re-renders neither the
// surviving cards nor recomputes their status accent.
const ProjectCard = memo(function ProjectCard({
  project,
  unreadCount,
  onOpen,
  onMore,
}: {
  project: Project
  unreadCount: number
  onOpen: (id: string) => void
  onMore: (id: string) => void
}) {
  const accent = projectAccent(project)
  const isComplete = effectiveProjectStatus(project) === "completed"
  // Completion always wins over a leftover next step (older data, or a status
  // change that didn't retype it) — a finished project should never still
  // read as having something outstanding to do.
  const nextStep = isComplete ? "Completed" : (project.nextStep ?? "No next step set")
  const nextDate = isComplete ? formatShortDate(project.updatedAt) : project.nextStepDue ? formatShortDate(project.nextStepDue) : "—"
  return (
    <article className="quest-coral-card flex w-full flex-col gap-3 rounded-[1.45rem] p-3.5">
      <div className="flex items-start gap-3">
        <button type="button" onClick={() => onOpen(project.id)} className="quest-coral-tap flex min-w-0 flex-1 items-start gap-3 text-left" aria-label={`Open ${project.name}`}>
          <div className="relative shrink-0">
            <ProgressRing percent={project.progress} size={74} label="" color={accent.ring} trackColor={accent.track} />
            {unreadCount > 0 && (
              <span
                className="absolute -right-0.5 -top-0.5 flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full bg-[var(--coral-strong)] px-1 text-[0.625rem] font-bold leading-none text-white ring-2 ring-[var(--coral-surface)]"
                aria-label={`${unreadCount} new ${unreadCount === 1 ? "activity" : "activities"}`}
              >
                {unreadCount}
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-1.5">
              <h3 className="min-w-0 flex-1 truncate text-[0.9375rem] font-semibold tracking-[-0.025em] text-[var(--coral-text)]">{project.name}</h3>
              <ProjectStatusBadge project={project} accent={accent} />
            </div>
            <p className="mt-1 line-clamp-2 text-[0.75rem] font-medium leading-[1.45] text-[var(--coral-text-muted)]">{project.description}</p>

            <div className="mt-2.5 flex items-center gap-2">
              <div className="flex -space-x-2">
                {project.people.slice(0, 4).map((person) => (
                  <Avatar key={person.id} initials={person.initials} className="h-7 w-7 text-[0.5625rem] ring-2 ring-[var(--coral-surface)]" />
                ))}
              </div>
              {project.people.length > 4 && (
                <span className="flex h-7 min-w-7 shrink-0 items-center justify-center rounded-full bg-[var(--coral-surface-2)] px-1 text-[0.625rem] font-semibold text-[var(--coral-text-muted)]">
                  +{project.people.length - 4}
                </span>
              )}
            </div>
          </div>
        </button>
        <button type="button" onClick={() => onMore(project.id)} className="quest-coral-tap -mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--coral-text-muted)] hover:bg-[var(--coral-surface-2)]" aria-label={`Actions for ${project.name}`}>
          <MoreVertical className="h-4 w-4" strokeWidth={2} />
        </button>
      </div>

      <button type="button" onClick={() => onOpen(project.id)} className="quest-coral-tap divide-y divide-[var(--coral-border)] border-t border-[var(--coral-border)] text-left" aria-label={`Open ${project.name} details`}>
        <div className="flex min-h-10 items-center gap-2.5 py-2.5">
          <Target className="h-4.5 w-4.5 shrink-0 text-[var(--coral-strong)]" strokeWidth={2} />
          <span className="min-w-0 flex-1 text-[0.8125rem] font-medium text-[var(--coral-text)]">Mission fit</span>
          <span className="text-[0.8125rem] font-semibold" style={{ color: accent.text }}>{missionFitLabel(project.missionFitScore)}</span>
          <MissionFitDots score={project.missionFitScore} />
        </div>
        <div className="flex min-h-10 items-center gap-2.5 py-2.5">
          {isComplete ? (
            <CheckCircle2 className="h-4.5 w-4.5 shrink-0" style={{ color: accent.ring }} strokeWidth={2} />
          ) : (
            <CircleArrowRight className="h-4.5 w-4.5 shrink-0 text-[var(--coral-strong)]" strokeWidth={1.9} />
          )}
          <span className="shrink-0 text-[0.8125rem] font-medium text-[var(--coral-text)]">{isComplete ? "Completed" : "Next step"}</span>
          <span className={cn("min-w-0 flex-1 truncate text-[0.8125rem]", project.nextStep ? "text-[var(--coral-text)]" : "text-[var(--coral-text-muted)]")}>{nextStep}</span>
          <span className="flex shrink-0 items-center gap-1 text-[0.6875rem] text-[var(--coral-text-muted)]">
            <CalendarDays className="h-3.5 w-3.5" strokeWidth={1.9} />
            {nextDate}
          </span>
        </div>
      </button>
    </article>
  )
})

export function QuestCoralScreen({
  dashboard,
  contacts,
  importedContacts,
  className,
  onOpenProject,
  onSwitchToStream,
  onSwitchToDirectory,
  onSwitchToApplications,
  onSwitchToByeByeDpr,
  onCourtneyRobertsCenter,
}: QuestCoralScreenProps) {
  const { currentUserId, projects, updates, feedbackReplies, contexts, visibleProjects, counts, filters, setFilters, createProject, deleteProject, patchProject, unreadCountFor } = dashboard
  const [showAbout, setShowAbout] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [statusSheetOpen, setStatusSheetOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [askOpen, setAskOpen] = useState(false)
  const [askQuestion, setAskQuestion] = useState("")
  const [askAnswer, setAskAnswer] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)
  const [askError, setAskError] = useState<string | null>(null)
  const [askAttempt, setAskAttempt] = useState(0)
  const [askCooldownUntil, setAskCooldownUntil] = useState(0)
  const askGenerating = useGeneratingReveal(askAttempt, asking, 500)
  const [projectMenuId, setProjectMenuId] = useState<string | null>(null)
  const [detailsProjectId, setDetailsProjectId] = useState<string | null>(null)
  const [deleteProjectId, setDeleteProjectId] = useState<string | null>(null)
  const [isProjectActionPending, setIsProjectActionPending] = useState(false)
  const [projectActionError, setProjectActionError] = useState<string | null>(null)
  const [projectShareNotice, setProjectShareNotice] = useState<string | null>(null)

  const statusLabel = filters.status === "all" ? "All statuses" : PROJECT_STATUS_META[filters.status].label
  const hasActiveProjectFilters = filters.status !== "all" || filters.query.trim().length > 0
  const menuProject = useMemo(() => projects.find((project) => project.id === projectMenuId) ?? null, [projects, projectMenuId])
  const detailsProject = useMemo(() => projects.find((project) => project.id === detailsProjectId) ?? null, [projects, detailsProjectId])
  const contextsByProjectId = useMemo(
    () => new Map(contexts.map((context) => [context.projectId, context.markdown])),
    [contexts],
  )

  const askSubmit = () => {
    const question = askQuestion.trim()
    if (!question || asking || Date.now() < askCooldownUntil) return
    setAsking(true)
    setAskError(null)
    setAskAttempt((current) => current + 1)

    if (!QUEST_CORAL_AI_ENABLED) {
      window.setTimeout(() => {
        setAskAnswer(answerPortfolioQuestion(projects, updates, question, contextsByProjectId))
        setAsking(false)
      }, 400)
      return
    }

    void (async () => {
      try {
        const response = await requestQuestCoralAsk(
          {
            question,
            scope: "portfolio",
            projects: projects
              .slice(0, QUEST_CORAL_AI_LIMITS.maxPortfolioProjects)
              .map((project) => projectToAskPayload(project, updates, contextsByProjectId.get(project.id), feedbackReplies)),
          },
          { idempotencyKey: createQuestCoralAiIdempotencyKey() },
        )
        setAskAnswer(response.answer)
      } catch (err) {
        if (err instanceof QuestCoralAiClientError && err.code === "rate-limited" && err.retryAfterSeconds) {
          setAskCooldownUntil(Date.now() + err.retryAfterSeconds * 1000)
        }
        setAskError(err instanceof Error ? err.message : "Something went wrong. Please try again.")
      } finally {
        setAsking(false)
      }
    })()
  }

  const openProjectMenu = useCallback((projectId: string) => {
    setProjectActionError(null)
    setProjectMenuId(projectId)
  }, [])

  const handleShareProject = async () => {
    if (!menuProject || isProjectActionPending) return
    setProjectActionError(null)
    const text = `${menuProject.name} — ${PROJECT_STATUS_META[menuProject.status].label}, ${menuProject.progress}% complete.${menuProject.nextStep ? ` Next step: ${menuProject.nextStep}.` : ""}`
    try {
      if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
        await navigator.share({ title: menuProject.name, text })
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
        setProjectShareNotice("Project summary copied")
      } else {
        throw new Error("Share is unavailable")
      }
      setProjectMenuId(null)
    } catch {
      setProjectActionError("This project summary could not be shared. Please try again.")
    }
  }

  const handleDeleteProject = async () => {
    if (!deleteProjectId || isProjectActionPending) return
    setIsProjectActionPending(true)
    setProjectActionError(null)
    try {
      await deleteProject(deleteProjectId)
      setDeleteProjectId(null)
    } catch {
      setProjectActionError("This project could not be deleted. Please try again.")
    } finally {
      setIsProjectActionPending(false)
    }
  }

  if (showAbout) {
    return (
      <AboutQuestCoralScreen
        className={className}
        onBack={() => setShowAbout(false)}
        onAskAI={() => {
          setShowAbout(false)
          setAskOpen(true)
        }}
      />
    )
  }

  return (
    <div className={cn("quest-coral-scope quest-coral-canvas relative flex min-h-0 flex-1 flex-col overflow-hidden", className)}>
      <header className="quest-coral-topbar app-topbar flex shrink-0 items-center justify-between border-b px-4 animate-slide-down">
        <ModuleSwitcher
          activeModule="quest-coral"
          showCourtneyRobertsCenter={Boolean(onCourtneyRobertsCenter)}
          onSelect={(module) => {
            if (module === "communications") onSwitchToStream()
            if (module === "directory") onSwitchToDirectory()
            if (module === "applications") onSwitchToApplications()
            if (module === "bye-bye-dpr") onSwitchToByeByeDpr()
            if (module === "courtney-roberts-center") onCourtneyRobertsCenter?.()
          }}
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSearchOpen((open) => !open)}
            className={cn(
              "quest-coral-tap flex h-9 w-9 items-center justify-center rounded-full border",
              searchOpen || filters.query
                ? "border-[#FFD2C2] bg-[var(--coral-soft)] text-[var(--coral-strong)]"
                : "border-[var(--coral-border)] bg-[var(--coral-surface)] text-[var(--coral-text)]",
            )}
            aria-label="Search projects"
          >
            <Search className="h-4 w-4" strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={() => setShowAbout(true)}
            className="quest-coral-tap flex h-9 w-9 items-center justify-center rounded-full border border-[var(--coral-border)] bg-[var(--coral-surface)] text-[var(--coral-text)]"
            aria-label="About Quest Coral"
          >
            <Info className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-hide">
        <div className="mx-auto w-full max-w-2xl px-4 pb-24 pt-4 md:px-6">
          <h1 className="text-[1.5rem] font-bold leading-tight tracking-[-0.02em] text-[var(--coral-text)]">Projects</h1>
          <p className="mt-1 text-[0.8125rem] text-[var(--coral-text-muted)]">
            {projects.length} {projects.length === 1 ? "project" : "projects"} tracked
          </p>
          {projectShareNotice && <p className="mt-1 text-[0.6875rem] font-medium text-[var(--coral-text-muted)]">{projectShareNotice}</p>}

          {searchOpen && (
            <div className="quest-coral-step-enter mt-3.5 flex items-center gap-2 rounded-xl border border-[var(--coral-border)] bg-[var(--coral-surface)] px-3.5 focus-within:border-[var(--coral)] focus-within:shadow-[0_0_0_3px_rgba(255,122,89,0.14)]">
              <Search className="h-4 w-4 shrink-0 text-[var(--coral-text-muted)]" strokeWidth={2} />
              <input
                autoFocus
                value={filters.query}
                onChange={(event) => setFilters({ ...filters, query: event.target.value })}
                placeholder="Search projects"
                className="h-11 min-w-0 flex-1 bg-transparent text-base text-[var(--coral-text)] outline-none placeholder:text-[#94A3B8]"
              />
              {filters.query && (
                <button
                  type="button"
                  onClick={() => setFilters({ ...filters, query: "" })}
                  className="quest-coral-tap flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--coral-text-muted)] hover:bg-[var(--coral-surface-2)]"
                  aria-label="Clear search"
                >
                  <X className="h-3.5 w-3.5" strokeWidth={2.5} />
                </button>
              )}
            </div>
          )}

          {/* Ask AI — portfolio-wide; the feature flag selects the live route or local demo answer. */}
          <QcCard className="mt-4 overflow-hidden border-[#FFD9CD] bg-[var(--coral-surface)] p-0 shadow-[0_8px_18px_rgba(255,122,89,0.08)]">
            <button
              type="button"
              onClick={() => setAskOpen((open) => !open)}
              aria-expanded={askOpen}
              className="quest-coral-tap flex w-full items-center gap-3 px-4 py-3 text-left"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[linear-gradient(145deg,#FF7458,#FF5C43)] text-white shadow-[0_7px_14px_rgba(255,100,75,0.22)]">
                <Sparkles className="h-4 w-4" strokeWidth={2.1} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold tracking-[-0.02em] text-[var(--coral-text)]">Ask AI</span>
                <span className="mt-0.5 block text-xs text-[var(--coral-text-muted)]">What do I need to know today?</span>
              </span>
              <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--coral-soft)] text-[var(--coral-strong)] transition-transform", askOpen && "rotate-90")}>
                <ChevronRight className="h-4 w-4" strokeWidth={2.3} />
              </span>
            </button>

            {askOpen && (
              <div className="quest-coral-step-enter border-t border-[#FFD9CD] px-4 pb-4 pt-3">
                <div className="flex items-center gap-2 rounded-2xl border border-[var(--coral-border)] bg-[#FCFCFD] px-3 py-2 focus-within:border-[var(--coral)] focus-within:shadow-[0_0_0_3px_rgba(255,122,89,0.12)]">
                  <input
                    value={askQuestion}
                    onChange={(event) => setAskQuestion(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault()
                        askSubmit()
                      }
                    }}
                    placeholder="Ask about progress, risks, or priorities"
                    className="h-9 min-w-0 flex-1 bg-transparent text-sm text-[var(--coral-text)] outline-none placeholder:text-[#94A3B8]"
                  />
                  <button
                    type="button"
                    onClick={askSubmit}
                    disabled={!askQuestion.trim() || asking}
                    className="quest-coral-tap flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--coral)] text-white shadow-[0_4px_10px_rgba(255,122,89,0.22)] disabled:opacity-40"
                    aria-label="Ask"
                  >
                    <ArrowUp className="h-4 w-4" strokeWidth={2.2} />
                  </button>
                </div>
                {askGenerating && <QuestCoralAskGenerating question={askQuestion} />}
                {!askGenerating && askAnswer && (
                  <p className="quest-coral-reading-copy mt-3 text-[0.8125rem]">{askAnswer}</p>
                )}
                {!askGenerating && askError && (
                  <p className="mt-2 text-[0.75rem] font-medium text-[var(--coral-missing)]">{askError}</p>
                )}
              </div>
            )}
          </QcCard>

          <div className="mt-3.5 flex gap-2">
            <StatTile value={counts.active} label="Active" tone="info" />
            <StatTile value={counts.atRisk} label="At risk" tone="pending" />
            <StatTile value={counts.completed} label="Completed" tone="complete" />
            <StatTile value={counts.openBlockers} label="Blockers" tone="missing" />
          </div>

          <div className="mt-3.5 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setStatusSheetOpen(true)}
              className={cn(
                "quest-coral-tap flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[0.8125rem] font-semibold",
                filters.status !== "all"
                  ? "border-[#FFD2C2] bg-[var(--coral-soft)] text-[var(--coral-strong)]"
                  : "border-[var(--coral-border)] bg-[var(--coral-surface)] text-[var(--coral-text-muted)]",
              )}
            >
              {statusLabel}
              <ChevronDown className="h-3.5 w-3.5" strokeWidth={2.5} />
            </button>
            {filters.status !== "all" && (
              <button
                type="button"
                onClick={() => setFilters({ ...filters, status: "all" })}
                className="quest-coral-tap flex h-7 items-center gap-1 rounded-full px-1 text-xs font-semibold text-[var(--coral-strong)]"
              >
                <X className="h-3.5 w-3.5" strokeWidth={2.5} />
                Clear
              </button>
            )}
          </div>

          <div className="mt-4 flex flex-col gap-2.5">
            {visibleProjects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                unreadCount={unreadCountFor(project.id)}
                onOpen={onOpenProject}
                onMore={openProjectMenu}
              />
            ))}
          </div>

          {visibleProjects.length === 0 && (
            <QcCard className="mt-4 flex flex-col items-center px-6 py-10 text-center" flat>
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--coral-surface-2)]">
                <Search className="h-5 w-5 text-[var(--coral-text-muted)]" strokeWidth={2} />
              </span>
              <p className="mt-3 text-sm font-semibold text-[var(--coral-text)]">No projects match</p>
              <p className="mt-1 text-[0.8125rem] text-[var(--coral-text-muted)]">
                {hasActiveProjectFilters ? "Try clearing a filter or searching another name." : "Create the first project to start tracking work."}
              </p>
              <QcButton
                size="sm"
                variant={hasActiveProjectFilters ? "secondary" : "primary"}
                className="mt-4"
                icon={hasActiveProjectFilters ? <X className="h-3.5 w-3.5" strokeWidth={2.3} /> : <Plus className="h-3.5 w-3.5" strokeWidth={2.3} />}
                onClick={() => {
                  if (hasActiveProjectFilters) setFilters(emptyQuestCoralFilters())
                  else setCreateOpen(true)
                }}
              >
                {hasActiveProjectFilters ? "Clear filters" : "Create project"}
              </QcButton>
            </QcCard>
          )}
        </div>
      </div>

      <QcSheet
        open={statusSheetOpen}
        title="Status"
        description="Filter projects by where they stand."
        onClose={() => setStatusSheetOpen(false)}
      >
        <ul className="flex flex-col">
          {(["all", ...PROJECT_STATUS_ORDER] as Array<ProjectStatus | "all">).map((status) => {
            const label = status === "all" ? "All statuses" : PROJECT_STATUS_META[status].label
            const tone = status === "all" ? null : PROJECT_STATUS_META[status].tone
            return (
              <li key={status}>
                <button
                  type="button"
                  onClick={() => {
                    setFilters({ ...filters, status })
                    setStatusSheetOpen(false)
                  }}
                  className={cn(
                    "quest-coral-tap flex min-h-[3.25rem] w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left",
                    filters.status === status ? "bg-[var(--coral-soft)]" : "hover:bg-[var(--coral-surface-2)]",
                  )}
                >
                  <span className="min-w-0 flex-1 text-sm font-semibold text-[var(--coral-text)]">{label}</span>
                  {tone && <span className={cn("h-2 w-2 shrink-0 rounded-full", TONE_STYLES[tone].solid)} aria-hidden="true" />}
                </button>
              </li>
            )
          })}
        </ul>
      </QcSheet>

      <QcSheet
        open={menuProject !== null}
        title="Project actions"
        description={menuProject?.name}
        onClose={() => {
          setProjectMenuId(null)
          setProjectActionError(null)
        }}
      >
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={() => {
              if (!menuProject) return
              const projectId = menuProject.id
              setProjectMenuId(null)
              setDetailsProjectId(projectId)
            }}
            className="quest-coral-tap flex min-h-12 items-center gap-3 rounded-xl px-3 text-left hover:bg-[var(--coral-surface-2)]"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--coral-soft)] text-[var(--coral-strong)]">
              <Pencil className="h-4 w-4" strokeWidth={2} />
            </span>
            <span className="min-w-0 flex-1 text-sm font-semibold text-[var(--coral-text)]">Edit name &amp; description</span>
          </button>
          <button
            type="button"
            onClick={() => {
              if (!menuProject) return
              const projectId = menuProject.id
              setProjectMenuId(null)
              onOpenProject(projectId)
            }}
            className="quest-coral-tap flex min-h-12 items-center gap-3 rounded-xl px-3 text-left hover:bg-[var(--coral-surface-2)]"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--coral-surface-2)] text-[var(--coral-text-muted)]">
              <ChevronRight className="h-4 w-4" strokeWidth={2} />
            </span>
            <span className="min-w-0 flex-1 text-sm font-semibold text-[var(--coral-text)]">Open project</span>
          </button>
          <button
            type="button"
            onClick={() => void handleShareProject()}
            className="quest-coral-tap flex min-h-12 items-center gap-3 rounded-xl px-3 text-left hover:bg-[var(--coral-surface-2)]"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--coral-soft)] text-[var(--coral-strong)]">
              <Share2 className="h-4 w-4" strokeWidth={2} />
            </span>
            <span className="min-w-0 flex-1 text-sm font-semibold text-[var(--coral-text)]">
              Share project
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              if (!menuProject) return
              setProjectMenuId(null)
              setDeleteProjectId(menuProject.id)
            }}
            className="quest-coral-tap flex min-h-12 items-center gap-3 rounded-xl px-3 text-left hover:bg-[var(--coral-missing-soft)]"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--coral-missing-soft)] text-[var(--coral-missing)]">
              <Trash2 className="h-4 w-4" strokeWidth={2} />
            </span>
            <span className="min-w-0 flex-1 text-sm font-semibold text-[var(--coral-missing)]">Delete project</span>
          </button>
          {projectActionError && <p className="px-3 pt-2 text-[0.75rem] font-medium text-[var(--coral-missing)]">{projectActionError}</p>}
        </div>
      </QcSheet>

      {detailsProject && (
        <EditProjectDetailsSheet
          open
          project={detailsProject}
          onClose={() => setDetailsProjectId(null)}
          onSave={(patch) => patchProject(detailsProject.id, patch)}
        />
      )}

      <QcSheet
        open={deleteProjectId !== null}
        title="Delete project?"
        description="This removes the project from Quest Coral. This action cannot be undone."
        onClose={() => {
          setDeleteProjectId(null)
          setProjectActionError(null)
        }}
        footer={
          <div className="grid grid-cols-2 gap-3">
            <QcButton variant="secondary" size="md" disabled={isProjectActionPending} onClick={() => setDeleteProjectId(null)}>
              Cancel
            </QcButton>
            <QcButton variant="danger" size="md" disabled={isProjectActionPending} onClick={() => void handleDeleteProject()}>
              {isProjectActionPending ? "Deleting…" : "Delete"}
            </QcButton>
          </div>
        }
      >
        <p className="text-[0.8125rem] leading-relaxed text-[var(--coral-text-muted)]">Updates are retained for audit history, but this project will no longer appear in the dashboard.</p>
        {projectActionError && <p className="mt-3 text-[0.75rem] font-medium text-[var(--coral-missing)]">{projectActionError}</p>}
      </QcSheet>

      <CreateProjectSheet
        open={createOpen}
        currentUserId={currentUserId}
        contacts={contacts}
        importedContacts={importedContacts}
        onClose={() => setCreateOpen(false)}
        onCreate={async (input) => {
          const project = await createProject(input)
          setCreateOpen(false)
          onOpenProject(project.id)
        }}
      />

      <button
        type="button"
        onClick={() => setCreateOpen(true)}
        className="quest-coral-primary-button quest-coral-tap absolute bottom-[calc(var(--sab)+2rem)] right-4 z-10 flex h-12 items-center gap-1.5 rounded-full px-4 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(255,122,89,0.30)]"
      >
        <Plus className="h-4.5 w-4.5" strokeWidth={2.4} />
        New project
      </button>
    </div>
  )
}
