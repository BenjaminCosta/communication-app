"use client"

/**
 * Quest Coral's activity composer.
 *
 * The opening choice deliberately feels different from the editor. People
 * first choose their intent in a calm 2 × 2 grid; once chosen, that grid
 * contracts into a compact type switcher and only relevant fields remain.
 */

import { useEffect, useState, type ComponentType, type CSSProperties } from "react"
import {
  AlertTriangle,
  CalendarDays,
  Check,
  CircleAlert,
  Flag,
  LayoutDashboard,
  MessageCircle,
  Users,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { QcSheet } from "@/components/quest-coral/ui/quest-coral-sheet"
import { QcButton } from "@/components/quest-coral/ui/quest-coral-primitives"
import {
  PROJECT_STATUS_META,
  PROJECT_STATUS_ORDER,
  UPDATE_TYPE_META,
  UPDATE_TYPE_ORDER,
  type ProjectStatus,
  type UpdateType,
} from "@/lib/quest-coral-core"
import type { NewUpdateInput } from "@/features/quest-coral/use-quest-coral-dashboard"

const UPDATE_TYPE_ICON: Record<UpdateType, ComponentType<{ className?: string; strokeWidth?: number }>> = {
  update: LayoutDashboard,
  feedback: MessageCircle,
  blocker: AlertTriangle,
  red_team_review: Users,
}

const FORM_COPY: Record<
  UpdateType,
  { title: string; description: string; fieldLabel: string; placeholder: string; submitLabel: string }
> = {
  update: {
    title: "Add update",
    description: "Share progress and keep the team informed.",
    fieldLabel: "What changed?",
    placeholder: "What is the latest on this project?",
    submitLabel: "Save update",
  },
  feedback: {
    title: "Add feedback",
    description: "Share an observation or suggestion with the team.",
    fieldLabel: "Your feedback",
    placeholder: "What worked well? What could be improved?",
    submitLabel: "Share feedback",
  },
  blocker: {
    title: "Report blocker",
    description: "Flag an issue that is preventing progress.",
    fieldLabel: "What is blocked?",
    placeholder: "Describe what cannot move forward.",
    submitLabel: "Report blocker",
  },
  red_team_review: {
    title: "Red Team Review",
    description: "Challenge assumptions, risks and blind spots.",
    fieldLabel: "Critical review",
    placeholder: "What assumptions, risks or blind spots do you see?",
    submitLabel: "Submit review",
  },
}

const MAX_BODY_CHARS = 1000
const inputClassName =
  "h-11 w-full rounded-xl border border-[var(--coral-border)] bg-[var(--coral-surface)] px-3.5 text-[15px] text-[var(--coral-text)] outline-none placeholder:text-[#94A3B8] transition-colors focus:border-[var(--coral)] focus:shadow-[0_0_0_3px_rgba(255,122,89,0.12)]"
const labelClassName = "text-[0.8125rem] font-semibold text-[var(--coral-text)]"

interface AddUpdateSheetProps {
  open: boolean
  currentStatus: ProjectStatus
  currentProgress: number
  onClose: () => void
  onSave: (input: NewUpdateInput) => void | Promise<void>
}

export function AddUpdateSheet({ open, currentStatus, currentProgress, onClose, onSave }: AddUpdateSheetProps) {
  const [type, setType] = useState<UpdateType>("update")
  const [body, setBody] = useState("")
  const [status, setStatus] = useState<ProjectStatus>(currentStatus)
  const [progress, setProgress] = useState(currentProgress)
  const [nextStep, setNextStep] = useState("")
  const [nextStepDue, setNextStepDue] = useState("")
  const [feedbackFocus, setFeedbackFocus] = useState("")
  const [suggestedAction, setSuggestedAction] = useState("")
  const [impact, setImpact] = useState<"Low" | "Medium" | "High">("Medium")
  const [blockerNeed, setBlockerNeed] = useState("")
  const [blockerOwner, setBlockerOwner] = useState("")
  const [resolutionDate, setResolutionDate] = useState("")
  const [challenge, setChallenge] = useState("")
  const [recommendedAction, setRecommendedAction] = useState("")
  const [severity, setSeverity] = useState<"Observation" | "Concern" | "Critical">("Concern")
  const [isSaving, setIsSaving] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setType("update")
    setBody("")
    setStatus(currentStatus)
    setProgress(currentProgress)
    setNextStep("")
    setNextStepDue("")
    setFeedbackFocus("")
    setSuggestedAction("")
    setImpact("Medium")
    setBlockerNeed("")
    setBlockerOwner("")
    setResolutionDate("")
    setChallenge("")
    setRecommendedAction("")
    setSeverity("Concern")
    setIsSaving(false)
    setSubmitError(null)
  }, [open, currentStatus, currentProgress])

  const copy = FORM_COPY[type]
  const canSave = body.trim().length > 0 && !isSaving

  const serialisedBody = () => {
    const parts = [body.trim()]
    if (type === "feedback") {
      if (feedbackFocus) parts.push(`Focus: ${feedbackFocus}`)
      if (suggestedAction.trim()) parts.push(`Suggested action: ${suggestedAction.trim()}`)
    }
    if (type === "blocker") {
      parts.push(`Impact: ${impact}`)
      if (blockerNeed.trim()) parts.push(`Needed to unblock: ${blockerNeed.trim()}`)
      if (blockerOwner.trim()) parts.push(`Owner: ${blockerOwner.trim()}`)
      if (resolutionDate) parts.push(`Target resolution: ${resolutionDate}`)
    }
    if (type === "red_team_review") {
      parts.push(`Severity: ${severity}`)
      if (challenge.trim()) parts.push(`Challenge: ${challenge.trim()}`)
      if (recommendedAction.trim()) parts.push(`Recommended action: ${recommendedAction.trim()}`)
    }
    return parts.join("\n\n")
  }

  const submit = async () => {
    if (!canSave) return
    setIsSaving(true)
    setSubmitError(null)
    try {
      await onSave({
        type,
        body: serialisedBody(),
        status: type === "update" ? status : undefined,
        progress: type === "update" ? progress : undefined,
        nextStep: type === "update" && nextStep.trim() ? nextStep.trim() : undefined,
        nextStepDue: type === "update" && nextStep.trim() ? nextStepDue || null : undefined,
        isBlocker: type === "blocker",
      })
    } catch {
      setSubmitError("Your entry could not be saved. Please try again.")
      setIsSaving(false)
    }
  }

  const selectType = (candidate: UpdateType) => {
    setType(candidate)
    setSubmitError(null)
  }

  return (
    <QcSheet
      open={open}
      eyebrow="SVC Quest Coral"
      title={copy.title}
      description={copy.description}
      onClose={onClose}
      footer={
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="quest-coral-tap min-h-[3rem] rounded-xl border border-[var(--coral-border)] bg-[var(--coral-surface)] px-4 text-sm font-semibold text-[var(--coral-text)] disabled:opacity-50"
          >
            Cancel
          </button>
          <QcButton
            size="md"
            disabled={!canSave}
            icon={<Check className="h-4 w-4" strokeWidth={2.4} />}
            onClick={submit}
            className="min-h-[3rem]"
          >
            {isSaving ? "Saving…" : copy.submitLabel}
          </QcButton>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
          <div className="grid grid-cols-4 gap-1.5" role="group" aria-label="Activity type">
            {UPDATE_TYPE_ORDER.map((candidate) => {
              const Icon = UPDATE_TYPE_ICON[candidate]
              const active = candidate === type
              const compactLabel = candidate === "red_team_review" ? "Red Team Review" : UPDATE_TYPE_META[candidate].label
              return (
                <button
                  key={candidate}
                  type="button"
                  onClick={() => selectType(candidate)}
                  aria-pressed={active}
                  className={cn(
                    "quest-coral-tap flex min-h-[6.75rem] flex-col items-center justify-center gap-1.5 rounded-2xl border px-1 text-center text-[0.625rem] font-semibold leading-tight transition-colors",
                    active
                      ? "border-[var(--coral)] bg-[var(--coral-ai-soft)] text-[var(--coral-strong)] shadow-[0_8px_18px_rgba(255,122,89,0.12)]"
                      : "border-[var(--coral-border)] bg-[var(--coral-surface)] text-[var(--coral-text)]",
                  )}
                >
                  <span className={cn("flex h-8 w-8 items-center justify-center rounded-full", active ? "bg-[var(--coral)] text-white shadow-[0_6px_12px_rgba(255,122,89,0.20)]" : "bg-[var(--coral-surface-2)] text-[var(--coral-text)]")}>
                    <Icon className="h-4 w-4" strokeWidth={active ? 2.2 : 1.8} />
                  </span>
                  <span className="px-0.5">{compactLabel}</span>
                </button>
              )
            })}
          </div>

          <label className="quest-coral-form-reveal flex flex-col gap-2">
            <span className={labelClassName}>{copy.fieldLabel}</span>
            <textarea
              autoFocus
              value={body}
              onChange={(event) => setBody(event.target.value.slice(0, MAX_BODY_CHARS))}
              rows={type === "red_team_review" ? 5 : 4}
              placeholder={copy.placeholder}
              className="min-h-[7.5rem] w-full resize-none rounded-2xl border border-[var(--coral-border)] bg-[var(--coral-surface)] px-3.5 py-3 text-[15px] leading-relaxed text-[var(--coral-text)] outline-none placeholder:text-[#94A3B8] transition-colors focus:border-[var(--coral)] focus:shadow-[0_0_0_3px_rgba(255,122,89,0.12)]"
            />
            <span className="text-right text-[0.6875rem] text-[var(--coral-text-muted)]">{body.length}/{MAX_BODY_CHARS}</span>
          </label>

          {type === "update" && (
            <div className="quest-coral-form-reveal flex flex-col gap-5">
              <label className="flex flex-col gap-2">
                <span className={labelClassName}>Project status</span>
                <select value={status} onChange={(event) => setStatus(event.target.value as ProjectStatus)} className={inputClassName}>
                  {PROJECT_STATUS_ORDER.map((candidate) => (
                    <option key={candidate} value={candidate}>
                      {PROJECT_STATUS_META[candidate].label}
                    </option>
                  ))}
                </select>
              </label>

              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className={labelClassName}>Progress</span>
                  <span className="rounded-xl border border-[var(--coral-border)] bg-[var(--coral-surface)] px-3 py-1.5 text-sm font-semibold tabular-nums text-[var(--coral-text)]">
                    {progress}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={progress}
                  onChange={(event) => {
                    const next = Number(event.target.value)
                    setProgress(next)
                    // Reaching 100% always means Completed — keep the status
                    // shown here in sync with what will actually be saved,
                    // instead of letting the form show "On track" right
                    // before it saves as "Completed".
                    if (next === 100) setStatus("completed")
                  }}
                  className="quest-coral-range w-full"
                  style={{ "--range-value": `${progress}%` } as CSSProperties}
                  aria-label="Project progress"
                />
                <div className="flex justify-between text-[0.6875rem] text-[var(--coral-text-muted)]">
                  <span>0%</span>
                  <span>50%</span>
                  <span>100%</span>
                </div>
              </div>

              <label className="flex flex-col gap-2">
                <span className={labelClassName}>Next step <span className="font-normal text-[var(--coral-text-muted)]">(optional)</span></span>
                <div className="flex items-center gap-2 rounded-xl border border-[var(--coral-border)] bg-[var(--coral-surface)] px-3.5 focus-within:border-[var(--coral)] focus-within:shadow-[0_0_0_3px_rgba(255,122,89,0.12)]">
                  <Flag className="h-4 w-4 shrink-0 text-[var(--coral-strong)]" strokeWidth={2} />
                  <input
                    value={nextStep}
                    onChange={(event) => setNextStep(event.target.value)}
                    placeholder="What is the next action?"
                    className="h-11 min-w-0 flex-1 bg-transparent text-[15px] text-[var(--coral-text)] outline-none placeholder:text-[#94A3B8]"
                  />
                </div>
              </label>

              <label className="flex flex-col gap-2">
                <span className={labelClassName}>Due date <span className="font-normal text-[var(--coral-text-muted)]">(optional)</span></span>
                <div className="flex items-center gap-2 rounded-xl border border-[var(--coral-border)] bg-[var(--coral-surface)] px-3.5 focus-within:border-[var(--coral)] focus-within:shadow-[0_0_0_3px_rgba(255,122,89,0.12)]">
                  <CalendarDays className="h-4 w-4 shrink-0 text-[var(--coral-strong)]" strokeWidth={2} />
                  <input
                    type="date"
                    value={nextStepDue}
                    onChange={(event) => setNextStepDue(event.target.value)}
                    className="h-11 min-w-0 flex-1 bg-transparent text-sm text-[var(--coral-text)] outline-none"
                  />
                </div>
              </label>
            </div>
          )}

          {type === "feedback" && (
            <div className="quest-coral-form-reveal flex flex-col gap-5">
              <fieldset>
                <legend className={labelClassName}>Feedback focus <span className="font-normal text-[var(--coral-text-muted)]">(optional)</span></legend>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
                  {["Process", "Communication", "Quality", "Team", "Other"].map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setFeedbackFocus(option)}
                      aria-pressed={feedbackFocus === option}
                      className={cn(
                        "quest-coral-tap min-h-[2.75rem] rounded-xl border px-2 text-xs font-semibold",
                        feedbackFocus === option
                          ? "border-[#FFD2C2] bg-[var(--coral-soft)] text-[var(--coral-strong)]"
                          : "border-[var(--coral-border)] text-[var(--coral-text-muted)]",
                      )}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </fieldset>
              <label className="flex flex-col gap-2">
                <span className={labelClassName}>Suggested action <span className="font-normal text-[var(--coral-text-muted)]">(optional)</span></span>
                <input
                  value={suggestedAction}
                  onChange={(event) => setSuggestedAction(event.target.value)}
                  placeholder="What would you like to see happen?"
                  className={inputClassName}
                />
              </label>
            </div>
          )}

          {type === "blocker" && (
            <div className="quest-coral-form-reveal flex flex-col gap-5">
              <fieldset>
                <legend className={labelClassName}>Impact</legend>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {(["Low", "Medium", "High"] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setImpact(option)}
                      aria-pressed={impact === option}
                      className={cn(
                        "quest-coral-tap min-h-[3.25rem] rounded-xl border text-sm font-semibold",
                        impact === option
                          ? option === "High"
                            ? "border-[#F7B4B4] bg-[var(--coral-missing-soft)] text-[#C84E4E]"
                            : "border-[#FFD2C2] bg-[var(--coral-soft)] text-[var(--coral-strong)]"
                          : "border-[var(--coral-border)] text-[var(--coral-text-muted)]",
                      )}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </fieldset>
              <label className="flex flex-col gap-2">
                <span className={labelClassName}>What is needed? <span className="font-normal text-[var(--coral-text-muted)]">(optional)</span></span>
                <textarea
                  value={blockerNeed}
                  onChange={(event) => setBlockerNeed(event.target.value.slice(0, 300))}
                  rows={3}
                  placeholder="What would resolve or unblock this?"
                  className="w-full resize-none rounded-2xl border border-[var(--coral-border)] bg-[var(--coral-surface)] px-3.5 py-3 text-[15px] leading-relaxed text-[var(--coral-text)] outline-none placeholder:text-[#94A3B8] transition-colors focus:border-[var(--coral)] focus:shadow-[0_0_0_3px_rgba(255,122,89,0.12)]"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="flex min-w-0 flex-col gap-2">
                  <span className={labelClassName}>Owner <span className="font-normal text-[var(--coral-text-muted)]">(optional)</span></span>
                  <input value={blockerOwner} onChange={(event) => setBlockerOwner(event.target.value)} placeholder="Who can help?" className={inputClassName} />
                </label>
                <label className="flex min-w-0 flex-col gap-2">
                  <span className={labelClassName}>Target date <span className="font-normal text-[var(--coral-text-muted)]">(optional)</span></span>
                  <input type="date" value={resolutionDate} onChange={(event) => setResolutionDate(event.target.value)} className={inputClassName} />
                </label>
              </div>
            </div>
          )}

          {type === "red_team_review" && (
            <div className="quest-coral-form-reveal flex flex-col gap-5">
              <label className="flex flex-col gap-2">
                <span className={labelClassName}>What should be challenged? <span className="font-normal text-[var(--coral-text-muted)]">(optional)</span></span>
                <input value={challenge} onChange={(event) => setChallenge(event.target.value)} placeholder="Name the assumption or decision." className={inputClassName} />
              </label>
              <label className="flex flex-col gap-2">
                <span className={labelClassName}>Recommended action <span className="font-normal text-[var(--coral-text-muted)]">(optional)</span></span>
                <input value={recommendedAction} onChange={(event) => setRecommendedAction(event.target.value)} placeholder="What should happen next?" className={inputClassName} />
              </label>
              <fieldset>
                <legend className={labelClassName}>Severity</legend>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {(["Observation", "Concern", "Critical"] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setSeverity(option)}
                      aria-pressed={severity === option}
                      className={cn(
                        "quest-coral-tap min-h-[3.25rem] rounded-xl border px-1 text-xs font-semibold",
                        severity === option
                          ? option === "Critical"
                            ? "border-[#F7B4B4] bg-[var(--coral-missing-soft)] text-[#C84E4E]"
                            : "border-[#FFD2C2] bg-[var(--coral-soft)] text-[var(--coral-strong)]"
                          : "border-[var(--coral-border)] text-[var(--coral-text-muted)]",
                      )}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </fieldset>
            </div>
          )}

          {submitError && (
            <p role="alert" className="flex items-center gap-2 rounded-xl border border-[#F7B4B4] bg-[var(--coral-missing-soft)] px-3 py-2.5 text-xs font-medium text-[#C84E4E]">
              <CircleAlert className="h-4 w-4 shrink-0" strokeWidth={2} />
              {submitError}
            </p>
          )}
      </div>
    </QcSheet>
  )
}
