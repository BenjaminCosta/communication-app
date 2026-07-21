"use client"

import { useEffect, useState } from "react"
import { Sparkles } from "lucide-react"

const GENERATION_STEPS = [
  "Searching the Directory",
  "Connecting related records",
  "Writing a grounded answer",
] as const

export function DirectoryAskGenerating({ question }: { question: string }) {
  const [step, setStep] = useState(0)

  useEffect(() => {
    const timer = window.setInterval(() => {
      setStep((current) => (current + 1) % GENERATION_STEPS.length)
    }, 1650)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <section className="directory-ask-generating animate-fade-in space-y-4" aria-live="polite" aria-busy="true">
      <header className="flex items-center gap-2.5">
        <span className="directory-ask-generating-orb flex h-9 w-9 items-center justify-center rounded-xl" aria-hidden="true">
          <Sparkles className="h-4 w-4 text-[var(--directory-ai)]" strokeWidth={1.8} />
        </span>
        <div className="min-w-0">
          <p className="directory-ai-text text-[11px] font-semibold uppercase tracking-[0.14em]">Generating answer</p>
          <p key={GENERATION_STEPS[step]} className="directory-ask-generation-copy mt-0.5 text-sm font-medium text-foreground/88">{GENERATION_STEPS[step]}</p>
        </div>
      </header>

      <div className="directory-ask-loading-panel overflow-hidden rounded-2xl border p-3.5" aria-hidden="true">
        <div className="grid grid-cols-3 gap-2">
          {[0, 1, 2].map((index) => <span key={index} className="h-2.5 rounded-full directory-ai-shimmer" style={{ animationDelay: `${index * 0.12}s` }} />)}
        </div>
        <div className="mt-4 space-y-2.5">
          <div className="h-4 w-[92%] rounded-full directory-ai-shimmer" />
          <div className="h-4 w-[68%] rounded-full directory-ai-shimmer" style={{ animationDelay: "0.15s" }} />
          <div className="h-4 w-[80%] rounded-full directory-ai-shimmer" style={{ animationDelay: "0.3s" }} />
        </div>
      </div>

      {[0, 1].map((row) => (
        <div key={row} className="directory-ask-loading-row rounded-2xl border p-3.5" aria-hidden="true">
          <div className="h-3.5 w-[52%] rounded-full directory-ai-shimmer" style={{ animationDelay: `${0.12 + row * 0.15}s` }} />
          <div className="mt-2 h-3 w-[36%] rounded-full directory-ai-shimmer" style={{ animationDelay: `${0.22 + row * 0.15}s` }} />
        </div>
      ))}
      <p className="px-1 text-center text-[11px] text-muted-foreground/50">{question}</p>
    </section>
  )
}
