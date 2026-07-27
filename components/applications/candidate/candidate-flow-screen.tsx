"use client"

/**
 * Candidate application flow — opened through a secure link (?apply=<token>).
 *
 * Deliberately minimal chrome: no bottom navigation, one action per screen,
 * and a back arrow that only appears once the candidate is inside a step.
 */

import { useState } from "react"
import { AlertCircle, ArrowLeft, Check, CircleHelp, Cloud } from "lucide-react"
import { cn } from "@/lib/utils"
import { useCandidateApplication } from "@/features/applications/use-candidate-application"
import { ApplicationsLoadingScreen } from "@/components/app-loading-screen"
import { AppsSheet } from "@/components/applications/ui/apps-sheet"
import { AppsButton } from "@/components/applications/ui/apps-primitives"
import { WelcomeStep } from "@/components/applications/candidate/steps/welcome-step"
import { GeneralStep } from "@/components/applications/candidate/steps/general-step"
import { VideoStep } from "@/components/applications/candidate/steps/video-step"
import { DocumentsStep } from "@/components/applications/candidate/steps/documents-step"
import { ReviewStep } from "@/components/applications/candidate/steps/review-step"
import { SubmittedStep } from "@/components/applications/candidate/steps/submitted-step"
import { AgreementStep } from "@/components/applications/candidate/steps/agreement-step"
import { AgreementSignedStep } from "@/components/applications/candidate/steps/agreement-signed-step"
import { CANDIDATE_STEP_COUNT, candidateStep, previousCandidateStep } from "@/lib/applications-core"

interface CandidateFlowScreenProps {
  /** Token from the application link. */
  token: string
  className?: string
  /** Present only for internal users previewing the flow. */
  onExit?: () => void
  /** Internal preview — stays on mock data, never opens a real session. */
  preview?: boolean
}

export function CandidateFlowScreen({ token, className, onExit, preview = false }: CandidateFlowScreenProps) {
  const controller = useCandidateApplication(token, { preview })
  const [showHelp, setShowHelp] = useState(false)
  const { application, progress, step, saveState, sessionState, sessionError } = controller
  const meta = candidateStep(step)
  // Only inside the linear flow. The agreement is its own visit, and there is
  // no going back from a submitted application.
  const showBack = previousCandidateStep(step) !== null && step !== "submitted"

  // Live mode opens a session first; until it resolves, or if the link is
  // invalid, the flow shows a full-screen status instead of the form.
  if (sessionState === "error") {
    return (
      <div
        className={cn(
          "applications-scope applications-canvas relative flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center",
          className,
        )}
      >
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--apps-missing-soft)] text-[#DC5A5A]">
          <AlertCircle className="h-7 w-7" strokeWidth={2} />
        </span>
        <h1 className="mt-4 text-lg font-bold text-[var(--apps-text)]">This link can't be opened</h1>
        <p className="mt-1.5 max-w-xs text-[0.875rem] leading-relaxed text-[var(--apps-text-muted)]">
          {sessionError ?? "Ask your SVC contact for a new link."}
        </p>
      </div>
    )
  }

  if (!application) {
    return <ApplicationsLoadingScreen className={className} />
  }

  return (
    <div
      className={cn(
        "applications-scope applications-canvas relative flex min-h-0 flex-1 flex-col overflow-hidden",
        className,
      )}
    >
      <header className="applications-topbar app-topbar flex shrink-0 items-center justify-between gap-2 border-b px-4 animate-slide-down">
        {showBack ? (
          <button
            type="button"
            onClick={controller.goBack}
            className="applications-tap -ml-1.5 flex h-9 w-9 items-center justify-center rounded-full text-[var(--apps-text)] hover:bg-[var(--apps-surface-2)]"
            aria-label="Back"
          >
            <ArrowLeft className="h-5 w-5" strokeWidth={2} />
          </button>
        ) : onExit ? (
          <button
            type="button"
            onClick={onExit}
            className="applications-tap -ml-1.5 flex h-9 w-9 items-center justify-center rounded-full text-[var(--apps-text)] hover:bg-[var(--apps-surface-2)]"
            aria-label="Exit candidate preview"
          >
            <ArrowLeft className="h-5 w-5" strokeWidth={2} />
          </button>
        ) : (
          <span className="h-9 w-9" aria-hidden="true" />
        )}

        {/* The header carries the screen name, so most steps need no body title. */}
        <span className="min-w-0 truncate text-[0.9375rem] font-bold tracking-tight text-[var(--apps-blue)]">
          {step === "welcome" ? (
            <>
              <span className="text-[var(--apps-text)]">SVC </span>Applications
            </>
          ) : (
            meta.title
          )}
        </span>

        <button
          type="button"
          onClick={() => setShowHelp(true)}
          className="applications-tap -mr-1.5 flex h-9 w-9 items-center justify-center rounded-full text-[var(--apps-text-muted)] hover:bg-[var(--apps-surface-2)]"
          aria-label="Help"
        >
          <CircleHelp className="h-4.5 w-4.5" strokeWidth={2} />
        </button>
      </header>

      {meta.index !== null && (
        <div className="shrink-0 border-b border-[var(--apps-border)] bg-[var(--apps-surface)] px-5 pb-3 pt-3 md:px-6">
          <div className="mx-auto w-full max-w-xl">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold text-[var(--apps-blue)]">
                Step {meta.index} of {CANDIDATE_STEP_COUNT}
              </p>
              {/* Autosave lives next to the progress, where the eye already is. */}
              {saveState !== "idle" && (
                <span className="flex items-center gap-1 text-xs font-medium text-[var(--apps-text-muted)]">
                  {saveState === "saving" ? (
                    <>
                      <Cloud className="h-3.5 w-3.5 animate-pulse" strokeWidth={2} />
                      Saving…
                    </>
                  ) : (
                    <>
                      <Check className="h-3.5 w-3.5 text-[var(--apps-complete)]" strokeWidth={2.5} />
                      Saved
                    </>
                  )}
                </span>
              )}
            </div>
            <div className="mt-2 flex gap-1.5" role="progressbar" aria-valuenow={meta.index} aria-valuemin={1} aria-valuemax={CANDIDATE_STEP_COUNT}>
              {Array.from({ length: CANDIDATE_STEP_COUNT }, (_, index) => (
                <span
                  key={index}
                  className={cn(
                    "h-1.5 flex-1 rounded-full transition-colors duration-300",
                    index < (meta.index ?? 0) ? "bg-[var(--apps-blue)]" : "bg-[var(--apps-blue-soft)]",
                  )}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {step === "welcome" && <WelcomeStep application={application} progress={progress} onContinue={controller.resume} />}

      {step === "general" && (
        <GeneralStep general={application.general} onChange={controller.setGeneralField} onContinue={controller.goNext} />
      )}

      {step === "video" && (
        <VideoStep
          video={application.video}
          upload={controller.videoUpload}
          onCapture={controller.captureVideo}
          onRemove={controller.removeVideo}
          onContinue={controller.goNext}
          onSkip={controller.goNext}
        />
      )}

      {step === "documents" && (
        <DocumentsStep
          documents={application.documents}
          jobName={application.job.name}
          upload={controller.docUpload}
          onUpload={controller.uploadDocument}
          onRemove={controller.removeDocument}
          onContinue={controller.goNext}
        />
      )}

      {step === "review" && (
        <ReviewStep
          application={application}
          progress={progress}
          onJumpTo={controller.goToSection}
          onSubmit={controller.submit}
        />
      )}

      {step === "submitted" && <SubmittedStep application={application} />}

      {step === "agreement" && (
        <AgreementStep
          application={application}
          signature={controller.signature}
          signState={controller.signState}
          onSignatureChange={controller.updateSignature}
          onSign={controller.signAgreement}
        />
      )}

      {step === "agreement-signed" && <AgreementSignedStep application={application} />}

      <AppsSheet
        open={showHelp}
        title="Need a hand?"
        description="A few things that trip people up."
        onClose={() => setShowHelp(false)}
        footer={
          <AppsButton fullWidth variant="secondary" onClick={() => setShowHelp(false)}>
            Got it
          </AppsButton>
        }
      >
        <ul className="flex flex-col gap-3">
          {[
            ["Your progress saves automatically.", "You can close this page and open the same link later."],
            ["Photos are fine.", "Take a picture of your documents with your phone camera — no scanner needed."],
            ["Nothing is shared until you submit.", "You can go back and change any answer before that."],
          ].map(([title, body]) => (
            <li key={title} className="rounded-xl bg-[var(--apps-surface-2)] px-3.5 py-3">
              <p className="text-[0.8125rem] font-semibold text-[var(--apps-text)]">{title}</p>
              <p className="mt-1 text-[0.8125rem] leading-relaxed text-[var(--apps-text-muted)]">{body}</p>
            </li>
          ))}
        </ul>
      </AppsSheet>
    </div>
  )
}
