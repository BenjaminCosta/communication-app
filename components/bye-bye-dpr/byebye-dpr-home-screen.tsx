"use client"

/**
 * ByeByeDPR — Home. Everything a worker needs is one screen: clock in/out,
 * jump into a report. No dashboards, no stats, no admin chrome — see
 * PRODUCT.md's anti-references. Clock In/Out are deliberately distinct
 * button treatments (bright violet vs. deep indigo), not the same button
 * relabeled — see .byebye-dpr-clockout-button in app/globals.css.
 *
 * Job selection is no longer a separate step here: tapping "Clock In" goes
 * straight to the job-site picker (with a location-based recommendation),
 * and confirming a job there is what actually starts the clock — see
 * ChangeJobScreen. The job card below is just a reference to the last job
 * used (or the one you're currently clocked into), not something to edit
 * in place. `job` is nullable: a brand-new install with zero job sites
 * still lands here directly (no separate "add a job" gate screen) — the
 * job card just doesn't render, and job creation happens inline the first
 * time someone taps Clock In and reaches the (now empty) picker.
 *
 * The "Change" link next to the job card reopens that same picker without
 * clocking in first. It only shows up next to "Last job" (i.e. while
 * clocked out) — the backend rejects a second clock-in while one is already
 * active ("already-clocked-in", see lib/bye-bye-dpr-server.ts), so offering
 * "Change" while clocked in would just surface that as an error toast.
 * Switching jobs mid-shift isn't supported yet; clock out first.
 */

import { Building2, Check, CheckCircle2, ChevronRight, Clock, ClipboardList, Play, Sparkles, Square } from "lucide-react"
import { cn } from "@/lib/utils"
import { ByeByeDprHeader } from "@/components/bye-bye-dpr/byebye-dpr-header"
import { Avatar, BdButton, BdCard, BdEmptyState, SectionLabel } from "@/components/bye-bye-dpr/ui/byebye-dpr-primitives"
import type { Job } from "@/lib/bye-bye-dpr-store"

export type ClockStatus = "clocked_out" | "clocked_in"

interface ByeByeDprHomeScreenProps {
  status: ClockStatus
  job: Job | null
  userFirstName: string
  userFullName: string
  userInitials: string
  clockedInLabel: string | null
  lastClockOutLabel: string
  justPosted: boolean
  recentActivity: string[]
  onClockIn: () => void
  onChangeJob: () => void
  onClockOut: () => void
  onForgotClockOut: () => void
  onOpenDailyReport: () => void
  onOpenAbout: () => void
  onSwitchToStream: () => void
  onSwitchToDirectory: () => void
  onSwitchToApplications: () => void
  onSwitchToQuestCoral: () => void
}

/** Splits "Clocked out yesterday at 4:18 PM" into ["Clocked out yesterday", "4:18 PM"]
 *  for a two-line row; falls back to a single line when there's no " at ". */
function splitActivityLabel(text: string): [string, string | null] {
  const idx = text.lastIndexOf(" at ")
  if (idx === -1) return [text, null]
  return [text.slice(0, idx), text.slice(idx + 4)]
}

export function ByeByeDprHomeScreen({
  status,
  job,
  userFirstName,
  userFullName,
  userInitials,
  clockedInLabel,
  lastClockOutLabel,
  justPosted,
  recentActivity,
  onClockIn,
  onChangeJob,
  onClockOut,
  onForgotClockOut,
  onOpenDailyReport,
  onOpenAbout,
  onSwitchToStream,
  onSwitchToDirectory,
  onSwitchToApplications,
  onSwitchToQuestCoral,
}: ByeByeDprHomeScreenProps) {
  const clockedIn = status === "clocked_in"
  const [activityLine1, activityLine2] = recentActivity[0] ? splitActivityLabel(recentActivity[0]) : [null, null]

  return (
    <div className="byebye-dpr-scope byebye-dpr-canvas relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <ByeByeDprHeader
        onOpenAbout={onOpenAbout}
        onSwitchToStream={onSwitchToStream}
        onSwitchToDirectory={onSwitchToDirectory}
        onSwitchToApplications={onSwitchToApplications}
        onSwitchToQuestCoral={onSwitchToQuestCoral}
      />

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-hide">
        <div className="mx-auto w-full max-w-md px-5 pb-10 pt-6">
          <h1 className="text-[1.5rem] font-bold leading-tight tracking-[-0.01em] text-[var(--bd-text)]">
            Good morning, {userFirstName} <span aria-hidden="true">👋</span>
          </h1>
          <p className="mt-1 text-[0.875rem] text-[var(--bd-text-muted)]">
            {clockedIn ? "You're on the clock." : "Let's get the day started."}
          </p>

          {job && (
            <>
              <div className="mt-7 flex items-center justify-between gap-3">
                <SectionLabel>{clockedIn ? "Current job" : "Last job"}</SectionLabel>
                {!clockedIn && (
                  <button
                    type="button"
                    onClick={onChangeJob}
                    className="byebye-dpr-tap text-[0.75rem] font-semibold text-[var(--bd-purple-strong)] hover:underline"
                  >
                    Change
                  </button>
                )}
              </div>
              <BdCard flat className="mt-2 flex items-center gap-3 px-3.5 py-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--bd-purple-soft)] text-[var(--bd-purple-strong)]" aria-hidden="true">
                  <Building2 className="h-4.5 w-4.5" strokeWidth={1.8} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.9375rem] font-bold text-[var(--bd-text)]">{job.name}</span>
                  <span className="mt-0.5 block truncate text-[0.75rem] text-[var(--bd-text-muted)]">{job.address ?? "No address set"}</span>
                </span>
              </BdCard>
            </>
          )}

          <div
            className={cn(
              "mt-5 flex items-center gap-3 rounded-2xl border px-4 py-3.5",
              clockedIn ? "border-[#BBF7D0] bg-[var(--bd-complete-soft)]" : "border-[var(--bd-border)] bg-[var(--bd-surface)]",
            )}
          >
            <span
              className={cn(
                "flex h-11 w-11 shrink-0 items-center justify-center rounded-full",
                clockedIn ? "bg-white text-[#15803D]" : "bg-[var(--bd-surface-2)] text-[var(--bd-text-muted)]",
              )}
              aria-hidden="true"
            >
              {clockedIn ? <CheckCircle2 className="h-5 w-5" strokeWidth={1.8} /> : <Clock className="h-5 w-5" strokeWidth={1.8} />}
            </span>
            <div className="min-w-0">
              <p className="text-[0.9375rem] font-bold text-[var(--bd-text)]">{clockedIn ? "Clocked in" : "Clocked out"}</p>
              <p className="mt-0.5 text-[0.8125rem] text-[var(--bd-text-muted)]">
                {clockedIn ? `Since ${clockedInLabel}` : lastClockOutLabel}
              </p>
            </div>
          </div>

          <BdButton
            variant={clockedIn ? "clockout" : "primary"}
            size="lg"
            fullWidth
            onClick={clockedIn ? onClockOut : onClockIn}
            className="mt-5 min-h-19 rounded-2xl px-4"
          >
            <span className="flex w-full items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/20" aria-hidden="true">
                {clockedIn ? <Square className="h-4 w-4" strokeWidth={2} fill="currentColor" /> : <Play className="h-4.5 w-4.5" strokeWidth={2} fill="currentColor" />}
              </span>
              <span className="flex flex-col items-start text-left">
                <span className="text-lg font-bold leading-tight">{clockedIn ? "Clock Out" : "Clock In"}</span>
                <span className="text-[0.75rem] font-medium leading-tight text-white/70">
                  {clockedIn ? "End your work day" : "Start your work day"}
                </span>
              </span>
            </span>
          </BdButton>

          {clockedIn && (
            <button
              type="button"
              onClick={onForgotClockOut}
              className="byebye-dpr-tap mt-3 text-[0.8125rem] font-semibold text-[var(--bd-text-muted)] hover:text-[var(--bd-text)]"
            >
              Forgot to clock out?
            </button>
          )}

          {justPosted && recentActivity[0] && (
            <BdCard className="byebye-dpr-step-enter mt-4 flex items-center gap-3 px-3.5 py-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--bd-ai-soft)] text-[var(--bd-purple-strong)]" aria-hidden="true">
                <Sparkles className="h-4 w-4" strokeWidth={2} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[0.8125rem] font-bold text-[var(--bd-text)]">Auto-posted to Comms</p>
                <p className="mt-0.5 truncate text-[0.75rem] text-[var(--bd-text-muted)]">
                  {userFullName} — {recentActivity[0]}
                </p>
              </div>
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--bd-complete-soft)] text-[#15803D]" aria-hidden="true">
                <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
              </span>
            </BdCard>
          )}

          <div className="my-7 border-t border-[var(--bd-border)]" />

          <SectionLabel>Reports</SectionLabel>
          <button
            type="button"
            onClick={onOpenDailyReport}
            disabled={!job}
            className="byebye-dpr-tap -mx-2 mt-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-xl px-2 py-2.5 text-left hover:bg-[var(--bd-surface-2)] disabled:opacity-50 disabled:hover:bg-transparent"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--bd-ai-soft)] text-[var(--bd-purple-strong)]" aria-hidden="true">
              <ClipboardList className="h-4.5 w-4.5" strokeWidth={1.8} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[0.9375rem] font-semibold text-[var(--bd-text)]">Daily Report</span>
              <span className="mt-0.5 block truncate text-[0.75rem] text-[var(--bd-text-muted)]">
                {job ? "Record or type today's update" : "Clock in to a job site first"}
              </span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-[var(--bd-text-muted)]" aria-hidden="true" />
          </button>

          <div className="my-7 border-t border-[var(--bd-border)]" />

          <SectionLabel>Recent activity</SectionLabel>
          {activityLine1 ? (
            <BdCard flat className="mt-2 flex items-center gap-3 px-3.5 py-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--bd-surface-2)] text-[var(--bd-text-muted)]" aria-hidden="true">
                <Clock className="h-4 w-4" strokeWidth={2} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[0.875rem] font-semibold text-[var(--bd-text)]">{activityLine1}</p>
                {activityLine2 && <p className="mt-0.5 text-[0.75rem] text-[var(--bd-text-muted)]">{activityLine2}</p>}
              </div>
            </BdCard>
          ) : (
            <BdEmptyState
              className="mt-2 px-4 py-6"
              icon={<Clock className="h-5 w-5 text-[var(--bd-text-muted)]" strokeWidth={2} />}
              title="Nothing yet"
              description="Your clock-ins and reports will show up here."
            />
          )}

          <div className="mt-8 flex items-center justify-center gap-2.5">
            <Avatar initials={userInitials} />
            <p className="text-[0.8125rem] font-medium text-[var(--bd-text-muted)]">
              {clockedIn ? "Keep it going. Great work!" : "Stay safe. Build strong."}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
