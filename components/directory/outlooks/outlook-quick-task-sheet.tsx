"use client"

import { useState } from "react"
import { Plus, Save, X } from "lucide-react"
import { compareIsoDates, createOutlookTask, localDateToIso, type OutlookTask, type OutlookWindow } from "@/lib/outlook-core"

function defaultDate(window: OutlookWindow): string {
  const today = localDateToIso(new Date())
  return compareIsoDates(today, window.start) >= 0 && compareIsoDates(today, window.end) <= 0 ? today : window.start
}

export function OutlookQuickTaskSheet({
  window,
  tasks,
  companies,
  saving,
  onClose,
  onSave,
}: {
  window: OutlookWindow
  tasks: OutlookTask[]
  companies: Array<{ id: string; name: string }>
  saving: boolean
  onClose: () => void
  onSave: (task: OutlookTask) => Promise<void>
}) {
  const [title, setTitle] = useState("")
  const [startDate, setStartDate] = useState(() => defaultDate(window))
  const [durationDays, setDurationDays] = useState(1)
  const [trade, setTrade] = useState("")
  const [companyName, setCompanyName] = useState("")
  const [dependencyTaskId, setDependencyTaskId] = useState("")
  const [showMore, setShowMore] = useState(false)
  const [error, setError] = useState("")

  const submit = async () => {
    if (!title.trim()) {
      setError("Task name is required.")
      return
    }
    if (!startDate && !dependencyTaskId) {
      setError("Start date or dependency is required.")
      return
    }
    const company = companies.find((candidate) => candidate.name === companyName.trim())
    const task = createOutlookTask({
      sortOrder: tasks.length,
      title,
      startDate: dependencyTaskId ? null : startDate,
      durationDays,
      trade,
      companyName,
      companyContextId: company?.id ?? null,
      dependencyTaskId: dependencyTaskId || null,
    })
    setError("")
    await onSave(task)
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end bg-[#04070b]/72 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="quick-outlook-title">
      <button type="button" className="absolute inset-0" onClick={onClose} aria-label="Close quick update" />
      <section className="directory-glass-screen relative z-[1] max-h-[90dvh] w-full overflow-y-auto rounded-t-[1.75rem] border-t border-white/[0.11] px-4 pb-[max(1rem,var(--sab))] pt-4 shadow-[0_-18px_48px_rgba(1,5,12,0.5)] animate-slide-up">
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/15" aria-hidden="true" />
        <div className="mx-auto w-full max-w-xl">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--directory-job-border)] bg-[var(--directory-job-soft)] text-[var(--directory-job)]"><Plus className="h-4 w-4" strokeWidth={1.8} /></div>
            <div className="min-w-0 flex-1">
              <h2 id="quick-outlook-title" className="text-sm font-semibold text-foreground/90">Quick Update</h2>
              <p className="mt-0.5 text-[10px] text-muted-foreground/52">Add one scheduled activity to this outlook.</p>
            </div>
            <button type="button" onClick={onClose} className="glass-button flex h-9 w-9 items-center justify-center rounded-full border active:scale-[0.96]" aria-label="Close quick update"><X className="h-4 w-4" strokeWidth={1.8} /></button>
          </div>

          <div className="mt-5 space-y-4">
            <label className="block min-w-0"><span className="outlook-label">Task name</span><input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="ADA ramp" className="outlook-input" /></label>
            <div className="grid grid-cols-1 gap-3 min-[430px]:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
              <label className="block min-w-0"><span className="outlook-label">Start date</span><input type="date" value={startDate} onChange={(event) => { setStartDate(event.target.value); setDependencyTaskId("") }} disabled={Boolean(dependencyTaskId)} className="outlook-input disabled:opacity-45" /></label>
              <label className="block min-w-0"><span className="outlook-label">Duration</span><select value={durationDays} onChange={(event) => setDurationDays(Number(event.target.value))} className="outlook-input">{Array.from({ length: 14 }, (_, index) => index + 1).map((days) => <option key={days} value={days}>{days} day{days === 1 ? "" : "s"}</option>)}</select></label>
            </div>
            <button type="button" onClick={() => setShowMore((value) => !value)} className="text-xs font-medium text-[var(--directory-job)] active:opacity-60">{showMore ? "Hide optional details" : "Trade, company and dependency"}</button>
            {showMore && (
              <div className="grid grid-cols-1 gap-3 border-t border-white/[0.06] pt-4 min-[420px]:grid-cols-2">
                <label className="block min-w-0"><span className="outlook-label">Trade</span><input value={trade} onChange={(event) => setTrade(event.target.value)} placeholder="Concrete" className="outlook-input" /></label>
                <label className="block min-w-0"><span className="outlook-label">Company</span><input list="quick-sheet-company-options" value={companyName} onChange={(event) => setCompanyName(event.target.value)} placeholder="74 Construction" className="outlook-input" /></label>
                <label className="block min-w-0 min-[420px]:col-span-2"><span className="outlook-label">Dependency</span><select value={dependencyTaskId} onChange={(event) => { setDependencyTaskId(event.target.value); if (event.target.value) setStartDate("") }} className="outlook-input"><option value="">None</option>{tasks.map((task) => <option key={task.id} value={task.id}>{task.title || "Untitled task"}</option>)}</select></label>
              </div>
            )}
            {error && <p className="text-[10px] text-orange-200/80" role="alert">{error}</p>}
          </div>

          <button type="button" onClick={() => void submit().catch(() => {})} disabled={saving || !title.trim() || (!startDate && !dependencyTaskId)} className="mt-5 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[var(--directory-job)] py-3 text-xs font-semibold text-[#0b0f14] shadow-[inset_0_1px_0_rgba(255,255,255,0.22)] transition-[opacity,transform] active:scale-[0.98] disabled:opacity-40">
            <Save className="h-3.5 w-3.5" strokeWidth={1.8} />{saving ? "Saving..." : "Add task"}
          </button>
          <datalist id="quick-sheet-company-options">{companies.map((company) => <option key={company.id} value={company.name} />)}</datalist>
        </div>
      </section>
    </div>
  )
}
