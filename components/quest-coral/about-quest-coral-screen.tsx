"use client"

/**
 * "About this module" — Quest Coral's onboarding/tutorial screen. Static
 * content, no interactivity beyond back (and an optional "Ask AI" jump-off
 * at the bottom), same weight as Applications' "Need a hand?" tips (see
 * candidate-flow-screen.tsx) but a full screen since Quest Coral has more
 * to explain up front.
 */

import type { ComponentType } from "react"
import {
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Compass,
  Flag,
  FolderKanban,
  LayoutDashboard,
  Search,
  Sparkles,
  Users,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { QcButton, QcCard, SectionLabel } from "@/components/quest-coral/ui/quest-coral-primitives"

interface AboutQuestCoralScreenProps {
  onBack: () => void
  /** Jumps back to Home with the Ask AI card already open. Falls back to onBack. */
  onAskAI?: () => void
  className?: string
}

type IconType = ComponentType<{ className?: string; strokeWidth?: number }>

function IconBadge({ icon: Icon }: { icon: IconType }) {
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--coral-soft)] text-[var(--coral-strong)]">
      <Icon className="h-4.5 w-4.5" strokeWidth={2} />
    </span>
  )
}

const VALUE_PROPS: Array<{ icon: IconType; title: string; body: string }> = [
  {
    icon: Compass,
    title: "What problem does it solve?",
    body: "Scattered updates, unclear status, and missing context across projects.",
  },
  {
    icon: ClipboardList,
    title: "What question does it answer?",
    body: "What's happening, what's next, and what do we need?",
  },
  {
    icon: Users,
    title: "Who uses it?",
    body: "Project owners, teams, leaders and stakeholders.",
  },
  {
    icon: LayoutDashboard,
    title: "How it works",
    body: "A simple flow to track progress, get feedback, and move forward.",
  },
]

const STEPS: Array<{ icon: IconType; title: string; body: string }> = [
  { icon: Search, title: "Create project", body: "Set goals, owner, and priority." },
  { icon: Users, title: "Add people", body: "Invite the right team and partners." },
  { icon: Flag, title: "Define next step", body: "Decide the next action and date." },
  { icon: CalendarClock, title: "Share updates", body: "Update progress, share feedback, raise blockers." },
  { icon: CheckCircle2, title: "Stay aligned", body: "Use insights and Ask AI to keep moving forward." },
]

const ACCESS_POINTS: Array<{ icon: IconType; title: string; body: string }> = [
  { icon: FolderKanban, title: "Projects tab", body: "Home dashboard" },
  { icon: Flag, title: "Project detail", body: "Central hub" },
  { icon: Sparkles, title: "Ask AI", body: "Anywhere in the app" },
]

export function AboutQuestCoralScreen({ onBack, onAskAI, className }: AboutQuestCoralScreenProps) {
  return (
    <div className={cn("quest-coral-scope quest-coral-canvas relative flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden", className)}>
      <header className="quest-coral-topbar app-topbar flex shrink-0 items-center gap-3 border-b px-4 animate-slide-down">
        <button
          type="button"
          onClick={onBack}
          className="quest-coral-tap flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--coral-border)] bg-[var(--coral-surface)] text-[var(--coral-text)]"
          aria-label="Back to projects"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={2} />
        </button>
        <h1 className="min-w-0 flex-1 truncate text-center text-[0.9375rem] font-semibold text-[var(--coral-text)]">About Quest Coral</h1>
        <span className="h-9 w-9 shrink-0" aria-hidden="true" />
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-hide">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 pb-10 pt-4 md:px-6">
          <QcCard className="flex items-center gap-3.5 overflow-hidden p-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[var(--coral)] text-white">
              <FolderKanban className="h-6 w-6" strokeWidth={2} />
            </span>
            <div className="min-w-0">
              <p className="text-base font-bold tracking-tight text-[var(--coral-text)]">
                SVC <span className="text-[var(--coral-strong)]">Quest Coral</span>
              </p>
              <p className="mt-0.5 text-[0.8125rem] leading-snug text-[var(--coral-text-muted)]">
                A project tracker built to keep every initiative visible and moving forward.
              </p>
            </div>
          </QcCard>

          <div>
            <SectionLabel>Why this module?</SectionLabel>
            <div className="mt-2.5 grid grid-cols-2 gap-3">
              {VALUE_PROPS.map((prop) => (
                <QcCard key={prop.title} className="p-3.5">
                  <IconBadge icon={prop.icon} />
                  <p className="mt-2 text-[0.75rem] font-semibold leading-snug text-[var(--coral-text)]">{prop.title}</p>
                  <p className="mt-1 text-[0.6875rem] leading-snug text-[var(--coral-text-muted)]">{prop.body}</p>
                </QcCard>
              ))}
            </div>
          </div>

          <div>
            <SectionLabel>How it works (5 steps)</SectionLabel>
            <div className="mt-2.5 flex flex-col gap-2">
              {STEPS.map((step, index) => (
                <QcCard key={step.title} flat className="flex items-start gap-3 p-3.5">
                  <div className="relative shrink-0">
                    <IconBadge icon={step.icon} />
                    <span className="absolute -bottom-1 -right-1 flex h-4.5 w-4.5 items-center justify-center rounded-full bg-[var(--coral)] text-[0.5625rem] font-bold text-white ring-2 ring-[var(--coral-surface)]">
                      {index + 1}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1 pt-0.5">
                    <p className="text-sm font-semibold text-[var(--coral-text)]">{step.title}</p>
                    <p className="mt-0.5 text-[0.75rem] leading-snug text-[var(--coral-text-muted)]">{step.body}</p>
                  </div>
                </QcCard>
              ))}
            </div>
          </div>

          <div>
            <SectionLabel>Access points — mobile-first</SectionLabel>
            <div className="mt-2.5 grid grid-cols-3 gap-2">
              {ACCESS_POINTS.map((point) => (
                <QcCard key={point.title} className="flex flex-col items-center gap-1.5 p-3 text-center">
                  <IconBadge icon={point.icon} />
                  <p className="text-[0.75rem] font-semibold text-[var(--coral-text)]">{point.title}</p>
                  <p className="text-[0.625rem] text-[var(--coral-text-muted)]">{point.body}</p>
                </QcCard>
              ))}
            </div>
          </div>

          <QcCard className="flex items-center gap-3 border-[#FFD9CD] bg-[var(--coral-ai-soft)] p-4">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--coral-surface)] text-[var(--coral-ai)]">
              <Sparkles className="h-4 w-4" strokeWidth={2} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[0.8125rem] font-semibold text-[var(--coral-text)]">Need help getting started?</p>
              <p className="mt-0.5 text-xs text-[var(--coral-text-muted)]">Explore the quick start guide or ask AI for help.</p>
            </div>
            <QcButton size="sm" onClick={onAskAI ?? onBack}>
              Ask AI
            </QcButton>
          </QcCard>
        </div>
      </div>
    </div>
  )
}
