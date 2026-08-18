"use client"

/** Quest Coral — the project decision surface. */

import { memo, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react"
import { useGeneratingReveal } from "@/hooks/use-generating-reveal"
import {
  ArrowLeft,
  ArrowUp,
  CalendarDays,
  Check,
  ChevronRight,
  Filter,
  Flag,
  MessageCircle,
  MoreHorizontal,
  NotebookText,
  Pencil,
  Plus,
  RefreshCw,
  Share2,
  ShieldAlert,
  Sparkles,
  Target,
  TriangleAlert,
  UploadCloud,
} from "lucide-react"
import { cn } from "@/lib/utils"
import {
  AiBriefCard,
  Avatar,
  MissionFitDots,
  ProgressRing,
  QcButton,
  QcCard,
  StatusPill,
} from "@/components/quest-coral/ui/quest-coral-primitives"
import { AddUpdateSheet } from "@/components/quest-coral/add-update-sheet"
import { EditProjectContextSheet } from "@/components/quest-coral/edit-project-context-sheet"
import { EditProjectDetailsSheet } from "@/components/quest-coral/edit-project-details-sheet"
import { MarkdownView } from "@/components/quest-coral/ui/markdown-view"
import { projectAccent } from "@/components/quest-coral/ui/project-accent"
import { QcSheet } from "@/components/quest-coral/ui/quest-coral-sheet"
import { PeopleSearchPicker } from "@/components/quest-coral/ui/people-search-picker"
import { QuestCoralAskGenerating, QuestCoralBriefGenerating } from "@/components/quest-coral/ui/quest-coral-ask-generating"
import { useQuestCoralAsk } from "@/features/quest-coral/use-quest-coral-ask"
import { useQuestCoralBrief } from "@/features/quest-coral/use-quest-coral-brief"
import { useQuestCoralContext, type SaveProjectContextInput } from "@/features/quest-coral/use-quest-coral-context"
import { QUEST_CORAL_AI_ENABLED } from "@/lib/quest-coral-flags"
import {
  contextSourceLabel,
  effectiveProjectStatus,
  PROJECT_STATUS_META,
  summarizeMarkdown,
  UPDATE_TYPE_META,
  type CoverageResult,
  type FeedbackReply,
  type Project,
  type ProjectPerson,
  type ProjectTimeline,
  type ProjectUpdate,
  type UpdateType,
} from "@/lib/quest-coral-core"
import type { NewUpdateInput } from "@/features/quest-coral/use-quest-coral-dashboard"
import type { Contact, ImportedContact } from "@/lib/store"

interface ProjectDetailScreenProps {
  project: Project
  updates: ProjectUpdate[]
  feedbackReplies: FeedbackReply[]
  activityLoaded: boolean
  coverage: CoverageResult
  contacts: Contact[]
  importedContacts: ImportedContact[]
  currentUserName: string
  onBack: () => void
  onAddUpdate: (input: NewUpdateInput) => void | Promise<unknown>
  onPatchProject: (patch: Partial<Project>) => void | Promise<unknown>
  onDeleteProject: () => void | Promise<unknown>
  onMarkProjectRead: () => void | Promise<unknown>
  className?: string
}

type ActivityFilter = "all" | UpdateType
type DetailView = "overview" | "activity" | "context"
type TimelinePhase = keyof ProjectTimeline

const EMPTY_TIMELINE: ProjectTimeline = {
  past: { range: "Past", items: [] },
  present: { range: "Now", items: [] },
  future: { range: "Upcoming", items: [] },
}

const ACTIVITY_FILTERS: Array<{ id: ActivityFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "update", label: "Updates" },
  { id: "feedback", label: "Feedback" },
  { id: "blocker", label: "Blockers" },
  { id: "red_team_review", label: "Red Team" },
]

const ACTIVITY_VISUALS: Record<
  UpdateType,
  { chip: string; badge: string; Icon: typeof ArrowUp }
> = {
  update: {
    chip: "bg-[var(--coral-soft)] text-[var(--coral-strong)]",
    badge: "border-[#FFD2C2] bg-white text-[var(--coral-strong)]",
    Icon: ArrowUp,
  },
  feedback: {
    chip: "bg-[#F4F6F8] text-[#64748B]",
    badge: "border-[#DCE4EC] bg-white text-[#64748B]",
    Icon: MessageCircle,
  },
  blocker: {
    chip: "bg-[var(--coral-missing-soft)] text-[var(--coral-missing)]",
    badge: "border-[#FBD0D0] bg-white text-[#C94D4D]",
    Icon: TriangleAlert,
  },
  red_team_review: {
    chip: "bg-[#F1F4F7] text-[#334155]",
    badge: "border-[#D8E0E8] bg-white text-[#334155]",
    Icon: ShieldAlert,
  },
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

function formatActivityDate(iso: string): string {
  const date = new Date(iso)
  const day = date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
  return `${day} · ${time}`
}

function initialsFromName(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()
}

const ActivityBadge = memo(function ActivityBadge({ type }: { type: UpdateType }) {
  const visual = ACTIVITY_VISUALS[type]
  return (
    <span className={cn("inline-flex shrink-0 rounded-full border px-2 py-0.5 text-[0.625rem] font-semibold leading-none", visual.badge)}>
      {UPDATE_TYPE_META[type].label}
    </span>
  )
})

const FeedbackReplyRows = memo(function FeedbackReplyRows({ replies }: { replies: FeedbackReply[] }) {
  if (replies.length === 0) return null
  return (
    <div className="ml-9 mt-3 border-l border-[var(--coral-border)] pl-3">
      <p className="text-[0.625rem] font-semibold uppercase tracking-[0.08em] text-[var(--coral-text-muted)]">
        {replies.length === 1 ? "1 reply" : `${replies.length} replies`}
      </p>
      <div className="mt-2 space-y-3">
        {replies.map((reply) => (
          <div key={reply.id} className="min-w-0">
            <div className="flex items-center gap-2">
              <Avatar initials={initialsFromName(reply.authorName)} className="h-6 w-6 text-[0.5rem]" />
              <span className="min-w-0 flex-1 truncate text-[0.6875rem] font-semibold text-[var(--coral-text)]">{reply.authorName}</span>
              <span className="shrink-0 text-[0.5625rem] text-[var(--coral-text-muted)]">{formatActivityDate(reply.createdAt)}</span>
            </div>
            {reply.body ? <p className="mt-1 whitespace-pre-line text-[0.75rem] leading-relaxed text-[var(--coral-text-muted)]">{reply.body}</p> : null}
            {reply.imageUrl && (
              <a href={reply.imageUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex text-[0.6875rem] font-semibold text-[var(--coral-strong)]">
                {reply.imageName || "View image"}
              </a>
            )}
            {reply.fileUrl && (
              <a href={reply.fileUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex text-[0.6875rem] font-semibold text-[var(--coral-strong)]">
                {reply.fileName || "View attachment"}
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  )
})

const ActivityMediaLinks = memo(function ActivityMediaLinks({ update }: { update: ProjectUpdate }) {
  if (!update.imageUrl && !update.fileUrl) return null
  return (
    <div className="ml-9 mt-2 flex flex-wrap gap-x-3 gap-y-1">
      {update.imageUrl && (
        <a href={update.imageUrl} target="_blank" rel="noreferrer" className="inline-flex text-[0.6875rem] font-semibold text-[var(--coral-strong)]">
          {update.imageName || "View image"}
        </a>
      )}
      {update.fileUrl && (
        <a href={update.fileUrl} target="_blank" rel="noreferrer" className="inline-flex text-[0.6875rem] font-semibold text-[var(--coral-strong)]">
          {update.fileName || "View attachment"}
        </a>
      )}
    </div>
  )
})

const ActivityRow = memo(function ActivityRow({ update, previousProgress, feedbackReplies }: { update: ProjectUpdate; previousProgress?: number; feedbackReplies: FeedbackReply[] }) {
  const visual = ACTIVITY_VISUALS[update.type]
  const Icon = visual.Icon
  const progressChanged = update.type === "update" && update.progress !== undefined && previousProgress !== undefined && update.progress !== previousProgress

  return (
    <article className="flex gap-2.5 px-4 py-3.5 first:pt-1">
      <span className={cn("mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", visual.chip)} aria-hidden="true">
        <Icon className="h-4.5 w-4.5" strokeWidth={2} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Avatar initials={initialsFromName(update.authorName)} className="h-7 w-7 text-[0.5625rem]" />
          <span className="min-w-0 flex-1 truncate text-[0.8125rem] font-semibold text-[var(--coral-text)]">{update.authorName}</span>
          <span className="shrink-0 text-[0.625rem] text-[var(--coral-text-muted)]">{formatActivityDate(update.createdAt)}</span>
        </div>
        <div className="ml-9 mt-1.5 flex flex-wrap items-center gap-1.5">
          <ActivityBadge type={update.type} />
          {update.type === "blocker" && <span className="text-[0.625rem] font-medium text-[var(--coral-missing)]">Active</span>}
        </div>
        <p className="ml-9 mt-1.5 whitespace-pre-line text-[0.75rem] leading-relaxed text-[var(--coral-text-muted)]">{update.body}</p>
        <ActivityMediaLinks update={update} />
        {progressChanged && (
          <p className="ml-9 mt-2 flex items-center gap-2 text-[0.6875rem] font-medium text-[var(--coral-text-muted)]">
            <span>Progress</span>
            <span>{previousProgress}%</span>
            <ArrowUp className="h-3.5 w-3.5 text-[var(--coral-text-muted)]" strokeWidth={2} />
            <strong className="font-semibold text-[var(--coral-strong)]">{update.progress}%</strong>
          </p>
        )}
        {update.type === "feedback" && <FeedbackReplyRows replies={feedbackReplies} />}
      </div>
    </article>
  )
})

const ActivityFilterTabs = memo(function ActivityFilterTabs({ value, onChange }: { value: ActivityFilter; onChange: (value: ActivityFilter) => void }) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide" role="tablist" aria-label="Filter project activity">
      {ACTIVITY_FILTERS.map((filter) => {
        const active = value === filter.id
        return (
          <button
            key={filter.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(filter.id)}
            className={cn(
              "quest-coral-tap shrink-0 rounded-full border px-3 py-1.5 text-[0.6875rem] font-semibold transition-colors",
              active ? "border-[var(--coral-text)] bg-[var(--coral-text)] text-white" : "border-[var(--coral-border)] bg-white text-[var(--coral-text-muted)]",
            )}
          >
            {filter.label}
          </button>
        )
      })}
    </div>
  )
})

/** Mirrors ActivityRow's shape (icon chip + avatar/name/date row + two text lines) so activity doesn't jump when real rows swap in. */
function ActivityRowSkeleton() {
  return (
    <article className="flex gap-2.5 px-4 py-3.5 first:pt-1" aria-hidden="true">
      <span className="mt-0.5 h-9 w-9 shrink-0 animate-pulse rounded-xl bg-[var(--coral-surface-2)]" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 shrink-0 animate-pulse rounded-full bg-[var(--coral-surface-2)]" />
          <div className="h-3 w-28 animate-pulse rounded bg-[var(--coral-surface-2)]" />
        </div>
        <div className="ml-9 mt-2 h-3 w-full animate-pulse rounded bg-[var(--coral-surface-2)]" />
        <div className="ml-9 mt-1.5 h-3 w-3/4 animate-pulse rounded bg-[var(--coral-surface-2)]" />
      </div>
    </article>
  )
}

const ActivityEntries = memo(function ActivityEntries({
  loaded,
  updates,
  feedbackReplies,
  emptyLabel,
  actionLabel,
  onAction,
  secondaryAction,
}: {
  loaded: boolean
  updates: ProjectUpdate[]
  feedbackReplies: FeedbackReply[]
  emptyLabel: string
  actionLabel: string
  onAction: () => void
  secondaryAction?: { label: string; onClick: () => void }
}) {
  if (!loaded) {
    return (
      <>
        <ActivityRowSkeleton />
        <ActivityRowSkeleton />
        <ActivityRowSkeleton />
      </>
    )
  }

  if (updates.length === 0) {
    return (
      <div className="flex flex-col items-center px-4 py-8 text-center">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--coral-surface-2)] text-[var(--coral-text-muted)]">
          <MessageCircle className="h-4.5 w-4.5" strokeWidth={1.9} />
        </span>
        <p className="mt-3 text-sm font-semibold text-[var(--coral-text)]">{emptyLabel}</p>
        <p className="mt-1 text-xs text-[var(--coral-text-muted)]">Use Add to capture the next project signal.</p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <QcButton size="sm" onClick={onAction} icon={<Plus className="h-3.5 w-3.5" strokeWidth={2.3} />}>
            {actionLabel}
          </QcButton>
          {secondaryAction && (
            <QcButton size="sm" variant="secondary" onClick={secondaryAction.onClick}>
              {secondaryAction.label}
            </QcButton>
          )}
        </div>
      </div>
    )
  }

  // One backward pass instead of re-scanning the tail of the (newest-first)
  // list for every row — same result, O(n) instead of O(n²) as activity grows.
  const previousProgressByIndex: Array<number | undefined> = new Array(updates.length)
  const repliesByFeedbackId = new Map<string, FeedbackReply[]>()
  for (const reply of feedbackReplies) {
    const bucket = repliesByFeedbackId.get(reply.feedbackId)
    if (bucket) bucket.push(reply)
    else repliesByFeedbackId.set(reply.feedbackId, [reply])
  }
  for (const replies of repliesByFeedbackId.values()) {
    replies.sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  }
  let trailingProgress: number | undefined
  for (let index = updates.length - 1; index >= 0; index -= 1) {
    previousProgressByIndex[index] = trailingProgress
    const update = updates[index]!
    if (update.type === "update" && update.progress !== undefined) trailingProgress = update.progress
  }

  return (
    <>
      {updates.map((update, index) => (
        <ActivityRow key={update.id} update={update} previousProgress={previousProgressByIndex[index]} feedbackReplies={repliesByFeedbackId.get(update.id) ?? []} />
      ))}
    </>
  )
})

const AlertsCard = memo(function AlertsCard({
  blockerCount,
  redTeamCount,
  onShowActivity,
}: {
  blockerCount: number
  redTeamCount: number
  onShowActivity: (filter: ActivityFilter) => void
}) {
  if (blockerCount === 0 && redTeamCount === 0) return null

  return (
    <QcCard className="p-3.5">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--coral-missing-soft)] text-[var(--coral-missing)]">
          <TriangleAlert className="h-4 w-4" strokeWidth={2} />
        </span>
        <div>
          <h2 className="text-[0.875rem] font-semibold text-[var(--coral-text)]">Needs attention</h2>
          <p className="text-[0.6875rem] text-[var(--coral-text-muted)]">Signals that need a project decision.</p>
        </div>
      </div>
      <div className="mt-3 divide-y divide-[var(--coral-border)] border-t border-[var(--coral-border)]">
        {blockerCount > 0 && (
          <button type="button" onClick={() => onShowActivity("blocker")} className="quest-coral-tap flex w-full items-center justify-between gap-3 py-2.5 text-left text-[0.75rem]">
            <span className="text-[var(--coral-text)]">{blockerCount} active {blockerCount === 1 ? "blocker" : "blockers"}</span>
            <ChevronRight className="h-4 w-4 shrink-0 text-[var(--coral-missing)]" strokeWidth={2} />
          </button>
        )}
        {redTeamCount > 0 && (
          <button type="button" onClick={() => onShowActivity("red_team_review")} className="quest-coral-tap flex w-full items-center justify-between gap-3 py-2.5 text-left text-[0.75rem]">
            <span className="text-[var(--coral-text)]">{redTeamCount} Red Team {redTeamCount === 1 ? "concern" : "concerns"}</span>
            <ChevronRight className="h-4 w-4 shrink-0 text-[#475569]" strokeWidth={2} />
          </button>
        )}
      </div>
    </QcCard>
  )
})

const EventCoverageCard = memo(function EventCoverageCard({ coverage, timeline, onOpenTimeline }: { coverage: CoverageResult; timeline: ProjectTimeline | null; onOpenTimeline: () => void }) {
  const events = timeline
    ? [
        { label: timeline.past.items[0] ?? "Project started", detail: timeline.past.range, state: "done" },
        { label: timeline.past.items[1] ?? "Scope aligned", detail: timeline.past.range, state: "done" },
        { label: timeline.present.items[0] ?? "Current phase", detail: "Today", state: "current" },
        { label: timeline.future.items[0] ?? "Next milestone", detail: timeline.future.range, state: "future" },
      ]
    : [
        { label: "Project started", detail: "Past", state: "done" },
        { label: "Team aligned", detail: "Past", state: "done" },
        { label: "Current work", detail: "Today", state: "current" },
        { label: "Next milestone", detail: "Upcoming", state: "future" },
      ]

  return (
    <QcCard className="p-3.5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-[0.875rem] font-semibold text-[var(--coral-text)]">Event coverage</h2>
          <p className="mt-0.5 text-[0.6875rem] text-[var(--coral-text-muted)]">{coverage.degrees}° of project context tracked</p>
        </div>
        <button type="button" onClick={onOpenTimeline} className="quest-coral-tap inline-flex items-center gap-1 text-[0.75rem] font-semibold text-[var(--coral-strong)]">
          View timeline
          <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.2} />
        </button>
      </div>
      <div className="relative mt-4">
        <span className="absolute left-[12.5%] right-[12.5%] top-1.5 h-px bg-[var(--coral-border)]" aria-hidden="true" />
        <div className="relative grid grid-cols-4 gap-1">
          {events.map((event, index) => {
            const isDone = event.state === "done"
            const isCurrent = event.state === "current"
            return (
              <div key={`${event.label}-${index}`} className="min-w-0 text-center">
                <span
                  className={cn(
                    "mx-auto flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 bg-[var(--coral-surface)]",
                    isDone && "border-[#718096] bg-[#718096] text-white",
                    isCurrent && "h-[1.125rem] w-[1.125rem] border-[var(--coral)] bg-white ring-2 ring-[var(--coral-soft)]",
                    !isDone && !isCurrent && "border-[#CBD5E1]",
                  )}
                >
                  {isDone && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
                </span>
                <p className="mt-2 line-clamp-2 text-[0.625rem] font-medium leading-snug text-[var(--coral-text)]">{event.label}</p>
                <p className="mt-0.5 text-[0.5625rem] text-[var(--coral-text-muted)]">{event.detail}</p>
              </div>
            )
          })}
        </div>
      </div>
    </QcCard>
  )
})

export function ProjectDetailScreen({ project, updates, feedbackReplies, activityLoaded, coverage, contacts, importedContacts, currentUserName, onBack, onAddUpdate, onPatchProject, onDeleteProject, onMarkProjectRead, className }: ProjectDetailScreenProps) {
  const [addOpen, setAddOpen] = useState(false)
  const [activeView, setActiveView] = useState<DetailView>("overview")
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>("all")
  const [contextEditorOpen, setContextEditorOpen] = useState(false)
  const [contextEditorMode, setContextEditorMode] = useState<"write" | "upload">("write")
  const [detailsEditorOpen, setDetailsEditorOpen] = useState(false)
  const [askOpen, setAskOpen] = useState(false)
  const [peopleOpen, setPeopleOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [addPersonOpen, setAddPersonOpen] = useState(false)
  const [pendingPeople, setPendingPeople] = useState<ProjectPerson[]>([])
  const [personError, setPersonError] = useState<string | null>(null)
  const [isAddingPerson, setIsAddingPerson] = useState(false)
  const [isCompletingStep, setIsCompletingStep] = useState(false)
  const [stepError, setStepError] = useState<string | null>(null)
  const [timelineOpen, setTimelineOpen] = useState(false)
  const [timelinePhase, setTimelinePhase] = useState<TimelinePhase>("present")
  const [timelineItem, setTimelineItem] = useState("")
  const [timelineError, setTimelineError] = useState<string | null>(null)
  const [isAddingTimelineItem, setIsAddingTimelineItem] = useState(false)
  const [shareMessage, setShareMessage] = useState<string | null>(null)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [isDeletingProject, setIsDeletingProject] = useState(false)
  const [deleteProjectError, setDeleteProjectError] = useState<string | null>(null)
  const readMarkedProjectRef = useRef<string | null>(null)
  const { context, saveContext } = useQuestCoralContext(project.id, currentUserName)
  const ask = useQuestCoralAsk(project, updates, context?.markdown, feedbackReplies)
  const brief = useQuestCoralBrief(project, updates, context?.markdown, feedbackReplies)
  // Holds the generating skeleton visible for a minimum beat per question, so
  // it reads as an intentional micro-moment even when mock mode (or a warm
  // cache) resolves near-instantly — same pattern as Directory's Ask AI.
  const askGenerating = useGeneratingReveal(ask.attempt, ask.phase === "asking", 500)

  // Opening the detail, after its activity feed is available, is the only
  // interaction that clears this user's marker. Returning to the dashboard
  // never calls this path.
  useEffect(() => {
    if (!activityLoaded || readMarkedProjectRef.current === project.id) return
    readMarkedProjectRef.current = project.id
    void Promise.resolve(onMarkProjectRead()).catch(() => {
      // Keep project activity usable if an unread-state write is temporarily
      // unavailable; the next detail entry will safely retry the marker.
      readMarkedProjectRef.current = null
    })
  }, [activityLoaded, onMarkProjectRead, project.id])
  const meta = PROJECT_STATUS_META[effectiveProjectStatus(project)]
  const sortedUpdates = useMemo(
    () => [...updates].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [updates],
  )
  const visibleUpdates = useMemo(
    () => (activityFilter === "all" ? sortedUpdates : sortedUpdates.filter((update) => update.type === activityFilter)),
    [sortedUpdates, activityFilter],
  )
  const latestUpdates = useMemo(() => visibleUpdates.slice(0, 3), [visibleUpdates])
  // A completed project has nothing left needing a decision — blockers and
  // Red Team concerns stay in the activity history, but stop showing as
  // "needs attention" alerts once the project itself is done.
  const isProjectComplete = effectiveProjectStatus(project) === "completed"
  const blockerCount = useMemo(
    () => (isProjectComplete ? 0 : sortedUpdates.filter((update) => update.isBlocker).length),
    [sortedUpdates, isProjectComplete],
  )
  const redTeamCount = useMemo(
    () => (isProjectComplete ? 0 : sortedUpdates.filter((update) => update.type === "red_team_review").length),
    [sortedUpdates, isProjectComplete],
  )
  const accent = useMemo(() => projectAccent(project), [project])
  const editableTimeline = project.timeline ?? EMPTY_TIMELINE

  // Stable references so AlertsCard/EventCoverageCard/ActivityEntries (all
  // React.memo'd) can actually skip re-rendering when unrelated state
  // changes elsewhere on the screen (typing in Ask AI, the timeline form,
  // etc.) — an inline arrow here would give them a new prop identity, and
  // therefore a full re-render, on every keystroke.
  const openActivity = useCallback((filter: ActivityFilter = "all") => {
    setActivityFilter(filter)
    setActiveView("activity")
  }, [])
  const openTimeline = useCallback(() => setTimelineOpen(true), [])
  const handleActivityAction = useCallback(() => {
    if (activityFilter === "all") setAddOpen(true)
    else setActivityFilter("all")
  }, [activityFilter])
  const activitySecondaryAction = useMemo(
    () => (activityFilter !== "all" ? { label: "Add update", onClick: () => setAddOpen(true) } : undefined),
    [activityFilter],
  )

  const openContextEditor = (mode: "write" | "upload") => {
    setContextEditorMode(mode)
    setContextEditorOpen(true)
  }

  const handleSaveContext = async (input: SaveProjectContextInput) => {
    await saveContext(input)
    setContextEditorOpen(false)
  }

  const activityEmptyLabel = activityFilter === "all"
    ? "No activity yet"
    : `No ${ACTIVITY_FILTERS.find((filter) => filter.id === activityFilter)?.label.toLowerCase()} yet`

  const handleShare = async () => {
    const text = `${project.name} — ${meta.label}, ${project.progress}% complete. ${project.nextStep ? `Next step: ${project.nextStep}.` : ""}`.trim()
    try {
      if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
        await navigator.share({ title: project.name, text })
        return
      }
      await navigator.clipboard?.writeText(text)
      setShareMessage("Project summary copied")
    } catch {
      // A dismissed native share sheet should leave the detail view unchanged.
    }
  }

  const handleDeleteProject = async () => {
    if (isDeletingProject) return
    setIsDeletingProject(true)
    setDeleteProjectError(null)
    try {
      await onDeleteProject()
      onBack()
    } catch {
      setDeleteProjectError("This project could not be deleted. Please try again.")
    } finally {
      setIsDeletingProject(false)
    }
  }

  const handleAddPeople = async () => {
    const peopleToAdd = pendingPeople.filter((person) => !project.people.some((existing) => existing.id === person.id))
    if (peopleToAdd.length === 0) {
      setPersonError("Select at least one new person to add.")
      return
    }
    setIsAddingPerson(true)
    setPersonError(null)
    try {
      await onPatchProject({ people: [...project.people, ...peopleToAdd] })
      setPendingPeople([])
      setAddPersonOpen(false)
    } catch {
      setPersonError("The selected people could not be added. Please try again.")
    } finally {
      setIsAddingPerson(false)
    }
  }

  const handleCompleteNextStep = async () => {
    if (!project.nextStep || isCompletingStep) return
    setIsCompletingStep(true)
    setStepError(null)
    try {
      await onAddUpdate({
        type: "update",
        body: `Completed next step: ${project.nextStep}`,
        status: project.status,
        progress: project.progress,
        isBlocker: false,
      })
      await onPatchProject({ nextStep: null, nextStepDue: null })
    } catch {
      setStepError("The step could not be marked complete. Please try again.")
    } finally {
      setIsCompletingStep(false)
    }
  }

  const handleAddTimelineItem = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const item = timelineItem.trim()
    if (!item) {
      setTimelineError("Describe the milestone before adding it.")
      return
    }
    setIsAddingTimelineItem(true)
    setTimelineError(null)
    try {
      const phase = editableTimeline[timelinePhase]
      await onPatchProject({
        timeline: {
          ...editableTimeline,
          [timelinePhase]: {
            ...phase,
            items: [...phase.items, item],
          },
        },
      })
      setTimelineItem("")
    } catch {
      setTimelineError("The milestone could not be added. Please try again.")
    } finally {
      setIsAddingTimelineItem(false)
    }
  }

  return (
    <div className={cn("quest-coral-scope quest-coral-canvas relative flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden", className)}>
      <header className="quest-coral-topbar app-topbar flex shrink-0 items-center gap-3 border-b px-4 animate-slide-down">
        <button
          type="button"
          onClick={activeView !== "overview" ? () => setActiveView("overview") : onBack}
          className="quest-coral-tap flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-[var(--coral-border)] bg-[var(--coral-surface)] text-[var(--coral-text)]"
          aria-label={activeView !== "overview" ? "Back to project overview" : "Back to projects"}
        >
          <ArrowLeft className="h-5 w-5" strokeWidth={1.8} />
        </button>
        <h1 className="min-w-0 flex-1 truncate text-center text-[1rem] font-semibold tracking-[-0.025em] text-[var(--coral-text)]">
          {activeView === "activity" ? "Activity & Feedback" : activeView === "context" ? "Project context" : project.name}
        </h1>
        {activeView === "activity" ? (
          <span className="flex h-10 min-w-10 items-center justify-center rounded-2xl border border-[var(--coral-border)] bg-[var(--coral-surface)] px-2 text-[0.6875rem] font-semibold text-[var(--coral-text-muted)]" aria-label={`${sortedUpdates.length} activity entries`}>
            {sortedUpdates.length}
          </span>
        ) : activeView === "context" ? (
          <button
            type="button"
            onClick={() => openContextEditor("write")}
            className="quest-coral-tap flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-[var(--coral-border)] bg-[var(--coral-surface)] text-[var(--coral-text-muted)]"
            aria-label="Edit project context"
          >
            <Pencil className="h-4.5 w-4.5" strokeWidth={2} />
          </button>
        ) : (
          <button type="button" onClick={() => setMenuOpen(true)} className="quest-coral-tap flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-[var(--coral-border)] bg-[var(--coral-surface)] text-[var(--coral-text-muted)]" aria-label="Project options">
            <MoreHorizontal className="h-5 w-5" strokeWidth={2} />
          </button>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-hide">
        {activeView === "activity" ? (
          <div className="mx-auto flex w-full max-w-[38rem] flex-col gap-3.5 px-4 pb-24 pt-4 sm:px-5">
            <div>
              <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-[var(--coral-text-muted)]">{project.name}</p>
              <p className="mt-1 text-[0.8125rem] text-[var(--coral-text-muted)]">All project updates, feedback and risks — newest first.</p>
            </div>
            <QcCard className="overflow-hidden py-3.5">
              <div className="px-4">
                <ActivityFilterTabs value={activityFilter} onChange={setActivityFilter} />
              </div>
              <div className="mt-3 divide-y divide-[var(--coral-border)] border-t border-[var(--coral-border)]">
                <ActivityEntries
                  loaded={activityLoaded}
                  updates={visibleUpdates}
                  feedbackReplies={feedbackReplies}
                  emptyLabel={activityEmptyLabel}
                  actionLabel={activityFilter === "all" ? "Add update" : "Show all activity"}
                  onAction={handleActivityAction}
                  secondaryAction={activitySecondaryAction}
                />
              </div>
            </QcCard>
          </div>
        ) : activeView === "context" ? (
          <div className="mx-auto flex w-full max-w-[38rem] flex-col gap-3.5 px-4 pb-24 pt-4 sm:px-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-1.5 text-[0.75rem] text-[var(--coral-text-muted)]">
                <CalendarDays className="h-3.5 w-3.5" strokeWidth={2} />
                {context ? `Updated ${formatDate(context.updatedAt)} by ${context.updatedBy}` : "Not written yet"}
              </div>
              {context && <span className="shrink-0 text-[0.6875rem] font-medium text-[var(--coral-text-muted)]">{contextSourceLabel(context)}</span>}
            </div>
            <QcCard className="p-4">
              {context ? (
                <MarkdownView markdown={context.markdown} />
              ) : (
                <div className="flex flex-col items-center px-2 py-6 text-center">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--coral-surface-2)] text-[var(--coral-text-muted)]">
                    <NotebookText className="h-4.5 w-4.5" strokeWidth={1.9} />
                  </span>
                  <p className="mt-3 text-sm font-semibold text-[var(--coral-text)]">No context written yet</p>
                  <p className="mt-1 text-xs text-[var(--coral-text-muted)]">Capture the purpose, users, flows and open questions for this project.</p>
                  <QcButton size="sm" className="mt-4" onClick={() => openContextEditor("write")} icon={<Pencil className="h-3.5 w-3.5" strokeWidth={2.3} />}>
                    Add context
                  </QcButton>
                </div>
              )}
            </QcCard>
            {context && (
              <div className="grid grid-cols-2 gap-3">
                <QcButton variant="secondary" size="md" onClick={() => openContextEditor("write")} icon={<Pencil className="h-4 w-4" strokeWidth={2} />}>
                  Edit
                </QcButton>
                <QcButton variant="secondary" size="md" onClick={() => openContextEditor("upload")} icon={<UploadCloud className="h-4 w-4" strokeWidth={2} />}>
                  Replace
                </QcButton>
              </div>
            )}
          </div>
        ) : (
        <div className="mx-auto flex w-full max-w-[38rem] flex-col gap-3.5 px-4 pb-24 pt-4 sm:px-5">
          <QcCard className="relative overflow-hidden p-3.5">
            <span className="absolute -right-8 -top-10 h-28 w-28 rounded-full bg-[var(--coral-soft)] opacity-25" aria-hidden="true" />
            <div className="relative flex items-center gap-3.5">
              <ProgressRing percent={project.progress} size={86} label="" color={accent.ring} trackColor={accent.track} />
              <div className="min-w-0 flex-1">
                <StatusPill label={meta.label} tone={meta.tone} dot />
                <p className="mt-2 text-[0.875rem] font-medium leading-[1.45] text-[var(--coral-text-muted)]">{project.description}</p>
              </div>
            </div>
            <div className="relative mt-3 grid grid-cols-2 gap-2 border-t border-[var(--coral-border)] pt-3">
              <div className="min-w-0">
                <p className="text-[0.625rem] font-medium uppercase tracking-[0.08em] text-[var(--coral-text-muted)]">Project owner</p>
                <p className="mt-1 truncate text-[0.75rem] font-semibold text-[var(--coral-text)]">{project.ownerName}</p>
              </div>
              <div className="min-w-0 border-l border-[var(--coral-border)] pl-3">
                <p className="text-[0.625rem] font-medium uppercase tracking-[0.08em] text-[var(--coral-text-muted)]">Mission fit</p>
                <div className="mt-1 flex items-center gap-2">
                  <Target className="h-3.5 w-3.5 text-[var(--coral-strong)]" strokeWidth={2} />
                  <MissionFitDots score={project.missionFitScore} />
                </div>
              </div>
            </div>
            <span className="sr-only">{coverage.degrees} degrees of project coverage.</span>
          </QcCard>

          {/* A completed project has no outstanding next step even if one is
              still stored from before it was marked done (older data, or a
              status change that didn't retype the next step) — showing a
              "Mark complete" action on an already-finished project reads as
              a bug, so this card never renders once the project is complete. */}
          {project.nextStep && !isProjectComplete && (
            <QcCard className="p-3.5">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--coral-soft)] text-[var(--coral-strong)]">
                  <Flag className="h-4.5 w-4.5" strokeWidth={1.9} />
                </span>
                <button type="button" onClick={() => setAddOpen(true)} className="quest-coral-tap min-w-0 flex-1 text-left" aria-label={`Update the next step: ${project.nextStep}`}>
                  <p className="text-[0.625rem] font-semibold uppercase tracking-[0.08em] text-[var(--coral-text-muted)]">Next step</p>
                  <p className="mt-1 truncate text-[0.875rem] font-semibold text-[var(--coral-text)]">{project.nextStep}</p>
                </button>
                {project.nextStepDue && (
                  <span className="flex shrink-0 flex-col items-end gap-1 text-[0.6875rem] font-medium text-[var(--coral-text-muted)]">
                    <CalendarDays className="h-4 w-4 text-[var(--coral-strong)]" strokeWidth={1.9} />
                    {formatDate(project.nextStepDue)}
                  </span>
                )}
              </div>
              <div className="mt-3 flex items-center justify-between gap-3 border-t border-[var(--coral-border)] pt-3">
                <span className="text-[0.6875rem] text-[var(--coral-text-muted)]">Update it or mark it done when complete.</span>
                <button type="button" onClick={handleCompleteNextStep} disabled={isCompletingStep} className="quest-coral-tap inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-[var(--coral-border)] bg-[var(--coral-surface)] px-2.5 py-1.5 text-[0.6875rem] font-semibold text-[var(--coral-text)] disabled:opacity-50">
                  <Check className="h-3.5 w-3.5 text-[var(--coral-strong)]" strokeWidth={2.4} />
                  {isCompletingStep ? "Saving…" : "Mark complete"}
                </button>
              </div>
              {stepError && <p className="mt-2 text-[0.6875rem] font-medium text-[var(--coral-missing)]">{stepError}</p>}
            </QcCard>
          )}

          <AlertsCard blockerCount={blockerCount} redTeamCount={redTeamCount} onShowActivity={openActivity} />

          <div className="grid grid-cols-3 gap-2" aria-label="Project actions">
            <button type="button" onClick={() => setAddOpen(true)} className="quest-coral-tap flex min-h-11 flex-col items-center justify-center gap-1 rounded-xl border border-[var(--coral-border)] bg-[var(--coral-surface)] text-[0.6875rem] font-semibold text-[var(--coral-text)]">
              <Plus className="h-4 w-4 text-[var(--coral-strong)]" strokeWidth={2.2} />
              Add
            </button>
            <button type="button" onClick={() => setAskOpen(true)} className="quest-coral-tap flex min-h-11 flex-col items-center justify-center gap-1 rounded-xl border border-[var(--coral-border)] bg-[var(--coral-surface)] text-[0.6875rem] font-semibold text-[var(--coral-text)]">
              <Sparkles className="h-4 w-4 text-[var(--coral-strong)]" strokeWidth={2} />
              Ask AI
            </button>
            <button type="button" onClick={handleShare} className="quest-coral-tap flex min-h-11 flex-col items-center justify-center gap-1 rounded-xl border border-[var(--coral-border)] bg-[var(--coral-surface)] text-[0.6875rem] font-semibold text-[var(--coral-text)]">
              <Share2 className="h-4 w-4 text-[var(--coral-text-muted)]" strokeWidth={2} />
              Share
            </button>
          </div>
          {shareMessage && <p className="-mt-1 text-center text-[0.6875rem] font-medium text-[var(--coral-text-muted)]">{shareMessage}</p>}

          <QcCard className="p-3.5">
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--coral-soft)] text-[var(--coral-strong)]">
                <NotebookText className="h-4.5 w-4.5" strokeWidth={1.9} />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-[0.875rem] font-semibold text-[var(--coral-text)]">Project context</h2>
                <p className="mt-0.5 truncate text-[0.6875rem] text-[var(--coral-text-muted)]">
                  {context ? `Updated ${formatDate(context.updatedAt)} · ${contextSourceLabel(context)}` : "No context written yet"}
                </p>
              </div>
            </div>
            <p className="quest-coral-reading-copy mt-3 line-clamp-3 text-[0.8125rem]">
              {context
                ? summarizeMarkdown(context.markdown, 220)
                : "Capture the purpose, users, flows and open questions for this project so anyone can get oriented fast."}
            </p>
            <div className="mt-3 flex items-center gap-4 border-t border-[var(--coral-border)] pt-3">
              <button
                type="button"
                onClick={() => (context ? setActiveView("context") : openContextEditor("write"))}
                className="quest-coral-tap inline-flex items-center gap-1 text-[0.75rem] font-semibold text-[var(--coral-strong)]"
              >
                {context ? "View context" : "Add context"}
                <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.2} />
              </button>
              {context && (
                <>
                  <span className="flex-1" />
                  <button type="button" onClick={() => openContextEditor("write")} className="quest-coral-tap text-[0.75rem] font-semibold text-[var(--coral-text-muted)]">
                    Edit
                  </button>
                  <button type="button" onClick={() => openContextEditor("upload")} className="quest-coral-tap text-[0.75rem] font-semibold text-[var(--coral-text-muted)]">
                    Replace
                  </button>
                </>
              )}
            </div>
          </QcCard>

          <AiBriefCard
            body={
              brief.phase === "loading" ? (
                <QuestCoralBriefGenerating />
              ) : (
                <>
                  {brief.brief ?? ""}
                  {brief.error && (
                    <span className="mt-1.5 block text-[0.6875rem] font-normal text-[var(--coral-text-muted)]/80">
                      Showing a basic summary — AI brief unavailable right now.
                    </span>
                  )}
                </>
              )
            }
            headerAction={
              QUEST_CORAL_AI_ENABLED && brief.phase === "ready" ? (
                <button
                  type="button"
                  onClick={brief.regenerate}
                  className="quest-coral-tap flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--coral-text-muted)] hover:bg-white/60"
                  aria-label="Regenerate AI brief"
                  title="Regenerate"
                >
                  <RefreshCw className="h-3.5 w-3.5" strokeWidth={2} />
                </button>
              ) : undefined
            }
            footer={
              askOpen ? (
                <div>
                  <div className="flex items-center gap-2 rounded-xl border border-[var(--coral-border)] bg-white px-3 py-1.5 focus-within:border-[var(--coral)] focus-within:shadow-[0_0_0_3px_rgba(255,122,89,0.10)]">
                    <input
                      autoFocus
                      value={ask.question}
                      onChange={(event) => ask.setQuestion(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault()
                          ask.submit()
                        }
                      }}
                      placeholder="Ask about this project"
                      className="h-8 min-w-0 flex-1 bg-transparent text-[0.75rem] text-[var(--coral-text)] outline-none placeholder:text-[#94A3B8]"
                    />
                    <button type="button" onClick={ask.submit} disabled={!ask.canSubmit} className="quest-coral-tap flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--coral)] text-white disabled:opacity-40" aria-label="Send question to AI">
                      <ArrowUp className="h-3.5 w-3.5" strokeWidth={2.4} />
                    </button>
                  </div>
                  {askGenerating && <QuestCoralAskGenerating question={ask.question} />}
                  {!askGenerating && ask.phase === "answered" && ask.answer && <p className="quest-coral-reading-copy mt-2 text-[0.75rem]">{ask.answer.text}</p>}
                  {!askGenerating && ask.phase === "error" && (
                    <p className="mt-2 text-[0.6875rem] font-medium text-[var(--coral-missing)]">{ask.error ?? "Something went wrong. Please try again."}</p>
                  )}
                </div>
              ) : (
                <button type="button" onClick={() => setAskOpen(true)} className="quest-coral-tap inline-flex items-center gap-1.5 text-[0.75rem] font-semibold text-[var(--coral-strong)]">
                  Ask a question
                  <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.2} />
                </button>
              )
            }
          />

          <QcCard className="overflow-hidden py-3.5">
            <div className="flex items-center justify-between gap-3 px-4">
              <div>
                <h2 className="text-[0.9375rem] font-semibold tracking-[-0.02em] text-[var(--coral-text)]">Activity &amp; Feedback</h2>
                <p className="mt-0.5 text-[0.6875rem] text-[var(--coral-text-muted)]">Latest project signals.</p>
              </div>
              <button type="button" onClick={() => openActivity("all")} className="quest-coral-tap flex items-center gap-1 text-[0.75rem] font-semibold text-[var(--coral-strong)]">
                View all
                <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.2} />
              </button>
            </div>
            <div className="mt-3 px-4">
              <ActivityFilterTabs value={activityFilter} onChange={setActivityFilter} />
            </div>
            <div className="mt-3 divide-y divide-[var(--coral-border)] border-t border-[var(--coral-border)]">
              <ActivityEntries
                loaded={activityLoaded}
                updates={latestUpdates}
                feedbackReplies={feedbackReplies}
                emptyLabel={activityEmptyLabel}
                actionLabel={activityFilter === "all" ? "Add update" : "Show all activity"}
                onAction={handleActivityAction}
                secondaryAction={activitySecondaryAction}
              />
            </div>
          </QcCard>

          <QcCard className="p-3.5">
            <div className="flex items-center justify-between">
              <h2 className="text-[0.875rem] font-semibold text-[var(--coral-text)]">People involved</h2>
              <button type="button" onClick={() => setPeopleOpen(true)} className="quest-coral-tap text-[0.75rem] font-semibold text-[var(--coral-strong)]">View all</button>
            </div>
            <div className="mt-3 flex items-center gap-2.5">
              <div className="flex -space-x-2.5">
                {project.people.slice(0, 5).map((person) => (
                  <Avatar key={person.id} initials={person.initials} className="h-9 w-9 text-[0.625rem] ring-2 ring-[var(--coral-surface)]" />
                ))}
              </div>
              {project.people.length > 5 && (
                <span className="flex h-9 min-w-9 items-center justify-center rounded-full bg-[var(--coral-surface-2)] px-2 text-[0.6875rem] font-semibold text-[var(--coral-text)]">+{project.people.length - 5}</span>
              )}
              <p className="min-w-0 truncate text-[0.75rem] text-[var(--coral-text-muted)]">{project.people.length} people contributing</p>
            </div>
          </QcCard>

          <EventCoverageCard coverage={coverage} timeline={project.timeline} onOpenTimeline={openTimeline} />
        </div>
        )}
      </div>

      <AddUpdateSheet
        open={addOpen}
        currentStatus={project.status}
        currentProgress={project.progress}
        onClose={() => setAddOpen(false)}
        onSave={async (input) => {
          await onAddUpdate(input)
          setAddOpen(false)
        }}
      />

      <EditProjectContextSheet
        open={contextEditorOpen}
        initialMode={contextEditorMode}
        context={context}
        projectName={project.name}
        onClose={() => setContextEditorOpen(false)}
        onSave={handleSaveContext}
      />

      <QcSheet
        open={peopleOpen}
        title="People involved"
        description={`${project.people.length} people contributing to ${project.name}.`}
        onClose={() => {
          setPeopleOpen(false)
          setAddPersonOpen(false)
          setPendingPeople([])
          setPersonError(null)
        }}
      >
        <div className="flex flex-col gap-4">
          <button type="button" onClick={() => { setPendingPeople([]); setPersonError(null); setAddPersonOpen((open) => !open) }} className="quest-coral-tap flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[var(--coral-border)] bg-[var(--coral-surface)] text-[0.8125rem] font-semibold text-[var(--coral-text)]">
            <Plus className="h-4 w-4 text-[var(--coral-strong)]" strokeWidth={2.3} />
            Add people
          </button>
          {addPersonOpen && (
            <div className="rounded-2xl border border-[var(--coral-border)] bg-[var(--coral-surface-2)] p-3.5">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-[0.75rem] font-semibold text-[var(--coral-text)]">Add someone</span>
                <button type="button" onClick={() => { setAddPersonOpen(false); setPersonError(null) }} className="quest-coral-tap text-[0.75rem] font-semibold text-[var(--coral-text-muted)]">
                  Cancel
                </button>
              </div>
              <PeopleSearchPicker
                contacts={contacts}
                importedContacts={importedContacts}
                excludeIds={project.people.map((person) => person.id)}
                selectedIds={pendingPeople.map((person) => person.id)}
                onToggle={(person) => {
                  setPersonError(null)
                  setPendingPeople((current) => current.some((entry) => entry.id === person.id)
                    ? current.filter((entry) => entry.id !== person.id)
                    : [...current, person])
                }}
              />
              <div className="mt-3 flex items-center justify-between gap-3 border-t border-[var(--coral-border)] pt-3">
                <span className="text-[0.6875rem] font-medium text-[var(--coral-text-muted)]">
                  {pendingPeople.length === 0 ? "Select people to add" : `${pendingPeople.length} selected`}
                </span>
                <div className="flex gap-2">
                  <button type="button" onClick={() => { setPendingPeople([]); setAddPersonOpen(false); setPersonError(null) }} className="quest-coral-tap h-9 rounded-xl px-3 text-[0.75rem] font-semibold text-[var(--coral-text-muted)]">
                    Cancel
                  </button>
                  <QcButton size="sm" disabled={pendingPeople.length === 0 || isAddingPerson} onClick={() => void handleAddPeople()}>
                    {isAddingPerson ? "Adding…" : pendingPeople.length === 1 ? "Add 1 person" : `Add ${pendingPeople.length} people`}
                  </QcButton>
                </div>
              </div>
              {personError && <p className="mt-2 text-[0.6875rem] font-medium text-[var(--coral-missing)]">{personError}</p>}
            </div>
          )}
          <ul className="flex flex-col divide-y divide-[var(--coral-border)]">
            {project.people.map((person) => {
              const isOwner = person.id === project.ownerId
              return (
                <li key={person.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <Avatar initials={person.initials} className="h-10 w-10 text-[0.6875rem]" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-[var(--coral-text)]">{person.name}</p>
                    <p className="mt-0.5 text-[0.75rem] text-[var(--coral-text-muted)]">{isOwner ? "Project owner" : "Project contributor"}</p>
                  </div>
                  {isOwner && <span className="rounded-full border border-[#FFD2C2] bg-[var(--coral-soft)] px-2 py-1 text-[0.625rem] font-semibold text-[var(--coral-strong)]">Owner</span>}
                </li>
              )
            })}
          </ul>
        </div>
      </QcSheet>

      <QcSheet
        open={timelineOpen}
        title="Project timeline"
        description="Keep milestones in the phase where they belong."
        onClose={() => {
          setTimelineOpen(false)
          setTimelineError(null)
          setTimelineItem("")
        }}
      >
        <div className="flex flex-col gap-4">
          <div className="flex gap-1 rounded-xl border border-[var(--coral-border)] bg-[var(--coral-surface-2)] p-1" role="tablist" aria-label="Timeline phase">
            {(["past", "present", "future"] as TimelinePhase[]).map((phase) => {
              const active = timelinePhase === phase
              return (
                <button
                  key={phase}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => {
                    setTimelinePhase(phase)
                    setTimelineError(null)
                  }}
                  className={cn("quest-coral-tap min-h-8 flex-1 rounded-lg px-2 text-[0.6875rem] font-semibold capitalize", active ? "bg-white text-[var(--coral-text)] shadow-sm" : "text-[var(--coral-text-muted)]")}
                >
                  {phase}
                </button>
              )
            })}
          </div>
          <div className="rounded-2xl border border-[var(--coral-border)] bg-[var(--coral-surface)] p-3.5">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold capitalize text-[var(--coral-text)]">{timelinePhase}</h3>
              <span className="text-[0.6875rem] text-[var(--coral-text-muted)]">{editableTimeline[timelinePhase].range}</span>
            </div>
            {editableTimeline[timelinePhase].items.length > 0 ? (
              <ul className="mt-3 flex flex-col gap-2">
                {editableTimeline[timelinePhase].items.map((item, index) => (
                  <li key={`${item}-${index}`} className="flex items-start gap-2 text-[0.8125rem] leading-snug text-[var(--coral-text-muted)]">
                    <span className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", timelinePhase === "present" ? "bg-[var(--coral)]" : "bg-[#94A3B8]")} aria-hidden="true" />
                    {item}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-[0.75rem] text-[var(--coral-text-muted)]">No milestones in this phase yet.</p>
            )}
          </div>
          <form onSubmit={handleAddTimelineItem} className="flex flex-col gap-2">
            <label className="flex flex-col gap-2">
              <span className="text-[0.75rem] font-semibold text-[var(--coral-text)]">Add a {timelinePhase} milestone</span>
              <input
                value={timelineItem}
                onChange={(event) => {
                  setTimelineItem(event.target.value)
                  setTimelineError(null)
                }}
                placeholder={timelinePhase === "present" ? "What is happening now?" : "Describe the milestone"}
                className="h-10 w-full rounded-xl border border-[var(--coral-border)] bg-[var(--coral-surface)] px-3 text-sm text-[var(--coral-text)] outline-none placeholder:text-[#94A3B8] focus:border-[var(--coral)] focus:shadow-[0_0_0_3px_rgba(255,122,89,0.10)]"
              />
            </label>
            {timelineError && <p className="text-[0.6875rem] font-medium text-[var(--coral-missing)]">{timelineError}</p>}
            <button type="submit" disabled={isAddingTimelineItem} className="quest-coral-tap inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-[var(--coral-border)] bg-[var(--coral-surface)] text-[0.8125rem] font-semibold text-[var(--coral-text)] disabled:opacity-50">
              <Plus className="h-4 w-4 text-[var(--coral-strong)]" strokeWidth={2.3} />
              {isAddingTimelineItem ? "Adding…" : "Add milestone"}
            </button>
          </form>
        </div>
      </QcSheet>

      <QcSheet
        open={menuOpen}
        title="Project options"
        description="Quick actions for this project."
        onClose={() => setMenuOpen(false)}
      >
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false)
              setDetailsEditorOpen(true)
            }}
            className="quest-coral-tap flex min-h-12 items-center gap-3 rounded-xl px-3 text-left hover:bg-[var(--coral-surface-2)]"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--coral-soft)] text-[var(--coral-strong)]">
              <Pencil className="h-4 w-4" strokeWidth={2} />
            </span>
            <span className="min-w-0 flex-1 text-sm font-semibold text-[var(--coral-text)]">Edit name &amp; description</span>
            <ChevronRight className="h-4 w-4 text-[var(--coral-text-muted)]" strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false)
              openActivity("all")
            }}
            className="quest-coral-tap flex min-h-12 items-center gap-3 rounded-xl px-3 text-left hover:bg-[var(--coral-surface-2)]"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--coral-surface-2)] text-[var(--coral-text-muted)]">
              <Filter className="h-4 w-4" strokeWidth={2} />
            </span>
            <span className="min-w-0 flex-1 text-sm font-semibold text-[var(--coral-text)]">Open activity feed</span>
            <ChevronRight className="h-4 w-4 text-[var(--coral-text-muted)]" strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false)
              void handleShare()
            }}
            className="quest-coral-tap flex min-h-12 items-center gap-3 rounded-xl px-3 text-left hover:bg-[var(--coral-surface-2)]"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--coral-soft)] text-[var(--coral-strong)]">
              <Share2 className="h-4 w-4" strokeWidth={2} />
            </span>
            <span className="min-w-0 flex-1 text-sm font-semibold text-[var(--coral-text)]">Share project summary</span>
            <ChevronRight className="h-4 w-4 text-[var(--coral-text-muted)]" strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false)
              setDeleteProjectError(null)
              setDeleteConfirmOpen(true)
            }}
            className="quest-coral-tap flex min-h-12 items-center gap-3 rounded-xl px-3 text-left hover:bg-[var(--coral-missing-soft)]"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--coral-missing-soft)] text-[var(--coral-missing)]">
              <TriangleAlert className="h-4 w-4" strokeWidth={2} />
            </span>
            <span className="min-w-0 flex-1 text-sm font-semibold text-[var(--coral-missing)]">Delete project</span>
            <ChevronRight className="h-4 w-4 text-[var(--coral-missing)]" strokeWidth={2} />
          </button>
        </div>
      </QcSheet>

      <EditProjectDetailsSheet
        open={detailsEditorOpen}
        project={project}
        onClose={() => setDetailsEditorOpen(false)}
        onSave={(patch) => onPatchProject(patch)}
      />

      <QcSheet
        open={deleteConfirmOpen}
        title="Delete project?"
        description="This removes the project from Quest Coral. This action cannot be undone."
        onClose={() => {
          if (isDeletingProject) return
          setDeleteConfirmOpen(false)
          setDeleteProjectError(null)
        }}
        footer={
          <div className="grid grid-cols-2 gap-3">
            <QcButton variant="secondary" size="md" disabled={isDeletingProject} onClick={() => setDeleteConfirmOpen(false)}>
              Cancel
            </QcButton>
            <QcButton variant="danger" size="md" disabled={isDeletingProject} onClick={() => void handleDeleteProject()}>
              {isDeletingProject ? "Deleting…" : "Delete"}
            </QcButton>
          </div>
        }
      >
        <p className="text-[0.8125rem] leading-relaxed text-[var(--coral-text-muted)]">Updates are retained for audit history, but the project will no longer appear in the dashboard.</p>
        {deleteProjectError && <p className="mt-3 text-[0.75rem] font-medium text-[var(--coral-missing)]">{deleteProjectError}</p>}
      </QcSheet>

      <button
        type="button"
        onClick={() => setAddOpen(true)}
        className="quest-coral-primary-button quest-coral-tap absolute bottom-[max(calc(var(--sab)+2rem),12dvh)] right-4 z-10 flex h-12 items-center gap-1.5 rounded-full px-4 text-sm font-semibold text-white"
      >
        <Plus className="h-4.5 w-4.5" strokeWidth={2.4} />
        Add
      </button>
    </div>
  )
}
