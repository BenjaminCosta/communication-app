"use client"

import { useMemo, useState } from "react"
import { createPortal } from "react-dom"
import { ArrowLeft, Check, ChevronDown, ChevronRight, Loader2, Pencil, Sparkles, Trash2, TriangleAlert, X } from "lucide-react"
import {
  formatOutlookDate,
  localDateToIso,
  outlookDates,
  scheduleOutlookTasks,
  type OutlookTask,
  type OutlookWindow,
} from "@/lib/outlook-core"
import type { FieldSource, NormalizedSuggestion } from "@/features/outlooks/ai/normalize-outlook-suggestions"
import { cn } from "@/lib/utils"

/**
 * Centered AI review modal (reference: "2. Review").
 *
 * Opens the instant the user taps Generate Outlook: first the AI generating
 * state — the same shimmer/spark language as the profile "AI summary" — then the
 * draft reveal: a labeled mini-gantt, compact expandable task cards, a warning
 * banner for anything uncertain, and Looks good / Advanced view actions.
 *
 * Purely presentational + local expansion state. Nothing here persists; the
 * caller confirms and routes accepted drafts through the existing deterministic
 * `persist` path.
 */

const TASK_TONES = [
  { bar: "border-violet-600 bg-violet-600 text-white", edge: "bg-violet-400", chip: "border-violet-400/35 text-violet-300" },
  { bar: "border-cyan-600 bg-cyan-600 text-white", edge: "bg-cyan-400", chip: "border-cyan-400/35 text-cyan-300" },
  { bar: "border-amber-500 bg-amber-500 text-[#14100a]", edge: "bg-amber-400", chip: "border-amber-400/35 text-amber-300" },
  { bar: "border-blue-600 bg-blue-600 text-white", edge: "bg-blue-400", chip: "border-blue-400/35 text-blue-300" },
  { bar: "border-emerald-600 bg-emerald-600 text-white", edge: "bg-emerald-400", chip: "border-emerald-400/35 text-emerald-300" },
] as const

const STATUS_LABELS: Record<OutlookTask["status"], string> = {
  not_started: "Planned",
  in_progress: "On track",
  blocked: "At risk",
  complete: "Done",
}

const STATUS_PILLS: Record<OutlookTask["status"], string> = {
  not_started: "border-blue-400/25 bg-blue-400/[0.07] text-blue-200/80",
  in_progress: "border-emerald-400/25 bg-emerald-400/[0.07] text-emerald-200/80",
  blocked: "border-orange-400/25 bg-orange-400/[0.07] text-orange-200/80",
  complete: "border-emerald-400/25 bg-emerald-400/[0.07] text-emerald-200/80",
}

export function OutlookAiReviewModal({
  window,
  review,
  companies,
  existingTasks,
  mode,
  generating,
  saving,
  onUpdateTask,
  onRemove,
  onBack,
  onConfirm,
  onAdvanced,
}: {
  window: OutlookWindow
  review: NormalizedSuggestion[]
  companies: Array<{ id: string; name: string }>
  existingTasks: Array<Pick<OutlookTask, "id" | "title">>
  mode: "mock" | "live" | null
  generating: boolean
  saving: boolean
  onUpdateTask: (taskId: string, patch: Partial<OutlookTask>) => void
  onRemove: (taskId: string) => void
  onBack: () => void
  onConfirm: () => void
  onAdvanced?: () => void
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Display-only deterministic preview: resolves dependency starts + end dates
  // exactly as the real scheduler will, so the gantt/cards show truth.
  const preview = useMemo(() => scheduleOutlookTasks(review.map((entry) => entry.task), window), [review, window])
  const scheduledById = useMemo(() => new Map(preview.tasks.map((task) => [task.id, task])), [preview.tasks])
  const noteCount = review.reduce((total, entry) => total + entry.notes.length, 0)

  const siblingOptions = review.map((entry) => ({ id: entry.task.id, title: entry.task.title }))

  if (typeof document === "undefined") return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#04070b]/78 p-4 backdrop-blur-md" role="dialog" aria-modal="true" aria-labelledby="ai-review-title">
      <button type="button" className="absolute inset-0" onClick={generating ? undefined : onBack} aria-label="Close review" tabIndex={-1} />
      <section className="directory-glass-screen animate-fade-up relative z-[1] flex max-h-[88dvh] w-full max-w-md flex-col overflow-hidden rounded-3xl border border-white/[0.11] shadow-[0_32px_80px_rgba(1,5,12,0.6)]">
        <header className="flex items-center gap-2.5 border-b border-white/[0.07] px-4 py-3.5">
          <Sparkles className={cn("h-4 w-4 shrink-0 text-[var(--directory-job)]", generating && "directory-ai-spark")} strokeWidth={2} />
          <div className="min-w-0 flex-1">
            <h2 id="ai-review-title" className="directory-ai-text text-[11px] font-semibold uppercase tracking-[0.14em]">
              {generating ? "Generating outlook" : "AI outlook draft"}
            </h2>
            {!generating && (
              <p className="mt-0.5 text-[10px] text-muted-foreground/55">
                {review.length} task{review.length === 1 ? "" : "s"} · {formatOutlookDate(window.start)} – {formatOutlookDate(window.end)}
                {mode === "mock" && <span className="ml-1.5 rounded-full border border-white/10 bg-white/[0.04] px-1.5 py-px text-[8px] font-semibold uppercase tracking-wide text-muted-foreground/55">Mock</span>}
              </p>
            )}
          </div>
          {!generating && (
            <button type="button" onClick={onBack} className="glass-button flex h-8 w-8 shrink-0 items-center justify-center rounded-full border active:scale-[0.94]" aria-label="Back to edit">
              <X className="h-3.5 w-3.5" strokeWidth={1.8} />
            </button>
          )}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {generating || review.length === 0 ? (
            <GeneratingSkeleton />
          ) : (
            <div className="space-y-3">
              <ReviewGantt window={window} tasks={preview.tasks} />

              <div className="space-y-2">
                {review.map((entry, index) => (
                  <ReviewTaskCard
                    key={entry.task.id}
                    entry={entry}
                    scheduled={scheduledById.get(entry.task.id) ?? entry.task}
                    tone={TASK_TONES[index % TASK_TONES.length]}
                    expanded={expandedId === entry.task.id}
                    companies={companies}
                    dependencyOptions={[...existingTasks, ...siblingOptions.filter((option) => option.id !== entry.task.id)]}
                    onToggle={() => setExpandedId((current) => (current === entry.task.id ? null : entry.task.id))}
                    onUpdateTask={onUpdateTask}
                    onRemove={onRemove}
                  />
                ))}
              </div>

              {noteCount > 0 && (
                <button
                  type="button"
                  onClick={() => setExpandedId(review.find((entry) => entry.notes.length > 0)?.task.id ?? null)}
                  className="flex w-full items-center gap-2.5 rounded-xl border border-amber-400/25 bg-amber-400/[0.07] px-3.5 py-3 text-left transition-transform active:scale-[0.99]"
                >
                  <TriangleAlert className="h-4 w-4 shrink-0 text-amber-300/85" strokeWidth={1.8} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[11px] font-semibold text-amber-100/90">
                      {noteCount} detail{noteCount === 1 ? "" : "s"} to review
                    </span>
                    <span className="block text-[10px] text-amber-100/55">Review suggested details</span>
                  </span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-amber-200/60" strokeWidth={1.8} />
                </button>
              )}
            </div>
          )}
        </div>

        {!generating && review.length > 0 && (
          <footer className="space-y-2 border-t border-white/[0.07] px-4 pb-[max(1rem,var(--sab))] pt-3">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={onConfirm}
                disabled={saving}
                className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-emerald-400 bg-emerald-600 text-[12px] font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_5px_14px_rgba(2,44,34,0.34)] transition-[background-color,transform] hover:bg-emerald-500 active:scale-[0.98] disabled:opacity-45"
              >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} /> : <Check className="h-3.5 w-3.5" strokeWidth={2.2} />}
                {saving ? "Adding…" : "Looks good"}
              </button>
              <button
                type="button"
                onClick={() => {
                  // Jump to the details that need review — expand the first
                  // flagged task (or the first task) inline, never leave the modal.
                  const target = review.find((entry) => entry.notes.length > 0)?.task.id ?? review[0]?.task.id ?? null
                  setExpandedId(target)
                  if (target) requestAnimationFrame(() => document.getElementById(`ai-review-task-${target}`)?.scrollIntoView({ behavior: "smooth", block: "center" }))
                }}
                disabled={saving}
                className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/[0.11] bg-white/[0.065] text-[12px] font-semibold text-foreground/84 transition-[background-color,border-color,transform] hover:border-white/[0.16] hover:bg-white/[0.1] active:scale-[0.98] disabled:opacity-45"
              >
                <Pencil className="h-3.5 w-3.5" strokeWidth={1.8} />
                Edit details
              </button>
            </div>
            <button
              type="button"
              onClick={onBack}
              disabled={saving}
              className="flex min-h-9 w-full items-center justify-center gap-1.5 text-[11px] font-medium text-muted-foreground/60 transition-colors hover:text-foreground/80 disabled:opacity-40"
            >
              <ArrowLeft className="h-3 w-3" strokeWidth={1.8} />
              Back to edit
            </button>
          </footer>
        )}
      </section>
    </div>,
    document.body,
  )
}

/** AI generating state — same shimmer language as the profile "AI summary". */
function GeneratingSkeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#091019]/70 p-3.5">
        <div className="flex gap-2">
          {[0, 1, 2].map((week) => (
            <div key={week} className="h-2.5 flex-1 rounded-full directory-ai-shimmer" style={{ animationDelay: `${week * 0.12}s` }} />
          ))}
        </div>
        <div className="mt-4 space-y-2.5">
          <div className="h-5 w-2/5 rounded directory-ai-shimmer" />
          <div className="ml-[18%] h-5 w-1/3 rounded directory-ai-shimmer" style={{ animationDelay: "0.15s" }} />
          <div className="ml-[38%] h-5 w-2/5 rounded directory-ai-shimmer" style={{ animationDelay: "0.3s" }} />
        </div>
      </div>
      {[0, 1, 2].map((row) => (
        <div key={row} className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-3.5">
          <div className="h-3.5 w-1/2 rounded-full directory-ai-shimmer" style={{ animationDelay: `${0.1 + row * 0.15}s` }} />
          <div className="mt-2 h-3 w-1/3 rounded-full directory-ai-shimmer" style={{ animationDelay: `${0.2 + row * 0.15}s` }} />
        </div>
      ))}
      <p className="text-center text-[10px] text-muted-foreground/45">Structuring tasks from your note…</p>
    </div>
  )
}

/** Mini three-week gantt with labeled bars, day letters and today marker. */
function ReviewGantt({ window, tasks }: { window: OutlookWindow; tasks: OutlookTask[] }) {
  const dates = outlookDates(window.start)
  const todayIndex = dates.indexOf(localDateToIso(new Date()))
  const dayLetter = useMemo(() => new Intl.DateTimeFormat("en-US", { weekday: "narrow", timeZone: "UTC" }), [])
  const visible = tasks.filter((task) => task.startDate && task.endDate && task.startDate <= window.end && task.endDate >= window.start)

  const clamp = (date: string) => (date < window.start ? window.start : date > window.end ? window.end : date)

  return (
    <section className="overflow-hidden rounded-2xl border border-white/[0.09] bg-[#091019]/82 shadow-[inset_0_1px_0_rgba(255,255,255,0.045)]" aria-label="Draft three-week calendar">
      <div className="grid grid-cols-3 divide-x divide-white/[0.07] border-b border-white/[0.08]">
        {[0, 1, 2].map((week) => (
          <div key={week} className="px-1 pb-1.5 pt-2.5 text-center">
            <p className="text-[9px] font-semibold text-foreground/78">Week {week + 1}</p>
            <p className="mt-0.5 truncate font-mono text-[7px] text-muted-foreground/50">
              {formatOutlookDate(dates[week * 7])} – {formatOutlookDate(dates[week * 7 + 6])}
            </p>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-[repeat(21,minmax(0,1fr))] border-b border-white/[0.07] pb-1 pt-0.5">
        {dates.map((date, index) => (
          <span key={date} className={cn("text-center font-mono text-[7px] text-muted-foreground/45", (index === 6 || index === 13) && "border-r border-white/[0.1]")}>
            {dayLetter.format(new Date(`${date}T00:00:00Z`))}
          </span>
        ))}
      </div>

      <div className="relative space-y-1.5 py-2.5">
        <div className="pointer-events-none absolute inset-0 grid grid-cols-[repeat(21,minmax(0,1fr))]" aria-hidden="true">
          {dates.map((date, index) => (
            <span key={date} className={cn("border-r border-white/[0.03] last:border-r-0", (index === 6 || index === 13) && "border-r-white/[0.12]")} />
          ))}
        </div>
        {todayIndex >= 0 && (
          <div className="pointer-events-none absolute inset-y-0 z-[2] w-px bg-[var(--directory-job)]/70" style={{ left: `${((todayIndex + 0.5) / 21) * 100}%` }} aria-hidden="true" />
        )}
        {visible.length === 0 ? (
          <p className="relative z-[1] px-3 py-4 text-center text-[10px] text-muted-foreground/50">No scheduled bars yet — set start dates below.</p>
        ) : (
          visible.map((task, index) => {
            const start = dates.indexOf(clamp(task.startDate!)) + 1
            const end = dates.indexOf(clamp(task.endDate!)) + 2
            return (
              <div key={task.id} className="relative z-[1] grid grid-cols-[repeat(21,minmax(0,1fr))]">
                <div
                  className={cn("mx-px flex h-6 min-w-0 items-center rounded-md border px-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_2px_5px_rgba(2,6,12,0.28)]", TASK_TONES[index % TASK_TONES.length].bar)}
                  style={{ gridColumn: `${start} / ${end}` }}
                  title={`${task.title} · ${formatOutlookDate(task.startDate!)} – ${formatOutlookDate(task.endDate!)}`}
                >
                  <span className="truncate text-[8px] font-semibold">{task.title || "Untitled"}</span>
                </div>
              </div>
            )
          })
        )}
      </div>
    </section>
  )
}

function ReviewTaskCard({
  entry,
  scheduled,
  tone,
  expanded,
  companies,
  dependencyOptions,
  onToggle,
  onUpdateTask,
  onRemove,
}: {
  entry: NormalizedSuggestion
  scheduled: OutlookTask
  tone: (typeof TASK_TONES)[number]
  expanded: boolean
  companies: Array<{ id: string; name: string }>
  dependencyOptions: Array<{ id: string; title: string }>
  onToggle: () => void
  onUpdateTask: (taskId: string, patch: Partial<OutlookTask>) => void
  onRemove: (taskId: string) => void
}) {
  const { task, notes } = entry
  const listId = `ai-review-company-${task.id}`

  const setCompany = (name: string) => {
    const match = companies.find((company) => company.name.trim().toLowerCase() === name.trim().toLowerCase())
    onUpdateTask(task.id, { companyName: name, companyContextId: match?.id ?? null })
  }

  return (
    <div id={`ai-review-task-${task.id}`} className="overflow-hidden rounded-2xl border border-white/[0.09] bg-[#0a111a]/82 shadow-[inset_0_1px_0_rgba(255,255,255,0.045)]">
      <button type="button" onClick={onToggle} className="grid w-full grid-cols-[3px_minmax(0,1fr)_auto_auto] items-center gap-3 p-3 text-left transition-colors active:bg-white/[0.03]" aria-expanded={expanded}>
        <span className={cn("h-9 w-[3px] rounded-full", tone.edge)} aria-hidden="true" />
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-semibold text-foreground/92">{task.title || "Untitled task"}</span>
          <span className="mt-0.5 block truncate text-[10px] text-muted-foreground/58">{task.trade || task.companyName || "General"}</span>
        </span>
        <span className="text-right">
          <span className="block font-mono text-[10px] text-muted-foreground/70">
            {scheduled.startDate ? formatOutlookDate(scheduled.startDate) : "No date"} · {task.durationDays}d
          </span>
          <span className={cn("mt-1 inline-flex rounded-full border px-2 py-0.5 text-[8px] font-semibold uppercase tracking-wide", notes.length ? "border-amber-400/30 bg-amber-400/[0.08] text-amber-200/85" : STATUS_PILLS[task.status])}>
            {notes.length ? "Review" : STATUS_LABELS[task.status]}
          </span>
        </span>
        <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground/50 transition-transform", expanded && "rotate-180")} strokeWidth={1.8} />
      </button>

      {expanded && (
        <div className="space-y-2.5 border-t border-white/[0.07] p-3 pt-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[8px] font-semibold uppercase tracking-wide text-muted-foreground/45">Sources</span>
            <ProvenanceTag label="Start" source={entry.fieldSources.startDate} />
            <ProvenanceTag label="Duration" source={entry.fieldSources.durationDays} />
            <ProvenanceTag label="Trade" source={entry.fieldSources.trade} />
            <ProvenanceTag label="Company" source={entry.fieldSources.companyName} />
            {entry.dependencyMatch !== "none" && <ProvenanceTag label="Dependency" source={entry.fieldSources.dependency} />}
          </div>
          <label className="block min-w-0">
            <span className="outlook-label">Task name</span>
            <input value={task.title} onChange={(event) => onUpdateTask(task.id, { title: event.target.value })} placeholder="Task name" className="outlook-input" />
          </label>
          <div className="grid grid-cols-1 gap-2.5 min-[400px]:grid-cols-2">
            <label className="block min-w-0">
              <span className="outlook-label">Start date</span>
              <input type="date" value={task.startDate ?? ""} onChange={(event) => onUpdateTask(task.id, { startDate: event.target.value || null })} className="outlook-input" />
            </label>
            <label className="block min-w-0">
              <span className="outlook-label">Duration</span>
              <select value={task.durationDays} onChange={(event) => onUpdateTask(task.id, { durationDays: Number(event.target.value) })} className="outlook-input">
                {Array.from({ length: 21 }, (_, index) => index + 1).map((days) => (
                  <option key={days} value={days}>{days} day{days === 1 ? "" : "s"}</option>
                ))}
              </select>
            </label>
            <label className="block min-w-0">
              <span className="outlook-label">Trade</span>
              <input value={task.trade} onChange={(event) => onUpdateTask(task.id, { trade: event.target.value })} placeholder="Concrete" className="outlook-input" />
            </label>
            <label className="block min-w-0">
              <span className="outlook-label">Company</span>
              <input list={listId} value={task.companyName} onChange={(event) => setCompany(event.target.value)} placeholder="74 Construction" className="outlook-input" />
              <datalist id={listId}>
                {companies.map((company) => <option key={company.id} value={company.name} />)}
              </datalist>
            </label>
            <label className="block min-w-0">
              <span className="outlook-label">Dependency</span>
              <select value={task.dependencyTaskId ?? ""} onChange={(event) => onUpdateTask(task.id, { dependencyTaskId: event.target.value || null })} className="outlook-input">
                <option value="">None</option>
                {dependencyOptions.map((option) => <option key={option.id} value={option.id}>{option.title || "Untitled task"}</option>)}
              </select>
            </label>
            <label className="block min-w-0">
              <span className="outlook-label">Status</span>
              <select value={task.status} onChange={(event) => onUpdateTask(task.id, { status: event.target.value as OutlookTask["status"] })} className="outlook-input">
                {(Object.keys(STATUS_LABELS) as Array<OutlookTask["status"]>).map((status) => (
                  <option key={status} value={status}>{STATUS_LABELS[status]}</option>
                ))}
              </select>
            </label>
          </div>

          {notes.length > 0 && (
            <ul className="space-y-1">
              {notes.map((note, index) => (
                <li key={index} className="flex items-start gap-1.5 text-[10px] leading-4 text-amber-100/72">
                  <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0 text-amber-300/70" strokeWidth={1.8} />
                  {note}
                </li>
              ))}
            </ul>
          )}

          <button type="button" onClick={() => onRemove(task.id)} className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground/55 transition-colors hover:text-orange-200/80">
            <Trash2 className="h-3 w-3" strokeWidth={1.8} />
            Discard this suggestion
          </button>
        </div>
      )}
    </div>
  )
}

/** Per-field provenance chip: where the value came from. */
const PROVENANCE_META: Record<FieldSource, { text: string; cls: string }> = {
  text: { text: "note", cls: "border-emerald-400/25 bg-emerald-400/[0.08] text-emerald-200/85" },
  chip: { text: "chips", cls: "border-[var(--directory-job-border)] bg-[var(--directory-job-soft)] text-[var(--directory-job)]" },
  review: { text: "review", cls: "border-amber-400/30 bg-amber-400/[0.08] text-amber-200/85" },
}

function ProvenanceTag({ label, source }: { label: string; source: FieldSource }) {
  const meta = PROVENANCE_META[source]
  return (
    <span className={cn("inline-flex items-center rounded-full border px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wide", meta.cls)}>
      {label} · {meta.text}
    </span>
  )
}
