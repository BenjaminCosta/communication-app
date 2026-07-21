"use client"

import { Fragment, useMemo, useState, type ReactNode } from "react"
import { Briefcase, Building2, Info, ShieldCheck, Users } from "lucide-react"
import { DirectoryResultRow } from "@/components/directory/directory-result-row"
import { DIRECTORY_ENTITY_META, type DirectoryListItem } from "@/lib/directory-config"
import type { DirectoryAnswer } from "@/features/directory/ai/client/use-directory-ask"

const DEFAULT_VISIBLE = 3

/**
 * Renders a Directory answer: the written response first (with light entity
 * highlights), then "Based on" source chips, then supporting record cards
 * grouped by People / Companies / Jobs. Tapping a card opens that profile.
 */
export function DirectoryAskAnswer({
  answer,
  onOpenDetail,
}: {
  answer: DirectoryAnswer
  onOpenDetail: (id: string) => void
}) {
  const highlighted = useMemo(() => highlightAnswer(answer.text, answer.items), [answer.text, answer.items])

  const people = answer.items.filter((item) => item.type === "person")
  const companies = answer.items.filter((item) => item.type === "company")
  const jobs = answer.items.filter((item) => item.type === "job")

  const sourceCounts = useMemo(() => {
    const source = answer.sources.length ? answer.sources : answer.items
    return {
      company: source.filter((item) => item.type === "company").length,
      job: source.filter((item) => item.type === "job").length,
      person: source.filter((item) => item.type === "person").length,
    }
  }, [answer.sources, answer.items])

  return (
    <div className="flex flex-col gap-6">
      <p className="text-[17px] leading-[1.7] tracking-[-0.01em] text-foreground/95">{highlighted}</p>

      {!answer.notFound && (sourceCounts.company > 0 || sourceCounts.job > 0 || sourceCounts.person > 0) && (
        <div>
          <p className="mb-3 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground/65">
            <ShieldCheck className="h-3.5 w-3.5 text-[var(--directory-company)]" strokeWidth={1.8} />
            Grounded in SVC Directory data
            <ConfidenceBadge confidence={answer.confidence} />
          </p>
          <span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground/45">Sources</span>
          <div className="flex flex-wrap gap-2">
            {sourceCounts.company > 0 && <SourceChip icon={<Building2 className="h-3.5 w-3.5" strokeWidth={1.8} />} label="Companies" count={sourceCounts.company} type="company" />}
            {sourceCounts.job > 0 && <SourceChip icon={<Briefcase className="h-3.5 w-3.5" strokeWidth={1.8} />} label="Jobs" count={sourceCounts.job} type="job" />}
            {sourceCounts.person > 0 && <SourceChip icon={<Users className="h-3.5 w-3.5" strokeWidth={1.8} />} label="Contacts" count={sourceCounts.person} type="person" />}
          </div>
        </div>
      )}

      {answer.limitations.length > 0 && (
        <section className="rounded-2xl border border-white/7 bg-white/2 px-4 py-3" aria-label="Answer limitations">
          <span className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/45">
            <Info className="h-3.5 w-3.5" strokeWidth={1.8} />
            Good to know
          </span>
          <ul className="flex flex-col gap-1">
            {answer.limitations.map((limitation) => (
              <li key={limitation} className="text-[13px] leading-relaxed text-muted-foreground/75">{limitation}</li>
            ))}
          </ul>
        </section>
      )}

      <CardSection id="ask-results-job" title="Jobs" items={jobs} onOpenDetail={onOpenDetail} />
      <CardSection id="ask-results-person" title="People" items={people} onOpenDetail={onOpenDetail} />
      <CardSection id="ask-results-company" title="Companies" items={companies} onOpenDetail={onOpenDetail} />
    </div>
  )
}

const CONFIDENCE_META: Record<DirectoryAnswer["confidence"], { label: string; color: string }> = {
  high: { label: "High confidence", color: "var(--directory-company)" },
  medium: { label: "Medium confidence", color: "var(--directory-person)" },
  low: { label: "Low confidence", color: "var(--muted-foreground)" },
}

/** Signals how much the answer leans on inference or thin data. */
function ConfidenceBadge({ confidence }: { confidence: DirectoryAnswer["confidence"] }) {
  const meta = CONFIDENCE_META[confidence]
  return (
    <span className="flex items-center gap-1 text-xs" style={{ color: meta.color }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: meta.color }} aria-hidden="true" />
      {meta.label}
    </span>
  )
}

function SourceChip({
  icon,
  label,
  count,
  type,
}: {
  icon: ReactNode
  label: string
  count: number
  type: "person" | "company" | "job"
}) {
  const meta = DIRECTORY_ENTITY_META[type]
  return (
    <button
      type="button"
      onClick={() => document.getElementById(`ask-results-${type}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}
      className="directory-ask-chip flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-transform active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--directory-ai)]/70"
      aria-label={`View ${count} ${label.toLowerCase()} used in this answer`}
      style={{ color: meta.color, background: meta.softBackground, borderColor: meta.border }}
    >
      {icon}
      {label}
      <span className="tabular-nums opacity-80">{count}</span>
    </button>
  )
}

function CardSection({
  id,
  title,
  items,
  onOpenDetail,
}: {
  id: string
  title: string
  items: DirectoryListItem[]
  onOpenDetail: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  if (items.length === 0) return null
  const visible = expanded ? items : items.slice(0, DEFAULT_VISIBLE)
  return (
    <section id={id} className="scroll-mt-4">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-[13px] font-medium text-foreground/80">
          {title} <span className="text-muted-foreground/50">({items.length})</span>
        </h3>
        {items.length > DEFAULT_VISIBLE && (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="text-xs font-medium text-[var(--directory-ai)] transition-colors hover:text-[var(--directory-company)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--directory-ai)]/70"
          >
            {expanded ? "Show less" : "View all"}
          </button>
        )}
      </div>
      <div className="directory-ask-evidence overflow-hidden rounded-2xl border p-1">
        {visible.map((item) => (
          <DirectoryResultRow key={item.id} item={item} onSelect={(selected) => onOpenDetail(selected.id)} compact showChevron className="directory-ask-evidence-row" />
        ))}
      </div>
    </section>
  )
}

// ── Answer highlighting ──────────────────────────────────────────────────────

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * Wrap standalone counts and exact record names inside the answer text with a
 * single Directory accent. Purely presentational and deterministic — it
 * never changes the wording, only how it reads.
 */
function highlightAnswer(text: string, items: DirectoryListItem[]): ReactNode {
  const nameType = new Map<string, DirectoryListItem["type"]>()
  for (const item of items) {
    if (item.name.trim().length >= 3) nameType.set(item.name.trim(), item.type)
  }
  const names = [...nameType.keys()].sort((a, b) => b.length - a.length)
  const alternation = names.map(escapeRegExp).join("|")
  const pattern = new RegExp(`(${alternation ? `${alternation}|` : ""}\\b\\d+\\b)`, "gi")
  const parts = text.split(pattern)

  return parts.map((part, index) => {
    if (!part) return null
    if (/^\d+$/.test(part)) {
      return <span key={index} className="directory-ask-hl">{part}</span>
    }
    const lower = part.toLowerCase()
    const matchKey = names.find((name) => name.toLowerCase() === lower)
    if (matchKey) {
      return <span key={index} className="directory-ask-hl">{part}</span>
    }
    return <Fragment key={index}>{part}</Fragment>
  })
}
