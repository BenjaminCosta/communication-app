"use client"

/**
 * Change Job Site — this *is* the clock-in flow now: Home's "Clock In"
 * button lands here first so the worker always confirms (or corrects) their
 * job site before the clock actually starts, instead of silently clocking
 * into whatever job happened to be selected last. Visual design/copy
 * matches the original reference screen exactly (title, "Use This Job"
 * button) — only the underlying behavior changed: confirming here now
 * performs a real clock-in, not just a selection.
 *
 * Real backend: `jobs`/`recentJobs` are fetched by the parent and passed in
 * as props. Location is requested automatically on entry (this screen only
 * exists because the worker tapped "Clock In", so a location prompt here is
 * expected, not a surprise) — it reads the browser's one-shot position,
 * computes client-side distances to every job with coordinates via the same
 * haversine helper the server uses, and asks the server for the
 * authoritative nearest match; "Use current location" stays as a manual
 * retry if it fails or the worker moved. ByeByeDPR never tracks location
 * continuously (see PRODUCT.md).
 *
 * Select-then-confirm: tapping a row updates the highlighted selection, the
 * sticky footer's primary button clocks in against it.
 *
 * Zero jobs yet: there's no separate "add a job" gate before Home (see
 * byebye-dpr-screen.tsx) — instead, if the picker has nothing to show, it's
 * the picker itself that offers a quick inline add. Creating a job selects
 * it immediately, so the normal footer "Use This Job" button just works.
 *
 * "All jobs" search: once the query is 2+ chars, results switch from a
 * client-side filter over the small set of jobs already added to ByeByeDPR
 * to a live, debounced SVC Directory search (same `searchDirectoryJobs` used
 * by AddFirstJobCard below) — so typing here finds any job in Directory, not
 * just the ones someone has already clocked into before. Picking a result
 * that isn't linked to a local job yet transparently links/creates one
 * (`createJob` with `directoryContextId`) before selecting it — always with
 * `latitude/longitude: null`. An earlier version stamped the worker's
 * current position onto the new job automatically, which is wrong: picking
 * a job from search doesn't mean you're standing at it (e.g. adding it
 * ahead of time from the office), so that silently taught the nearest-job
 * feature the wrong location for real jobs (see the 2026-08-11 "nearest
 * location" fix in docs/svc-bye-bye-dpr-module.md). A job's coordinates are
 * now only ever set by an explicit, deliberate capture — today that's just
 * `AddFirstJobCard`'s "Set this job's location" button below; jobs added
 * later via this search simply have no coordinates until a job-management
 * UI to add/correct them exists (tracked, not built).
 */

import { useEffect, useMemo, useState } from "react"
import { ArrowLeft, Building2, Check, ChevronRight, Loader2, MapPin, Search, Star, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { BdButton, BdCard, BdEmptyState } from "@/components/bye-bye-dpr/ui/byebye-dpr-primitives"
import { haversineDistanceMeters, type GeoPoint } from "@/lib/bye-bye-dpr-core"
import { ByeByeDprClientError, createJob, fetchNearestJob, searchDirectoryJobs } from "@/features/bye-bye-dpr/client/byebye-dpr-client"
import type { Job } from "@/lib/bye-bye-dpr-store"
import type { DirectoryJobSearchResult } from "@/lib/bye-bye-dpr-directory-link"

interface ChangeJobScreenProps {
  jobs: Job[]
  recentJobs: Job[]
  currentJobId?: string | null
  busy?: boolean
  onBack: () => void
  onConfirm: (jobId: string) => void
  onJobCreated: (job: Job) => void
}

function metersToMilesLabel(meters: number): string {
  return `${(meters / 1609.344).toFixed(1)} mi away`
}

function getCurrentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("unsupported"))
      return
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 })
  })
}

function JobRow({
  job,
  selected,
  subtitle,
  onSelect,
}: {
  job: Job
  selected: boolean
  subtitle: string
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="byebye-dpr-tap flex w-full items-center gap-3 py-3.5 text-left"
    >
      <span
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
          selected ? "bg-[var(--bd-purple)] text-white" : "bg-[var(--bd-purple-soft)] text-[var(--bd-purple-strong)]",
        )}
        aria-hidden="true"
      >
        <Building2 className="h-4.5 w-4.5" strokeWidth={1.8} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[0.875rem] font-semibold text-[var(--bd-text)]">{job.name}</span>
        <span className="mt-0.5 block truncate text-[0.75rem] text-[var(--bd-text-muted)]">{subtitle}</span>
      </span>
      {selected && (
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--bd-purple)] text-white" aria-hidden="true">
          <Check className="h-3 w-3" strokeWidth={2.5} />
        </span>
      )}
    </button>
  )
}

/**
 * First job for the whole app: search-then-confirm against real SVC
 * Directory job contexts, so a worker's first "Add Job Site" doesn't create
 * a disconnected duplicate of a job that already exists in Directory. Only
 * falls back to creating a brand-new Directory job when search comes up
 * empty — every path ends with a real `directoryContextId` link (enforced
 * server-side in createJob(), see lib/bye-bye-dpr-server.ts).
 */
function AddFirstJobCard({ onCreated }: { onCreated: (job: Job) => void }) {
  const [query, setQuery] = useState("")
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<DirectoryJobSearchResult[]>([])
  const [searchError, setSearchError] = useState<string | null>(null)
  const [selected, setSelected] = useState<DirectoryJobSearchResult | null>(null)
  const [creatingNew, setCreatingNew] = useState(false)
  const [newName, setNewName] = useState("")
  const [address, setAddress] = useState("")
  const [coords, setCoords] = useState<GeoPoint | null>(null)
  const [locating, setLocating] = useState(false)
  const [locError, setLocError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < 2) {
      setResults([])
      setSearchError(null)
      return
    }
    setSearching(true)
    const handle = setTimeout(() => {
      searchDirectoryJobs(trimmed)
        .then(({ results }) => setResults(results))
        .catch((err) => setSearchError(err instanceof ByeByeDprClientError ? err.message : "Search failed."))
        .finally(() => setSearching(false))
    }, 300)
    return () => clearTimeout(handle)
  }, [query])

  async function captureLocation() {
    if (locating) return
    setLocating(true)
    setLocError(null)
    try {
      const position = await getCurrentPosition()
      setCoords({ lat: position.coords.latitude, lng: position.coords.longitude })
    } catch {
      setLocError("Couldn't get your location. Check permissions and try again.")
    } finally {
      setLocating(false)
    }
  }

  async function submit() {
    const trimmedNewName = newName.trim()
    if (!selected && !trimmedNewName) return
    if (submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const { job } = await createJob({
        name: selected ? selected.name : trimmedNewName,
        directoryContextId: selected?.directoryContextId ?? null,
        address: selected ? null : address.trim() || null,
        latitude: coords?.lat ?? null,
        longitude: coords?.lng ?? null,
      })
      onCreated(job)
    } catch (err) {
      setError(err instanceof ByeByeDprClientError ? err.message : "Could not add the job site. Try again.")
      setSubmitting(false)
    }
  }

  const showLocationCapture = Boolean(selected) || creatingNew

  return (
    <BdCard className="mt-4 flex flex-col items-center p-5 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--bd-purple)] text-white" aria-hidden="true">
        <Building2 className="h-5 w-5" strokeWidth={2} />
      </span>
      <p className="mt-3 text-[0.9375rem] font-bold text-[var(--bd-text)]">No job sites yet</p>
      <p className="mt-1 text-[0.8125rem] leading-snug text-[var(--bd-text-muted)]">
        Find your job in SVC Directory to clock in — you can add more any time.
      </p>

      <div className="mt-4 flex w-full flex-col gap-2.5 text-left">
        {!selected && !creatingNew && (
          <>
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search Directory for your job"
              className="h-11 w-full rounded-xl border border-[var(--bd-border)] bg-[var(--bd-surface)] px-3.5 text-[0.875rem] text-[var(--bd-text)] outline-none placeholder:text-[var(--bd-text-muted)] focus:border-[var(--bd-purple)] focus:shadow-[0_0_0_3px_rgba(109,91,208,0.14)]"
            />
            {searchError && <p className="text-[0.8125rem] text-[#DC5A5A]">{searchError}</p>}
            {searching && (
              <p className="flex items-center gap-1.5 text-[0.8125rem] text-[var(--bd-text-muted)]">
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} /> Searching Directory...
              </p>
            )}
            {!searching && results.length > 0 && (
              <div className="divide-y divide-[var(--bd-border)] rounded-xl border border-[var(--bd-border)]">
                {results.map((result) => (
                  <button
                    key={result.directoryContextId}
                    type="button"
                    onClick={() => setSelected(result)}
                    className="byebye-dpr-tap flex w-full items-center gap-2.5 px-3 py-2.5 text-left"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--bd-purple-soft)] text-[var(--bd-purple-strong)]" aria-hidden="true">
                      <Building2 className="h-4 w-4" strokeWidth={1.8} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[0.8125rem] font-semibold text-[var(--bd-text)]">{result.name}</span>
                      {result.location && <span className="mt-0.5 block truncate text-[0.75rem] text-[var(--bd-text-muted)]">{result.location}</span>}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {!searching && query.trim().length >= 2 && (
              <button
                type="button"
                onClick={() => {
                  setCreatingNew(true)
                  setNewName(query.trim())
                }}
                className="byebye-dpr-tap px-1 text-left text-[0.8125rem] font-semibold text-[var(--bd-purple-strong)] hover:underline"
              >
                Can&apos;t find it? Create &quot;{query.trim()}&quot; as a new job
              </button>
            )}
          </>
        )}

        {selected && (
          <div className="flex items-center gap-2.5 rounded-xl border border-[var(--bd-purple)]/30 bg-[var(--bd-purple-soft)] px-3.5 py-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-[var(--bd-purple-strong)]" aria-hidden="true">
              <Building2 className="h-4 w-4" strokeWidth={1.8} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[0.8125rem] font-semibold text-[var(--bd-text)]">{selected.name}</span>
              {selected.location && <span className="mt-0.5 block truncate text-[0.75rem] text-[var(--bd-text-muted)]">{selected.location}</span>}
            </span>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="byebye-dpr-tap shrink-0 text-[0.75rem] font-semibold text-[var(--bd-purple-strong)] hover:underline"
            >
              Change
            </button>
          </div>
        )}

        {creatingNew && (
          <>
            <button
              type="button"
              onClick={() => setCreatingNew(false)}
              className="byebye-dpr-tap flex items-center gap-1 self-start text-[0.75rem] font-semibold text-[var(--bd-purple-strong)] hover:underline"
            >
              <ArrowLeft className="h-3 w-3" strokeWidth={2.5} aria-hidden="true" />
              Back to search
            </button>
            <input
              autoFocus
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="Job name, e.g. Miami Beach Project"
              className="h-11 w-full rounded-xl border border-[var(--bd-border)] bg-[var(--bd-surface)] px-3.5 text-[0.875rem] text-[var(--bd-text)] outline-none placeholder:text-[var(--bd-text-muted)] focus:border-[var(--bd-purple)] focus:shadow-[0_0_0_3px_rgba(109,91,208,0.14)]"
            />
            <input
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              placeholder="Address (optional)"
              className="h-11 w-full rounded-xl border border-[var(--bd-border)] bg-[var(--bd-surface)] px-3.5 text-[0.875rem] text-[var(--bd-text)] outline-none placeholder:text-[var(--bd-text-muted)] focus:border-[var(--bd-purple)] focus:shadow-[0_0_0_3px_rgba(109,91,208,0.14)]"
            />
            <p className="px-1 text-[0.75rem] text-[var(--bd-text-muted)]">This also adds it to SVC Directory as a job.</p>
          </>
        )}

        {showLocationCapture && (
          <>
            <button
              type="button"
              onClick={captureLocation}
              disabled={locating}
              className="byebye-dpr-tap flex w-full items-center gap-2.5 rounded-xl border border-[var(--bd-border)] bg-[var(--bd-surface)] px-3.5 py-2.5 text-left disabled:opacity-70"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--bd-sky-soft)] text-[var(--bd-sky)]" aria-hidden="true">
                {locating ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} /> : <MapPin className="h-3.5 w-3.5" strokeWidth={1.8} />}
              </span>
              <span className="min-w-0 flex-1 text-[0.8125rem] font-semibold text-[var(--bd-sky)]">
                {coords ? "Location captured" : locating ? "Getting location..." : "Set this job's location"}
              </span>
              {coords && (
                <span className="flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full bg-[var(--bd-complete-soft)] text-[#15803D]" aria-hidden="true">
                  <Check className="h-3 w-3" strokeWidth={2.5} />
                </span>
              )}
            </button>
            {locError && <p className="text-[0.75rem] text-[#DC5A5A]">{locError}</p>}
            {!coords && !locError && (
              <p className="px-1 text-[0.75rem] text-[var(--bd-text-muted)]">Optional, but needed for nearest-job suggestions to work.</p>
            )}
          </>
        )}

        {error && <p className="text-[0.8125rem] text-[#DC5A5A]">{error}</p>}
      </div>

      {(selected || creatingNew) && (
        <BdButton
          variant="primary"
          size="md"
          fullWidth
          className="mt-4"
          disabled={(!selected && !newName.trim()) || submitting}
          onClick={submit}
          icon={submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}
        >
          {submitting ? "Adding..." : "Add Job Site"}
        </BdButton>
      )}
    </BdCard>
  )
}

export function ChangeJobScreen({ jobs, recentJobs, currentJobId, busy = false, onBack, onConfirm, onJobCreated }: ChangeJobScreenProps) {
  const [query, setQuery] = useState("")
  const [findingNearest, setFindingNearest] = useState(false)
  const [geoError, setGeoError] = useState<string | null>(null)
  const [suggestedJobId, setSuggestedJobId] = useState<string | null>(null)
  const [distances, setDistances] = useState<Record<string, number>>({})
  const [selectedId, setSelectedId] = useState<string | null>(currentJobId ?? null)

  const [dirResults, setDirResults] = useState<DirectoryJobSearchResult[]>([])
  const [dirSearching, setDirSearching] = useState(false)
  const [dirSearchError, setDirSearchError] = useState<string | null>(null)
  const [linkingId, setLinkingId] = useState<string | null>(null)
  const [creatingFromQuery, setCreatingFromQuery] = useState(false)

  const suggestedJob = useMemo(() => jobs.find((job) => job.id === suggestedJobId) ?? null, [jobs, suggestedJobId])

  const recentJobsFiltered = useMemo(
    () => recentJobs.filter((job) => job.id !== suggestedJobId),
    [recentJobs, suggestedJobId],
  )
  const recentJobIds = useMemo(() => new Set(recentJobsFiltered.map((job) => job.id)), [recentJobsFiltered])

  const trimmedQuery = query.trim().toLowerCase()
  // With a location fix, jobs that have coordinates sort nearest-first and
  // jobs without one are appended after — never interleaved, since a job
  // with no coordinates has no real distance to rank by.
  const filteredJobs = useMemo(() => {
    const matches = jobs.filter((job) => job.name.toLowerCase().includes(trimmedQuery))
    const base = trimmedQuery ? matches : matches.filter((job) => job.id !== suggestedJobId && !recentJobIds.has(job.id))
    const withDistance = base.filter((job) => distances[job.id] != null).sort((a, b) => distances[a.id] - distances[b.id])
    const withoutDistance = base.filter((job) => distances[job.id] == null)
    return [...withDistance, ...withoutDistance]
  }, [jobs, trimmedQuery, suggestedJobId, recentJobIds, distances])

  useEffect(() => {
    if (trimmedQuery.length < 2) {
      setDirResults([])
      setDirSearchError(null)
      setDirSearching(false)
      return
    }
    setDirSearching(true)
    const handle = setTimeout(() => {
      searchDirectoryJobs(trimmedQuery)
        .then(({ results }) => setDirResults(results))
        .catch((err) => setDirSearchError(err instanceof ByeByeDprClientError ? err.message : "Search failed."))
        .finally(() => setDirSearching(false))
    }, 300)
    return () => clearTimeout(handle)
  }, [trimmedQuery])

  async function handleSelectDirectoryResult(result: DirectoryJobSearchResult) {
    const existing = jobs.find((candidate) => candidate.directoryContextId === result.directoryContextId)
    if (existing) {
      setSelectedId(existing.id)
      return
    }
    if (linkingId) return
    setLinkingId(result.directoryContextId)
    setDirSearchError(null)
    try {
      const { job: created } = await createJob({
        name: result.name,
        directoryContextId: result.directoryContextId,
        address: null,
        latitude: null,
        longitude: null,
      })
      onJobCreated(created)
      setSelectedId(created.id)
    } catch (err) {
      setDirSearchError(err instanceof ByeByeDprClientError ? err.message : "Could not link that job. Try again.")
    } finally {
      setLinkingId(null)
    }
  }

  async function handleCreateFromQuery() {
    if (creatingFromQuery || !trimmedQuery) return
    setCreatingFromQuery(true)
    setDirSearchError(null)
    try {
      const { job: created } = await createJob({
        name: query.trim(),
        directoryContextId: null,
        address: null,
        latitude: null,
        longitude: null,
      })
      onJobCreated(created)
      setSelectedId(created.id)
    } catch (err) {
      setDirSearchError(err instanceof ByeByeDprClientError ? err.message : "Could not add that job. Try again.")
    } finally {
      setCreatingFromQuery(false)
    }
  }

  function jobSubtitle(job: Job): string {
    const base = job.address || "No address set"
    const distance = distances[job.id]
    return distance != null ? `${base} · ${metersToMilesLabel(distance)}` : base
  }

  async function handleUseCurrentLocation() {
    if (findingNearest || jobs.length === 0) return
    setFindingNearest(true)
    setGeoError(null)
    try {
      const position = await getCurrentPosition()
      const location: GeoPoint = { lat: position.coords.latitude, lng: position.coords.longitude }
      const nextDistances: Record<string, number> = {}
      for (const job of jobs) {
        if (job.latitude == null || job.longitude == null) continue
        nextDistances[job.id] = haversineDistanceMeters(location, { lat: job.latitude, lng: job.longitude })
      }
      setDistances(nextDistances)

      const { match } = await fetchNearestJob(location)
      if (match) {
        // The server may have just geocoded and linked a Directory job that
        // wasn't in our local list yet — add it so `suggestedJob`/`selectedJob`
        // (both derived from `jobs`) can actually resolve it below.
        if (!jobs.some((job) => job.id === match.job.id)) onJobCreated(match.job)
        if (match.job.latitude != null && match.job.longitude != null) {
          setDistances((prev) => ({ ...prev, [match.job.id]: match.distanceMeters }))
        }
        setSuggestedJobId(match.job.id)
        setSelectedId(match.job.id)
      } else {
        setGeoError("No job sites have a location set yet.")
      }
    } catch (err) {
      setGeoError(err instanceof ByeByeDprClientError ? err.message : "Couldn't get your location. Check permissions and try again.")
    } finally {
      setFindingNearest(false)
    }
  }

  // Auto-run once on entry — the worker is already mid "Clock In", so asking
  // for location right away (rather than waiting for an extra tap) is the
  // expected next step, not a surprise permission prompt.
  useEffect(() => {
    void handleUseCurrentLocation()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleJobCreated(job: Job) {
    onJobCreated(job)
    setSelectedId(job.id)
  }

  const selectedJob = selectedId ? jobs.find((job) => job.id === selectedId) ?? null : null

  return (
    <div className="byebye-dpr-scope byebye-dpr-canvas relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="byebye-dpr-topbar app-topbar flex shrink-0 items-center justify-between border-b px-4">
        <h1 className="text-[1.0625rem] font-bold text-[var(--bd-text)]">Change Job Site</h1>
        <button
          type="button"
          onClick={onBack}
          disabled={busy}
          className="byebye-dpr-tap flex h-8 w-8 items-center justify-center rounded-full text-[var(--bd-text-muted)] hover:bg-[var(--bd-surface-2)] disabled:opacity-50"
          aria-label="Close"
        >
          <X className="h-4 w-4" strokeWidth={2} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-hide">
        <div className="mx-auto w-full max-w-md px-5 pb-6 pt-5">
          {jobs.length === 0 ? (
            <AddFirstJobCard onCreated={handleJobCreated} />
          ) : (
            <>
              <button
                type="button"
                onClick={handleUseCurrentLocation}
                disabled={findingNearest}
                className="byebye-dpr-tap flex w-full items-center gap-3 py-3 text-left disabled:opacity-70"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--bd-sky-soft)] text-[var(--bd-sky)]" aria-hidden="true">
                  {findingNearest ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} /> : <MapPin className="h-4 w-4" strokeWidth={1.8} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[0.875rem] font-semibold text-[var(--bd-sky)]">
                    {findingNearest ? "Finding nearest job..." : "Use current location"}
                  </span>
                  <span className="mt-0.5 block text-[0.75rem] text-[var(--bd-text-muted)]">Find the nearest job site to you</span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-[var(--bd-text-muted)]" aria-hidden="true" />
              </button>
              {geoError && <p className="px-1 pb-1 text-[0.75rem] text-[#DC5A5A]">{geoError}</p>}

              {suggestedJob && (
                <>
                  <p className="mb-2 mt-4 px-1 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-[var(--bd-text-muted)]">Suggested</p>
                  <button
                    type="button"
                    onClick={() => setSelectedId(suggestedJob.id)}
                    className={cn(
                      "byebye-dpr-tap flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left",
                      selectedId === suggestedJob.id
                        ? "border-[var(--bd-purple)]/30 bg-[var(--bd-purple-soft)]"
                        : "border-[var(--bd-border)] bg-[var(--bd-surface)]",
                    )}
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-[var(--bd-purple-strong)]" aria-hidden="true">
                      <Building2 className="h-4.5 w-4.5" strokeWidth={1.8} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[0.875rem] font-semibold text-[var(--bd-text)]">{suggestedJob.name}</span>
                      <span className="mt-0.5 block truncate text-[0.75rem] text-[var(--bd-text-muted)]">{jobSubtitle(suggestedJob)}</span>
                    </span>
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[var(--bd-purple)]/25 bg-white px-2 py-1 text-[0.6875rem] font-semibold text-[var(--bd-purple-strong)]">
                      <Star className="h-2.5 w-2.5" strokeWidth={2.5} fill="currentColor" aria-hidden="true" />
                      Nearest
                    </span>
                  </button>
                </>
              )}

              {/* First-time worker with no clock history yet: this convenience
                  section simply doesn't render, rather than showing an empty
                  list under a header — "All jobs" below is still the complete,
                  always-available list. */}
              {recentJobsFiltered.length > 0 && (
                <>
                  <p className="mb-1 mt-5 px-1 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-[var(--bd-text-muted)]">Recent jobs</p>
                  <div className="divide-y divide-[var(--bd-border)]">
                    {recentJobsFiltered.map((job) => (
                      <JobRow key={job.id} job={job} selected={selectedId === job.id} subtitle={jobSubtitle(job)} onSelect={() => setSelectedId(job.id)} />
                    ))}
                  </div>
                </>
              )}

              <p className="mb-1 mt-5 px-1 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-[var(--bd-text-muted)]">All jobs</p>
              <div className="mb-1 mt-2 flex items-center gap-2 rounded-xl bg-[var(--bd-surface-2)] px-3">
                <Search className="h-4 w-4 shrink-0 text-[var(--bd-text-muted)]" strokeWidth={2} />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search job sites"
                  className="h-10 min-w-0 flex-1 bg-transparent text-sm text-[var(--bd-text)] outline-none placeholder:text-[var(--bd-text-muted)]"
                />
              </div>
              {trimmedQuery.length >= 2 ? (
                <>
                  {dirSearching && (
                    <p className="flex items-center gap-1.5 px-1 py-2 text-[0.8125rem] text-[var(--bd-text-muted)]">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} /> Searching Directory...
                    </p>
                  )}
                  {dirSearchError && <p className="px-1 py-1 text-[0.8125rem] text-[#DC5A5A]">{dirSearchError}</p>}
                  {!dirSearching && dirResults.length > 0 && (
                    <div className="divide-y divide-[var(--bd-border)]">
                      {dirResults.map((result) => {
                        const existing = jobs.find((candidate) => candidate.directoryContextId === result.directoryContextId)
                        const linking = linkingId === result.directoryContextId
                        const selected = existing != null && selectedId === existing.id
                        return (
                          <button
                            key={result.directoryContextId}
                            type="button"
                            onClick={() => void handleSelectDirectoryResult(result)}
                            disabled={linking}
                            className="byebye-dpr-tap flex w-full items-center gap-3 py-3.5 text-left disabled:opacity-70"
                          >
                            <span
                              className={cn(
                                "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                                selected ? "bg-[var(--bd-purple)] text-white" : "bg-[var(--bd-purple-soft)] text-[var(--bd-purple-strong)]",
                              )}
                              aria-hidden="true"
                            >
                              {linking ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} /> : <Building2 className="h-4.5 w-4.5" strokeWidth={1.8} />}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[0.875rem] font-semibold text-[var(--bd-text)]">{result.name}</span>
                              <span className="mt-0.5 block truncate text-[0.75rem] text-[var(--bd-text-muted)]">
                                {existing ? jobSubtitle(existing) : (result.location ?? "No location set")}
                              </span>
                            </span>
                            {selected && (
                              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--bd-purple)] text-white" aria-hidden="true">
                                <Check className="h-3 w-3" strokeWidth={2.5} />
                              </span>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  )}
                  {!dirSearching && dirResults.length === 0 && !dirSearchError && (
                    <BdEmptyState
                      className="mt-2"
                      icon={<Search className="h-5 w-5 text-[var(--bd-text-muted)]" strokeWidth={2} />}
                      title="No jobs match"
                      description="Search SVC Directory by a different name, or add it as new."
                      action={
                        <BdButton
                          variant="secondary"
                          size="sm"
                          disabled={creatingFromQuery}
                          onClick={() => void handleCreateFromQuery()}
                          icon={creatingFromQuery ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}
                        >
                          {creatingFromQuery ? "Adding..." : `Create "${query.trim()}"`}
                        </BdButton>
                      }
                    />
                  )}
                </>
              ) : filteredJobs.length > 0 ? (
                <div className="divide-y divide-[var(--bd-border)]">
                  {filteredJobs.map((job) => (
                    <JobRow key={job.id} job={job} selected={selectedId === job.id} subtitle={jobSubtitle(job)} onSelect={() => setSelectedId(job.id)} />
                  ))}
                </div>
              ) : (
                <BdEmptyState
                  className="mt-2"
                  icon={<Building2 className="h-5 w-5 text-[var(--bd-text-muted)]" strokeWidth={2} />}
                  title="That's everything"
                  description="Search above to find more jobs from SVC Directory."
                />
              )}
            </>
          )}
        </div>
      </div>

      <div className="byebye-dpr-topbar shrink-0 border-t px-5 pb-[max(env(safe-area-inset-bottom),1rem)] pt-3">
        <div className="mx-auto flex w-full max-w-md flex-col items-center gap-3">
          <BdButton
            variant="primary"
            size="lg"
            fullWidth
            disabled={!selectedJob || busy}
            onClick={() => selectedId && onConfirm(selectedId)}
          >
            {busy ? (
              <>
                <Loader2 className="h-4.5 w-4.5 animate-spin" />
                Clocking in...
              </>
            ) : (
              <span className="flex w-full items-center justify-between">
                Use This Job
                <ChevronRight className="h-4.5 w-4.5" strokeWidth={2.5} aria-hidden="true" />
              </span>
            )}
          </BdButton>
          {selectedId !== null && !busy && (
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              className="byebye-dpr-tap text-[0.8125rem] font-semibold text-[var(--bd-purple-strong)] hover:underline"
            >
              Choose Another Job
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
