"use client"

import { useEffect, useMemo, useState } from "react"
import { formatDateInAppZone, isSameDayInAppZone } from "@/lib/datetime"
import { ArrowUpRight, CalendarDays, Clock3, FileText, ListTodo, Pencil, Save, Share2, SlidersHorizontal, Sparkles } from "lucide-react"
import { OutlookActionBar, type OutlookAction } from "@/components/directory/outlooks/outlook-action-bar"
import { OutlookAdvancedView } from "@/components/directory/outlooks/outlook-advanced-view"
import { OutlookAiCaptureSheet } from "@/components/directory/outlooks/outlook-ai-capture-sheet"
import { OutlookAiQuickUpdate } from "@/components/directory/outlooks/outlook-ai-quick-update"
import { OutlookInlinePreview } from "@/components/directory/outlooks/outlook-inline-preview"
import { OutlookPreviewView } from "@/components/directory/outlooks/outlook-preview-view"
import { OutlookQuickTaskSheet } from "@/components/directory/outlooks/outlook-quick-task-sheet"
import { OutlookTaskDetailSheet } from "@/components/directory/outlooks/outlook-task-detail-sheet"
import { OUTLOOK_AI_ENABLED } from "@/lib/ai/flags"
import { useJobOutlookController } from "@/features/outlooks/use-job-outlook-controller"
import {
  compareIsoDates,
  createOutlookTask,
  formatOutlookDate,
  formatOutlookRange,
  localDateToIso,
  scheduleOutlookTasks,
  type OutlookTask,
  type OutlookWindow,
} from "@/lib/outlook-core"
import type { JobProfileViewModel } from "@/lib/directory-view-models"
import { cn } from "@/lib/utils"

type OutlookScreenTab = "preview" | "advanced"

interface ThreeWeekOutlookTabProps {
  job: JobProfileViewModel
  userId: string
  companies?: Array<{ id: string; name: string }>
  mode?: "embedded" | "full"
  onSeeFullOutlook?: () => void
}

export function ThreeWeekOutlookTab({
  job,
  userId,
  companies = [],
  mode = "full",
  onSeeFullOutlook,
}: ThreeWeekOutlookTabProps) {
  const controller = useJobOutlookController({ job, userId })

  if (controller.loading) {
    return mode === "embedded" ? <EmbeddedOutlookSkeleton /> : <FullOutlookSkeleton />
  }

  if (mode === "embedded") {
    return (
      <EmbeddedOutlookPanel
        controller={controller}
        companies={companies}
        jobName={job.name}
        location={job.location}
        onSeeFullOutlook={onSeeFullOutlook}
      />
    )
  }

  return (
    <DedicatedOutlookScreen
      controller={controller}
      companies={companies}
      jobName={job.name}
      location={job.location}
    />
  )
}

type OutlookController = ReturnType<typeof useJobOutlookController>

function DedicatedOutlookScreen({
  controller,
  companies,
  jobName,
  location,
}: {
  controller: OutlookController
  companies: Array<{ id: string; name: string }>
  jobName: string
  location: string | null
}) {
  const {
    window,
    draft,
    tasks,
    scheduled,
    latestVersion,
    saving,
    publishing,
    error,
    notice,
    hasPdf,
    persist,
    selectWindowStart,
    viewLatestPdf,
    shareLatestPdf,
  } = controller
  const [activeTab, setActiveTab] = useState<OutlookScreenTab>("preview")
  const [quickUpdateOpen, setQuickUpdateOpen] = useState(false)
  const [aiCaptureOpen, setAiCaptureOpen] = useState(false)
  const [selectedTask, setSelectedTask] = useState<OutlookTask | null>(null)
  const [advancedFocusId, setAdvancedFocusId] = useState<string | null>(null)
  const [advancedDrafts, setAdvancedDrafts] = useState<OutlookTask[]>(scheduled.tasks)
  const [advancedDirty, setAdvancedDirty] = useState(false)
  const advancedScheduled = useMemo(() => scheduleOutlookTasks(advancedDrafts, window), [advancedDrafts, window])

  useEffect(() => {
    if (!advancedDirty) setAdvancedDrafts(scheduled.tasks)
  }, [advancedDirty, scheduled.tasks])

  useEffect(() => {
    setSelectedTask(null)
    setQuickUpdateOpen(false)
    setAiCaptureOpen(false)
    setAdvancedFocusId(null)
    setAdvancedDirty(false)
  }, [window.start])

  const addAiTasks = async (accepted: OutlookTask[]) => {
    if (accepted.length === 0) return
    await persist([...tasks, ...accepted], accepted.length === 1 ? "Task added." : `${accepted.length} tasks added.`)
  }

  const openAdvancedTask = (task: OutlookTask) => {
    setSelectedTask(null)
    setAdvancedFocusId(task.id)
    setActiveTab("advanced")
  }

  const saveAdvanced = async () => {
    await persist(advancedDrafts, "Advanced changes saved.")
    setAdvancedDirty(false)
  }

  const deleteAdvancedTask = async (id: string) => {
    const next = advancedDrafts.filter((task) => task.id !== id).map((task, sortOrder) => ({ ...task, sortOrder }))
    setAdvancedDrafts(next)
    await persist(next, "Task deleted.")
    setAdvancedDirty(false)
  }

  const addQuickTask = async (task: OutlookTask) => {
    await persist([...tasks, task], "Task added.")
    setQuickUpdateOpen(false)
  }

  const actions = buildActions({
    activeTab,
    saving,
    publishing,
    hasPdf,
    onQuickUpdate: () => setQuickUpdateOpen(true),
    onViewPdf: viewLatestPdf,
    onShare: () => void shareLatestPdf().catch(() => {}),
  })
  const visibleIssues = activeTab === "advanced" ? advancedScheduled.issues : scheduled.issues

  return (
    <div className="space-y-3">
      <OutlookMetrics
        updatedAt={draft?.updatedAt ?? latestVersion?.createdAt ?? null}
        window={window}
        tasks={scheduled.tasks}
        onStartDateChange={selectWindowStart}
      />

      <OutlookTabs active={activeTab} onChange={setActiveTab} />

      {OUTLOOK_AI_ENABLED && (
        <button
          type="button"
          onClick={() => setAiCaptureOpen(true)}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-[var(--directory-job-border)] bg-[var(--directory-job-soft)] px-4 py-2.5 text-[11px] font-semibold text-[var(--directory-job)] transition-[background-color,transform] active:scale-[0.98]"
        >
          <Sparkles className="h-3.5 w-3.5" strokeWidth={1.8} />
          Capture with AI
        </button>
      )}

      {latestVersion && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-400/15 bg-emerald-400/[0.045] px-3 py-2 text-[9px] text-emerald-100/72">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400/75" />
          Published version {latestVersion.versionNumber}
          <span className="ml-auto text-muted-foreground/48">{latestVersion.pdf ? "PDF posted to Comms" : "PDF publishing"}</span>
        </div>
      )}
      {error && <p className="rounded-xl border border-orange-400/25 bg-orange-400/[0.07] px-3.5 py-3 text-xs leading-5 text-orange-100/85" role="alert">{error}</p>}
      {notice && <p className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.055] px-3.5 py-2.5 text-xs text-emerald-100/80" role="status">{notice}</p>}
      {visibleIssues.length > 0 && (
        <div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.06] px-3 py-2.5 text-[10px] leading-4 text-amber-100/76">
          {visibleIssues.slice(0, 2).map((issue) => issue.message).join(" · ")}
        </div>
      )}

      {activeTab === "preview" && <OutlookPreviewView window={window} tasks={scheduled.tasks} onOpenTask={setSelectedTask} />}
      {activeTab === "advanced" && (
        <OutlookAdvancedView
          window={window}
          drafts={advancedDrafts}
          companies={companies}
          focusTaskId={advancedFocusId}
          saving={saving}
          dirty={advancedDirty}
          onChange={(next) => {
            setAdvancedDrafts(next)
            setAdvancedDirty(true)
          }}
          onSave={() => void saveAdvanced().catch(() => {})}
          onDeleteTask={(id) => void deleteAdvancedTask(id).catch(() => {})}
        />
      )}

      <OutlookActionBar actions={actions} />

      {quickUpdateOpen && (
        <OutlookQuickTaskSheet
          window={window}
          tasks={tasks}
          companies={companies}
          saving={saving}
          onClose={() => setQuickUpdateOpen(false)}
          onSave={addQuickTask}
        />
      )}
      {selectedTask && (
        <OutlookTaskDetailSheet
          task={selectedTask}
          tasks={scheduled.tasks}
          onClose={() => setSelectedTask(null)}
          onEdit={() => openAdvancedTask(selectedTask)}
        />
      )}
      {aiCaptureOpen && (
        <OutlookAiCaptureSheet
          window={window}
          companies={companies}
          existingTasks={tasks}
          jobName={jobName}
          location={location}
          saving={saving}
          onClose={() => setAiCaptureOpen(false)}
          onConfirm={addAiTasks}
          onManualFallback={() => {
            setAiCaptureOpen(false)
            setQuickUpdateOpen(true)
          }}
          onAdvanced={() => setActiveTab("advanced")}
        />
      )}
    </div>
  )
}

function OutlookTabs({ active, onChange }: { active: OutlookScreenTab; onChange: (tab: OutlookScreenTab) => void }) {
  const tabs: Array<{ id: OutlookScreenTab; label: string; icon: React.ReactNode }> = [
    { id: "preview", label: "Preview", icon: <CalendarDays className="size-3.5" strokeWidth={1.8} /> },
    { id: "advanced", label: "Advanced", icon: <SlidersHorizontal className="size-3.5" strokeWidth={1.8} /> },
  ]
  return (
    <nav className="grid grid-cols-2 rounded-xl border border-white/[0.08] bg-white/[0.025] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]" aria-label="Outlook views">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
          className={cn(
            "relative flex min-w-0 items-center justify-center gap-1.5 rounded-[9px] px-1.5 py-2.5 text-[10px] font-semibold transition-[background-color,color,transform] active:scale-[0.98] min-[380px]:text-[11px]",
            active === tab.id ? "bg-[var(--directory-job-soft)] text-[var(--directory-job)]" : "text-muted-foreground/58 hover:text-foreground/75",
          )}
          aria-current={active === tab.id ? "page" : undefined}
        >
          {tab.icon}<span className="truncate">{tab.label}</span>
          {active === tab.id && <span className="absolute inset-x-5 bottom-0 h-0.5 rounded-full bg-[var(--directory-job)]" />}
        </button>
      ))}
    </nav>
  )
}

function OutlookMetrics({
  updatedAt,
  window,
  tasks,
  onStartDateChange,
}: {
  updatedAt: Date | null
  window: OutlookWindow
  tasks: OutlookTask[]
  onStartDateChange: (value: string) => void
}) {
  const trades = new Set(tasks.map((task) => task.trade.trim() || task.companyName.trim()).filter(Boolean)).size
  return (
    <div className="space-y-2.5">
      <label className="flex min-h-12 items-center gap-3 rounded-xl border border-[var(--directory-job-border)] bg-[var(--directory-job-soft)] px-3 transition focus-within:border-[var(--directory-job)] focus-within:ring-2 focus-within:ring-violet-500/10">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-[var(--directory-job-border)] bg-white/[0.025] text-[var(--directory-job)]">
          <CalendarDays className="size-4" strokeWidth={1.8} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/55">Outlook starts</span>
          <span className="block truncate text-[10px] text-muted-foreground/70">Choose the exact first day</span>
        </span>
        <input
          type="date"
          value={window.start}
          onChange={(event) => onStartDateChange(event.target.value)}
          aria-label="Outlook start date"
          className="min-w-0 max-w-[9.5rem] cursor-pointer rounded-lg border border-white/10 bg-[#0b1119]/80 px-2.5 py-2 text-right font-mono text-[11px] font-semibold text-foreground/90 outline-none [color-scheme:dark] focus:border-[var(--directory-job-border)]"
        />
      </label>
      <div className="flex min-w-0 gap-1.5 overflow-x-auto scrollbar-hide">
        <Metric icon={<Clock3 className="h-3 w-3" strokeWidth={1.8} />} value={updatedLabel(updatedAt)} />
        <Metric icon={<CalendarDays className="h-3 w-3" strokeWidth={1.8} />} value={`Ends ${formatOutlookDate(window.end)}`} />
        <Metric icon={<ListTodo className="h-3 w-3" strokeWidth={1.8} />} value={`${tasks.length} tasks`} />
        <Metric value={`${trades} trades`} />
      </div>
    </div>
  )
}

function Metric({ icon, value }: { icon?: React.ReactNode; value: string }) {
  return <span className="flex shrink-0 items-center gap-1 rounded-md border border-white/[0.08] bg-white/[0.025] px-2 py-1.5 font-mono text-[8px] text-muted-foreground/62">{icon}{value}</span>
}

function updatedLabel(value: Date | null): string {
  if (!value) return "Not updated"
  return isSameDayInAppZone(value, new Date())
    ? "Updated today"
    : `Updated ${formatDateInAppZone(value, { month: "short", day: "numeric" })}`
}

function buildActions({
  activeTab,
  saving,
  publishing,
  hasPdf,
  onQuickUpdate,
  onViewPdf,
  onShare,
}: {
  activeTab: OutlookScreenTab
  saving: boolean
  publishing: boolean
  hasPdf: boolean
  onQuickUpdate: () => void
  onViewPdf: () => void
  onShare: () => void
}): OutlookAction[] {
  if (activeTab === "advanced") {
    return [
      { id: "view", label: "View PDF", icon: <FileText className="h-3.5 w-3.5" strokeWidth={1.8} />, onClick: onViewPdf, disabled: saving || publishing || !hasPdf },
      { id: "share", label: "Share", icon: <Share2 className="h-3.5 w-3.5" strokeWidth={1.8} />, onClick: onShare, disabled: saving || publishing || !hasPdf, tone: "accent" },
    ]
  }
  return [
    { id: "quick", label: "Quick update", icon: <Pencil className="h-3.5 w-3.5" strokeWidth={1.8} />, onClick: onQuickUpdate },
    { id: "view", label: "View PDF", icon: <FileText className="h-3.5 w-3.5" strokeWidth={1.8} />, onClick: onViewPdf, disabled: saving || publishing || !hasPdf },
    { id: "share", label: "Share", icon: <Share2 className="h-3.5 w-3.5" strokeWidth={1.8} />, onClick: onShare, disabled: saving || publishing || !hasPdf, tone: "accent" },
  ]
}

function EmbeddedOutlookPanel({
  controller,
  companies,
  jobName,
  location,
  onSeeFullOutlook,
}: {
  controller: OutlookController
  companies: Array<{ id: string; name: string }>
  jobName: string
  location: string | null
  onSeeFullOutlook?: () => void
}) {
  const { window, tasks, scheduled, latestVersion, saving, error, notice, persist } = controller
  const [view, setView] = useState<"preview" | "quick">("preview")
  const [manualOpen, setManualOpen] = useState(false)
  const trades = new Set(scheduled.tasks.map((task) => task.trade.trim() || task.companyName.trim()).filter(Boolean)).size

  const addAiTasks = async (accepted: OutlookTask[]) => {
    if (accepted.length === 0) return
    await persist([...tasks, ...accepted], accepted.length === 1 ? "Task added." : `${accepted.length} tasks added.`)
    setView("preview")
  }

  return (
    <section className="animate-fade-up overflow-hidden rounded-2xl border border-[var(--directory-job-border)] bg-[#0a111b]/78 p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.055)] sm:p-4" aria-label="3-Week Outlook summary">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--directory-job-border)] bg-[var(--directory-job-soft)] text-[var(--directory-job)]"><CalendarDays className="h-5 w-5" strokeWidth={1.7} /></div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold tracking-tight text-foreground/92">3-Week Outlook</h2>
            <span className="rounded-full border border-emerald-400/20 bg-emerald-400/[0.07] px-2 py-0.5 text-[8px] font-semibold uppercase text-emerald-200/75">{latestVersion ? `Version ${latestVersion.versionNumber}` : tasks.length ? "Draft" : "Ready"}</span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[9px] text-muted-foreground/58">
            <span>{formatOutlookRange(window)}</span><span className="h-3 w-px bg-white/10" aria-hidden="true" /><span>{tasks.length} tasks</span><span className="h-3 w-px bg-white/10" aria-hidden="true" /><span>{trades} trades</span>
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 rounded-xl border border-white/[0.08] bg-white/[0.025] p-1" role="group" aria-label="Outlook panel view">
        {(["preview", "quick"] as const).map((entry) => (
          <button key={entry} type="button" onClick={() => setView(entry)} className={cn("rounded-[9px] border px-2 py-2.5 text-[11px] font-semibold transition-[background-color,border-color,color,transform] active:scale-[0.98]", view === entry ? "border-[var(--directory-job-border)] bg-[var(--directory-job-soft)] text-[var(--directory-job)]" : "border-transparent text-muted-foreground/60 hover:text-foreground/75")} aria-pressed={view === entry}>{entry === "preview" ? "Preview" : "Quick Update"}</button>
        ))}
      </div>

      {error && <p className="mt-3 rounded-xl border border-orange-400/25 bg-orange-400/[0.07] px-3 py-2.5 text-[11px] leading-5 text-orange-100/85" role="alert">{error}</p>}
      {notice && <p className="mt-3 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.055] px-3 py-2.5 text-[11px] text-emerald-100/80" role="status">{notice}</p>}
      <div className="mt-3">
        {view === "preview" ? (
          <OutlookInlinePreview window={window} tasks={scheduled.tasks} />
        ) : OUTLOOK_AI_ENABLED && !manualOpen ? (
          <OutlookAiQuickUpdate
            window={window}
            companies={companies}
            existingTasks={tasks}
            jobName={jobName}
            location={location}
            saving={saving}
            onConfirm={addAiTasks}
            onManualFallback={() => setManualOpen(true)}
            onAdvanced={onSeeFullOutlook}
          />
        ) : (
          <div className="space-y-3">
            {OUTLOOK_AI_ENABLED && (
              <button
                type="button"
                onClick={() => setManualOpen(false)}
                className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--directory-job)] transition-opacity active:opacity-60"
              >
                <Sparkles className="h-3.5 w-3.5" strokeWidth={1.8} />
                Back to AI capture
              </button>
            )}
            <EmbeddedQuickForm
              window={window}
              tasks={tasks}
              companies={companies}
              saving={saving}
              onSave={async (task) => {
                await persist([...tasks, task], "Task added.")
                setManualOpen(false)
                setView("preview")
              }}
            />
          </div>
        )}
      </div>
      <button type="button" onClick={onSeeFullOutlook} className="glass-button mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-white/[0.1] px-4 py-2.5 text-[11px] font-semibold text-[var(--directory-job)] transition-[border-color,background-color,transform] hover:border-[var(--directory-job-border)] hover:bg-[var(--directory-job-soft)] active:scale-[0.98]">See full outlook<ArrowUpRight className="h-3.5 w-3.5" strokeWidth={1.8} /></button>
    </section>
  )
}

function EmbeddedQuickForm({
  window,
  tasks,
  companies,
  saving,
  onSave,
}: {
  window: OutlookWindow
  tasks: OutlookTask[]
  companies: Array<{ id: string; name: string }>
  saving: boolean
  onSave: (task: OutlookTask) => Promise<void>
}) {
  const [title, setTitle] = useState("")
  const [startDate, setStartDate] = useState(() => defaultTaskDate(window))
  const [durationDays, setDurationDays] = useState(1)
  const [trade, setTrade] = useState("")
  const [companyName, setCompanyName] = useState("")
  const [showMore, setShowMore] = useState(false)
  const companyOptions = useMemo(() => companies.map((company) => company.name), [companies])

  const submit = async () => {
    const company = companies.find((candidate) => candidate.name === companyName.trim())
    await onSave(createOutlookTask({
      sortOrder: tasks.length,
      title,
      startDate,
      durationDays,
      trade,
      companyName,
      companyContextId: company?.id ?? null,
    }))
  }

  return (
    <div className="rounded-xl border border-white/[0.08] bg-[#080e16]/62 p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
      <label className="block min-w-0"><span className="outlook-label">Task name</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="ADA ramp" className="outlook-input" /></label>
      <div className="mt-3 grid grid-cols-1 gap-3 min-[440px]:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <label className="block min-w-0"><span className="outlook-label">Start date</span><input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="outlook-input" /></label>
        <label className="block min-w-0"><span className="outlook-label">Duration</span><select value={durationDays} onChange={(event) => setDurationDays(Number(event.target.value))} className="outlook-input">{Array.from({ length: 14 }, (_, index) => index + 1).map((days) => <option key={days} value={days}>{days} day{days === 1 ? "" : "s"}</option>)}</select></label>
      </div>
      <button type="button" onClick={() => setShowMore((value) => !value)} className="mt-3 text-[10px] font-medium text-[var(--directory-job)] active:opacity-60">{showMore ? "Hide optional details" : "Add trade and company"}</button>
      {showMore && <div className="mt-3 grid grid-cols-1 gap-3 border-t border-white/[0.06] pt-3 min-[440px]:grid-cols-2"><label className="block min-w-0"><span className="outlook-label">Trade</span><input value={trade} onChange={(event) => setTrade(event.target.value)} className="outlook-input" /></label><label className="block min-w-0"><span className="outlook-label">Company</span><input list="embedded-company-options" value={companyName} onChange={(event) => setCompanyName(event.target.value)} className="outlook-input" /></label></div>}
      <button type="button" onClick={() => void submit().catch(() => {})} disabled={saving || !title.trim() || !startDate} className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[var(--directory-job)] py-2.5 text-[11px] font-semibold text-[#0b0f14] shadow-[inset_0_1px_0_rgba(255,255,255,0.22)] transition-[opacity,transform] active:scale-[0.98] disabled:opacity-35"><Save className="h-3.5 w-3.5" strokeWidth={1.8} />{saving ? "Saving..." : "Add task"}</button>
      <datalist id="embedded-company-options">{companyOptions.map((name) => <option key={name} value={name} />)}</datalist>
    </div>
  )
}

function defaultTaskDate(window: OutlookWindow): string {
  const today = localDateToIso(new Date())
  return compareIsoDates(today, window.start) >= 0 && compareIsoDates(today, window.end) <= 0 ? today : window.start
}

function FullOutlookSkeleton() {
  return <div className="space-y-3 animate-pulse"><div className="h-8 rounded-lg bg-white/[0.045]" /><div className="h-10 rounded-xl bg-white/[0.05]" /><div className="h-80 rounded-2xl bg-white/[0.04]" /></div>
}

function EmbeddedOutlookSkeleton() {
  return <div className="animate-pulse rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4"><div className="flex gap-3"><div className="h-10 w-10 rounded-xl bg-white/[0.06]" /><div className="flex-1 space-y-2"><div className="h-4 w-40 rounded bg-white/[0.06]" /><div className="h-3 w-56 rounded bg-white/[0.04]" /></div></div><div className="mt-4 h-9 rounded-xl bg-white/[0.045]" /><div className="mt-3 h-52 rounded-xl bg-white/[0.04]" /></div>
}
