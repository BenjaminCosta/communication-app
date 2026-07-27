"use client"

import { useRef } from "react"
import { Check, Clock, Play, Upload, Video, X } from "lucide-react"
import { StepLayout } from "@/components/applications/candidate/step-layout"
import { AppsButton, AppsCard } from "@/components/applications/ui/apps-primitives"
import { INTRO_VIDEO_PROMPTS, type IntroVideo } from "@/lib/applications-core"

interface VideoStepProps {
  video: IntroVideo
  upload?: { percent: number | null; error: string | null }
  onCapture: (source: "record" | "upload", file: File) => void
  onRemove: () => void
  onContinue: () => void
  onSkip: () => void
}

/** Decorative: a phone with a play button over a construction skyline. */
function VideoIllustration() {
  return (
    <div className="relative flex h-52 items-center justify-center overflow-hidden rounded-2xl bg-[var(--apps-surface-2)]">
      <svg viewBox="0 0 320 200" className="absolute inset-0 h-full w-full" aria-hidden="true" preserveAspectRatio="xMidYMax slice">
        {/* skyline */}
        <path d="M0 168h44v-38h20v38h34v-56h26v56h30v-24h22v24h144v32H0z" fill="#DBEAFE" />
        {/* crane */}
        <path d="M244 40h4v128h-4z" fill="#CFE0F5" />
        <path d="M204 40h84v5h-84z" fill="#CFE0F5" />
        <path d="M214 45h2v18h-2z" fill="#CFE0F5" />
      </svg>

      <div className="relative flex h-40 w-[5.5rem] items-center justify-center rounded-[1.1rem] border-[3px] border-[#1E3A5F] bg-white shadow-[0_10px_24px_rgba(15,23,42,0.12)]">
        <span className="absolute left-1/2 top-1.5 h-1 w-6 -translate-x-1/2 rounded-full bg-[#1E3A5F]/25" aria-hidden="true" />
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--apps-blue)] shadow-[0_6px_16px_rgba(37,99,235,0.32)]">
          <Play className="ml-0.5 h-5 w-5 text-white" strokeWidth={2} fill="currentColor" />
        </span>
      </div>
    </div>
  )
}

export function VideoStep({ video, upload, onCapture, onRemove, onContinue, onSkip }: VideoStepProps) {
  const recordRef = useRef<HTMLInputElement>(null)
  const uploadRef = useRef<HTMLInputElement>(null)
  const isReady = video.state === "ready"
  const isProcessing = video.state === "processing"
  const uploadingPercent = upload?.percent ?? null

  return (
    <StepLayout
      title="Please tell us:"
      primary={
        isReady
          ? { label: "Continue", onClick: onContinue }
          : {
              label: isProcessing ? "Uploading…" : "Record video",
              onClick: () => recordRef.current?.click(),
              disabled: isProcessing,
              icon: <Video className="h-4.5 w-4.5" strokeWidth={2} />,
            }
      }
      secondary={
        isReady
          ? { label: "Record again", onClick: () => recordRef.current?.click() }
          : {
              label: "Upload from phone",
              onClick: () => uploadRef.current?.click(),
              disabled: isProcessing,
              icon: <Upload className="h-4.5 w-4.5" strokeWidth={2} />,
            }
      }
      note={
        isReady ? (
          "You can re-record it if you're not happy with it."
        ) : (
          <span className="inline-flex items-center gap-1.5">
            <Clock className="h-3 w-3" strokeWidth={2} />
            Est. time: 1–2 minutes
          </span>
        )
      }
    >
      {/* "Record" opens the phone camera; "Upload" opens the gallery/files. */}
      <input
        ref={recordRef}
        type="file"
        accept="video/*"
        capture="user"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) onCapture("record", file)
          event.target.value = ""
        }}
      />
      <input
        ref={uploadRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) onCapture("upload", file)
          event.target.value = ""
        }}
      />

      <ul className="-mt-2 flex flex-col gap-3">
        {INTRO_VIDEO_PROMPTS.map((prompt) => (
          <li key={prompt} className="flex items-center gap-3">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--apps-blue)] text-white">
              <Check className="h-3 w-3" strokeWidth={3} />
            </span>
            <span className="text-[0.9375rem] font-medium text-[var(--apps-text)]">{prompt}</span>
          </li>
        ))}
      </ul>

      <div className="mt-6">
        {isReady || isProcessing ? (
          <AppsCard className="overflow-hidden">
            <div className="flex items-center gap-3.5 p-4">
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-[var(--apps-blue-soft)]">
                {isProcessing ? (
                  <span className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--apps-blue)] border-t-transparent" />
                ) : (
                  <Play className="h-5 w-5 text-[var(--apps-blue-strong)]" strokeWidth={2} fill="currentColor" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-[var(--apps-text)]">{video.fileName ?? "Intro video"}</p>
                <p className="mt-0.5 text-xs text-[var(--apps-text-muted)]">
                  {isProcessing
                    ? uploadingPercent !== null
                      ? `Uploading… ${uploadingPercent}%`
                      : "Uploading…"
                    : `Video uploaded · ${Math.floor((video.durationSeconds ?? 0) / 60)}:${String((video.durationSeconds ?? 0) % 60).padStart(2, "0")}`}
                </p>
              </div>
              {isReady && (
                <>
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--apps-complete-soft)] text-[#15803D]">
                    <Check className="h-4 w-4" strokeWidth={3} />
                  </span>
                  <button
                    type="button"
                    onClick={onRemove}
                    className="applications-tap flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--apps-text-muted)] hover:bg-[var(--apps-surface-2)]"
                    aria-label="Remove video"
                  >
                    <X className="h-4 w-4" strokeWidth={2} />
                  </button>
                </>
              )}
            </div>
          </AppsCard>
        ) : (
          <VideoIllustration />
        )}
      </div>

      {upload?.error && (
        <p className="mt-3 rounded-xl border border-[#FBD0D0] bg-[var(--apps-missing-soft)] px-3.5 py-2.5 text-[0.8125rem] font-medium text-[#DC5A5A]">
          {upload.error}
        </p>
      )}

      {!isReady && (
        <div className="mt-3 text-center">
          <AppsButton variant="ghost" size="sm" onClick={onSkip}>
            I'll do this later
          </AppsButton>
        </div>
      )}
    </StepLayout>
  )
}
