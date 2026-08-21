"use client"

/**
 * Internal Applications dashboard — list view.
 *
 * No bottom navigation: the module switcher in the header is the only way
 * out, matching Communications and Directory.
 */

import { useEffect, useRef, useState } from "react"
import { ChevronDown, ExternalLink, Link2, Search, Share2, SlidersHorizontal, UserPlus, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { ModuleSwitcher } from "@/components/module-switcher"
import { AppsSheet } from "@/components/applications/ui/apps-sheet"
import { AppsButton, AppsCard } from "@/components/applications/ui/apps-primitives"
import { ApplicationCard } from "@/components/applications/dashboard/application-card"
import { ShareLinkSheet } from "@/components/applications/dashboard/share-link-sheet"
import { InviteCandidateSheet } from "@/components/applications/dashboard/invite-candidate-sheet"
import { useShareLink, NEW_APPLICATION_MARKER } from "@/features/applications/use-share-link"
import { TONE_STYLES } from "@/components/applications/ui/tone"
import {
  APPLICATION_STATUS_META,
  APPLICATION_STATUS_ORDER,
  emptyFilters,
  type ApplicationFilters,
  type ApplicationStatus,
} from "@/lib/applications-core"
import type { ApplicationsDashboard, ApplicationSort } from "@/features/applications/use-applications-dashboard"

type FilterKey = "status" | "jobId" | "more"

const SORT_LABEL: Record<ApplicationSort, string> = {
  newest: "Newest",
  oldest: "Oldest",
  progress: "Recently updated",
}

function FilterPill({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "applications-tap flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[0.8125rem] font-semibold",
        active
          ? "border-[#BFDBFE] bg-[var(--apps-blue-soft)] text-[var(--apps-blue-strong)]"
          : "border-[var(--apps-border)] bg-[var(--apps-surface)] text-[var(--apps-text-muted)]",
      )}
    >
      {label}
      <ChevronDown className="h-3.5 w-3.5" strokeWidth={2.5} />
    </button>
  )
}

function StatTile({ value, label, tone }: { value: number; label: string; tone: keyof typeof TONE_STYLES }) {
  return (
    <div className="applications-card flex min-w-[4.75rem] flex-1 flex-col items-center rounded-xl px-2 py-2.5">
      <span className={cn("text-lg font-bold leading-none tabular-nums", TONE_STYLES[tone].text)}>{value}</span>
      <span className="mt-1 text-center text-[0.625rem] font-medium leading-tight text-[var(--apps-text-muted)]">{label}</span>
    </div>
  )
}

interface ApplicationsListScreenProps {
  dashboard: ApplicationsDashboard
  className?: string
  /** Applied once when Courtney opens a specific Applications review queue. */
  initialStatusFilter?: ApplicationStatus
  onOpenApplication: (id: string) => void
  onSwitchToStream: () => void
  onSwitchToDirectory: () => void
  onSwitchToQuestCoral: () => void
  onSwitchToByeByeDpr: () => void
  onCourtneyRobertsCenter?: () => void
  onPreviewCandidateFlow: (token: string) => void
}

export function ApplicationsListScreen({
  dashboard,
  className,
  initialStatusFilter,
  onOpenApplication,
  onSwitchToStream,
  onSwitchToDirectory,
  onSwitchToQuestCoral,
  onSwitchToByeByeDpr,
  onCourtneyRobertsCenter,
  onPreviewCandidateFlow,
}: ApplicationsListScreenProps) {
  const { visibleApplications, counts, filters, setFilters, sort, setSort, jobs, trades } = dashboard
  const appliedDeepLinkStatusRef = useRef<ApplicationStatus | null>(null)
  const shareLink = useShareLink(dashboard.reviewer)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [openFilter, setOpenFilter] = useState<FilterKey | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)

  useEffect(() => {
    if (!initialStatusFilter || appliedDeepLinkStatusRef.current === initialStatusFilter) return
    appliedDeepLinkStatusRef.current = initialStatusFilter
    setFilters({ ...emptyFilters(), status: initialStatusFilter })
  }, [initialStatusFilter, setFilters])

  const setFilter = (patch: Partial<ApplicationFilters>) => setFilters({ ...filters, ...patch })
  const hasFilters = filters.status !== "all" || filters.jobId !== "all" || filters.trade !== "all" || !!filters.query.trim()

  const statusLabel = filters.status === "all" ? "All statuses" : APPLICATION_STATUS_META[filters.status].label
  const jobLabel = filters.jobId === "all" ? "All jobs" : jobs.find((job) => job.id === filters.jobId)?.name ?? "All jobs"

  return (
    <div className={cn("applications-scope applications-canvas relative flex min-h-0 flex-1 flex-col overflow-hidden", className)}>
      <header className="applications-topbar app-topbar flex shrink-0 items-center justify-between border-b px-4 animate-slide-down">
        <ModuleSwitcher
          activeModule="applications"
          showCourtneyRobertsCenter={Boolean(onCourtneyRobertsCenter)}
          onSelect={(module) => {
            if (module === "communications") onSwitchToStream()
            if (module === "directory") onSwitchToDirectory()
            if (module === "quest-coral") onSwitchToQuestCoral()
            if (module === "bye-bye-dpr") onSwitchToByeByeDpr()
            if (module === "courtney-roberts-center") onCourtneyRobertsCenter?.()
          }}
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSearchOpen((open) => !open)}
            className={cn(
              "applications-tap flex h-9 w-9 items-center justify-center rounded-full border",
              searchOpen || filters.query
                ? "border-[#BFDBFE] bg-[var(--apps-blue-soft)] text-[var(--apps-blue-strong)]"
                : "border-[var(--apps-border)] bg-[var(--apps-surface)] text-[var(--apps-text)]",
            )}
            aria-label="Search applications"
          >
            <Search className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-hide">
        <div className="mx-auto w-full max-w-2xl px-4 pb-10 pt-4 md:px-6">
          <h1 className="text-[1.5rem] font-bold leading-tight tracking-[-0.02em] text-[var(--apps-text)]">
            Applications
          </h1>
          <p className="mt-1 text-[0.8125rem] text-[var(--apps-text-muted)]">
            {visibleApplications.length} {visibleApplications.length === 1 ? "candidate" : "candidates"}
            {hasFilters ? " matching your filters" : " in the pipeline"}
          </p>

          {searchOpen && (
            <div className="applications-step-enter mt-3.5 flex items-center gap-2 rounded-xl border border-[var(--apps-border)] bg-[var(--apps-surface)] px-3.5 focus-within:border-[var(--apps-blue)] focus-within:shadow-[0_0_0_3px_rgba(37,99,235,0.14)]">
              <Search className="h-4 w-4 shrink-0 text-[var(--apps-text-muted)]" strokeWidth={2} />
              <input
                autoFocus
                value={filters.query}
                onChange={(event) => setFilter({ query: event.target.value })}
                placeholder="Search name, trade or job"
                className="h-11 min-w-0 flex-1 bg-transparent text-base text-[var(--apps-text)] outline-none placeholder:text-[#94A3B8]"
              />
              {filters.query && (
                <button
                  type="button"
                  onClick={() => setFilter({ query: "" })}
                  className="applications-tap flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--apps-text-muted)] hover:bg-[var(--apps-surface-2)]"
                  aria-label="Clear search"
                >
                  <X className="h-3.5 w-3.5" strokeWidth={2.5} />
                </button>
              )}
            </div>
          )}

          {/* Inviting someone new is the supervisor's most common action, so it
              sits above the pipeline instead of hiding in a menu. */}
          <button
            type="button"
            onClick={() => setInviteOpen(true)}
            className="applications-tap mt-3.5 flex w-full items-center gap-3 rounded-2xl border border-[#BFDBFE] bg-[var(--apps-blue-soft)]/45 px-4 py-3 text-left hover:bg-[var(--apps-blue-soft)]"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--apps-surface)] text-[var(--apps-blue-strong)]">
              <UserPlus className="h-4 w-4" strokeWidth={2} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-[var(--apps-text)]">Invite a candidate</span>
              <span className="mt-0.5 block text-xs text-[var(--apps-text-muted)]">
                Create a secure link and send it by text, WhatsApp or email.
              </span>
            </span>
            <Share2 className="h-4 w-4 shrink-0 text-[var(--apps-blue-strong)]" strokeWidth={2} />
          </button>

          <div className="mt-3.5 flex gap-2">
            <StatTile value={counts.newCount} label="New" tone="info" />
            <StatTile value={counts.needsReview} label="Needs review" tone="pending" />
            <StatTile value={counts.missingItems} label="Missing items" tone="missing" />
            <StatTile value={counts.approved} label="Approved" tone="complete" />
          </div>

          {/* Two filters inline — the rest live behind the icon so the row
              never scrolls out of reach on a phone. */}
          <div className="mt-3.5 flex items-center gap-2">
            <FilterPill label={statusLabel} active={filters.status !== "all"} onClick={() => setOpenFilter("status")} />
            <FilterPill label={jobLabel} active={filters.jobId !== "all"} onClick={() => setOpenFilter("jobId")} />
            <button
              type="button"
              onClick={() => setOpenFilter("more")}
              className={cn(
                "applications-tap ml-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-full border",
                filters.trade !== "all" || sort !== "newest"
                  ? "border-[#BFDBFE] bg-[var(--apps-blue-soft)] text-[var(--apps-blue-strong)]"
                  : "border-[var(--apps-border)] bg-[var(--apps-surface)] text-[var(--apps-text-muted)]",
              )}
              aria-label="More filters"
            >
              <SlidersHorizontal className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>

          {hasFilters && (
            <button
              type="button"
              onClick={() => setFilters(emptyFilters())}
              className="applications-tap mt-2.5 flex h-7 items-center gap-1 rounded-full px-1 text-xs font-semibold text-[var(--apps-blue-strong)]"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2.5} />
              Clear filters
            </button>
          )}

          <div className="mt-4 flex flex-col gap-2.5">
            {visibleApplications.map((application) => (
              // onOpen is passed by reference (id-based) so ApplicationCard's
              // memo holds — typing in search re-renders neither the surviving
              // cards nor recomputes their progress.
              <ApplicationCard key={application.id} application={application} onOpen={onOpenApplication} />
            ))}
          </div>

          {dashboard.isLoading && (
            <div className="mt-4 flex flex-col gap-2.5" aria-label="Loading applications">
              {[0, 1, 2].map((row) => (
                <div key={row} className="applications-card rounded-2xl p-4">
                  <div className="flex items-center gap-3">
                    <div className="h-11 w-11 shrink-0 animate-pulse rounded-full bg-[var(--apps-surface-2)]" />
                    <div className="flex-1">
                      <div className="h-3.5 w-32 animate-pulse rounded bg-[var(--apps-surface-2)]" />
                      <div className="mt-2 h-3 w-44 animate-pulse rounded bg-[var(--apps-surface-2)]" />
                    </div>
                  </div>
                  <div className="mt-3 h-1.5 w-full animate-pulse rounded-full bg-[var(--apps-surface-2)]" />
                </div>
              ))}
            </div>
          )}

          {dashboard.loadError && !dashboard.isLoading && (
            <AppsCard className="mt-4 border-[#FBD0D0] p-4" flat>
              <p className="text-sm font-semibold text-[#DC5A5A]">{dashboard.loadError}</p>
              <p className="mt-1 text-[0.8125rem] text-[var(--apps-text-muted)]">
                Applications is running against Firestore. Check the emulator or the security rules.
              </p>
            </AppsCard>
          )}

          {visibleApplications.length === 0 && !dashboard.isLoading && !dashboard.loadError && (
            <AppsCard className="mt-4 flex flex-col items-center px-6 py-10 text-center" flat>
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--apps-surface-2)]">
                <Search className="h-5 w-5 text-[var(--apps-text-muted)]" strokeWidth={2} />
              </span>
              <p className="mt-3 text-sm font-semibold text-[var(--apps-text)]">No applications match</p>
              <p className="mt-1 text-[0.8125rem] text-[var(--apps-text-muted)]">Try clearing a filter or searching another name.</p>
            </AppsCard>
          )}

          <button
            type="button"
            onClick={() => onPreviewCandidateFlow("demo")}
            className="applications-tap mt-5 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-[#BFD3E8] py-3 text-[0.8125rem] font-semibold text-[var(--apps-blue-strong)] hover:bg-[var(--apps-surface-2)]"
          >
            <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} />
            Preview the candidate view
          </button>
        </div>
      </div>

      <AppsSheet
        open={openFilter === "status"}
        title="Status"
        description="Filter the pipeline by where each candidate is."
        onClose={() => setOpenFilter(null)}
      >
        <OptionList
          options={[
            { value: "all", label: "All statuses" },
            ...APPLICATION_STATUS_ORDER.map((status) => ({
              value: status,
              label: APPLICATION_STATUS_META[status].label,
              detail: APPLICATION_STATUS_META[status].description,
              tone: APPLICATION_STATUS_META[status].tone,
            })),
          ]}
          value={filters.status}
          onSelect={(value) => {
            setFilter({ status: value as ApplicationStatus | "all" })
            setOpenFilter(null)
          }}
        />
      </AppsSheet>

      <AppsSheet open={openFilter === "jobId"} title="Job" onClose={() => setOpenFilter(null)}>
        <OptionList
          options={[
            { value: "all", label: "All jobs" },
            ...jobs.map((job) => ({ value: job.id, label: job.name, detail: job.location })),
          ]}
          value={filters.jobId}
          onSelect={(value) => {
            setFilter({ jobId: value })
            setOpenFilter(null)
          }}
        />
      </AppsSheet>

      <AppsSheet
        open={openFilter === "more"}
        title="Trade & sorting"
        onClose={() => setOpenFilter(null)}
        footer={
          <AppsButton variant="secondary" fullWidth onClick={() => setFilters(emptyFilters())}>
            Reset all filters
          </AppsButton>
        }
      >
        <p className="mb-1.5 px-1 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-[var(--apps-text-muted)]">
          Trade
        </p>
        <OptionList
          options={[{ value: "all", label: "All trades" }, ...trades.map((trade) => ({ value: trade, label: trade }))]}
          value={filters.trade}
          onSelect={(value) => setFilter({ trade: value })}
        />
        <p className="mb-1.5 mt-4 px-1 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-[var(--apps-text-muted)]">
          Sort by
        </p>
        <OptionList
          options={(Object.keys(SORT_LABEL) as ApplicationSort[]).map((key) => ({ value: key, label: SORT_LABEL[key] }))}
          value={sort}
          onSelect={(value) => setSort(value as ApplicationSort)}
        />
      </AppsSheet>

      <InviteCandidateSheet
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onCreate={(details) => {
          setInviteOpen(false)
          shareLink.openFor({ applicationId: NEW_APPLICATION_MARKER, purpose: "application", invite: details })
        }}
      />

      <ShareLinkSheet
        open={shareLink.isOpen}
        link={shareLink.link}
        error={shareLink.error}
        candidateName={shareLink.request?.invite?.candidateName}
        jobName={shareLink.request?.invite?.jobName}
        onClose={shareLink.close}
        onRegenerate={shareLink.regenerate}
        onRevoke={shareLink.revoke}
      />

      <button
        type="button"
        onClick={() => setInviteOpen(true)}
        className="applications-primary-button applications-tap absolute bottom-[max(calc(var(--sab)+2rem),6dvh)] right-4 z-10 flex h-14 w-14 items-center justify-center rounded-full text-white shadow-[0_10px_24px_rgba(37,99,235,0.30)]"
        aria-label="Create a secure application link"
      >
        <Link2 className="h-6 w-6" strokeWidth={2.2} />
      </button>
    </div>
  )
}

function OptionList({
  options,
  value,
  onSelect,
}: {
  options: Array<{ value: string; label: string; detail?: string; tone?: keyof typeof TONE_STYLES }>
  value: string
  onSelect: (value: string) => void
}) {
  return (
    <ul className="flex flex-col">
      {options.map((option) => (
        <li key={option.value}>
          <button
            type="button"
            onClick={() => onSelect(option.value)}
            className={cn(
              "applications-tap flex min-h-[3.25rem] w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left",
              option.value === value ? "bg-[var(--apps-blue-soft)]" : "hover:bg-[var(--apps-surface-2)]",
            )}
          >
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-[var(--apps-text)]">{option.label}</span>
              {option.detail && <span className="mt-0.5 block truncate text-xs text-[var(--apps-text-muted)]">{option.detail}</span>}
            </span>
            {option.tone && (
              <span className={cn("h-2 w-2 shrink-0 rounded-full", TONE_STYLES[option.tone].solid)} aria-hidden="true" />
            )}
          </button>
        </li>
      ))}
    </ul>
  )
}
