"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { localDateToIso, type OutlookTask, type OutlookWindow } from "@/lib/outlook-core"
import { OUTLOOK_AI_LIMITS } from "@/lib/ai/config-public"
import {
  createOutlookAiIdempotencyKey,
  OutlookAiClientError,
  requestOutlookParse,
  requestOutlookTranscription,
} from "@/features/outlooks/ai/client/outlook-ai-client"
import {
  normalizeOutlookSuggestions,
  type CompanyOption,
  type NormalizedSuggestion,
  type OutlookContextDefaults,
} from "@/features/outlooks/ai/normalize-outlook-suggestions"

/**
 * Orchestrates the client capture flow the handoff describes:
 *   voice → transcript → editable text → parse → structured draft → review.
 *
 * It owns only transient capture state. It never persists anything: producing
 * reviewable drafts is the end of its responsibility. The caller confirms and
 * routes the accepted drafts through the existing `persist` path so the
 * deterministic scheduler stays the single source of truth.
 */

export type CapturePhase = "compose" | "review"

interface UseOutlookAiCaptureInput {
  window: OutlookWindow
  companies: CompanyOption[]
  existingTasks: OutlookTask[]
  jobName?: string | null
  location?: string | null
}

export function useOutlookAiCapture({
  window,
  companies,
  existingTasks,
  jobName,
  location,
}: UseOutlookAiCaptureInput) {
  const [phase, setPhase] = useState<CapturePhase>("compose")
  const [text, setText] = useState("")
  const [transcribing, setTranscribing] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [error, setError] = useState("")
  const [mode, setMode] = useState<"mock" | "live" | null>(null)
  const [review, setReview] = useState<NormalizedSuggestion[]>([])
  const [generationCooldownUntil, setGenerationCooldownUntil] = useState(0)
  const [transcriptionCooldownUntil, setTranscriptionCooldownUntil] = useState(0)
  const [clockMs, setClockMs] = useState(() => Date.now())
  // Guards against a double submit landing two parse/transcribe calls at once.
  const busyRef = useRef(false)

  const maxTextChars = OUTLOOK_AI_LIMITS.maxTextChars
  const generationCooldownSeconds = secondsRemaining(generationCooldownUntil, clockMs)
  const transcriptionCooldownSeconds = secondsRemaining(transcriptionCooldownUntil, clockMs)

  useEffect(() => {
    if (generationCooldownSeconds <= 0 && transcriptionCooldownSeconds <= 0) return
    const timer = setInterval(() => setClockMs(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [generationCooldownSeconds, transcriptionCooldownSeconds])

  useEffect(() => {
    if (generationCooldownUntil > 0 && generationCooldownSeconds === 0) {
      setGenerationCooldownUntil(0)
      setError("")
    }
    if (transcriptionCooldownUntil > 0 && transcriptionCooldownSeconds === 0) {
      setTranscriptionCooldownUntil(0)
      setError("")
    }
  }, [generationCooldownUntil, generationCooldownSeconds, transcriptionCooldownUntil, transcriptionCooldownSeconds])

  const buildContext = useCallback(
    () => ({
      windowStart: window.start,
      windowEnd: window.end,
      today: localDateToIso(new Date()),
      jobName: jobName ?? null,
      location: location ?? null,
      companies: companies.slice(0, 200),
      existingTasks: existingTasks.map((task) => ({
        id: task.id,
        title: task.title,
        startDate: task.startDate,
        endDate: task.endDate,
      })),
    }),
    [window.start, window.end, jobName, location, companies, existingTasks],
  )

  const transcribeFromAudio = useCallback(async (audio: Blob) => {
    if (busyRef.current || transcriptionCooldownUntil > Date.now()) return
    busyRef.current = true
    setTranscribing(true)
    setError("")
    try {
      const result = await requestOutlookTranscription(audio, {
        idempotencyKey: createOutlookAiIdempotencyKey(),
      })
      setMode(result.mode)
      // Append so a second recording adds to, rather than wipes, existing notes.
      setText((current) => {
        const next = current.trim() ? `${current.trim()} ${result.transcript}` : result.transcript
        return next.slice(0, maxTextChars)
      })
    } catch (err) {
      if (err instanceof OutlookAiClientError && err.code === "rate-limited" && err.retryAfterSeconds) {
        const until = Date.now() + err.retryAfterSeconds * 1000
        setTranscriptionCooldownUntil(until)
        setClockMs(Date.now())
      }
      setError(err instanceof Error ? err.message : "Transcription failed.")
    } finally {
      setTranscribing(false)
      busyRef.current = false
    }
  }, [maxTextChars, transcriptionCooldownUntil])

  const runParse = useCallback(async (defaults: OutlookContextDefaults = {}) => {
    const trimmed = text.trim()
    if (!trimmed || busyRef.current || generationCooldownUntil > Date.now()) return
    busyRef.current = true
    setParsing(true)
    setError("")
    try {
      const result = await requestOutlookParse(trimmed.slice(0, maxTextChars), buildContext(), {
        idempotencyKey: createOutlookAiIdempotencyKey(),
      })
      setMode(result.mode)
      const normalized = normalizeOutlookSuggestions(
        result.suggestions,
        { companies, existingTasks: existingTasks.map((task) => ({ id: task.id, title: task.title })) },
        existingTasks.length,
        defaults,
      )
      if (normalized.length === 0) {
        setError("No tasks were detected. Try adding more detail, or type them manually.")
        return
      }
      setReview(normalized)
      setPhase("review")
    } catch (err) {
      if (err instanceof OutlookAiClientError && err.code === "rate-limited" && err.retryAfterSeconds) {
        const until = Date.now() + err.retryAfterSeconds * 1000
        setGenerationCooldownUntil(until)
        setClockMs(Date.now())
      }
      setError(err instanceof Error ? err.message : "Parsing failed.")
    } finally {
      setParsing(false)
      busyRef.current = false
    }
  }, [text, maxTextChars, buildContext, companies, existingTasks, generationCooldownUntil])

  const updateReviewTask = useCallback((taskId: string, patch: Partial<OutlookTask>) => {
    setReview((current) =>
      current.map((entry) => (entry.task.id === taskId ? { ...entry, task: { ...entry.task, ...patch } } : entry)),
    )
  }, [])

  const removeReviewTask = useCallback((taskId: string) => {
    setReview((current) => current.filter((entry) => entry.task.id !== taskId))
  }, [])

  const backToCompose = useCallback(() => {
    setPhase("compose")
    setError("")
  }, [])

  const reset = useCallback(() => {
    setPhase("compose")
    setText("")
    setReview([])
    setError("")
    setMode(null)
  }, [])

  const acceptedTasks = useMemo(() => review.map((entry) => entry.task), [review])

  return {
    phase,
    text,
    setText,
    transcribing,
    parsing,
    error,
    setError,
    mode,
    review,
    acceptedTasks,
    maxTextChars,
    generationCooldownSeconds,
    transcriptionCooldownSeconds,
    canParse: text.trim().length > 0 && !parsing && !transcribing && generationCooldownSeconds === 0,
    transcribeFromAudio,
    runParse,
    updateReviewTask,
    removeReviewTask,
    backToCompose,
    reset,
  }
}

function secondsRemaining(untilMs: number, nowMs: number): number {
  return untilMs > nowMs ? Math.max(1, Math.ceil((untilMs - nowMs) / 1000)) : 0
}
