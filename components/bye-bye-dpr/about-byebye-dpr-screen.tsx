"use client"

/**
 * "About this module" — ByeByeDPR's onboarding/tutorial screen. Same shape
 * and weight as Quest Coral's about-quest-coral-screen.tsx (hero card, "Why
 * this module?" grid, numbered "How it works" steps, a closing card) —
 * content grounded in PRODUCT.md rather than invented. Static, no
 * interactivity beyond back.
 */

import type { ComponentType } from "react"
import { ArrowLeft, Building2, CheckCircle2, Clock, HardHat, Hand, Mic, Send, ShieldCheck, Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"
import { BdButton, BdCard, SectionLabel } from "@/components/bye-bye-dpr/ui/byebye-dpr-primitives"

interface AboutByeByeDprScreenProps {
  onBack: () => void
  className?: string
}

type IconType = ComponentType<{ className?: string; strokeWidth?: number }>

function IconBadge({ icon: Icon }: { icon: IconType }) {
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--bd-purple-soft)] text-[var(--bd-purple-strong)]">
      <Icon className="h-4.5 w-4.5" strokeWidth={2} />
    </span>
  )
}

const VALUE_PROPS: Array<{ icon: IconType; title: string; body: string }> = [
  {
    icon: Clock,
    title: "What problem does it solve?",
    body: "Paper timesheets and daily reports that get lost, delayed, or never filled out.",
  },
  {
    icon: CheckCircle2,
    title: "What question does it answer?",
    body: "Who's on site, since when, and what got done today?",
  },
  {
    icon: HardHat,
    title: "Who uses it?",
    body: "Field crews — carpenters, electricians, laborers, foremen — on their own phone.",
  },
  {
    icon: Sparkles,
    title: "How it works",
    body: "Clock in, clock out, and dictate your update. AI structures it for you.",
  },
]

const STEPS: Array<{ icon: IconType; title: string; body: string }> = [
  { icon: Building2, title: "Set your job site", body: "Confirm or change it any time before clocking in." },
  { icon: Clock, title: "Clock in", body: "One tap when you start your shift." },
  { icon: CheckCircle2, title: "Clock out", body: "One tap when you're done. Forgot? Fix it any time, no approval needed." },
  { icon: Mic, title: "Daily Report", body: "Record or type your update — AI structures it for you." },
  { icon: Send, title: "Auto-posted", body: "Turned into a PDF and posted to Comms automatically." },
]

const PRINCIPLES: Array<{ icon: IconType; title: string; body: string }> = [
  { icon: Hand, title: "One tap, one task", body: "One primary action per screen" },
  { icon: Mic, title: "Voice-first", body: "Speak your update, hands-free" },
  { icon: ShieldCheck, title: "You're in control", body: "AI drafts are always editable" },
]

export function AboutByeByeDprScreen({ onBack, className }: AboutByeByeDprScreenProps) {
  return (
    <div className={cn("byebye-dpr-scope byebye-dpr-canvas relative flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden", className)}>
      <header className="byebye-dpr-topbar app-topbar flex shrink-0 items-center gap-3 border-b px-4">
        <button
          type="button"
          onClick={onBack}
          className="byebye-dpr-tap flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--bd-border)] bg-[var(--bd-surface)] text-[var(--bd-text)]"
          aria-label="Back to home"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={2} />
        </button>
        <h1 className="min-w-0 flex-1 truncate text-center text-[0.9375rem] font-semibold text-[var(--bd-text)]">About ByeByeDPR</h1>
        <span className="h-9 w-9 shrink-0" aria-hidden="true" />
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-hide">
        <div className="mx-auto flex w-full max-w-md flex-col gap-5 px-5 pb-10 pt-4">
          <BdCard className="flex items-center gap-3.5 overflow-hidden p-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[var(--bd-purple)] text-white">
              <HardHat className="h-6 w-6" strokeWidth={2} />
            </span>
            <div className="min-w-0">
              <p className="text-base font-bold tracking-tight text-[var(--bd-text)]">
                SVC <span className="text-[var(--bd-purple-strong)]">ByeByeDPR</span>
              </p>
              <p className="mt-0.5 text-[0.8125rem] leading-snug text-[var(--bd-text-muted)]">
                Clock in, clock out, and submit your daily report — all in under a minute.
              </p>
            </div>
          </BdCard>

          <div>
            <SectionLabel>Why this module?</SectionLabel>
            <div className="mt-2.5 grid grid-cols-2 gap-3">
              {VALUE_PROPS.map((prop) => (
                <BdCard key={prop.title} className="p-3.5">
                  <IconBadge icon={prop.icon} />
                  <p className="mt-2 text-[0.75rem] font-semibold leading-snug text-[var(--bd-text)]">{prop.title}</p>
                  <p className="mt-1 text-[0.6875rem] leading-snug text-[var(--bd-text-muted)]">{prop.body}</p>
                </BdCard>
              ))}
            </div>
          </div>

          <div>
            <SectionLabel>How it works (5 steps)</SectionLabel>
            <div className="mt-2.5 flex flex-col gap-2">
              {STEPS.map((step, index) => (
                <BdCard key={step.title} flat className="flex items-start gap-3 p-3.5">
                  <div className="relative shrink-0">
                    <IconBadge icon={step.icon} />
                    <span className="absolute -bottom-1 -right-1 flex h-4.5 w-4.5 items-center justify-center rounded-full bg-[var(--bd-purple)] text-[0.5625rem] font-bold text-white ring-2 ring-[var(--bd-surface)]">
                      {index + 1}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1 pt-0.5">
                    <p className="text-sm font-semibold text-[var(--bd-text)]">{step.title}</p>
                    <p className="mt-0.5 text-[0.75rem] leading-snug text-[var(--bd-text-muted)]">{step.body}</p>
                  </div>
                </BdCard>
              ))}
            </div>
          </div>

          <div>
            <SectionLabel>Built for the field</SectionLabel>
            <div className="mt-2.5 grid grid-cols-3 gap-2">
              {PRINCIPLES.map((principle) => (
                <BdCard key={principle.title} className="flex flex-col items-center gap-1.5 p-3 text-center">
                  <IconBadge icon={principle.icon} />
                  <p className="text-[0.75rem] font-semibold text-[var(--bd-text)]">{principle.title}</p>
                  <p className="text-[0.625rem] text-[var(--bd-text-muted)]">{principle.body}</p>
                </BdCard>
              ))}
            </div>
          </div>

          <BdCard className="flex items-center gap-3 p-4">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--bd-purple-soft)] text-[var(--bd-purple-strong)]" aria-hidden="true">
              <HardHat className="h-4 w-4" strokeWidth={2} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[0.8125rem] font-semibold text-[var(--bd-text)]">Ready to get started?</p>
              <p className="mt-0.5 text-xs text-[var(--bd-text-muted)]">Head back to clock in or submit today's report.</p>
            </div>
            <BdButton size="sm" onClick={onBack}>
              Back to Home
            </BdButton>
          </BdCard>
        </div>
      </div>
    </div>
  )
}
