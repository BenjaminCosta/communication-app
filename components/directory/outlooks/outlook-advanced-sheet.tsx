"use client"

import { useMemo, useState } from "react"
import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, FileText, Plus, Send, Trash2, X } from "lucide-react"
import { createOutlookTask, formatOutlookRange, taskStatusLabel, type OutlookTask, type OutlookWindow } from "@/lib/outlook-core"
import { cn } from "@/lib/utils"

interface OutlookAdvancedSheetProps {
  jobName: string
  window: OutlookWindow
  tasks: OutlookTask[]
  companies: Array<{ id: string; name: string }>
  saving: boolean
  onClose: () => void
  onSave: (tasks: OutlookTask[]) => Promise<void>
  onGeneratePdf: (tasks: OutlookTask[]) => Promise<void>
  onPostUpdate: () => void
  canPostUpdate: boolean
}

function reorder(tasks: OutlookTask[], index: number, direction: -1 | 1): OutlookTask[] {
  const target = index + direction
  if (target < 0 || target >= tasks.length) return tasks
  const next = [...tasks]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next.map((task, sortOrder) => ({ ...task, sortOrder }))
}

export function OutlookAdvancedSheet({
  jobName,
  window,
  tasks,
  companies,
  saving,
  onClose,
  onSave,
  onGeneratePdf,
  onPostUpdate,
  canPostUpdate,
}: OutlookAdvancedSheetProps) {
  const [drafts, setDrafts] = useState(tasks)
  const [expandedId, setExpandedId] = useState<string | null>(tasks[0]?.id ?? null)
  const [busyAction, setBusyAction] = useState<"save" | "pdf" | null>(null)
  const [error, setError] = useState("")
  const companyNames = useMemo(() => companies.map((company) => company.name), [companies])

  const update = (id: string, patch: Partial<OutlookTask>) => {
    setDrafts((current) => current.map((task) => task.id === id ? { ...task, ...patch } : task))
  }

  const run = async (kind: "save" | "pdf") => {
    if (busyAction || saving) return
    setBusyAction(kind)
    setError("")
    try {
      if (kind === "save") await onSave(drafts)
      else await onGeneratePdf(drafts)
      if (kind === "save") onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : "The outlook could not be updated.")
    } finally {
      setBusyAction(null)
    }
  }

  return (
    <div
      className="directory-glass-screen !fixed inset-0 z-40 flex min-h-0 flex-col overflow-hidden animate-slide-in-right"
      role="dialog"
      aria-modal="true"
      aria-labelledby="outlook-advanced-title"
    >
      <header className="glass-panel app-topbar flex shrink-0 items-center gap-3 border-b px-4">
        <button type="button" onClick={onClose} className="glass-button flex h-9 w-9 items-center justify-center rounded-full border active:scale-[0.96]" aria-label="Close advanced outlook">
          <X className="h-4 w-4" strokeWidth={1.8} />
        </button>
        <div className="min-w-0 flex-1">
          <h2 id="outlook-advanced-title" className="truncate text-sm font-semibold">3-Week Outlook</h2>
          <p className="truncate text-[10px] text-muted-foreground/55">{jobName} · {formatOutlookRange(window)}</p>
        </div>
        <button type="button" onClick={() => void run("save")} disabled={Boolean(busyAction) || saving} className="rounded-full bg-[var(--directory-job-soft)] px-3.5 py-1.5 text-xs font-semibold text-[var(--directory-job)] active:scale-[0.97] disabled:opacity-45">
          {busyAction === "save" || saving ? "Saving…" : "Save"}
        </button>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto scrollbar-hide">
        <div className="mx-auto w-full max-w-3xl px-4 pb-32 pt-5 md:px-6">
          {error && <p className="mb-4 rounded-xl border border-orange-400/25 bg-orange-400/[0.07] px-3.5 py-3 text-xs leading-5 text-orange-100/85" role="alert">{error}</p>}
          <div className="space-y-3">
            {drafts.map((task, index) => {
              const expanded = expandedId === task.id
              return (
                <section key={task.id} className="overflow-hidden rounded-2xl border border-white/[0.09] bg-[#0b111a]/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                  <button type="button" onClick={() => setExpandedId(expanded ? null : task.id)} className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-white/[0.025]">
                    <span className="h-8 w-0.5 shrink-0 rounded-full bg-[var(--directory-job)]" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground/90">{task.title || "Untitled task"}</span>
                      <span className="mt-0.5 block text-[10px] text-muted-foreground/55">{task.startDate || "No date"} · {task.durationDays} day{task.durationDays === 1 ? "" : "s"} · {taskStatusLabel(task.status)}</span>
                    </span>
                    {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground/50" /> : <ChevronDown className="h-4 w-4 text-muted-foreground/50" />}
                  </button>
                  {expanded && (
                    <div className="border-t border-white/[0.07] px-4 pb-4 pt-4">
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <Field label="Task" wide>
                          <input value={task.title} onChange={(event) => update(task.id, { title: event.target.value })} className="outlook-input" />
                        </Field>
                        <Field label="Description" wide>
                          <textarea value={task.description} onChange={(event) => update(task.id, { description: event.target.value })} rows={3} className="outlook-input resize-none" />
                        </Field>
                        <Field label="Trade">
                          <input value={task.trade} onChange={(event) => update(task.id, { trade: event.target.value })} className="outlook-input" placeholder="Concrete, MEP…" />
                        </Field>
                        <Field label="Company">
                          <input list="outlook-company-options" value={task.companyName} onChange={(event) => {
                            const match = companies.find((company) => company.name === event.target.value)
                            update(task.id, { companyName: event.target.value, companyContextId: match?.id ?? null })
                          }} className="outlook-input" />
                        </Field>
                        <Field label="Start date">
                          <input type="date" value={task.startDate ?? ""} onChange={(event) => update(task.id, { startDate: event.target.value || null })} className="outlook-input" />
                        </Field>
                        <Field label="Duration">
                          <input type="number" min={1} max={90} inputMode="numeric" value={task.durationDays} onChange={(event) => update(task.id, { durationDays: Math.max(1, Number(event.target.value) || 1) })} className="outlook-input" />
                        </Field>
                        <Field label="Dependency">
                          <select value={task.dependencyTaskId ?? ""} onChange={(event) => update(task.id, { dependencyTaskId: event.target.value || null, ...(event.target.value ? { startDate: null } : {}) })} className="outlook-input">
                            <option value="">None</option>
                            {drafts.filter((candidate) => candidate.id !== task.id).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.title || "Untitled task"}</option>)}
                          </select>
                        </Field>
                        <Field label="Status">
                          <select value={task.status} onChange={(event) => update(task.id, { status: event.target.value as OutlookTask["status"] })} className="outlook-input">
                            <option value="not_started">Planned</option>
                            <option value="in_progress">In progress</option>
                            <option value="blocked">Blocked</option>
                            <option value="complete">Complete</option>
                          </select>
                        </Field>
                        <Field label="Completion">
                          <div className="flex items-center gap-3">
                            <input type="range" min={0} max={100} step={5} value={task.completionPercent} onChange={(event) => update(task.id, { completionPercent: Number(event.target.value) })} className="min-w-0 flex-1 accent-violet-400" />
                            <span className="w-11 text-right font-mono text-xs text-foreground/70">{task.completionPercent}%</span>
                          </div>
                        </Field>
                      </div>
                      <div className="mt-4 flex items-center justify-between border-t border-white/[0.06] pt-3">
                        <button type="button" onClick={() => setDrafts((current) => current.filter((entry) => entry.id !== task.id).map((entry, order) => ({ ...entry, sortOrder: order })))} className="flex items-center gap-1.5 text-xs text-red-300/70 active:opacity-60">
                          <Trash2 className="h-3.5 w-3.5" /> Delete
                        </button>
                        <div className="flex gap-1.5">
                          <button type="button" onClick={() => setDrafts((current) => reorder(current, index, -1))} disabled={index === 0} className="glass-button flex h-8 w-8 items-center justify-center rounded-lg border disabled:opacity-25" aria-label="Move task up"><ArrowUp className="h-3.5 w-3.5" /></button>
                          <button type="button" onClick={() => setDrafts((current) => reorder(current, index, 1))} disabled={index === drafts.length - 1} className="glass-button flex h-8 w-8 items-center justify-center rounded-lg border disabled:opacity-25" aria-label="Move task down"><ArrowDown className="h-3.5 w-3.5" /></button>
                        </div>
                      </div>
                    </div>
                  )}
                </section>
              )
            })}
          </div>
          <button type="button" onClick={() => {
            const next = createOutlookTask({ sortOrder: drafts.length, startDate: window.start })
            setDrafts((current) => [...current, next])
            setExpandedId(next.id)
          }} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-white/[0.12] py-3 text-xs font-medium text-muted-foreground/70 active:scale-[0.99]">
            <Plus className="h-4 w-4" /> Add task
          </button>
          <datalist id="outlook-company-options">{companyNames.map((name) => <option key={name} value={name} />)}</datalist>
        </div>
      </main>

      <footer className="glass-panel safe-area-pb shrink-0 border-t px-3 pt-2">
        <div className="mx-auto grid w-full max-w-3xl grid-cols-3 gap-2 pb-2">
          <button type="button" onClick={() => void run("save")} disabled={Boolean(busyAction) || saving} className="glass-button rounded-xl border py-2.5 text-xs font-medium active:scale-[0.98] disabled:opacity-40">Save</button>
          <button type="button" onClick={() => void run("pdf")} disabled={Boolean(busyAction) || saving || drafts.length === 0} className="glass-button flex items-center justify-center gap-1.5 rounded-xl border py-2.5 text-xs font-medium active:scale-[0.98] disabled:opacity-40"><FileText className="h-3.5 w-3.5" /> PDF</button>
          <button type="button" onClick={onPostUpdate} disabled={!canPostUpdate || Boolean(busyAction)} className="flex items-center justify-center gap-1.5 rounded-xl border border-violet-400/30 bg-violet-400/15 py-2.5 text-xs font-medium text-violet-200 active:scale-[0.98] disabled:opacity-35"><Send className="h-3.5 w-3.5" /> Post</button>
        </div>
      </footer>
    </div>
  )
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return <label className={cn("block", wide && "sm:col-span-2")}><span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/50">{label}</span>{children}</label>
}
