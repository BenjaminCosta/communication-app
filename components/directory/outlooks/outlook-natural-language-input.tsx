"use client"

import { useState } from "react"
import { Clipboard, Loader2, Sparkles, X } from "lucide-react"
import { OutlookVoiceControl } from "@/components/directory/outlooks/outlook-voice-control"
import { OutlookContextChips } from "@/components/directory/outlooks/outlook-context-chips"
import type { OutlookContextDefaults } from "@/features/outlooks/ai/normalize-outlook-suggestions"
import type { OutlookTask } from "@/lib/outlook-core"
import { cn } from "@/lib/utils"

/**
 * AI-first "Quick Update" compose card (see reference design).
 *
 * An editable note — typed or dictated — that the parser turns into a reviewable
 * draft. Manual entry stays one tap away via the field chips / "More options",
 * which open the deterministic quick-add form. Nothing is saved here; the CTA
 * only *generates* a draft for review.
 */

export function OutlookNaturalLanguageInput({
  text,
  onTextChange,
  maxChars,
  transcribing,
  parsing,
  generationCooldownSeconds,
  transcriptionCooldownSeconds,
  voiceEnabled,
  onAudio,
  onGenerate,
  onMoreOptions,
  error,
  heading,
  companies,
  existingTasks,
  contextDefaults,
  onContextDefaultsChange,
}: {
  text: string
  onTextChange: (value: string) => void
  maxChars: number
  transcribing: boolean
  parsing: boolean
  generationCooldownSeconds: number
  transcriptionCooldownSeconds: number
  voiceEnabled: boolean
  onAudio: (audio: Blob) => void
  onGenerate: () => void
  onMoreOptions?: () => void
  error: string
  heading?: { title: string; subtitle: string }
  companies: Array<{ id: string; name: string }>
  existingTasks: OutlookTask[]
  contextDefaults: OutlookContextDefaults
  onContextDefaultsChange: (next: OutlookContextDefaults) => void
}) {
  const remaining = maxChars - text.length
  const [voiceCapturing, setVoiceCapturing] = useState(false)
  const busy = parsing || transcribing || voiceCapturing
  const canGenerate = text.trim().length > 0 && !busy && generationCooldownSeconds === 0
  // Recorder failures (permission denied, empty audio…) render in the shared
  // error slot; cleared as soon as the user types or records again.
  const [voiceError, setVoiceError] = useState("")
  const cooldownMessage = generationCooldownSeconds > 0
    ? `Task generation is available again in ${formatCountdown(generationCooldownSeconds)}.`
    : transcriptionCooldownSeconds > 0
      ? `Voice transcription is available again in ${formatCountdown(transcriptionCooldownSeconds)}.`
      : ""
  const visibleError = cooldownMessage || error || voiceError

  const pasteNotes = async () => {
    try {
      const clip = await navigator.clipboard.readText()
      if (clip) onTextChange((text.trim() ? `${text.trim()}\n${clip}` : clip).slice(0, maxChars))
    } catch {
      /* clipboard blocked — user can type instead */
    }
  }

  return (
    <div className="space-y-4">
      {heading && (
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg border border-[var(--directory-job-border)] bg-[var(--directory-job-soft)] text-[var(--directory-job)]">
            <Sparkles className={cn("h-3.5 w-3.5", parsing && "directory-ai-spark")} strokeWidth={2} />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground/92">{heading.title}</h3>
            <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground/55">{heading.subtitle}</p>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-[var(--directory-job-border)] bg-[#0a111b]/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition focus-within:border-[var(--directory-job)]/55 focus-within:ring-2 focus-within:ring-violet-500/10">
        <div className="relative">
          <textarea
            value={text}
            onChange={(event) => {
              setVoiceError("")
              onTextChange(event.target.value.slice(0, maxChars))
            }}
            rows={4}
            disabled={parsing}
            placeholder="Write or speak update…"
            className="min-h-[6.5rem] w-full resize-none bg-transparent px-4 pb-2 pr-16 pt-4 text-[15px] leading-6 text-foreground/90 outline-none placeholder:text-muted-foreground/40 disabled:opacity-70"
          />
          {voiceEnabled && (
            <div className="absolute bottom-2.5 right-2.5">
              <OutlookVoiceControl
                onAudio={(audio) => {
                  setVoiceError("")
                  onAudio(audio)
                }}
                busy={transcribing}
                disabled={parsing || transcriptionCooldownSeconds > 0}
                onError={setVoiceError}
                onActiveChange={setVoiceCapturing}
              />
            </div>
          )}
        </div>
        <div className="flex items-center justify-between border-t border-white/[0.06] px-2.5 py-1.5">
          <button
            type="button"
            onClick={() => void pasteNotes()}
            disabled={parsing}
            className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-medium text-muted-foreground/65 transition-colors hover:text-foreground/85 disabled:opacity-40"
          >
            <Clipboard className="h-3.5 w-3.5" strokeWidth={1.8} />
            Paste notes
          </button>
          <button
            type="button"
            onClick={() => {
              setVoiceError("")
              onTextChange("")
            }}
            disabled={!text || parsing}
            className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-medium text-muted-foreground/55 transition-colors hover:text-foreground/80 disabled:opacity-30"
          >
            <X className="h-3.5 w-3.5" strokeWidth={1.8} />
            Clear
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between px-0.5 text-[9px] text-muted-foreground/45">
        <span>Every task is reviewed before it’s saved.</span>
        <span className={cn("font-mono", remaining < 0 && "text-orange-300/80")}>{remaining}</span>
      </div>

      {visibleError && (
        <p className="rounded-xl border border-orange-400/25 bg-orange-400/[0.07] px-3 py-2.5 text-[11px] leading-5 text-orange-100/85" role="alert">
          {visibleError}
        </p>
      )}

      <OutlookContextChips
        companies={companies}
        existingTasks={existingTasks}
        contextDefaults={contextDefaults}
        onContextDefaultsChange={onContextDefaultsChange}
      />

      <button
        type="button"
        onClick={onGenerate}
        disabled={!canGenerate}
        className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[var(--directory-job)] text-[13px] font-semibold text-[#0b0f14] shadow-[0_8px_24px_-8px_var(--directory-job),inset_0_1px_0_rgba(255,255,255,0.28)] transition-[opacity,transform] active:scale-[0.98] disabled:opacity-40 disabled:shadow-none"
      >
        {generationCooldownSeconds > 0 ? (
          <>Try again in {formatCountdown(generationCooldownSeconds)}</>
        ) : parsing ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
            Generating outlook…
          </>
        ) : (
          <>
            Generate Outlook
            <Sparkles className="h-4 w-4" strokeWidth={2} />
          </>
        )}
      </button>

      {onMoreOptions && (
        <button
          type="button"
          onClick={onMoreOptions}
          className="mx-auto block text-[12px] font-semibold text-[var(--directory-job)] transition-opacity active:opacity-60"
        >
          More options
        </button>
      )}
    </div>
  )
}

function formatCountdown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, "0")}`
}
