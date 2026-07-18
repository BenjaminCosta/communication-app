"use client"

import { useEffect, useRef } from "react"
import { Loader2, Mic, Square, X } from "lucide-react"
import { OUTLOOK_AI_LIMITS } from "@/lib/ai/config-public"
import { useOutlookRecorder } from "@/features/outlooks/voice/use-outlook-recorder"
import { cn } from "@/lib/utils"

// Base heights (px) for the decorative "Listening…" equalizer bars.
const WAVE_BARS = [7, 12, 16, 9, 14, 6, 11, 15, 8]

/**
 * Inline microphone for the AI compose card. Idle state is a compact circular
 * button that lives inside the textarea; while recording it expands leftward
 * into a pill with a live timer and stop/cancel.
 */
export function OutlookVoiceControl({
  onAudio,
  busy = false,
  disabled = false,
  onError,
  onActiveChange,
}: {
  onAudio: (audio: Blob) => void
  busy?: boolean
  disabled?: boolean
  onError?: (message: string) => void
  onActiveChange?: (active: boolean) => void
}) {
  const recorder = useOutlookRecorder({ maxSeconds: OUTLOOK_AI_LIMITS.maxAudioSeconds, onComplete: onAudio })

  // Surface recorder failures (permission denied, no audio…) to the parent's
  // error slot — the inline mic has no room for its own message.
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError
  const { errorMessage } = recorder
  useEffect(() => {
    if (errorMessage) onErrorRef.current?.(errorMessage)
  }, [errorMessage])

  const onActiveChangeRef = useRef(onActiveChange)
  onActiveChangeRef.current = onActiveChange
  useEffect(() => {
    const active = recorder.state === "permission" || recorder.state === "recording" || recorder.state === "processing"
    onActiveChangeRef.current?.(active)
  }, [recorder.state])
  useEffect(() => () => onActiveChangeRef.current?.(false), [])

  if (!recorder.isSupported) return null

  if (busy || recorder.state === "processing") {
    return (
      <span className="flex h-11 w-11 items-center justify-center rounded-full border border-[var(--directory-job-border)] bg-[var(--directory-job-soft)] text-[var(--directory-job)]">
        <Loader2 className="h-4.5 w-4.5 animate-spin" strokeWidth={1.8} />
      </span>
    )
  }

  if (recorder.state === "recording") {
    return (
      <div className="flex items-center gap-2 rounded-full border border-violet-500 bg-[#21183a] py-1.5 pl-3 pr-1.5 shadow-[0_4px_18px_rgba(76,29,149,0.24)]">
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-teal-300/70" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-teal-400" />
        </span>
        <span className="hidden text-[10px] font-semibold uppercase tracking-wide text-violet-100 min-[360px]:inline">Listening</span>
        <span className="flex h-4 items-center gap-[2px]" aria-hidden="true">
          {WAVE_BARS.map((height, index) => (
            <span
              key={index}
              className={cn("outlook-wave-bar w-[2px] shrink-0 rounded-full", index % 3 === 0 ? "bg-teal-300" : "bg-violet-300")}
              style={{ height: `${height}px`, animationDelay: `${index * 0.08}s` }}
            />
          ))}
        </span>
        <span className="font-mono text-[10px] tabular-nums text-violet-100/70">{formatSeconds(recorder.seconds)}</span>
        <button
          type="button"
          onClick={recorder.cancel}
          className="ml-0.5 flex h-8 w-8 items-center justify-center rounded-full text-violet-100/70 transition-colors hover:text-violet-50 active:scale-[0.94]"
          aria-label="Cancel recording"
        >
          <X className="h-4 w-4" strokeWidth={2} />
        </button>
        <button
          type="button"
          onClick={recorder.stop}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-600 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.24)] active:scale-[0.94]"
          aria-label="Stop recording"
        >
          <Square className="h-3 w-3 fill-current" strokeWidth={0} />
        </button>
      </div>
    )
  }

  const requesting = recorder.state === "permission"
  return (
    <button
      type="button"
      onClick={() => {
        if (recorder.state === "error") recorder.reset()
        void recorder.start()
      }}
      disabled={disabled || requesting}
      className={cn(
        "flex h-11 w-11 items-center justify-center rounded-full border transition-[background-color,transform,box-shadow] active:scale-[0.94] disabled:opacity-45",
        "border-[var(--directory-job-border)] bg-[var(--directory-job-soft)] text-[var(--directory-job)] hover:bg-[var(--directory-job)]/18 hover:shadow-[0_0_0_4px_var(--directory-job-soft)]",
      )}
      aria-label={requesting ? "Waiting for microphone" : "Record a voice note"}
    >
      {requesting ? <Loader2 className="h-4.5 w-4.5 animate-spin" strokeWidth={1.8} /> : <Mic className="h-4.5 w-4.5" strokeWidth={1.8} />}
    </button>
  )
}

function formatSeconds(total: number): string {
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, "0")}`
}
