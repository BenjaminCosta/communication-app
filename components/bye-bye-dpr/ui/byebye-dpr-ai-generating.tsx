"use client"

/**
 * "AI is generating" placeholder — same orb + rotating-status-copy +
 * shimmer-skeleton pattern as components/quest-coral/ui/quest-coral-ask-generating.tsx
 * (which itself mirrors components/directory/ask/directory-ask-generating.tsx),
 * re-skinned in this module's purple identity. Replaces the record button
 * while a Daily Report is being transcribed/structured.
 */

import { useEffect, useState } from "react"
import { Sparkles } from "lucide-react"

interface ByeByeDprAiGeneratingProps {
  /** Rotating status lines, shown one at a time. */
  steps: readonly string[]
  /** Screen-reader-only description of what's being generated. */
  label: string
}

export function ByeByeDprAiGenerating({ steps, label }: ByeByeDprAiGeneratingProps) {
  const [step, setStep] = useState(0)

  useEffect(() => {
    setStep(0)
    const timer = window.setInterval(() => {
      setStep((current) => (current + 1) % steps.length)
    }, 900)
    return () => window.clearInterval(timer)
  }, [steps])

  return (
    <div className="byebye-dpr-step-enter flex flex-col items-center gap-3" aria-live="polite" aria-busy="true">
      <span className="byebye-dpr-ai-generating-orb flex h-16 w-16 items-center justify-center rounded-full" aria-hidden="true">
        <Sparkles className="h-6 w-6 text-white" strokeWidth={2} />
      </span>
      <p key={steps[step]} className="byebye-dpr-ai-generation-copy text-[0.9375rem] font-bold text-[var(--bd-text)]">
        {steps[step]}
      </p>
      <div className="w-full max-w-[15rem] space-y-1.5 rounded-xl border border-[var(--bd-border)] bg-[var(--bd-surface)] p-2.5" aria-hidden="true">
        <div className="byebye-dpr-ai-shimmer h-2.5 w-[88%] rounded-full" />
        <div className="byebye-dpr-ai-shimmer h-2.5 w-[62%] rounded-full" style={{ animationDelay: "0.15s" }} />
      </div>
      <p className="sr-only">{label}</p>
    </div>
  )
}
