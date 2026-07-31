"use client"

/**
 * "Generating answer" placeholder for Quest Coral's Ask AI — same skeleton +
 * rotating-status-copy pattern as components/directory/ask/directory-ask-generating.tsx,
 * re-skinned in Quest Coral's light, coral-only AI accent and sized for the
 * compact footer space Ask AI occupies here (inside AiBriefCard / the
 * portfolio Ask AI card), rather than Directory's full-screen layout.
 */

import { useEffect, useState } from "react"
import { Sparkles } from "lucide-react"

const GENERATION_STEPS = [
  "Reviewing project updates",
  "Checking blockers & Red Team notes",
  "Writing a grounded answer",
] as const

export function QuestCoralAskGenerating({ question }: { question: string }) {
  const [step, setStep] = useState(0)

  useEffect(() => {
    const timer = window.setInterval(() => {
      setStep((current) => (current + 1) % GENERATION_STEPS.length)
    }, 1400)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <div className="quest-coral-step-enter mt-2 space-y-2.5" aria-live="polite" aria-busy="true">
      <div className="flex items-center gap-2">
        <span className="quest-coral-ask-generating-orb flex h-6 w-6 shrink-0 items-center justify-center rounded-lg" aria-hidden="true">
          <Sparkles className="h-3 w-3 text-white" strokeWidth={2.2} />
        </span>
        <p key={GENERATION_STEPS[step]} className="quest-coral-ask-generation-copy min-w-0 truncate text-[0.75rem] font-medium text-[var(--coral-text-muted)]">
          {GENERATION_STEPS[step]}
        </p>
      </div>
      <div className="space-y-1.5 rounded-xl border border-[var(--coral-border)] bg-white p-2.5" aria-hidden="true">
        <div className="h-2.5 w-[88%] rounded-full quest-coral-ai-shimmer" />
        <div className="h-2.5 w-[62%] rounded-full quest-coral-ai-shimmer" style={{ animationDelay: "0.15s" }} />
      </div>
      <p className="sr-only">Generating an answer to: {question}</p>
    </div>
  )
}

/**
 * Compact variant for "AI Project Brief" — no rotating status copy (brief
 * generation is a single quick call, not a multi-step conversation), just
 * the shimmer bars, sized to sit directly as the card body.
 */
export function QuestCoralBriefGenerating() {
  return (
    <div className="quest-coral-step-enter space-y-1.5" aria-live="polite" aria-busy="true">
      <div className="h-3 w-[92%] rounded-full quest-coral-ai-shimmer" />
      <div className="h-3 w-[70%] rounded-full quest-coral-ai-shimmer" style={{ animationDelay: "0.15s" }} />
      <p className="sr-only">Generating the AI project brief…</p>
    </div>
  )
}
