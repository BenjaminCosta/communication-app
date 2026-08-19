"use client"

/**
 * ByeByeDPR — worker MVP, now a real in-app screen of `app/page.tsx` like
 * the other four modules (Communications, Directory, Applications, Quest
 * Coral), not a standalone route. All jobs/recentJobs/activeClock data and
 * clock mutations live in `useByeByeDprDashboard` (called at the page.tsx
 * level, gated by a sticky "entered" flag) so switching away and back never
 * refetches. Even the first entry (or a real page reload) never blocks on a
 * full-screen takeover: `ByeByeDprHomeScreen`'s `loading` prop keeps the
 * header mounted and skeleton-izes the body instead, matching how
 * Applications/Quest Coral show their shell immediately with skeleton rows.
 * This component owns only its own internal
 * navigation (`screen`) and the current report draft's working state —
 * exactly like Applications only hoists `selectedApplicationId` and leaves
 * the rest of its own screen-local state alone. Leaving the module and
 * coming back always resets to Home, same as Applications/Quest Coral
 * resetting to their list view rather than resuming a specific
 * sub-screen — that's existing, deliberate behavior in this app, not a new
 * compromise.
 *
 * Home is always the first screen, even with zero job sites — there's no
 * separate "add a job" gate; the job picker reached via "Clock In" offers a
 * quick add inline when it has nothing to show (see ChangeJobScreen).
 *
 * "Recent activity" / "last clocked out" only reflect actions taken this
 * session — there is no list-history endpoint yet (see
 * docs/svc-bye-bye-dpr-module.md's pending-issues list).
 */

import { useState } from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatTimeInAppZone } from "@/lib/datetime"
import { ByeByeDprHomeScreen, type ClockStatus } from "@/components/bye-bye-dpr/byebye-dpr-home-screen"
import { AboutByeByeDprScreen } from "@/components/bye-bye-dpr/about-byebye-dpr-screen"
import { ChangeJobScreen } from "@/components/bye-bye-dpr/change-job-screen"
import { ClockOutConfirmSheet } from "@/components/bye-bye-dpr/clock-out-confirm-sheet"
import { ForgotClockOutSheet } from "@/components/bye-bye-dpr/forgot-clock-out-sheet"
import { DailyReportScreen } from "@/components/bye-bye-dpr/daily-report-screen"
import { ReportReviewScreen } from "@/components/bye-bye-dpr/report-review-screen"
import { BdButton, BdCard } from "@/components/bye-bye-dpr/ui/byebye-dpr-primitives"
import { createReportDraft, uploadReportAttachment } from "@/features/bye-bye-dpr/client/byebye-dpr-client"
import type { ByeByeDprDashboard } from "@/features/bye-bye-dpr/use-bye-bye-dpr-dashboard"
import { deriveInitials } from "@/lib/store"
import type { Job } from "@/lib/bye-bye-dpr-store"

type Screen = "home" | "about" | "change-job" | "daily-report" | "daily-report-review"

interface ByeByeDprScreenProps {
  dashboard: ByeByeDprDashboard
  userDisplayName: string
  className?: string
  onSwitchToStream: () => void
  onSwitchToDirectory: () => void
  onSwitchToApplications: () => void
  onSwitchToQuestCoral: () => void
  onCourtneyRobertsCenter?: () => void
}

function timeStringToToday(time: string): Date {
  const [hours, minutes] = time.split(":").map(Number)
  const date = new Date()
  date.setHours(hours, minutes, 0, 0)
  return date
}

/** `<input type="time">` requires 24-hour "HH:MM", not a localized time string. */
function to24HourInputValue(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
}

function formatIsoTime(iso: string | null): string {
  if (!iso) return ""
  return formatTimeInAppZone(new Date(iso), { hour: "numeric", minute: "2-digit" })
}

function BootErrorScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="byebye-dpr-scope byebye-dpr-canvas flex min-h-0 flex-1 items-center justify-center px-5">
      <BdCard className="flex max-w-sm flex-col items-center p-6 text-center">
        <p className="text-sm font-semibold text-[var(--bd-text)]">Couldn&apos;t load ByeByeDPR</p>
        <p className="mt-1.5 text-[0.8125rem] text-[var(--bd-text-muted)]">{message}</p>
        <BdButton variant="primary" size="md" className="mt-4" onClick={onRetry}>
          Try Again
        </BdButton>
      </BdCard>
    </div>
  )
}

function ByeByeDprToast({ message, onDismiss }: { message: string | null; onDismiss: () => void }) {
  if (!message) return null
  return (
    <div className="byebye-dpr-scope pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
      <div className="pointer-events-auto flex max-w-md items-center gap-2 rounded-xl bg-[#2A2438] px-4 py-3 text-sm font-medium text-white shadow-lg">
        <span className="flex-1">{message}</span>
        <button type="button" onClick={onDismiss} className="shrink-0 text-white/70 hover:text-white" aria-label="Dismiss">
          <X className="h-4 w-4" strokeWidth={2} />
        </button>
      </div>
    </div>
  )
}

export function ByeByeDprScreen({
  dashboard,
  userDisplayName,
  className,
  onSwitchToStream,
  onSwitchToDirectory,
  onSwitchToApplications,
  onSwitchToQuestCoral,
  onCourtneyRobertsCenter,
}: ByeByeDprScreenProps) {
  const [screen, setScreen] = useState<Screen>("home")
  const [clockOutConfirmOpen, setClockOutConfirmOpen] = useState(false)
  const [forgotClockOutOpen, setForgotClockOutOpen] = useState(false)

  const [reportId, setReportId] = useState<string | null>(null)
  const [reportSource, setReportSource] = useState<"voice" | "typed">("voice")
  const [reportText, setReportText] = useState("")
  const [photos, setPhotos] = useState<string[]>([])

  const { job, toastError, dismissToast, showToast } = dashboard

  async function handleClockInToJob(jobId: string) {
    try {
      await dashboard.clockInToJob(jobId)
      setScreen("home")
    } catch {
      // dashboard.showToast already surfaced the error.
    }
  }

  async function handleClockOutConfirm() {
    try {
      await dashboard.clockOutConfirm()
      setClockOutConfirmOpen(false)
    } catch {
      // dashboard.showToast already surfaced the error.
    }
  }

  async function handleForgotClockOutConfirm(time: string) {
    try {
      await dashboard.forgotClockOutConfirm(timeStringToToday(time))
      setForgotClockOutOpen(false)
    } catch {
      // dashboard.showToast already surfaced the error.
    }
  }

  async function handleOpenDailyReport() {
    if (!job || reportId) return
    try {
      const { report } = await createReportDraft(job.id)
      setReportId(report.id)
      setReportText("")
      setPhotos([])
      setScreen("daily-report")
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not start a new report.")
    }
  }

  function handleAddPhotos(files: File[]) {
    if (!reportId || files.length === 0) return
    const activeReportId = reportId
    const newUrls = files.map((file) => URL.createObjectURL(file))
    setPhotos((current) => [...current, ...newUrls])
    for (const file of files) {
      uploadReportAttachment(activeReportId, file).catch(() => {
        showToast("A photo couldn't be uploaded. It's shown locally but wasn't saved.")
      })
    }
  }

  function handleRemovePhoto(index: number) {
    setPhotos((current) => {
      const next = [...current]
      const [removed] = next.splice(index, 1)
      if (removed) URL.revokeObjectURL(removed)
      return next
    })
  }

  function handleDailyReportContinue(input: { source: "voice" | "typed"; text: string }) {
    setReportSource(input.source)
    setReportText(input.text)
    setScreen("daily-report-review")
  }

  function handleReportSubmitted() {
    dashboard.recordActivity(`Submitted Daily Report for ${job?.name ?? "job"}`)
    setPhotos([])
    setReportId(null)
    setScreen("home")
  }

  function handleJobCreated(newJob: Job) {
    dashboard.jobCreated(newJob)
  }

  let content: React.ReactNode

  if (dashboard.bootPhase === "loading") {
    // The header mounts immediately with the body skeleton-ized (instead of
    // a full-screen takeover) so switching into ByeByeDPR never blanks the
    // screen — matching how Applications/Quest Coral show their shell
    // immediately with skeleton rows, not a branded splash, on every entry
    // including the first.
    content = (
      <ByeByeDprHomeScreen
        loading
        status="clocked_out"
        job={null}
        userFirstName={userDisplayName.split(" ")[0]}
        userFullName={userDisplayName}
        userInitials={deriveInitials(userDisplayName)}
        clockedInLabel={null}
        lastClockOutLabel=""
        justPosted={false}
        recentActivity={[]}
        onClockIn={() => {}}
        onChangeJob={() => {}}
        onClockOut={() => {}}
        onForgotClockOut={() => {}}
        onOpenDailyReport={() => {}}
        onOpenAbout={() => setScreen("about")}
        onSwitchToStream={onSwitchToStream}
        onSwitchToDirectory={onSwitchToDirectory}
        onSwitchToApplications={onSwitchToApplications}
        onSwitchToQuestCoral={onSwitchToQuestCoral}
        onCourtneyRobertsCenter={onCourtneyRobertsCenter}
      />
    )
  } else if (dashboard.bootPhase === "error") {
    content = <BootErrorScreen message={dashboard.bootError} onRetry={() => void dashboard.retry()} />
  } else if (screen === "about") {
    content = <AboutByeByeDprScreen onBack={() => setScreen("home")} />
  } else if (screen === "change-job") {
    content = (
      <>
        <ChangeJobScreen
          jobs={dashboard.jobs}
          recentJobs={dashboard.recentJobs}
          currentJobId={job?.id}
          busy={dashboard.clockActionBusy}
          onBack={() => setScreen("home")}
          onConfirm={(jobId) => void handleClockInToJob(jobId)}
          onJobCreated={handleJobCreated}
        />
        <ByeByeDprToast message={toastError} onDismiss={dismissToast} />
      </>
    )
  } else if (screen === "daily-report" && reportId && job) {
    content = (
      <>
        <DailyReportScreen
          job={job}
          reportId={reportId}
          photos={photos}
          onAddPhotos={handleAddPhotos}
          onRemovePhoto={handleRemovePhoto}
          onBack={() => setScreen("home")}
          onContinue={handleDailyReportContinue}
        />
        <ByeByeDprToast message={toastError} onDismiss={dismissToast} />
      </>
    )
  } else if (screen === "daily-report-review" && reportId && job) {
    content = (
      <>
        <ReportReviewScreen
          job={job}
          reportId={reportId}
          source={reportSource}
          initialText={reportText}
          photos={photos}
          onRemovePhoto={handleRemovePhoto}
          onBack={() => setScreen("daily-report")}
          onSubmitted={handleReportSubmitted}
        />
        <ByeByeDprToast message={toastError} onDismiss={dismissToast} />
      </>
    )
  } else {
    const clockStatus: ClockStatus = dashboard.activeClock ? "clocked_in" : "clocked_out"
    const userFirstName = userDisplayName.split(" ")[0]
    const userInitials = deriveInitials(userDisplayName)

    content = (
      <>
        <ByeByeDprHomeScreen
          status={clockStatus}
          job={job}
          userFirstName={userFirstName}
          userFullName={userDisplayName}
          userInitials={userInitials}
          clockedInLabel={dashboard.activeClock ? formatIsoTime(dashboard.activeClock.clockInAt) : null}
          lastClockOutLabel={dashboard.lastClockOutLabel}
          justPosted={dashboard.justPosted}
          recentActivity={dashboard.recentActivity}
          onClockIn={() => setScreen("change-job")}
          onChangeJob={() => setScreen("change-job")}
          onClockOut={() => setClockOutConfirmOpen(true)}
          onForgotClockOut={() => setForgotClockOutOpen(true)}
          onOpenDailyReport={() => void handleOpenDailyReport()}
          onOpenAbout={() => setScreen("about")}
          onSwitchToStream={onSwitchToStream}
          onSwitchToDirectory={onSwitchToDirectory}
          onSwitchToApplications={onSwitchToApplications}
          onSwitchToQuestCoral={onSwitchToQuestCoral}
          onCourtneyRobertsCenter={onCourtneyRobertsCenter}
        />

        <ClockOutConfirmSheet
          open={clockOutConfirmOpen}
          onOpenChange={setClockOutConfirmOpen}
          jobName={job?.name ?? "this job"}
          onConfirm={() => void handleClockOutConfirm()}
          busy={dashboard.clockActionBusy}
        />

        <ForgotClockOutSheet
          open={forgotClockOutOpen}
          onOpenChange={setForgotClockOutOpen}
          defaultTime={dashboard.activeClock?.clockInAt ? to24HourInputValue(new Date(dashboard.activeClock.clockInAt)) : "16:00"}
          onConfirm={(time) => void handleForgotClockOutConfirm(time)}
          busy={dashboard.clockActionBusy}
        />

        <ByeByeDprToast message={toastError} onDismiss={dismissToast} />
      </>
    )
  }

  return <div className={cn("flex min-h-0 flex-1 flex-col overflow-hidden", className)}>{content}</div>
}
