"use client"

import { useState } from "react"
import { OUTLOOK_VOICE_ENABLED } from "@/lib/ai/flags"
import { useGeneratingReveal } from "@/hooks/use-generating-reveal"
import { useOutlookAiCapture } from "@/features/outlooks/ai/client/use-outlook-ai-capture"
import { OutlookNaturalLanguageInput } from "@/components/directory/outlooks/outlook-natural-language-input"
import { OutlookAiReviewModal } from "@/components/directory/outlooks/outlook-ai-review"
import type { OutlookContextDefaults } from "@/features/outlooks/ai/normalize-outlook-suggestions"
import type { OutlookTask, OutlookWindow } from "@/lib/outlook-core"

/**
 * Self-contained AI Quick Update unit: the compose card plus the centered
 * review modal. Used inline in the embedded job panel and inside the bottom
 * sheet on the dedicated screen, so both surfaces share one flow.
 *
 * The review modal opens the moment Generate is tapped and shows the AI
 * generating shimmer for a deliberate minimum beat (same pattern as the profile
 * "AI summary") before revealing the draft. On parse failure the modal closes
 * and the error surfaces back on the compose card. Confirming routes through
 * `onConfirm` — the caller's existing deterministic persist.
 */
export function OutlookAiQuickUpdate({
  window,
  companies,
  existingTasks,
  jobName,
  location,
  saving,
  heading,
  onConfirm,
  onManualFallback,
  onAdvanced,
  onDone,
}: {
  window: OutlookWindow
  companies: Array<{ id: string; name: string }>
  existingTasks: OutlookTask[]
  jobName?: string | null
  location?: string | null
  saving: boolean
  heading?: { title: string; subtitle: string }
  onConfirm: (tasks: OutlookTask[]) => Promise<void>
  onManualFallback?: () => void
  onAdvanced?: () => void
  onDone?: () => void
}) {
  const capture = useOutlookAiCapture({ window, companies, existingTasks, jobName, location })
  const [reviewOpen, setReviewOpen] = useState(false)
  const [attempt, setAttempt] = useState(0)
  // Optional chip context — applied only as a fallback for fields the note
  // leaves empty (explicit text always wins).
  const [contextDefaults, setContextDefaults] = useState<OutlookContextDefaults>({})
  // Avoid a flash on very fast responses without adding a noticeable delay
  // after the real parse has already completed.
  const generating = useGeneratingReveal(attempt, capture.parsing, 300)

  const generate = () => {
    if (!capture.canParse) return
    setAttempt((value) => value + 1)
    setReviewOpen(true)
    void capture.runParse(contextDefaults).then(() => {})
  }

  // Parse failed → drop the modal and show the error on the compose card.
  if (reviewOpen && !capture.parsing && capture.error && capture.phase !== "review") {
    setReviewOpen(false)
  }

  const closeReview = () => {
    setReviewOpen(false)
    capture.backToCompose()
  }

  const confirm = async (after?: () => void) => {
    try {
      await onConfirm(capture.acceptedTasks)
      capture.reset()
      setReviewOpen(false)
      after?.()
      onDone?.()
    } catch {
      capture.setError("Those tasks could not be saved. Try again.")
    }
  }

  return (
    <>
      <OutlookNaturalLanguageInput
        text={capture.text}
        onTextChange={capture.setText}
        maxChars={capture.maxTextChars}
        transcribing={capture.transcribing}
        parsing={capture.parsing}
        generationCooldownSeconds={capture.generationCooldownSeconds}
        transcriptionCooldownSeconds={capture.transcriptionCooldownSeconds}
        voiceEnabled={OUTLOOK_VOICE_ENABLED}
        onAudio={(audio) => void capture.transcribeFromAudio(audio)}
        onGenerate={generate}
        onMoreOptions={onManualFallback}
        error={reviewOpen ? "" : capture.error}
        heading={heading}
        companies={companies}
        existingTasks={existingTasks}
        contextDefaults={contextDefaults}
        onContextDefaultsChange={setContextDefaults}
      />

      {reviewOpen && (
        <OutlookAiReviewModal
          window={window}
          review={capture.review}
          companies={companies}
          existingTasks={existingTasks.map((task) => ({ id: task.id, title: task.title }))}
          mode={capture.mode}
          generating={generating || capture.phase !== "review"}
          saving={saving}
          onUpdateTask={capture.updateReviewTask}
          onRemove={capture.removeReviewTask}
          onBack={closeReview}
          onConfirm={() => void confirm()}
          onAdvanced={onAdvanced ? () => void confirm(onAdvanced) : undefined}
        />
      )}
    </>
  )
}
