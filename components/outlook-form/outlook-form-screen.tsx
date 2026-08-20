"use client"

/**
 * Public 3-Week Outlook intake form — reached via app/outlook-form/page.tsx,
 * no login required. A 5-step wizard (identify → job → tasks → notes →
 * review) plus a success screen, matching the reference mockup closely.
 * State lives in useOutlookFormWizard; nothing is persisted until the final
 * submit (POST /api/outlook-form/submit) — no draft/autosave, per the shared
 * static public link design (see lib/outlook-form-submissions/).
 */

import { useState } from "react"
import { ArrowLeft, CircleHelp } from "lucide-react"
import { cn } from "@/lib/utils"
import { useOutlookFormWizard } from "@/features/outlook-form/use-outlook-form-wizard"
import { outlookFormStepMeta, previousOutlookFormStep, OUTLOOK_FORM_STEP_COUNT } from "@/lib/outlook-form-submissions/wizard-core"
import { OutlookFormButton, OutlookFormSheet } from "@/components/outlook-form/ui/outlook-form-primitives"
import { IdentifyStep } from "@/components/outlook-form/steps/identify-step"
import { JobStep } from "@/components/outlook-form/steps/job-step"
import { TasksStep } from "@/components/outlook-form/steps/tasks-step"
import { NotesStep } from "@/components/outlook-form/steps/notes-step"
import { ReviewStep } from "@/components/outlook-form/steps/review-step"
import { SubmittedStep } from "@/components/outlook-form/steps/submitted-step"

const HELP_STEPS = new Set(["notes", "review", "submitted"])

export function OutlookFormScreen() {
  const wizard = useOutlookFormWizard()
  const [showHelp, setShowHelp] = useState(false)
  const meta = outlookFormStepMeta(wizard.step)
  const showBack = previousOutlookFormStep(wizard.step) !== null && wizard.step !== "submitted"

  const headerTitle = wizard.step === "review" ? "Review Outlook" : wizard.step === "submitted" ? "Outlook Submitted" : "3-Week Outlook"
  const showJobInSubtitle = wizard.jobName && (wizard.step === "tasks" || wizard.step === "notes" || wizard.step === "review")
  const subtitle = meta.index
    ? showJobInSubtitle
      ? `${wizard.jobName} · Step ${meta.index} of ${OUTLOOK_FORM_STEP_COUNT}`
      : `Step ${meta.index} of ${OUTLOOK_FORM_STEP_COUNT}`
    : null

  return (
    <div className="outlook-form-scope relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="outlook-form-topbar app-topbar flex shrink-0 items-center justify-between gap-2 border-b px-4 animate-slide-down">
        {showBack ? (
          <button
            type="button"
            onClick={wizard.goBack}
            className="outlook-form-tap -ml-1.5 flex h-9 w-9 items-center justify-center rounded-full text-[var(--of-text)] hover:bg-[var(--of-surface-2)]"
            aria-label="Back"
          >
            <ArrowLeft className="h-5 w-5" strokeWidth={2} />
          </button>
        ) : (
          <span className="h-9 w-9" aria-hidden="true" />
        )}

        <div className="min-w-0 flex-1 text-center">
          <p className="truncate text-[0.9375rem] font-bold tracking-tight text-[var(--of-text)]">{headerTitle}</p>
          {subtitle && <p className="truncate text-[0.6875rem] font-semibold text-[var(--of-blue-strong)]">{subtitle}</p>}
        </div>

        {HELP_STEPS.has(wizard.step) ? (
          <button
            type="button"
            onClick={() => setShowHelp(true)}
            className="outlook-form-tap -mr-1.5 flex h-9 w-9 items-center justify-center rounded-full text-[var(--of-text-muted)] hover:bg-[var(--of-surface-2)]"
            aria-label="Help"
          >
            <CircleHelp className="h-4.5 w-4.5" strokeWidth={2} />
          </button>
        ) : (
          <span className="h-9 w-9" aria-hidden="true" />
        )}
      </header>

      {wizard.step === "identify" && <IdentifyStep wizard={wizard} />}
      {wizard.step === "job" && <JobStep wizard={wizard} />}
      {wizard.step === "tasks" && <TasksStep wizard={wizard} />}
      {wizard.step === "notes" && <NotesStep wizard={wizard} />}
      {wizard.step === "review" && <ReviewStep wizard={wizard} />}
      {wizard.step === "submitted" && <SubmittedStep wizard={wizard} />}

      <OutlookFormSheet
        open={showHelp}
        title="Need a hand?"
        description="A few things that trip people up."
        onClose={() => setShowHelp(false)}
        footer={
          <OutlookFormButton fullWidth variant="secondary" onClick={() => setShowHelp(false)}>
            Got it
          </OutlookFormButton>
        }
      >
        <ul className="flex flex-col gap-3">
          {[
            ["Nothing is saved until you submit.", "You can go back and change any answer before that."],
            ["Not sure about exact dates?", "Give your best guess — Frank can always follow up."],
            ["Takes about 2 minutes.", "Just the main work planned for each week is enough."],
          ].map(([title, body]) => (
            <li key={title} className={cn("rounded-xl bg-[var(--of-surface-2)] px-3.5 py-3")}>
              <p className="text-[0.8125rem] font-semibold text-[var(--of-text)]">{title}</p>
              <p className="mt-1 text-[0.8125rem] leading-relaxed text-[var(--of-text-muted)]">{body}</p>
            </li>
          ))}
        </ul>
      </OutlookFormSheet>
    </div>
  )
}
