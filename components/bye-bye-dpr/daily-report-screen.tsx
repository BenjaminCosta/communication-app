"use client"

/**
 * Daily Report — capture step. Voice is tap-to-start / tap-to-stop (not
 * hold-to-record — uncomfortable one-handed in the field, per PRODUCT.md).
 * "Type instead" and "Add photos" are equal, always-visible alternatives.
 *
 * Real backend: recording reuses `useOutlookRecorder`, the same MediaRecorder
 * hook the Outlook module uses (generic despite the name — see its own
 * docstring). On stop, the raw audio is archived and transcribed. The user
 * reviews and edits that source text before deciding whether to organize it.
 */

import { useRef, useState } from "react"
import { ArrowLeft, Building2, Camera, ImagePlus, Keyboard, Lock, Mic, Square, TriangleAlert, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { BdButton, BdCard } from "@/components/bye-bye-dpr/ui/byebye-dpr-primitives"
import { ByeByeDprAiGenerating } from "@/components/bye-bye-dpr/ui/byebye-dpr-ai-generating"
import { useOutlookRecorder } from "@/features/outlooks/voice/use-outlook-recorder"
import { BYE_BYE_DPR_AI_LIMITS } from "@/lib/ai/config-public"
import {
  ByeByeDprClientError,
  transcribeReportAudio,
  uploadReportAudio,
} from "@/features/bye-bye-dpr/client/byebye-dpr-client"
import type { Job } from "@/lib/bye-bye-dpr-store"

type Stage = "choose" | "typing" | "transcribing"

const TRANSCRIBING_STEPS = ["Transcribing your recording", "Almost done"] as const

interface DailyReportScreenProps {
  job: Job
  reportId: string
  photos: string[]
  onAddPhotos: (files: File[]) => void
  onRemovePhoto: (index: number) => void
  onBack: () => void
  onContinue: (input: { source: "voice" | "typed"; text: string }) => void
}

function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, "0")}`
}

function extensionForAudio(type: string): string {
  const mediaType = type.split(";", 1)[0].toLowerCase()
  if (mediaType === "audio/mp4" || mediaType === "audio/m4a" || mediaType === "audio/x-m4a") return "m4a"
  if (mediaType === "audio/ogg") return "ogg"
  if (mediaType === "audio/mpeg") return "mp3"
  if (mediaType === "audio/wav" || mediaType === "audio/x-wav") return "wav"
  return "webm"
}

export function DailyReportScreen({ job, reportId, photos, onAddPhotos, onRemovePhoto, onBack, onContinue }: DailyReportScreenProps) {
  const [stage, setStage] = useState<Stage>("choose")
  const [typedText, setTypedText] = useState("")
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const recorder = useOutlookRecorder({
    maxSeconds: BYE_BYE_DPR_AI_LIMITS.maxAudioSeconds,
    onComplete: async (audio, durationMs) => {
      setStage("transcribing")
      setError(null)
      const fileName = `daily-report-${Date.now()}.${extensionForAudio(audio.type)}`
      // Best-effort raw-audio archive — never blocks getting to the transcript.
      uploadReportAudio(reportId, audio, fileName).catch(() => {})
      try {
        // Mobile recorders (Safari/iOS MP4 in particular) often produce a
        // streamed/fragmented container with no readable duration — the
        // server falls back to this wall-clock value from the recorder
        // itself. Without it, server-side validation has nothing to fall
        // back to and rejects the recording outright (desktop Chrome's
        // WebM output usually has a readable duration, so this only bit
        // mobile).
        const { transcript } = await transcribeReportAudio(reportId, audio, fileName, durationMs)
        onContinue({ source: "voice", text: transcript })
      } catch (err) {
        setStage("choose")
        setError(err instanceof ByeByeDprClientError ? err.message : "Transcription failed. Try again, or type your update instead.")
      }
    },
  })

  function submitTyped() {
    if (!typedText.trim()) return
    setError(null)
    onContinue({ source: "typed", text: typedText.trim() })
  }

  function handlePhotoSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    if (files.length === 0) return
    onAddPhotos(files)
    event.target.value = ""
  }

  const micState = recorder.state
  const showRecordCard = stage === "choose"

  return (
    <div className="byebye-dpr-scope byebye-dpr-canvas relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="byebye-dpr-topbar app-topbar flex shrink-0 items-center gap-3 border-b px-4">
        <button type="button" onClick={onBack} className="byebye-dpr-tap flex h-9 w-9 items-center justify-center rounded-full text-[var(--bd-text)] hover:bg-[var(--bd-surface-2)]" aria-label="Back">
          <ArrowLeft className="h-4.5 w-4.5" strokeWidth={2} />
        </button>
        <h1 className="text-[1.0625rem] font-bold text-[var(--bd-text)]">Daily Report</h1>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-hide">
        <div className="mx-auto w-full max-w-md px-4 pb-10 pt-4">
          <BdCard className="flex items-center gap-3 px-4 py-3" flat>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--bd-purple-soft)] text-[var(--bd-purple-strong)]" aria-hidden="true">
              <Building2 className="h-4 w-4" strokeWidth={1.8} />
            </span>
            <span className="truncate text-[0.9375rem] font-semibold text-[var(--bd-text)]">{job.name}</span>
            <span className="ml-auto shrink-0 text-[0.8125rem] text-[var(--bd-text-muted)]">
              {new Date().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
            </span>
          </BdCard>

          {error && (
            <div className="byebye-dpr-step-enter mt-4 flex items-start gap-2 rounded-2xl bg-[var(--bd-missing-soft)] px-3.5 py-2.5 text-[0.8125rem] font-semibold text-[#B3261E]">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
              <span className="min-w-0 flex-1">{error}</span>
            </div>
          )}

          {stage === "transcribing" && (
            <BdCard className="byebye-dpr-step-enter mt-4 flex flex-col items-center px-6 py-10 text-center">
              <ByeByeDprAiGenerating
                steps={TRANSCRIBING_STEPS}
                label="Preparing your transcription for review"
              />
            </BdCard>
          )}

          {showRecordCard && (
            <BdCard className="byebye-dpr-step-enter mt-4 flex flex-col items-center px-6 py-8 text-center">
              <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-[var(--bd-text-muted)]">Record your update</p>

              <button
                type="button"
                onClick={() => {
                  setError(null)
                  if (micState === "recording") recorder.stop()
                  else if (micState === "idle" || micState === "error") void recorder.start()
                }}
                disabled={micState === "permission" || micState === "processing"}
                className={cn(
                  "byebye-dpr-tap relative mt-6 flex h-32 w-32 items-center justify-center rounded-full transition-colors disabled:opacity-70",
                  micState === "recording"
                    ? "byebye-dpr-record-pulse bg-[#DC5A5A] text-white"
                    : "bg-[var(--bd-purple-soft)] text-[var(--bd-purple)]",
                )}
                aria-label={micState === "recording" ? "Stop recording" : "Start recording"}
              >
                {micState === "recording" ? <Square className="h-9 w-9" strokeWidth={2} fill="currentColor" /> : <Mic className="h-11 w-11" strokeWidth={1.8} />}
              </button>

              <p className="mt-4 text-[0.9375rem] font-bold text-[var(--bd-text)]">
                {micState === "recording"
                  ? formatClock(recorder.seconds)
                  : micState === "permission"
                    ? "Requesting microphone..."
                    : micState === "processing"
                      ? "Finishing recording..."
                      : "Start Recording"}
              </p>
              <p className="mt-1 max-w-[16rem] text-[0.8125rem] text-[var(--bd-text-muted)]">
                {micState === "recording" ? "Speak freely, hands-free. Tap the square to stop." : "Tap once to start, tap again to stop."}
              </p>

              <div className="mt-6 flex gap-2.5">
                <BdButton
                  variant="secondary"
                  size="md"
                  icon={<Keyboard className="h-4 w-4" strokeWidth={1.8} />}
                  onClick={() => setStage("typing")}
                  disabled={micState === "recording" || micState === "permission"}
                >
                  Type instead
                </BdButton>
                <BdButton
                  variant="secondary"
                  size="md"
                  icon={<Camera className="h-4 w-4" strokeWidth={1.8} />}
                  onClick={() => fileInputRef.current?.click()}
                >
                  Add photos
                </BdButton>
              </div>

              <p className="mt-5 flex items-center gap-1.5 text-[0.75rem] text-[var(--bd-text-muted)]">
                <Lock className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
                Your update is private until submitted
              </p>
            </BdCard>
          )}

          {stage === "typing" && (
            <BdCard className="byebye-dpr-form-reveal byebye-dpr-step-enter mt-4 p-4">
              <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-[var(--bd-text-muted)]">Type your update</p>
              <textarea
                autoFocus
                value={typedText}
                onChange={(event) => setTypedText(event.target.value)}
                placeholder="What did you finish today? Any issues, who was on site, what's next..."
                rows={7}
                maxLength={BYE_BYE_DPR_AI_LIMITS.maxTextChars}
                className="mt-3 w-full resize-none rounded-xl border border-[var(--bd-border)] bg-[var(--bd-surface)] p-3 text-[0.9375rem] text-[var(--bd-text)] outline-none placeholder:text-[var(--bd-text-muted)] focus:border-[var(--bd-purple)] focus:shadow-[0_0_0_3px_rgba(109,91,208,0.14)]"
              />
              <div className="mt-3 flex gap-2.5">
                <BdButton variant="ghost" size="md" onClick={() => setStage("choose")}>
                  Back
                </BdButton>
                <BdButton variant="primary" size="md" fullWidth disabled={!typedText.trim()} onClick={submitTyped}>
                  Continue
                </BdButton>
              </div>
            </BdCard>
          )}

          <input ref={fileInputRef} type="file" accept="image/*" multiple capture="environment" className="hidden" onChange={handlePhotoSelect} />

          {photos.length > 0 && (
            <div className="mt-4">
              <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-[var(--bd-text-muted)]">Photos ({photos.length})</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {photos.map((url, index) => (
                  <div key={url} className="group relative h-20 w-20 overflow-hidden rounded-xl border border-[var(--bd-border)]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt="" className="h-full w-full object-cover" />
                    <button
                      type="button"
                      onClick={() => onRemovePhoto(index)}
                      className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/55 text-white"
                      aria-label="Remove photo"
                    >
                      <X className="h-3 w-3" strokeWidth={2.5} />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="byebye-dpr-tap flex h-20 w-20 items-center justify-center rounded-xl border border-dashed border-[var(--bd-border)] text-[var(--bd-text-muted)]"
                  aria-label="Add another photo"
                >
                  <ImagePlus className="h-5 w-5" strokeWidth={1.8} />
                </button>
              </div>
            </div>
          )}

          {recorder.errorMessage && micState === "error" && (
            <p className="mt-3 text-center text-[0.8125rem] text-[#DC5A5A]">{recorder.errorMessage}</p>
          )}
        </div>
      </div>
    </div>
  )
}
