"use client"

/**
 * ByeByeDPR dashboard state — jobs/recentJobs/activeClock plus the clock
 * mutations, hoisted out of the screen component so it can live at
 * `app/page.tsx`'s top level, same shape as `useApplicationsDashboard`/
 * `useQuestCoralDashboard`: called unconditionally, gated by a sticky
 * `enabled` flag the caller flips true once the module is first entered.
 *
 * This is what makes switching in and out of ByeByeDPR feel like the other
 * modules — once `enabled` goes true, the boot fetch runs exactly once for
 * the rest of the session; leaving and returning to the module never
 * refetches or blocks on a loading screen again, because this hook (and its
 * state) never unmounts, unlike the presentational screen that reads it.
 */

import { useCallback, useEffect, useState } from "react"
import {
  ByeByeDprClientError,
  clockIn as apiClockIn,
  clockOut as apiClockOut,
  correctClockOut as apiCorrectClockOut,
  fetchActiveClock,
  fetchJobs,
  fetchRecentJobs,
} from "@/features/bye-bye-dpr/client/byebye-dpr-client"
import type { ClockSelectionSource } from "@/lib/bye-bye-dpr-core"
import type { ClockRecord, Job } from "@/lib/bye-bye-dpr-store"

export type ByeByeDprBootPhase = "loading" | "error" | "ready"

function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
}

function formatIsoTime(iso: string | null): string {
  if (!iso) return ""
  return formatTime(new Date(iso))
}

function errMessage(err: unknown): string {
  return err instanceof ByeByeDprClientError ? err.message : "Something went wrong. Try again."
}

export function useByeByeDprDashboard(uid: string, enabled: boolean) {
  const [bootPhase, setBootPhase] = useState<ByeByeDprBootPhase>("loading")
  const [bootError, setBootError] = useState("")

  const [jobs, setJobs] = useState<Job[]>([])
  const [recentJobs, setRecentJobs] = useState<Job[]>([])
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [activeClock, setActiveClock] = useState<ClockRecord | null>(null)
  const [clockActionBusy, setClockActionBusy] = useState(false)

  const [justPosted, setJustPosted] = useState(false)
  const [recentActivity, setRecentActivity] = useState<string[]>([])
  const [lastClockOutLabel, setLastClockOutLabel] = useState("Not clocked in today yet")
  const [toastError, setToastError] = useState<string | null>(null)

  const recordActivity = useCallback((label: string) => {
    setRecentActivity((current) => [label, ...current].slice(0, 3))
    setJustPosted(true)
    setTimeout(() => setJustPosted(false), 3200)
  }, [])

  const showToast = useCallback((message: string) => {
    setToastError(message)
    setTimeout(() => setToastError((current) => (current === message ? null : current)), 4500)
  }, [])

  const dismissToast = useCallback(() => setToastError(null), [])

  const loadInitialData = useCallback(async () => {
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
  }, [])

  // Deferred until `enabled` (the module was actually entered) — deliberately
  // NOT keyed on `uid` too, matching useApplicationsDashboard/
  // useQuestCoralDashboard's boot effects: `uid` only ever transitions empty
  // -> real-value once per session, but keeping it in the deps array meant
  // any transient reference change in the Firebase `User` object (e.g. a
  // silent token refresh re-emitting the auth callback) re-ran this effect
  // and reset `bootPhase` to "loading" — showing the full boot screen again
  // on every module switch, not just genuine first entry, since `enabled`
  // alone doesn't change on switch (it's sticky true forever).
  useEffect(() => {
    if (enabled && uid) void loadInitialData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])

  /** Reached from ChangeJobScreen's confirm — picking a job there is what actually starts the clock. */
  const clockInToJob = useCallback(async (jobId: string) => {
    if (clockActionBusy) return
    setClockActionBusy(true)
    try {
      const selectionSource: ClockSelectionSource = recentJobs.some((candidate) => candidate.id === jobId) ? "recent" : "manual"
      const { clockRecord } = await apiClockIn({ jobId, selectionSource, location: null })
      setSelectedJobId(jobId)
      setActiveClock(clockRecord)
      recordActivity(`Clocked in today at ${formatIsoTime(clockRecord.clockInAt)}`)
    } catch (err) {
      showToast(errMessage(err))
      throw err
    } finally {
      setClockActionBusy(false)
    }
  }, [clockActionBusy, recentJobs, recordActivity, showToast])

  const clockOutConfirm = useCallback(async () => {
    if (!activeClock || clockActionBusy) return
    setClockActionBusy(true)
    try {
      const { clockRecord } = await apiClockOut({ clockRecordId: activeClock.id, location: null })
      setActiveClock(null)
      setLastClockOutLabel(clockRecord.clockOutAt ? `Today at ${formatIsoTime(clockRecord.clockOutAt)}` : "Just now")
      recordActivity(`Clocked out today at ${formatIsoTime(clockRecord.clockOutAt)}`)
    } catch (err) {
      showToast(errMessage(err))
      throw err
    } finally {
      setClockActionBusy(false)
    }
  }, [activeClock, clockActionBusy, recordActivity, showToast])

  const forgotClockOutConfirm = useCallback(async (corrected: Date) => {
    if (!activeClock || clockActionBusy) return
    setClockActionBusy(true)
    try {
      await apiCorrectClockOut({ clockRecordId: activeClock.id, correctedClockOutAt: corrected })
      setActiveClock(null)
      setLastClockOutLabel(`Today at ${formatTime(corrected)}`)
      recordActivity(`Clock-out time updated to ${formatTime(corrected)}`)
    } catch (err) {
      showToast(errMessage(err))
      throw err
    } finally {
      setClockActionBusy(false)
    }
  }, [activeClock, clockActionBusy, recordActivity, showToast])

  const jobCreated = useCallback((newJob: Job) => {
    setJobs((current) => [...current, newJob].sort((a, b) => a.name.localeCompare(b.name)))
    setSelectedJobId(newJob.id)
  }, [])

  const job = jobs.find((candidate) => candidate.id === selectedJobId) ?? jobs[0] ?? null

  return {
    bootPhase,
    bootError,
    retry: loadInitialData,
    jobs,
    recentJobs,
    activeClock,
    job,
    selectedJobId,
    setSelectedJobId,
    clockActionBusy,
    justPosted,
    recentActivity,
    lastClockOutLabel,
    toastError,
    dismissToast,
    showToast,
    clockInToJob,
    clockOutConfirm,
    forgotClockOutConfirm,
    jobCreated,
    recordActivity,
  }
}

export type ByeByeDprDashboard = ReturnType<typeof useByeByeDprDashboard>
