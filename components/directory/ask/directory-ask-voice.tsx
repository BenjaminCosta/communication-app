"use client"

import { useEffect, useRef } from "react"
import { Check, Loader2, X } from "lucide-react"
import { DIRECTORY_AI_LIMITS } from "@/lib/ai/config-public"
import { useOutlookRecorder } from "@/features/outlooks/voice/use-outlook-recorder"
import { cn } from "@/lib/utils"

// Decorative equalizer heights (px) for the "Listening…" orb.
const WAVE_BARS = [10, 20, 34, 16, 44, 24, 52, 30, 46, 18, 38, 22, 12]

/**
 * Full-screen "Listening…" panel for a spoken Directory question (mockup screen
 * 4). Reuses the shared MediaRecorder hook; the mic is always released on stop /
 * cancel / unmount. On stop it hands the audio to the parent, which transcribes
 * it into the editable question box before anything is asked.
 */
export function DirectoryAskVoice({
  question,
  onAudio,
  onClose,
  onError,
}: {
  question: string
  onAudio: (audio: Blob, durationMs: number) => void
  onClose: () => void
  onError?: (message: string) => void
}) {
  const recorder = useOutlookRecorder({
    maxSeconds: DIRECTORY_AI_LIMITS.maxAudioSeconds,
    onComplete: (audio, durationMs) => {
      onAudio(audio, durationMs)
      onClose()
    },
  })

  // Auto-start recording as soon as the panel opens.
  const startedRef = useRef(false)
  const startRef = useRef(recorder.start)
  startRef.current = recorder.start
  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    void startRef.current()
  }, [])

  // Surface permission / no-audio failures to the parent, then close.
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const { errorMessage } = recorder
  useEffect(() => {
    if (errorMessage) {
      onErrorRef.current?.(errorMessage)
      onCloseRef.current()
    }
  }, [errorMessage])

  const processing = recorder.state === "processing"
  const requesting = recorder.state === "permission"

  return (
    <div className="animate-fade-in absolute inset-0 z-30 flex flex-col bg-[rgba(7,11,17,0.97)] backdrop-blur-xl">
      <header className="app-topbar flex shrink-0 items-center justify-between px-4">
        <span className="text-base font-medium tracking-tight text-foreground">Ask <span className="text-[var(--directory-title)]">SVC Directory</span></span>
        <button
          type="button"
          onClick={() => { recorder.cancel(); onClose() }}
          className="glass-button flex h-9 w-9 items-center justify-center rounded-full border active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--directory-ai)]/70"
          aria-label="Cancel voice question"
        >
          <X className="h-4 w-4 text-white/80" strokeWidth={1.8} />
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-8 text-center">
        <h2 className="text-2xl font-light tracking-tight text-foreground">
          {processing ? "Transcribing…" : requesting ? "Starting…" : "Listening…"}
        </h2>
        {question.trim() && (
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground/80 line-clamp-3">{question.trim()}</p>
        )}

        <div className="relative mt-12 flex h-56 w-56 items-center justify-center">
          <span className="directory-ask-orb absolute inset-0 rounded-full" aria-hidden="true" />
          <span className="absolute inset-3 rounded-full border border-[var(--directory-ai-border)] bg-[#0a0e16]/70" aria-hidden="true" />
          <span className="relative flex h-16 items-end gap-[3px]" aria-hidden="true">
            {WAVE_BARS.map((height, index) => (
              <span
                key={index}
                className={cn(
                  "outlook-wave-bar w-[3px] shrink-0 rounded-full",
                  index % 3 === 0 ? "bg-[var(--directory-company)]" : "bg-[var(--directory-ai)]",
                )}
                style={{ height: `${height}px`, animationDelay: `${index * 0.07}s` }}
              />
            ))}
          </span>
        </div>

        <p className="mt-10 font-mono text-sm tabular-nums text-muted-foreground/70">
          {formatSeconds(recorder.seconds)}
        </p>
        <p className="mt-1 text-xs text-muted-foreground/55">Keep speaking — your transcript stays editable.</p>
      </div>

      <div className="shrink-0 px-8 pb-[calc(var(--sab)+1.5rem)]">
        <button
          type="button"
          onClick={recorder.stop}
          disabled={recorder.state !== "recording"}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[var(--directory-ai-action)] py-3.5 text-sm font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] transition-transform active:scale-[0.98] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--directory-ai)]/70"
        >
          {processing ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} /> : <Check className="h-4 w-4" strokeWidth={2.2} />}
          Use transcript
        </button>
        <button
          type="button"
          onClick={() => { recorder.cancel(); onClose() }}
          className="mt-2 w-full py-2 text-sm text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--directory-ai)]/70"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

function formatSeconds(total: number): string {
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, "0")}`
}
