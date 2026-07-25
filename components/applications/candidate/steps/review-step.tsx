"use client"

import { AlertCircle, Check, ChevronRight, FileText, User, Video } from "lucide-react"
import { StepLayout } from "@/components/applications/candidate/step-layout"
import { AppsCard, StatusPill } from "@/components/applications/ui/apps-primitives"
import { toneForSectionState, TONE_STYLES } from "@/components/applications/ui/tone"
import type { ApplicationProgress, ApplicationSectionId, CandidateApplication } from "@/lib/applications-core"

const SECTION_ICON: Record<ApplicationSectionId, typeof User> = {
  general: User,
  video: Video,
  documents: FileText,
}

interface ReviewStepProps {
  application: CandidateApplication
  progress: ApplicationProgress
  onJumpTo: (section: ApplicationSectionId) => void
  onSubmit: () => void
}

export function ReviewStep({ application, progress, onJumpTo, onSubmit }: ReviewStepProps) {
  return (
    <StepLayout
      intro="Check everything looks right before you send it."
      primary={{
        label: progress.isComplete ? "Submit application" : `${progress.missingItems.length} item${progress.missingItems.length === 1 ? "" : "s"} missing`,
        onClick: onSubmit,
        disabled: !progress.isComplete,
      }}
      note={progress.isComplete ? "You can't edit after submitting." : "Fix the items above to submit."}
    >
      <AppsCard className="overflow-hidden">
        <ul className="divide-y divide-[var(--apps-border)]">
          {progress.sections.map((section) => {
            const Icon = SECTION_ICON[section.id]
            const tone = toneForSectionState(section.state)
            return (
              <li key={section.id}>
                <button
                  type="button"
                  onClick={() => onJumpTo(section.id)}
                  className="applications-tap flex min-h-[3.75rem] w-full items-center gap-3 px-4 py-3 text-left hover:bg-[var(--apps-surface-2)]"
                >
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${TONE_STYLES[tone].soft} ${TONE_STYLES[tone].text}`}>
                    {section.state === "complete" ? <Check className="h-4.5 w-4.5" strokeWidth={2.5} /> : <Icon className="h-4.5 w-4.5" strokeWidth={2} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-[var(--apps-text)]">{section.label}</span>
                    <span className={`mt-0.5 block text-xs font-medium ${TONE_STYLES[tone].text}`}>{section.detail}</span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-[var(--apps-text-muted)]" strokeWidth={2} />
                </button>
              </li>
            )
          })}
        </ul>
      </AppsCard>

      {progress.missingItems.length > 0 && (
        <div className="mt-4 rounded-2xl border border-[#FBD0D0] bg-[var(--apps-missing-soft)] p-4">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-[#DC5A5A]" strokeWidth={2} />
            <h3 className="text-[0.8125rem] font-semibold text-[#DC5A5A]">Still missing</h3>
          </div>
          <ul className="mt-2 flex flex-col gap-1.5">
            {progress.missingItems.map((item) => (
              <li key={`${item.step}-${item.label}`}>
                <button
                  type="button"
                  onClick={() => onJumpTo(item.step)}
                  className="text-left text-[0.8125rem] font-medium text-[#B14545] underline decoration-[#F0B4B4] underline-offset-2"
                >
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-5">
        <h3 className="mb-2 px-1 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-[var(--apps-text-muted)]">
          Your details
        </h3>
        <AppsCard className="p-4" flat>
          <dl className="flex flex-col gap-2.5 text-[0.8125rem]">
            {[
              ["Name", application.general.fullName],
              ["Phone", application.general.phone],
              ["Email", application.general.email],
              ["Location", application.general.cityState],
              ["Trade", application.general.primaryTrade],
              ["Experience", application.general.yearsExperience ? `${application.general.yearsExperience} years` : ""],
              ["Applying to", application.job.name],
            ].map(([label, value]) => (
              <div key={label} className="flex items-start justify-between gap-4">
                <dt className="shrink-0 text-[var(--apps-text-muted)]">{label}</dt>
                <dd className="min-w-0 truncate text-right font-medium text-[var(--apps-text)]">{value || "—"}</dd>
              </div>
            ))}
          </dl>
        </AppsCard>
      </div>

      <div className="mt-4 flex items-center justify-center">
        <StatusPill label="Nothing is shared until you submit" tone="neutral" />
      </div>
    </StepLayout>
  )
}
