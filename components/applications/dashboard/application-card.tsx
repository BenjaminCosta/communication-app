"use client"

import { memo, useMemo } from "react"
import { AlertCircle, BadgeCheck, ChevronRight, Sparkles } from "lucide-react"
import { Avatar, NoticeBadge, ProgressBar, StatusPill } from "@/components/applications/ui/apps-primitives"
import {
  APPLICATION_STATUS_META,
  computeApplicationProgress,
  initialsFor,
  needsAgreementAttention,
  nextActionLabel,
  type CandidateApplication,
} from "@/lib/applications-core"

/**
 * Memoized: the list re-renders on every keystroke in search and every sheet
 * toggle, but a card only needs to re-render when ITS application changes. The
 * `onOpen(id)` shape keeps the callback stable so memo actually holds.
 */
export const ApplicationCard = memo(function ApplicationCard({
  application,
  onOpen,
}: {
  application: CandidateApplication
  onOpen: (id: string) => void
}) {
  const progress = useMemo(() => computeApplicationProgress(application), [application])
  const status = APPLICATION_STATUS_META[application.status]
  const blocked = application.status === "needs_information" || progress.missingItems.length > 0
  const isHired = application.status === "hired"
  const isApproved = application.status === "approved"

  return (
    <button
      type="button"
      onClick={() => onOpen(application.id)}
      className={`applications-card applications-tap flex w-full flex-col gap-3 rounded-2xl p-4 text-left hover:border-[#BFDBFE] ${
        isHired
          ? "border-[#86EFAC] bg-[linear-gradient(135deg,#FFFFFF_0%,#F0FDF4_100%)] shadow-[0_8px_18px_rgba(22,163,74,0.08)]"
          : isApproved
            ? "border-[#BFDBFE] bg-[linear-gradient(135deg,#FFFFFF_0%,#EFF6FF_100%)]"
            : ""
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="relative shrink-0">
          <Avatar
            initials={initialsFor(application.candidateName || "New candidate")}
            className={isHired ? "bg-[var(--apps-complete-soft)] text-[#15803D]" : undefined}
          />
          {needsAgreementAttention(application) && (
            <NoticeBadge tone="pending" className="absolute -right-0.5 -top-0.5" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="min-w-0 truncate text-[0.9375rem] font-bold text-[var(--apps-text)]">
              {application.candidateName || "Unnamed candidate"}
            </h3>
            <StatusPill
              label={status.label}
              tone={status.tone}
              className={
                isHired
                  ? "border-[#86EFAC] bg-[#DCFCE7] text-[#166534]"
                  : isApproved
                    ? "border-[#BFDBFE] bg-[#EFF6FF] text-[#1D4ED8]"
                    : undefined
              }
            />
          </div>
          <p className="mt-0.5 truncate text-[0.8125rem] text-[var(--apps-text-muted)]">{application.trade || "Trade not set"}</p>
          <p className="mt-0.5 truncate text-xs text-[var(--apps-text-muted)]">
            {application.job.name} — {application.job.location}
          </p>
        </div>
        <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-[var(--apps-text-muted)]" strokeWidth={2} />
      </div>

      <ProgressBar percent={progress.percent} showLabel tone={isHired || progress.isComplete ? "complete" : "info"} />

      <div className="flex items-center justify-between gap-2">
        <span
          className={`flex min-w-0 items-center gap-1.5 text-xs font-medium ${
            isHired ? "text-[#15803D]" : isApproved ? "text-[var(--apps-blue-strong)]" : blocked ? "text-[#DC5A5A]" : "text-[var(--apps-text-muted)]"
          }`}
        >
          {isHired ? (
            <BadgeCheck className="h-4 w-4 shrink-0" strokeWidth={2.2} />
          ) : blocked ? (
            <AlertCircle className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          ) : (
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--apps-blue)]" aria-hidden="true" />
          )}
          <span className="truncate">{isHired ? "Hired - onboarding complete" : isApproved ? "Approved - operating agreement sent" : nextActionLabel(application, progress)}</span>
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
})
