"use client"

import { useCallback, useEffect, useRef, useState } from "react"

/**
 * Browser audio recorder for Outlook voice notes, built on MediaRecorder.
 *
 * Explicit state machine so the UI can reflect every stage the handoff requires:
 *   idle → permission → recording → processing → (idle | error)
 *
 * Guarantees:
 *  - microphone tracks are always stopped on stop/cancel/unmount (no hot mic);
 *  - a hard max-duration auto-stops the recording;
 *  - the recorded audio is handed back as a Blob and never persisted here;
 *  - unsupported browsers and denied permission surface as typed errors.
 */

export type OutlookRecorderState = "idle" | "permission" | "recording" | "processing" | "error"

export type OutlookRecorderErrorKind =
  | "unsupported"
  | "permission-denied"
  | "no-audio"
  | "unknown"

interface UseOutlookRecorderOptions {
  maxSeconds?: number
  onComplete?: (audio: Blob, durationMs: number) => void
}

const PREFERRED_MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"]

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined
  return PREFERRED_MIME_TYPES.find((type) => {
    try {
      return MediaRecorder.isTypeSupported(type)
    } catch {
      return false
    }
  })
}

function errorMessageFor(kind: OutlookRecorderErrorKind): string {
  switch (kind) {
    case "unsupported":
      return "Voice recording is not supported in this browser."
    case "permission-denied":
      return "Microphone access was blocked. Enable it in your browser settings to record."
    case "no-audio":
      return "No audio was captured. Try recording again."
    default:
      return "Recording failed. You can still type the note."
  }
}

export function useOutlookRecorder({ maxSeconds = 120, onComplete }: UseOutlookRecorderOptions = {}) {
  const [state, setState] = useState<OutlookRecorderState>("idle")
  const [errorKind, setErrorKind] = useState<OutlookRecorderErrorKind | null>(null)
  const [seconds, setSeconds] = useState(0)
  const [isSupported, setIsSupported] = useState(true)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const maxTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const recordingStartedAtRef = useRef<number | null>(null)
  const cancelledRef = useRef(false)
  const startingRef = useRef(false)
  // Keep the latest callback without re-subscribing the recorder handlers.
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete

  useEffect(() => {
    setIsSupported(
      typeof window !== "undefined" &&
        typeof navigator !== "undefined" &&
        Boolean(navigator.mediaDevices?.getUserMedia) &&
        typeof MediaRecorder !== "undefined",
    )
  }, [])

  const clearTimers = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    if (maxTimeoutRef.current) clearTimeout(maxTimeoutRef.current)
    intervalRef.current = null
    maxTimeoutRef.current = null
  }, [])

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  const fail = useCallback(
    (kind: OutlookRecorderErrorKind) => {
      clearTimers()
      stopTracks()
      recorderRef.current = null
      recordingStartedAtRef.current = null
      startingRef.current = false
      chunksRef.current = []
      setErrorKind(kind)
      setState("error")
    },
    [clearTimers, stopTracks],
  )

  const start = useCallback(async () => {
    if (startingRef.current || state === "recording" || state === "permission" || state === "processing") return
    startingRef.current = true
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setIsSupported(false)
      fail("unsupported")
      return
    }

    setErrorKind(null)
    setSeconds(0)
    cancelledRef.current = false
    setState("permission")

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (error) {
      const denied =
        error instanceof DOMException &&
        (error.name === "NotAllowedError" || error.name === "SecurityError" || error.name === "PermissionDeniedError")
      fail(denied ? "permission-denied" : "unknown")
      return
    }

    streamRef.current = stream
    chunksRef.current = []
    const mimeType = pickMimeType()
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    recorderRef.current = recorder

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) chunksRef.current.push(event.data)
    }
    recorder.onstop = () => {
      clearTimers()
      stopTracks()
      const durationMs = recordingStartedAtRef.current == null
        ? 0
        : Math.max(1, Math.round(performance.now() - recordingStartedAtRef.current))
      recordingStartedAtRef.current = null
      const type = recorder.mimeType || mimeType || "audio/webm"
      const blob = new Blob(chunksRef.current, { type })
      chunksRef.current = []
      recorderRef.current = null
      if (cancelledRef.current) {
        setState("idle")
        return
      }
      if (blob.size === 0) {
        setErrorKind("no-audio")
        setState("error")
        return
      }
      setState("idle")
      onCompleteRef.current?.(blob, durationMs)
    }
    recorder.onerror = () => fail("unknown")

    try {
      recorder.start()
      recordingStartedAtRef.current = performance.now()
    } catch {
      fail("unknown")
      return
    }
    startingRef.current = false
    setState("recording")

    intervalRef.current = setInterval(() => setSeconds((value) => value + 1), 1000)
    maxTimeoutRef.current = setTimeout(() => {
      if (recorderRef.current?.state === "recording") recorderRef.current.stop()
    }, maxSeconds * 1000)
  }, [state, fail, clearTimers, stopTracks, maxSeconds])

  const stop = useCallback(() => {
    if (recorderRef.current?.state === "recording") {
      cancelledRef.current = false
      setState("processing")
      recorderRef.current.stop()
    }
  }, [])

  const cancel = useCallback(() => {
    clearTimers()
    if (recorderRef.current?.state === "recording") {
      cancelledRef.current = true
      recorderRef.current.stop()
    } else {
      stopTracks()
      recorderRef.current = null
      recordingStartedAtRef.current = null
      startingRef.current = false
      chunksRef.current = []
      setState("idle")
    }
    setErrorKind(null)
    setSeconds(0)
  }, [clearTimers, stopTracks])

  const reset = useCallback(() => {
    setErrorKind(null)
    setSeconds(0)
    setState("idle")
    startingRef.current = false
    recordingStartedAtRef.current = null
  }, [])

  // Always release the mic if the component unmounts mid-recording.
  useEffect(() => {
    return () => {
      clearTimers()
      if (recorderRef.current?.state === "recording") {
        cancelledRef.current = true
        try {
          recorderRef.current.stop()
        } catch {
          /* ignore */
        }
      }
      stopTracks()
    }
  }, [clearTimers, stopTracks])

  return {
    state,
    errorKind,
    errorMessage: errorKind ? errorMessageFor(errorKind) : null,
    seconds,
    maxSeconds,
    isSupported,
    isRecording: state === "recording",
    start,
    stop,
    cancel,
    reset,
  }
}
