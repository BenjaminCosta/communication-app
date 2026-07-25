"use client"

import { AlertCircle, ChevronRight, Sparkles } from "lucide-react"
import { Avatar, ProgressBar, StatusPill } from "@/components/applications/ui/apps-primitives"
import {
  APPLICATION_STATUS_META,
  computeApplicationProgress,
  initialsFor,
  nextActionLabel,
  type CandidateApplication,
} from "@/lib/applications-core"

export function ApplicationCard({
  application,
  onOpen,
}: {
  application: CandidateApplication
  onOpen: () => void
}) {
  const progress = computeApplicationProgress(application)
  const status = APPLICATION_STATUS_META[application.status]
  const blocked = application.status === "needs_information" || progress.missingItems.length > 0

  return (
    <button
      type="button"
      onClick={onOpen}
      className="applications-card applications-tap flex w-full flex-col gap-3 rounded-2xl p-4 text-left hover:border-[#BFDBFE]"
    >
      <div className="flex items-start gap-3">
        <Avatar initials={initialsFor(application.candidateName || "New candidate")} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="min-w-0 truncate text-[0.9375rem] font-bold text-[var(--apps-text)]">
              {application.candidateName || "Unnamed candidate"}
            </h3>
            <StatusPill label={status.label} tone={status.tone} />
          </div>
          <p className="mt-0.5 truncate text-[0.8125rem] text-[var(--apps-text-muted)]">{application.trade || "Trade not set"}</p>
          <p className="mt-0.5 truncate text-xs text-[var(--apps-text-muted)]">
            {application.job.name} — {application.job.location}
          </p>
        </div>
        <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-[var(--apps-text-muted)]" strokeWidth={2} />
      </div>

      <ProgressBar percent={progress.percent} showLabel tone={progress.isComplete ? "complete" : "info"} />

      <div className="flex items-center justify-between gap-2">
        <span
          className={`flex min-w-0 items-center gap-1.5 text-xs font-medium ${
            blocked ? "text-[#DC5A5A]" : "text-[var(--apps-text-muted)]"
          }`}
        >
          {blocked ? (
            <AlertCircle className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          ) : (
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--apps-blue)]" aria-hidden="true" />
          )}
          <span className="truncate">{nextActionLabel(application)}</span>
        </span>

        {application.video.state === "ready" && (
          <span className="flex shrink-0 items-center gap-1 rounded-full border border-[#E0D6FB] bg-[var(--apps-ai-soft)] px-2 py-1 text-[0.625rem] font-semibold text-[#6D3EE0]">
            <Sparkles className="h-3 w-3" strokeWidth={2} />
            AI video summary
          </span>
        )}
      </div>
    </button>
  )
}
