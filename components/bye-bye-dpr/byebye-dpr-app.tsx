"use client"

/**
 * ByeByeDPR worker MVP — root orchestrator.
 *
 * Connected to the real backend (lib/bye-bye-dpr-server.ts via
 * features/bye-bye-dpr/client/byebye-dpr-client.ts) — no mock data. Flat,
 * single-org model (2026-08-10): every signed-in user sees every job, no
 * company/role setup. Boots in stages: wait for Firebase auth → load jobs +
 * active clock. Home is always the first screen, even with zero job sites —
 * there's no separate "add a job" gate; the job picker reached via "Clock
 * In" offers a quick add inline when it has nothing to show (see
 * ChangeJobScreen).
 *
 * "Recent activity" / "last clocked out" only reflect actions taken this
 * session — there is no list-history endpoint yet (see
 * docs/svc-bye-bye-dpr-module.md's pending-issues list), so a fresh page
 * load with no active clock always starts from a neutral empty state even
 * if the user clocked out earlier today in a previous session.
 */

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { onAuthStateChanged, type User } from "firebase/auth"
import { doc, getDoc } from "firebase/firestore"
import { X } from "lucide-react"
import { auth, db } from "@/lib/firebase"
import { ByeByeDprLoadingScreen } from "@/components/app-loading-screen"
import { ByeByeDprHomeScreen, type ClockStatus } from "@/components/bye-bye-dpr/byebye-dpr-home-screen"
import { AboutByeByeDprScreen } from "@/components/bye-bye-dpr/about-byebye-dpr-screen"
import { ChangeJobScreen } from "@/components/bye-bye-dpr/change-job-screen"
import { ClockOutConfirmSheet } from "@/components/bye-bye-dpr/clock-out-confirm-sheet"
import { ForgotClockOutSheet } from "@/components/bye-bye-dpr/forgot-clock-out-sheet"
import { DailyReportScreen } from "@/components/bye-bye-dpr/daily-report-screen"
import { ReportReviewScreen } from "@/components/bye-bye-dpr/report-review-screen"
import { BdButton, BdCard } from "@/components/bye-bye-dpr/ui/byebye-dpr-primitives"
import {
  ByeByeDprClientError,
  clockIn as apiClockIn,
  clockOut as apiClockOut,
  correctClockOut as apiCorrectClockOut,
  createReportDraft,
  fetchActiveClock,
  fetchJobs,
  fetchRecentJobs,
  uploadReportAttachment,
} from "@/features/bye-bye-dpr/client/byebye-dpr-client"
import { type ClockSelectionSource } from "@/lib/bye-bye-dpr-core"
import type { ClockRecord, Job } from "@/lib/bye-bye-dpr-store"
import { deriveInitials, deriveNameFromEmail } from "@/lib/store"

type Screen = "home" | "about" | "change-job" | "daily-report" | "daily-report-review"
type BootPhase = "loading" | "error" | "ready"

function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
}

function formatIsoTime(iso: string | null): string {
  if (!iso) return ""
  return formatTime(new Date(iso))
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

function errMessage(err: unknown): string {
  return err instanceof ByeByeDprClientError ? err.message : "Something went wrong. Try again."
}

function BootLoadingScreen() {
  return (
    <div className="byebye-dpr-scope flex min-h-0 flex-1 flex-col">
      <ByeByeDprLoadingScreen className="min-h-0" />
    </div>
  )
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

export function ByeByeDprApp() {
  const router = useRouter()

  const [authResolved, setAuthResolved] = useState(false)
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null)

  const [bootPhase, setBootPhase] = useState<BootPhase>("loading")
  const [bootError, setBootError] = useState("")
  const [userName, setUserName] = useState<string | null>(null)

  const [screen, setScreen] = useState<Screen>("home")
  const [jobs, setJobs] = useState<Job[]>([])
  const [recentJobs, setRecentJobs] = useState<Job[]>([])
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [activeClock, setActiveClock] = useState<ClockRecord | null>(null)
  const [clockActionBusy, setClockActionBusy] = useState(false)

  const [justPosted, setJustPosted] = useState(false)
  const [recentActivity, setRecentActivity] = useState<string[]>([])
  const [lastClockOutLabel, setLastClockOutLabel] = useState("Not clocked in today yet")
  const [toastError, setToastError] = useState<string | null>(null)

  const [clockOutConfirmOpen, setClockOutConfirmOpen] = useState(false)
  const [forgotClockOutOpen, setForgotClockOutOpen] = useState(false)

  const [reportId, setReportId] = useState<string | null>(null)
  const [reportSource, setReportSource] = useState<"voice" | "typed">("voice")
  const [reportText, setReportText] = useState("")
  const [photos, setPhotos] = useState<string[]>([])

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user)
      setAuthResolved(true)
    })
    return unsub
  }, [])

  useEffect(() => {
    if (authResolved && !firebaseUser) router.replace("/")
  }, [authResolved, firebaseUser, router])

  async function loadInitialData() {
    setBootPhase("loading")
    setBootError("")
    try {
      const [jobsResult, recentResult, activeClockResult] = await Promise.all([
        fetchJobs(),
        fetchRecentJobs(),
        fetchActiveClock(),
      ])
      setJobs(jobsResult.jobs)
      setRecentJobs(recentResult.jobs)
      setActiveClock(activeClockResult.clockRecord)

      const initialJobId = activeClockResult.clockRecord?.jobId ?? recentResult.jobs[0]?.id ?? jobsResult.jobs[0]?.id ?? null
      setSelectedJobId(initialJobId)
      setBootPhase("ready")
    } catch (err) {
      setBootError(errMessage(err))
      setBootPhase("error")
    }
  }

  useEffect(() => {
    if (firebaseUser) void loadInitialData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firebaseUser?.uid])

  useEffect(() => {
    if (!firebaseUser) return
    getDoc(doc(db, "users", firebaseUser.uid))
      .then((snap) => {
        const name = snap.data()?.name
        if (typeof name === "string" && name.trim()) setUserName(name.trim())
      })
      .catch(() => {
        // Falls back to the Firebase Auth name below.
      })
  }, [firebaseUser])

  function flashPosted() {
    setJustPosted(true)
    setTimeout(() => setJustPosted(false), 3200)
  }

  function pushActivity(label: string) {
    setRecentActivity((current) => [label, ...current].slice(0, 3))
  }

  function showToast(message: string) {
    setToastError(message)
    setTimeout(() => setToastError((current) => (current === message ? null : current)), 4500)
  }

  const job = jobs.find((candidate) => candidate.id === selectedJobId) ?? jobs[0] ?? null

  /** Reached from ChangeJobScreen's confirm — picking a job there is what actually starts the clock. */
  async function handleClockInToJob(jobId: string) {
    if (clockActionBusy) return
    setClockActionBusy(true)
    try {
      const selectionSource: ClockSelectionSource = recentJobs.some((candidate) => candidate.id === jobId) ? "recent" : "manual"
      const { clockRecord } = await apiClockIn({ jobId, selectionSource, location: null })
      setSelectedJobId(jobId)
      setActiveClock(clockRecord)
      pushActivity(`Clocked in today at ${formatIsoTime(clockRecord.clockInAt)}`)
      flashPosted()
      setScreen("home")
    } catch (err) {
      showToast(errMessage(err))
    } finally {
      setClockActionBusy(false)
    }
  }

  async function handleClockOutConfirm() {
    if (!activeClock || clockActionBusy) return
    setClockActionBusy(true)
    try {
      const { clockRecord } = await apiClockOut({ clockRecordId: activeClock.id, location: null })
      setActiveClock(null)
      setClockOutConfirmOpen(false)
      const label = clockRecord.clockOutAt ? `Today at ${formatIsoTime(clockRecord.clockOutAt)}` : "Just now"
      setLastClockOutLabel(label)
      pushActivity(`Clocked out today at ${formatIsoTime(clockRecord.clockOutAt)}`)
      flashPosted()
    } catch (err) {
      showToast(errMessage(err))
    } finally {
      setClockActionBusy(false)
    }
  }

  async function handleForgotClockOutConfirm(time: string) {
    if (!activeClock || clockActionBusy) return
    const corrected = timeStringToToday(time)
    setClockActionBusy(true)
    try {
      await apiCorrectClockOut({ clockRecordId: activeClock.id, correctedClockOutAt: corrected })
      setActiveClock(null)
      setForgotClockOutOpen(false)
      setLastClockOutLabel(`Today at ${formatTime(corrected)}`)
      pushActivity(`Clock-out time updated to ${formatTime(corrected)}`)
      flashPosted()
    } catch (err) {
      showToast(errMessage(err))
    } finally {
      setClockActionBusy(false)
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
      showToast(errMessage(err))
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
    pushActivity(`Submitted Daily Report for ${job?.name ?? "job"}`)
    setPhotos([])
    setReportId(null)
    flashPosted()
    setScreen("home")
  }

  function handleJobCreated(newJob: Job) {
    setJobs((current) => [...current, newJob].sort((a, b) => a.name.localeCompare(b.name)))
    setSelectedJobId(newJob.id)
  }

  if (!authResolved || !firebaseUser) return <BootLoadingScreen />
  if (bootPhase === "loading") return <BootLoadingScreen />
  if (bootPhase === "error") return <BootErrorScreen message={bootError} onRetry={loadInitialData} />

  if (screen === "about") {
    return <AboutByeByeDprScreen onBack={() => setScreen("home")} />
  }

  if (screen === "change-job") {
    return (
      <>
        <ChangeJobScreen
          jobs={jobs}
          recentJobs={recentJobs}
          currentJobId={job?.id}
          busy={clockActionBusy}
          onBack={() => setScreen("home")}
          onConfirm={(jobId) => void handleClockInToJob(jobId)}
          onJobCreated={handleJobCreated}
        />
        <ByeByeDprToast message={toastError} onDismiss={() => setToastError(null)} />
      </>
    )
  }

  if (screen === "daily-report" && reportId && job) {
    return (
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
        <ByeByeDprToast message={toastError} onDismiss={() => setToastError(null)} />
      </>
    )
  }

  if (screen === "daily-report-review" && reportId && job) {
    return (
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
        <ByeByeDprToast message={toastError} onDismiss={() => setToastError(null)} />
      </>
    )
  }

  const clockStatus: ClockStatus = activeClock ? "clocked_in" : "clocked_out"
  const userFullName = userName || firebaseUser.displayName?.trim() || deriveNameFromEmail(firebaseUser.email ?? "") || "there"
  const userFirstName = userFullName.split(" ")[0]
  const userInitials = deriveInitials(userFullName)

  return (
    <>
      <ByeByeDprHomeScreen
        status={clockStatus}
        job={job}
        userFirstName={userFirstName}
        userFullName={userFullName}
        userInitials={userInitials}
        clockedInLabel={activeClock ? formatIsoTime(activeClock.clockInAt) : null}
        lastClockOutLabel={lastClockOutLabel}
        justPosted={justPosted}
        recentActivity={recentActivity}
        onClockIn={() => setScreen("change-job")}
        onChangeJob={() => setScreen("change-job")}
        onClockOut={() => setClockOutConfirmOpen(true)}
        onForgotClockOut={() => setForgotClockOutOpen(true)}
        onOpenDailyReport={() => void handleOpenDailyReport()}
        onOpenAbout={() => setScreen("about")}
      />

      <ClockOutConfirmSheet
        open={clockOutConfirmOpen}
        onOpenChange={setClockOutConfirmOpen}
        jobName={job?.name ?? "this job"}
        onConfirm={() => void handleClockOutConfirm()}
        busy={clockActionBusy}
      />

      <ForgotClockOutSheet
        open={forgotClockOutOpen}
        onOpenChange={setForgotClockOutOpen}
        defaultTime={activeClock?.clockInAt ? to24HourInputValue(new Date(activeClock.clockInAt)) : "16:00"}
        onConfirm={(time) => void handleForgotClockOutConfirm(time)}
        busy={clockActionBusy}
      />

      <ByeByeDprToast message={toastError} onDismiss={() => setToastError(null)} />
    </>
  )
}
