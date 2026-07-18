"use client"

import { useMemo, useState } from "react"
import { createPortal } from "react-dom"
import { Building2, CalendarDays, Check, ChevronDown, Clock, Link2, Search, Wrench, X } from "lucide-react"
import { formatOutlookDate, type OutlookTask } from "@/lib/outlook-core"
import type { OutlookContextDefaults } from "@/features/outlooks/ai/normalize-outlook-suggestions"
import { cn } from "@/lib/utils"

/**
 * Optional AI-context chips for the Quick Update compose card.
 *
 * These are hints, never required fields: each chip pins a default the parser
 * applies ONLY to fields the note leaves empty — anything explicit in the text
 * always wins. Company/dependency reuse real Directory records/tasks. Tapping a
 * chip opens a bottom-sheet selector; an active chip shows its value and can be
 * removed. Self-contained so it can drop into the compose card without touching
 * the note/voice surface.
 */

type ChipField = "startDate" | "trade" | "company" | "duration" | "dependency"

const DEFAULT_FIELDS: ChipField[] = ["startDate", "trade", "company"]
const MORE_FIELDS: ChipField[] = ["duration", "dependency"]

const CHIP_META: Record<ChipField, { label: string; icon: typeof CalendarDays }> = {
  startDate: { label: "Start date", icon: CalendarDays },
  trade: { label: "Trade", icon: Wrench },
  company: { label: "Company", icon: Building2 },
  duration: { label: "Duration", icon: Clock },
  dependency: { label: "Dependency", icon: Link2 },
}

const COMMON_TRADES = [
  "Concrete", "Framing", "Electrical", "Plumbing", "HVAC", "Drywall",
  "Roofing", "Painting", "Masonry", "Flooring", "Demolition", "Site work",
]

const DURATION_PRESETS = [1, 2, 3, 5, 7, 10, 14, 21]

export function OutlookContextChips({
  companies,
  existingTasks,
  contextDefaults,
  onContextDefaultsChange,
}: {
  companies: Array<{ id: string; name: string }>
  existingTasks: OutlookTask[]
  contextDefaults: OutlookContextDefaults
  onContextDefaultsChange: (next: OutlookContextDefaults) => void
}) {
  const [openField, setOpenField] = useState<ChipField | null>(null)
  const [showMore, setShowMore] = useState(false)

  const chipValue = (field: ChipField): string | null => {
    switch (field) {
      case "startDate":
        return contextDefaults.startDate ? formatOutlookDate(contextDefaults.startDate) : null
      case "duration":
        return contextDefaults.durationDays ? `${contextDefaults.durationDays} day${contextDefaults.durationDays === 1 ? "" : "s"}` : null
      case "trade":
        return contextDefaults.trade?.trim() || null
      case "company":
        return contextDefaults.companyName?.trim() || null
      case "dependency":
        return contextDefaults.dependencyTaskId
          ? existingTasks.find((task) => task.id === contextDefaults.dependencyTaskId)?.title ?? "Linked task"
          : null
    }
  }

  const clearField = (field: ChipField) => {
    const next = { ...contextDefaults }
    if (field === "startDate") next.startDate = null
    if (field === "duration") next.durationDays = null
    if (field === "trade") next.trade = null
    if (field === "company") { next.companyName = null; next.companyContextId = null }
    if (field === "dependency") next.dependencyTaskId = null
    onContextDefaultsChange(next)
  }

  const visibleMoreFields = MORE_FIELDS.filter((field) => showMore || chipValue(field) !== null)
  const hiddenMoreCount = MORE_FIELDS.length - visibleMoreFields.length

  return (
    <div className="flex flex-wrap gap-1.5">
      {[...DEFAULT_FIELDS, ...visibleMoreFields].map((field) => (
        <ContextChip
          key={field}
          field={field}
          value={chipValue(field)}
          onOpen={() => setOpenField(field)}
          onRemove={() => clearField(field)}
        />
      ))}
      {hiddenMoreCount > 0 && (
        <button
          type="button"
          onClick={() => setShowMore(true)}
          className="flex items-center gap-1 rounded-xl border border-white/[0.09] bg-white/[0.025] px-2.5 py-2 text-[10px] font-medium text-muted-foreground/70 transition-[border-color,color,transform] hover:border-white/[0.16] hover:text-foreground/85 active:scale-[0.97]"
        >
          <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.8} />
          More context
        </button>
      )}

      {openField && (
        <ChipSelectorSheet
          field={openField}
          defaults={contextDefaults}
          companies={companies}
          existingTasks={existingTasks}
          onApply={(next) => {
            onContextDefaultsChange(next)
            setOpenField(null)
          }}
          onClose={() => setOpenField(null)}
        />
      )}
    </div>
  )
}

/** Inactive chip shows the label; active chip shows the selected value + remove. */
function ContextChip({
  field,
  value,
  onOpen,
  onRemove,
}: {
  field: ChipField
  value: string | null
  onOpen: () => void
  onRemove: () => void
}) {
  const Icon = CHIP_META[field].icon
  if (value) {
    return (
      <span className="flex items-center gap-1.5 rounded-xl border border-[var(--directory-job-border)] bg-[var(--directory-job-soft)] py-1.5 pl-2.5 pr-1 text-[10px] font-semibold text-[var(--directory-job)]">
        <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
        <button type="button" onClick={onOpen} className="max-w-[9rem] truncate active:opacity-70">{value}</button>
        <button
          type="button"
          onClick={onRemove}
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[var(--directory-job)]/70 transition-colors hover:bg-white/10 hover:text-[var(--directory-job)]"
          aria-label={`Remove ${CHIP_META[field].label}`}
        >
          <X className="h-3 w-3" strokeWidth={2.2} />
        </button>
      </span>
    )
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex items-center gap-1.5 rounded-xl border border-white/[0.09] bg-white/[0.025] px-2.5 py-2 text-[10px] font-medium text-muted-foreground/70 transition-[border-color,color,transform] hover:border-white/[0.16] hover:text-foreground/85 active:scale-[0.97]"
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={1.8} />
      {CHIP_META[field].label}
    </button>
  )
}

/** Bottom-sheet selector, portalled to escape any transformed ancestor (same
 *  pattern as the review modal) so it overlays the whole screen. */
function ChipSelectorSheet({
  field,
  defaults,
  companies,
  existingTasks,
  onApply,
  onClose,
}: {
  field: ChipField
  defaults: OutlookContextDefaults
  companies: Array<{ id: string; name: string }>
  existingTasks: OutlookTask[]
  onApply: (next: OutlookContextDefaults) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState("")
  const Icon = CHIP_META[field].icon

  const filteredCompanies = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (q ? companies.filter((company) => company.name.toLowerCase().includes(q)) : companies).slice(0, 60)
  }, [companies, query])

  const filteredTasks = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (q ? existingTasks.filter((task) => task.title.toLowerCase().includes(q)) : existingTasks).slice(0, 60)
  }, [existingTasks, query])

  if (typeof document === "undefined") return null
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end bg-[#04070b]/72 backdrop-blur-sm" role="dialog" aria-modal="true">
      <button type="button" className="absolute inset-0" onClick={onClose} aria-label="Close selector" />
      <section className="directory-glass-screen relative z-[1] flex max-h-[80dvh] w-full flex-col overflow-hidden rounded-t-[1.75rem] border-t border-white/[0.11] pb-[max(1rem,var(--sab))] shadow-[0_-18px_48px_rgba(1,5,12,0.5)] animate-slide-up">
        <div className="mx-auto mt-3 h-1 w-10 shrink-0 rounded-full bg-white/15" aria-hidden="true" />
        <header className="flex items-center gap-2.5 px-4 pb-3 pt-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-[var(--directory-job-border)] bg-[var(--directory-job-soft)] text-[var(--directory-job)]">
            <Icon className="h-4 w-4" strokeWidth={1.8} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-foreground/90">{CHIP_META[field].label}</h2>
            <p className="text-[10px] text-muted-foreground/50">Optional — the note overrides this.</p>
          </div>
          <button type="button" onClick={onClose} className="glass-button flex h-8 w-8 items-center justify-center rounded-full border active:scale-[0.94]" aria-label="Close">
            <X className="h-3.5 w-3.5" strokeWidth={1.8} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-2">
          {field === "startDate" && (
            <input
              type="date"
              defaultValue={defaults.startDate ?? ""}
              onChange={(event) => onApply({ ...defaults, startDate: event.target.value || null })}
              className="outlook-input"
              autoFocus
            />
          )}

          {field === "duration" && (
            <div className="grid grid-cols-4 gap-2">
              {DURATION_PRESETS.map((days) => (
                <button
                  key={days}
                  type="button"
                  onClick={() => onApply({ ...defaults, durationDays: days })}
                  className={cn(
                    "flex flex-col items-center rounded-xl border py-2.5 text-[13px] font-semibold transition-transform active:scale-[0.97]",
                    defaults.durationDays === days
                      ? "border-[var(--directory-job-border)] bg-[var(--directory-job-soft)] text-[var(--directory-job)]"
                      : "border-white/[0.09] bg-white/[0.02] text-foreground/80 hover:border-white/20",
                  )}
                >
                  {days}
                  <span className="text-[8px] font-medium uppercase tracking-wide text-muted-foreground/50">day{days === 1 ? "" : "s"}</span>
                </button>
              ))}
            </div>
          )}

          {field === "trade" && (
            <div className="space-y-3">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Type a trade…"
                className="outlook-input"
                autoFocus
              />
              <div className="flex flex-wrap gap-1.5">
                {(query.trim() ? [query.trim(), ...COMMON_TRADES] : COMMON_TRADES)
                  .filter((trade, index, all) => all.findIndex((entry) => entry.toLowerCase() === trade.toLowerCase()) === index)
                  .filter((trade) => trade.toLowerCase().includes(query.trim().toLowerCase()))
                  .slice(0, 14)
                  .map((trade) => (
                    <button
                      key={trade}
                      type="button"
                      onClick={() => onApply({ ...defaults, trade })}
                      className={cn(
                        "rounded-full border px-3 py-1.5 text-[12px] font-medium transition-transform active:scale-[0.97]",
                        defaults.trade?.trim().toLowerCase() === trade.toLowerCase()
                          ? "border-[var(--directory-job-border)] bg-[var(--directory-job-soft)] text-[var(--directory-job)]"
                          : "border-white/[0.09] bg-white/[0.02] text-foreground/80 hover:border-white/20",
                      )}
                    >
                      {trade}
                    </button>
                  ))}
              </div>
            </div>
          )}

          {field === "company" && (
            <SelectorSearchList
              query={query}
              onQuery={setQuery}
              placeholder="Search companies…"
              emptyLabel="No matching companies."
              items={filteredCompanies.map((company) => ({
                id: company.id,
                title: company.name,
                selected: defaults.companyContextId === company.id || defaults.companyName?.trim().toLowerCase() === company.name.trim().toLowerCase(),
                onSelect: () => onApply({ ...defaults, companyName: company.name, companyContextId: company.id }),
              }))}
            />
          )}

          {field === "dependency" && (
            <SelectorSearchList
              query={query}
              onQuery={setQuery}
              placeholder="Search existing tasks…"
              emptyLabel="No existing tasks to depend on yet."
              items={filteredTasks.map((task) => ({
                id: task.id,
                title: task.title || "Untitled task",
                selected: defaults.dependencyTaskId === task.id,
                onSelect: () => onApply({ ...defaults, dependencyTaskId: task.id }),
              }))}
            />
          )}
        </div>
      </section>
    </div>,
    document.body,
  )
}

function SelectorSearchList({
  query,
  onQuery,
  placeholder,
  emptyLabel,
  items,
}: {
  query: string
  onQuery: (value: string) => void
  placeholder: string
  emptyLabel: string
  items: Array<{ id: string; title: string; selected: boolean; onSelect: () => void }>
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 rounded-xl border border-white/[0.09] bg-white/[0.02] px-3">
        <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" strokeWidth={1.8} />
        <input
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder={placeholder}
          className="w-full bg-transparent py-2.5 text-[13px] text-foreground/90 outline-none placeholder:text-muted-foreground/40"
          autoFocus
        />
      </div>
      {items.length === 0 ? (
        <p className="px-1 py-3 text-center text-[11px] text-muted-foreground/50">{emptyLabel}</p>
      ) : (
        <div className="flex flex-col">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={item.onSelect}
              className="flex items-center gap-2 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-white/[0.04] active:bg-white/[0.06]"
            >
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground/85">{item.title}</span>
              {item.selected && <Check className="h-4 w-4 shrink-0 text-[var(--directory-job)]" strokeWidth={2.2} />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
