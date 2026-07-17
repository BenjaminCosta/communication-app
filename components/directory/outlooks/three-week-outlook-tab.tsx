"use client"

import { useEffect, useMemo, useState } from "react"
import { ArrowUpRight, CalendarDays, Clock3, FileText, ListTodo, Pencil, Save, Send } from "lucide-react"
import { OutlookActionBar, type OutlookAction } from "@/components/directory/outlooks/outlook-action-bar"
import { OutlookAdvancedView } from "@/components/directory/outlooks/outlook-advanced-view"
import { OutlookInlinePreview } from "@/components/directory/outlooks/outlook-inline-preview"
import { OutlookPreviewView } from "@/components/directory/outlooks/outlook-preview-view"
import { OutlookQuickTaskSheet } from "@/components/directory/outlooks/outlook-quick-task-sheet"
import { OutlookTaskDetailSheet } from "@/components/directory/outlooks/outlook-task-detail-sheet"
import { OutlookTasksView } from "@/components/directory/outlooks/outlook-tasks-view"
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

export type { OutlookPostPayload } from "@/features/outlooks/use-job-outlook-controller"
import type { OutlookPostPayload } from "@/features/outlooks/use-job-outlook-controller"

type OutlookScreenTab = "preview" | "tasks" | "advanced"

interface ThreeWeekOutlookTabProps {
  job: JobProfileViewModel
  userId: string
  companies?: Array<{ id: string; name: string }>
  onPostUpdate?: (payload: OutlookPostPayload) => void
  mode?: "embedded" | "full"
  onSeeFullOutlook?: () => void
}

export function ThreeWeekOutlookTab({
  job,
  userId,
  companies = [],
  onPostUpdate,
  mode = "full",
  onSeeFullOutlook,
}: ThreeWeekOutlookTabProps) {
  const controller = useJobOutlookController({ job, userId, onPostUpdate })

  if (controller.loading) {
    return mode === "embedded" ? <EmbeddedOutlookSkeleton /> : <FullOutlookSkeleton />
  }

  if (mode === "embedded") {
    return (
      <EmbeddedOutlookPanel
        controller={controller}
        companies={companies}
        onSeeFullOutlook={onSeeFullOutlook}
      />
    )
  }

  return <DedicatedOutlookScreen controller={controller} companies={companies} />
}

type OutlookController = ReturnType<typeof useJobOutlookController>

function DedicatedOutlookScreen({
  controller,
  companies,
}: {
  controller: OutlookController
  companies: Array<{ id: string; name: string }>
}) {
  const {
    window,
    draft,
    tasks,
    scheduled,
    latestVersion,
    saving,
    generatingPdf,
    error,
    notice,
    canPostUpdate,
    persist,
    selectWindowStart,
    generatePdf,
    postLatestVersion,
  } = controller
  const [activeTab, setActiveTab] = useState<OutlookScreenTab>("preview")
  const [quickUpdateOpen, setQuickUpdateOpen] = useState(false)
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
    setAdvancedFocusId(null)
    setAdvancedDirty(false)
  }, [window.start])

  const openAdvancedTask = (task: OutlookTask) => {
    setSelectedTask(null)
    setAdvancedFocusId(task.id)
    setActiveTab("advanced")
  }

  const saveAdvanced = async () => {
    await persist(advancedDrafts, "Advanced changes saved.")
    setAdvancedDirty(false)
  }

  const addQuickTask = async (task: OutlookTask) => {
    await persist([...tasks, task], "Task added.")
    setQuickUpdateOpen(false)
  }

  const actions = buildActions({
    activeTab,
    saving,
    generatingPdf,
    canPublish: activeTab === "advanced" ? advancedScheduled.canPublish : scheduled.canPublish,
    canPostUpdate,
    onQuickUpdate: () => setQuickUpdateOpen(true),
    onPreview: () => setActiveTab("preview"),
    onSave: () => void saveAdvanced().catch(() => {}),
    onGeneratePdf: () => void generatePdf(activeTab === "advanced" ? advancedDrafts : scheduled.tasks).catch(() => {}),
    onPostUpdate: postLatestVersion,
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

      {latestVersion && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-400/15 bg-emerald-400/[0.045] px-3 py-2 text-[9px] text-emerald-100/72">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400/75" />
          Published version {latestVersion.versionNumber}
          <span className="ml-auto text-muted-foreground/48">{latestVersion.pdf ? "PDF ready" : "PDF can be regenerated"}</span>
        </div>
      )}
      {error && <p className="rounded-xl border border-orange-400/25 bg-orange-400/[0.07] px-3.5 py-3 text-xs leading-5 text-orange-100/85" role="alert">{error}</p>}
      {notice && <p className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.055] px-3.5 py-2.5 text-xs text-emerald-100/80" role="status">{notice}</p>}
      {visibleIssues.length > 0 && (
        <div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.06] px-3 py-2.5 text-[10px] leading-4 text-amber-100/76">
          {visibleIssues.slice(0, 2).map((issue) => issue.message).join(" · ")}
        </div>
      )}

      {activeTab === "preview" && <OutlookPreviewView window={window} tasks={scheduled.tasks} />}
      {activeTab === "tasks" && (
        <OutlookTasksView tasks={scheduled.tasks} onAddTask={() => setQuickUpdateOpen(true)} onOpenTask={setSelectedTask} />
      )}
      {activeTab === "advanced" && (
        <OutlookAdvancedView
          window={window}
          drafts={advancedDrafts}
          companies={companies}
          focusTaskId={advancedFocusId}
          onChange={(next) => {
            setAdvancedDrafts(next)
            setAdvancedDirty(true)
          }}
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
    </div>
  )
}

function OutlookTabs({ active, onChange }: { active: OutlookScreenTab; onChange: (tab: OutlookScreenTab) => void }) {
  const tabs: Array<{ id: OutlookScreenTab; label: string }> = [
    { id: "preview", label: "Preview" },
    { id: "tasks", label: "Tasks" },
    { id: "advanced", label: "Advanced" },
  ]
  return (
    <nav className="grid grid-cols-3 rounded-xl border border-white/[0.07] bg-white/[0.035] p-0.5" aria-label="Outlook views">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
          className={cn(
            "relative rounded-[10px] px-2 py-2.5 text-[11px] font-semibold transition-[background-color,color,transform] active:scale-[0.98]",
            active === tab.id ? "bg-white/[0.045] text-foreground/88" : "text-muted-foreground/58",
          )}
          aria-current={active === tab.id ? "page" : undefined}
        >
          {tab.label}
          {active === tab.id && <span className="absolute inset-x-5 bottom-0 h-0.5 rounded-full bg-violet-400" />}
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
      <label className="flex min-h-12 items-center gap-3 rounded-xl border border-violet-400/25 bg-violet-500/[0.07] px-3 transition focus-within:border-violet-400/55 focus-within:ring-2 focus-within:ring-violet-500/15">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-violet-400/20 bg-violet-500/10 text-violet-300">
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
          className="min-w-0 max-w-[9.5rem] cursor-pointer rounded-lg border border-white/10 bg-black/25 px-2.5 py-2 text-right font-mono text-[11px] font-semibold text-foreground/90 outline-none [color-scheme:dark] focus:border-violet-400/50"
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
  const today = new Date()
  return value.toDateString() === today.toDateString()
    ? "Updated today"
    : `Updated ${value.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
}

function buildActions({
  activeTab,
  saving,
  generatingPdf,
  canPublish,
  canPostUpdate,
  onQuickUpdate,
  onPreview,
  onSave,
  onGeneratePdf,
  onPostUpdate,
}: {
  activeTab: OutlookScreenTab
  saving: boolean
  generatingPdf: boolean
  canPublish: boolean
  canPostUpdate: boolean
  onQuickUpdate: () => void
  onPreview: () => void
  onSave: () => void
  onGeneratePdf: () => void
  onPostUpdate: () => void
}): OutlookAction[] {
  if (activeTab === "tasks") {
    return [
      { id: "quick", label: "Quick update", icon: <Pencil className="h-3.5 w-3.5" strokeWidth={1.8} />, onClick: onQuickUpdate, tone: "accent" },
      { id: "preview", label: "Preview calendar", icon: <CalendarDays className="h-3.5 w-3.5" strokeWidth={1.8} />, onClick: onPreview },
    ]
  }
  if (activeTab === "advanced") {
    return [
      { id: "save", label: saving ? "Saving..." : "Save", icon: <Save className="h-3.5 w-3.5" strokeWidth={1.8} />, onClick: onSave, disabled: saving || generatingPdf },
      { id: "pdf", label: generatingPdf ? "Generating..." : "Generate PDF", icon: <FileText className="h-3.5 w-3.5" strokeWidth={1.8} />, onClick: onGeneratePdf, disabled: saving || generatingPdf || !canPublish },
      { id: "post", label: "Post update", icon: <Send className="h-3.5 w-3.5" strokeWidth={1.8} />, onClick: onPostUpdate, disabled: !canPostUpdate || saving || generatingPdf, tone: "accent" },
    ]
  }
  return [
    { id: "quick", label: "Quick update", icon: <Pencil className="h-3.5 w-3.5" strokeWidth={1.8} />, onClick: onQuickUpdate, tone: "accent" },
    { id: "pdf", label: generatingPdf ? "Generating..." : "Generate PDF", icon: <FileText className="h-3.5 w-3.5" strokeWidth={1.8} />, onClick: onGeneratePdf, disabled: saving || generatingPdf || !canPublish },
    { id: "post", label: "Post update", icon: <Send className="h-3.5 w-3.5" strokeWidth={1.8} />, onClick: onPostUpdate, disabled: !canPostUpdate || saving || generatingPdf },
  ]
}

function EmbeddedOutlookPanel({
  controller,
  companies,
  onSeeFullOutlook,
}: {
  controller: OutlookController
  companies: Array<{ id: string; name: string }>
  onSeeFullOutlook?: () => void
}) {
  const { window, tasks, scheduled, latestVersion, saving, error, notice, persist } = controller
  const [view, setView] = useState<"preview" | "quick">("preview")
  const trades = new Set(scheduled.tasks.map((task) => task.trade.trim() || task.companyName.trim()).filter(Boolean)).size

  return (
    <section className="animate-fade-up rounded-2xl border border-violet-400/20 bg-[#0a111b]/78 p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.055)] sm:p-4" aria-label="3-Week Outlook summary">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-violet-400/25 bg-violet-400/10 text-violet-200"><CalendarDays className="h-5 w-5" strokeWidth={1.7} /></div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold tracking-tight text-foreground/92">3-Week Outlook</h2>
            <span className="rounded-full border border-emerald-400/20 bg-emerald-400/[0.07] px-2 py-0.5 text-[8px] font-semibold uppercase text-emerald-200/75">{latestVersion ? `Version ${latestVersion.versionNumber}` : tasks.length ? "Draft" : "Ready"}</span>
          </div>
          <p className="mt-1.5 font-mono text-[9px] text-muted-foreground/55">{formatOutlookRange(window)} · {tasks.length} tasks · {trades} trades</p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 rounded-xl border border-white/[0.08] bg-white/[0.025] p-0.5" role="group" aria-label="Outlook panel view">
        {(["preview", "quick"] as const).map((entry) => (
          <button key={entry} type="button" onClick={() => setView(entry)} className={cn("rounded-[10px] border px-3 py-2 text-[11px] font-medium active:scale-[0.98]", view === entry ? "border-violet-400/25 bg-violet-400/18 text-violet-100" : "border-transparent text-muted-foreground/65")} aria-pressed={view === entry}>{entry === "preview" ? "Preview" : "Quick Update"}</button>
        ))}
      </div>

      {error && <p className="mt-3 rounded-xl border border-orange-400/25 bg-orange-400/[0.07] px-3 py-2.5 text-[11px] leading-5 text-orange-100/85" role="alert">{error}</p>}
      {notice && <p className="mt-3 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.055] px-3 py-2.5 text-[11px] text-emerald-100/80" role="status">{notice}</p>}
      <div className="mt-3">
        {view === "preview" ? (
          <OutlookInlinePreview window={window} tasks={scheduled.tasks} />
        ) : (
          <EmbeddedQuickForm
            window={window}
            tasks={tasks}
            companies={companies}
            saving={saving}
            onSave={async (task) => {
              await persist([...tasks, task], "Task added.")
              setView("preview")
            }}
          />
        )}
      </div>
      <button type="button" onClick={onSeeFullOutlook} className="glass-button mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-white/[0.09] px-4 py-2.5 text-[11px] font-semibold text-violet-200/85 active:scale-[0.98]">See full outlook<ArrowUpRight className="h-3.5 w-3.5" strokeWidth={1.8} /></button>
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
    <div className="rounded-xl border border-violet-400/20 bg-[#080e16]/72 p-3.5">
      <label className="block"><span className="outlook-label">Task name</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="ADA ramp" className="outlook-input" /></label>
      <div className="mt-3 grid grid-cols-2 gap-2.5">
        <label className="block"><span className="outlook-label">Start date</span><input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="outlook-input" /></label>
        <label className="block"><span className="outlook-label">Duration</span><select value={durationDays} onChange={(event) => setDurationDays(Number(event.target.value))} className="outlook-input">{Array.from({ length: 14 }, (_, index) => index + 1).map((days) => <option key={days} value={days}>{days} day{days === 1 ? "" : "s"}</option>)}</select></label>
      </div>
      <button type="button" onClick={() => setShowMore((value) => !value)} className="mt-3 text-[10px] font-medium text-violet-200/72">{showMore ? "Hide optional details" : "Trade and company"}</button>
      {showMore && <div className="mt-3 grid grid-cols-2 gap-2.5 border-t border-white/[0.06] pt-3"><label className="block"><span className="outlook-label">Trade</span><input value={trade} onChange={(event) => setTrade(event.target.value)} className="outlook-input" /></label><label className="block"><span className="outlook-label">Company</span><input list="embedded-company-options" value={companyName} onChange={(event) => setCompanyName(event.target.value)} className="outlook-input" /></label></div>}
      <button type="button" onClick={() => void submit().catch(() => {})} disabled={saving || !title.trim() || !startDate} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-violet-500/80 py-2.5 text-[11px] font-semibold text-white active:scale-[0.98] disabled:opacity-40"><Save className="h-3.5 w-3.5" strokeWidth={1.8} />{saving ? "Saving..." : "Add task"}</button>
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
