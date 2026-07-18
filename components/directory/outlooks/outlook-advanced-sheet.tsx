"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { ArrowDown, ArrowUp, Check, ChevronDown, ChevronUp, FileText, Loader2, Minus, Plus, Send, Trash2, X } from "lucide-react"
import { createOutlookTask, formatOutlookDate, formatOutlookRange, type OutlookTask, type OutlookTaskStatus, type OutlookWindow } from "@/lib/outlook-core"
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

const STATUS_OPTIONS: Array<{ value: OutlookTaskStatus; label: string }> = [
  { value: "not_started", label: "Planned" },
  { value: "in_progress", label: "In progress" },
  { value: "blocked", label: "Blocked" },
  { value: "complete", label: "Complete" },
]

const MIN_DURATION = 1
const MAX_DURATION = 90

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function snapshot(tasks: OutlookTask[]): string {
  return JSON.stringify(tasks)
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
  const [dirty, setDirty] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  // Local text state for the expanded task's duration input so the field can be
  // cleared and retyped freely instead of snapping to 1 on every keystroke.
  const [durationText, setDurationText] = useState("")
  const companyNames = useMemo(() => companies.map((company) => company.name), [companies])

  const draftsRef = useRef(drafts)
  const lastSavedRef = useRef(snapshot(tasks))
  const busyRef = useRef(false)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { draftsRef.current = drafts }, [drafts])
  useEffect(() => { setDirty(snapshot(drafts) !== lastSavedRef.current) }, [drafts])
  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current) }, [])

  // Seed the duration text whenever a different task is expanded.
  useEffect(() => {
    const task = draftsRef.current.find((entry) => entry.id === expandedId)
    setDurationText(task ? String(task.durationDays) : "")
  }, [expandedId])

  const update = (id: string, patch: Partial<OutlookTask>) => {
    setDrafts((current) => current.map((task) => task.id === id ? { ...task, ...patch } : task))
  }

  const stepDuration = (task: OutlookTask, delta: number) => {
    const next = clamp(task.durationDays + delta, MIN_DURATION, MAX_DURATION)
    update(task.id, { durationDays: next })
    setDurationText(String(next))
  }

  const commitDurationText = (id: string) => {
    const value = durationText === "" ? MIN_DURATION : clamp(Number(durationText), MIN_DURATION, MAX_DURATION)
    update(id, { durationDays: value })
    setDurationText(String(value))
  }

  const runSave = async (): Promise<boolean> => {
    if (busyRef.current) return false
    const list = draftsRef.current
    busyRef.current = true
    setBusyAction("save")
    setError("")
    try {
      await onSave(list)
      lastSavedRef.current = snapshot(list)
      setDirty(false)
      setSavedFlash(true)
      if (flashTimer.current) clearTimeout(flashTimer.current)
      flashTimer.current = setTimeout(() => setSavedFlash(false), 1800)
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : "The outlook could not be saved.")
      return false
    } finally {
      busyRef.current = false
      setBusyAction(null)
    }
  }

  const runPdf = async () => {
    if (busyRef.current) return
    busyRef.current = true
    setBusyAction("pdf")
    setError("")
    try {
      await onGeneratePdf(draftsRef.current)
      lastSavedRef.current = snapshot(draftsRef.current)
      setDirty(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "The PDF could not be generated.")
    } finally {
      busyRef.current = false
      setBusyAction(null)
    }
  }

  // Never lose edits: closing persists any unsaved changes first.
  const handleClose = async () => {
    if (dirty && !busyRef.current) {
      const ok = await runSave()
      if (!ok) return
    }
    onClose()
  }

  const addTask = () => {
    const next = createOutlookTask({ sortOrder: drafts.length, startDate: window.start })
    setDrafts((current) => [...current, next])
    setExpandedId(next.id)
  }

  const removeTask = (id: string) => {
    setDrafts((current) => current.filter((entry) => entry.id !== id).map((entry, sortOrder) => ({ ...entry, sortOrder })))
    if (expandedId === id) setExpandedId(null)
  }

  const busy = busyAction !== null || saving
  const saveLabel = busyAction === "save"
    ? "Saving…"
    : savedFlash
      ? "Saved"
      : dirty
        ? "Save"
        : "Saved"

  return (
    <div
      className="directory-glass-screen !fixed inset-0 z-40 flex min-h-0 flex-col overflow-hidden animate-slide-in-right"
      role="dialog"
      aria-modal="true"
      aria-labelledby="outlook-advanced-title"
    >
      <header className="glass-panel app-topbar flex shrink-0 items-center gap-3 border-b px-4">
        <button type="button" onClick={() => void handleClose()} className="glass-button flex h-9 w-9 items-center justify-center rounded-full border active:scale-[0.96]" aria-label="Close advanced outlook">
          <X className="h-4 w-4" strokeWidth={1.8} />
        </button>
        <div className="min-w-0 flex-1">
          <h2 id="outlook-advanced-title" className="truncate text-sm font-semibold">Edit outlook</h2>
          <p className="truncate text-[10px] text-muted-foreground/55">{jobName} · {formatOutlookRange(window)}</p>
        </div>
        <button
          type="button"
          onClick={() => void runSave()}
          disabled={busy || (!dirty && !savedFlash)}
          className={cn(
            "flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold transition-colors active:scale-[0.97] disabled:active:scale-100",
            dirty && busyAction !== "save"
              ? "bg-[var(--directory-job)] text-white shadow-[0_4px_14px_rgba(124,92,255,0.35)]"
              : "bg-[var(--directory-job-soft)] text-[var(--directory-job)] disabled:opacity-45",
          )}
        >
          {busyAction === "save" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : savedFlash ? <Check className="h-3.5 w-3.5" /> : null}
          {saveLabel}
        </button>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto scrollbar-hide">
        <div className="mx-auto w-full max-w-3xl px-4 pb-40 pt-4 md:px-6">
          {error && <p className="mb-4 rounded-xl border border-orange-400/25 bg-orange-400/[0.07] px-3.5 py-3 text-xs leading-5 text-orange-100/85" role="alert">{error}</p>}

          <div className="mb-3 flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/55">{drafts.length} task{drafts.length === 1 ? "" : "s"}</p>
            <span className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-medium",
              dirty ? "bg-amber-400/10 text-amber-200/85" : "bg-emerald-400/10 text-emerald-200/80",
            )}>
              <span className={cn("h-1.5 w-1.5 rounded-full", dirty ? "bg-amber-300 animate-pulse" : "bg-emerald-300")} />
              {dirty ? "Unsaved changes" : "All changes saved"}
            </span>
          </div>

          {drafts.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/12 px-4 py-10 text-center">
              <p className="text-sm text-muted-foreground/70">No tasks yet.</p>
              <p className="mt-1 text-xs text-muted-foreground/45">Add the first scheduled activity below.</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {drafts.map((task, index) => {
                const expanded = expandedId === task.id
                return (
                  <section key={task.id} className="overflow-hidden rounded-2xl border border-white/[0.09] bg-[#0b111a]/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                    <button type="button" onClick={() => setExpandedId(expanded ? null : task.id)} className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-white/[0.025]">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--directory-job-soft)] text-[10px] font-bold text-[var(--directory-job)]">{index + 1}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-foreground/90">{task.title || "Untitled task"}</span>
                        <span className="mt-0.5 block truncate text-[10px] text-muted-foreground/55">
                          {task.startDate ? formatOutlookDate(task.startDate) : "No date"} · {task.durationDays} day{task.durationDays === 1 ? "" : "s"} · {statusShort(task.status)}
                        </span>
                      </span>
                      <span className={cn("h-2 w-2 shrink-0 rounded-full", statusDot(task.status))} />
                      {expanded ? <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground/50" /> : <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground/50" />}
                    </button>

                    {expanded && (
                      <div className="border-t border-white/[0.07] px-4 pb-4 pt-4">
                        <div className="space-y-4">
                          <Field label="Task">
                            <input value={task.title} onChange={(event) => update(task.id, { title: event.target.value })} placeholder="ADA ramp" className="outlook-input" />
                          </Field>
                          <Field label="Description">
                            <textarea value={task.description} onChange={(event) => update(task.id, { description: event.target.value })} rows={2} placeholder="Optional details…" className="outlook-input resize-none" />
                          </Field>

                          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <Field label="Start date">
                              <input
                                type="date"
                                value={task.startDate ?? ""}
                                min={window.start}
                                max={window.end}
                                onChange={(event) => update(task.id, { startDate: event.target.value || null, ...(event.target.value ? { dependencyTaskId: null } : {}) })}
                                disabled={Boolean(task.dependencyTaskId)}
                                className="outlook-input disabled:opacity-45"
                              />
                            </Field>
                            <Field label="Duration">
                              <div className="flex items-center gap-2">
                                <button type="button" onClick={() => stepDuration(task, -1)} disabled={task.durationDays <= MIN_DURATION} className="glass-button flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border active:scale-[0.95] disabled:opacity-30" aria-label="Decrease duration">
                                  <Minus className="h-4 w-4" />
                                </button>
                                <input
                                  inputMode="numeric"
                                  value={durationText}
                                  onChange={(event) => {
                                    const value = event.target.value.replace(/[^0-9]/g, "")
                                    setDurationText(value)
                                    if (value !== "") update(task.id, { durationDays: clamp(Number(value), MIN_DURATION, MAX_DURATION) })
                                  }}
                                  onBlur={() => commitDurationText(task.id)}
                                  className="outlook-input min-w-0 flex-1 text-center"
                                  aria-label="Duration in days"
                                />
                                <button type="button" onClick={() => stepDuration(task, 1)} disabled={task.durationDays >= MAX_DURATION} className="glass-button flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border active:scale-[0.95] disabled:opacity-30" aria-label="Increase duration">
                                  <Plus className="h-4 w-4" />
                                </button>
                                <span className="w-8 shrink-0 text-xs text-muted-foreground/55">day{task.durationDays === 1 ? "" : "s"}</span>
                              </div>
                            </Field>
                            <Field label="Trade">
                              <input value={task.trade} onChange={(event) => update(task.id, { trade: event.target.value })} placeholder="Concrete, MEP…" className="outlook-input" />
                            </Field>
                            <Field label="Company">
                              <input list="outlook-company-options" value={task.companyName} onChange={(event) => {
                                const match = companies.find((company) => company.name === event.target.value)
                                update(task.id, { companyName: event.target.value, companyContextId: match?.id ?? null })
                              }} placeholder="74 Construction" className="outlook-input" />
                            </Field>
                          </div>

                          <Field label="Depends on">
                            <select value={task.dependencyTaskId ?? ""} onChange={(event) => update(task.id, { dependencyTaskId: event.target.value || null, ...(event.target.value ? { startDate: null } : {}) })} className="outlook-input">
                              <option value="">Nothing — starts on its own date</option>
                              {drafts.filter((candidate) => candidate.id !== task.id).map((candidate) => <option key={candidate.id} value={candidate.id}>After: {candidate.title || "Untitled task"}</option>)}
                            </select>
                          </Field>

                          <Field label="Status">
                            <div className="grid grid-cols-2 gap-1.5">
                              {STATUS_OPTIONS.map((option) => (
                                <button
                                  key={option.value}
                                  type="button"
                                  onClick={() => update(task.id, { status: option.value })}
                                  className={cn(
                                    "rounded-lg border px-2 py-2.5 text-xs font-medium transition-colors active:scale-[0.98]",
                                    task.status === option.value
                                      ? "border-[var(--directory-job)]/50 bg-[var(--directory-job-soft)] text-[var(--directory-job)]"
                                      : "border-white/10 text-muted-foreground/70 active:bg-white/5",
                                  )}
                                >
                                  {option.label}
                                </button>
                              ))}
                            </div>
                          </Field>

                          <Field label={`Completion — ${task.completionPercent}%`}>
                            <input type="range" min={0} max={100} step={5} value={task.completionPercent} onChange={(event) => update(task.id, { completionPercent: Number(event.target.value) })} className="w-full accent-[var(--directory-job)]" />
                          </Field>
                        </div>

                        <div className="mt-4 flex items-center justify-between border-t border-white/[0.06] pt-3">
                          <button type="button" onClick={() => removeTask(task.id)} className="flex items-center gap-1.5 text-xs text-red-300/70 active:opacity-60">
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
          )}

          <button type="button" onClick={addTask} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-white/[0.14] py-3.5 text-xs font-medium text-muted-foreground/70 active:scale-[0.99] active:bg-white/[0.02]">
            <Plus className="h-4 w-4" /> Add task
          </button>
          <datalist id="outlook-company-options">{companyNames.map((name) => <option key={name} value={name} />)}</datalist>
        </div>
      </main>

      <footer className="glass-panel safe-area-pb shrink-0 border-t px-3 pt-2">
        <div className="mx-auto grid w-full max-w-3xl grid-cols-2 gap-2 pb-2">
          <button type="button" onClick={() => void runPdf()} disabled={busy || drafts.length === 0} className="glass-button flex items-center justify-center gap-1.5 rounded-xl border py-3 text-xs font-semibold active:scale-[0.98] disabled:opacity-40">
            {busyAction === "pdf" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
            {busyAction === "pdf" ? "Generating…" : "Generate PDF"}
          </button>
          <button type="button" onClick={onPostUpdate} disabled={!canPostUpdate || busy} className="flex items-center justify-center gap-1.5 rounded-xl border border-[var(--directory-job)]/30 bg-[var(--directory-job-soft)] py-3 text-xs font-semibold text-[var(--directory-job)] active:scale-[0.98] disabled:opacity-35">
            <Send className="h-3.5 w-3.5" /> Post update
          </button>
        </div>
      </footer>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/50">{label}</span>
      {children}
    </label>
  )
}

function statusShort(status: OutlookTaskStatus): string {
  switch (status) {
    case "in_progress": return "In progress"
    case "blocked": return "Blocked"
    case "complete": return "Complete"
    default: return "Planned"
  }
}

function statusDot(status: OutlookTaskStatus): string {
  switch (status) {
    case "in_progress": return "bg-amber-400"
    case "blocked": return "bg-red-400"
    case "complete": return "bg-emerald-400"
    default: return "bg-sky-400/70"
  }
}
