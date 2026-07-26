"use client"

import { BriefcaseBusiness, Check, Lock } from "lucide-react"
import { cn } from "@/lib/utils"
import { StepLayout } from "@/components/applications/candidate/step-layout"
import { AppsCard, ProgressRing } from "@/components/applications/ui/apps-primitives"
import {
  APPLICATION_TIME_ESTIMATE,
  type ApplicationProgress,
  type CandidateApplication,
  type SectionState,
} from "@/lib/applications-core"

interface WelcomeStepProps {
  application: CandidateApplication
  progress: ApplicationProgress
  onContinue: () => void
}

const STATE_TEXT: Record<SectionState, { label: string; className: string }> = {
  complete: { label: "Complete", className: "text-[#15803D]" },
  in_progress: { label: "In progress", className: "text-[var(--apps-blue)]" },
  not_started: { label: "Not started", className: "text-[var(--apps-text-muted)]" },
}

function StepNumber({ index, state }: { index: number; state: SectionState }) {
  if (state === "complete") {
    return (
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--apps-blue)] text-[0.6875rem] font-bold text-white">
        {index}
      </span>
    )
  }
  return (
    <span
      className={cn(
        "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[0.6875rem] font-bold",
        state === "in_progress"
          ? "border-[var(--apps-blue)] bg-[var(--apps-surface)] text-[var(--apps-blue)]"
          : "border-[var(--apps-border)] bg-[var(--apps-surface-2)] text-[var(--apps-text-muted)]",
      )}
    >
      {index}
    </span>
  )
}

export function WelcomeStep({ application, progress, onContinue }: WelcomeStepProps) {
  const invitedName = application.candidateName.trim() || application.general.fullName.trim()
  const firstName = invitedName.split(/\s+/)[0]
  // Name and trade can be prefilled by the reviewer. Those are context for
  // the candidate, not evidence that they already started the form.
  const invitedOnly =
    application.general.fullName.trim() === application.candidateName.trim() &&
    application.general.primaryTrade.trim() === application.trade.trim() &&
    !application.general.phone.trim() &&
    !application.general.email.trim() &&
    !application.general.cityState.trim() &&
    !application.general.yearsExperience.trim() &&
    !application.general.resumeFileName.trim() &&
    !application.general.workReference.trim() &&
    application.video.state === "not_started" &&
    application.documents.every((document) => document.status === "missing")
  const started = !invitedOnly && progress.percent > 0
  const displayProgress = invitedOnly ? { ...progress, percent: 0, sections: progress.sections.map((section) => ({ ...section, state: "not_started" as const })) } : progress
  const hasOpportunityContext = Boolean(application.trade || application.job.name)

  const steps: Array<{ label: string; state: SectionState }> = [
    ...displayProgress.sections.map((section) => ({ label: section.label, state: section.state })),
    { label: "Review", state: displayProgress.isComplete ? "in_progress" : "not_started" },
  ]

  return (
    <StepLayout
      title={firstName ? (started ? `Welcome back, ${firstName}` : `Welcome, ${firstName}`) : "Complete your application"}
      intro={
        hasOpportunityContext
          ? `You're applying for ${application.trade || "this opportunity"}${application.job.name ? ` at ${application.job.name}` : ""}. It takes around ${APPLICATION_TIME_ESTIMATE}.`
          : `It takes around ${APPLICATION_TIME_ESTIMATE} and your progress saves automatically.`
      }
      primary={{ label: started ? "Continue" : "Start application", onClick: onContinue }}
      note={
        <span className="inline-flex items-center gap-1.5">
          <Lock className="h-3 w-3" strokeWidth={2} />
          Nothing is shared until you submit.
        </span>
      }
    >
      {hasOpportunityContext && (
        <AppsCard className="flex items-center gap-3 p-4" flat>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--apps-blue-soft)] text-[var(--apps-blue-strong)]">
            <BriefcaseBusiness className="h-4 w-4" strokeWidth={2} />
          </span>
          <div className="min-w-0">
            <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-[var(--apps-text-muted)]">Your opportunity</p>
            <p className="mt-0.5 truncate text-sm font-semibold text-[var(--apps-text)]">
              {application.trade || "SVC candidate"}{application.job.name ? ` · ${application.job.name}` : ""}
            </p>
          </div>
        </AppsCard>
      )}

      <AppsCard className={cn("p-5", hasOpportunityContext && "mt-3.5")}>
        <p className="text-[0.8125rem] font-semibold text-[var(--apps-text)]">Your application</p>
        <div className="mt-3.5 flex items-center gap-5">
          <ProgressRing percent={displayProgress.percent} />
          <div className="min-w-0">
            <p className="text-sm font-bold text-[var(--apps-text)]">
              {displayProgress.percent === 0 ? "Ready when you are" : displayProgress.isComplete ? "All set" : "Keep going!"}
            </p>
            <p className="mt-1 text-[0.8125rem] leading-snug text-[var(--apps-text-muted)]">
              {displayProgress.percent === 0
                ? "Four short steps, one at a time."
                : displayProgress.isComplete
                  ? "Review your answers and submit."
                  : "You're making great progress."}
            </p>
          </div>
        </div>
      </AppsCard>

      <AppsCard className="mt-3.5 overflow-hidden">
        <ul className="divide-y divide-[var(--apps-border)]">
          {steps.map((step, index) => {
            const state = STATE_TEXT[step.state]
            return (
              <li key={step.label} className="flex min-h-[3.5rem] items-center gap-3 px-4 py-3">
                <StepNumber index={index + 1} state={step.state} />
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-sm font-semibold",
                    step.state === "not_started" ? "text-[var(--apps-text-muted)]" : "text-[var(--apps-text)]",
                  )}
                >
                  {step.label}
                </span>
                <span className={cn("shrink-0 text-[0.8125rem] font-medium", state.className)}>{state.label}</span>
                {step.state === "complete" && (
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--apps-complete)] text-white">
                    <Check className="h-3 w-3" strokeWidth={3} />
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      </AppsCard>

      {application.job.name && (
        <p className="mt-4 px-1 text-xs leading-relaxed text-[var(--apps-text-muted)]">
          Applying for <span className="font-semibold text-[var(--apps-text)]">{application.job.name}</span>
          {application.job.location ? ` — ${application.job.location}` : ""}
        </p>
      )}
    </StepLayout>
  )
}
