"use client"

/**
 * "New project" — a 5-step flow inside a single sheet (not 5 separate
 * screens), same weight class as Applications' invite-candidate-sheet.
 */

import { useState, type ReactNode } from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"
import { QcSheet } from "@/components/quest-coral/ui/quest-coral-sheet"
import { QcButton, Avatar, MissionFitDots } from "@/components/quest-coral/ui/quest-coral-primitives"
import { PeopleSearchPicker } from "@/components/quest-coral/ui/people-search-picker"
import { PROJECT_STATUS_META, PROJECT_STATUS_ORDER, type MissionFitScore, type ProjectPerson, type ProjectStatus } from "@/lib/quest-coral-core"
import type { NewProjectInput } from "@/features/quest-coral/use-quest-coral-dashboard"
import type { Contact, ImportedContact } from "@/lib/store"

const STEP_LABELS = ["Basics", "People", "Next step", "Timeline", "Start tracking"]

interface CreateProjectSheetProps {
  open: boolean
  currentUserId: string
  contacts: Contact[]
  importedContacts: ImportedContact[]
  onClose: () => void
  onCreate: (input: NewProjectInput) => void
}

const inputClass =
  "w-full rounded-xl border border-[var(--coral-border)] bg-[var(--coral-surface)] px-3.5 py-2.5 text-[15px] text-[var(--coral-text)] outline-none placeholder:text-[#94A3B8] focus:border-[var(--coral)]"

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[0.8125rem] font-semibold text-[var(--coral-text)]">{label}</span>
      {children}
      {hint && <span className="text-xs text-[var(--coral-text-muted)]">{hint}</span>}
    </label>
  )
}

export function CreateProjectSheet({ open, currentUserId, contacts, importedContacts, onClose, onCreate }: CreateProjectSheetProps) {
  const [step, setStep] = useState(0)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [missionFitScore, setMissionFitScore] = useState<MissionFitScore>(3)
  const [additionalPeople, setAdditionalPeople] = useState<ProjectPerson[]>([])
  const [addPeopleOpen, setAddPeopleOpen] = useState(false)
  const [pendingPeople, setPendingPeople] = useState<ProjectPerson[]>([])
  const [nextStep, setNextStep] = useState("")
  const [nextStepDue, setNextStepDue] = useState("")
  const [timelineNote, setTimelineNote] = useState("")
  const [status, setStatus] = useState<ProjectStatus>("planning")

  const reset = () => {
    setStep(0)
    setName("")
    setDescription("")
    setMissionFitScore(3)
    setAdditionalPeople([])
    setAddPeopleOpen(false)
    setPendingPeople([])
    setNextStep("")
    setNextStepDue("")
    setTimelineNote("")
    setStatus("planning")
  }

  const close = () => {
    reset()
    onClose()
  }

  const canContinue = step !== 0 || name.trim().length > 0

  const submit = () => {
    onCreate({
      name,
      description,
      missionFitScore,
      additionalPeople,
      nextStep: nextStep.trim() || null,
      nextStepDue: nextStepDue || null,
      timelineNote,
      status,
    })
    reset()
  }

  return (
    <QcSheet
      open={open}
      title="New project"
      description={`Step ${step + 1} of 5 — ${STEP_LABELS[step]}`}
      onClose={close}
      footer={
        <div className="flex gap-2">
          {step > 0 && (
            <QcButton variant="secondary" onClick={() => setStep((current) => current - 1)}>
              Back
            </QcButton>
          )}
          {step < 4 ? (
            <QcButton fullWidth disabled={!canContinue} onClick={() => setStep((current) => current + 1)}>
              Continue
            </QcButton>
          ) : (
            <QcButton fullWidth onClick={submit}>
              Start tracking
            </QcButton>
          )}
        </div>
      }
    >
      {step === 0 && (
        <div className="flex flex-col gap-4">
          <Field label="Project name">
            <input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Customer Onboarding Redesign"
              className={inputClass}
            />
          </Field>
          <Field label="Description">
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
              placeholder="What's this project about?"
              className={cn(inputClass, "resize-none")}
            />
          </Field>
          <Field label="Mission fit">
            <div className="flex items-center gap-3">
              <MissionFitDots score={missionFitScore} />
              <div className="flex gap-1">
                {([1, 2, 3, 4, 5] as MissionFitScore[]).map((score) => (
                  <button
                    key={score}
                    type="button"
                    onClick={() => setMissionFitScore(score)}
                    className={cn(
                      "h-7 w-7 rounded-full text-xs font-semibold",
                      missionFitScore === score
                        ? "bg-[var(--coral)] text-white"
                        : "bg-[var(--coral-surface-2)] text-[var(--coral-text-muted)]",
                    )}
                  >
                    {score}
                  </button>
                ))}
              </div>
            </div>
          </Field>
        </div>
      )}

      {step === 1 && (
        <div className="flex flex-col gap-3">
          <p className="text-[0.8125rem] font-semibold text-[var(--coral-text)]">Who&apos;s involved?</p>
          <p className="-mt-2 text-xs text-[var(--coral-text-muted)]">You&apos;re added automatically as the owner.</p>

          {additionalPeople.length > 0 && (
            <ul className="flex flex-col divide-y divide-[var(--coral-border)] rounded-xl border border-[var(--coral-border)]">
              {additionalPeople.map((person) => (
                <li key={person.id} className="flex items-center gap-3 px-3 py-2.5">
                  <Avatar initials={person.initials} className="h-8 w-8 text-[0.625rem]" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--coral-text)]">{person.name}</span>
                  <button
                    type="button"
                    onClick={() => setAdditionalPeople((current) => current.filter((entry) => entry.id !== person.id))}
                    className="quest-coral-tap flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--coral-text-muted)] hover:bg-[var(--coral-surface-2)]"
                    aria-label={`Remove ${person.name}`}
                  >
                    <X className="h-3.5 w-3.5" strokeWidth={2.2} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {addPeopleOpen ? (
            <div className="flex flex-col gap-3 rounded-2xl border border-[var(--coral-border)] bg-[var(--coral-surface-2)] p-3">
              <PeopleSearchPicker
                contacts={contacts}
                importedContacts={importedContacts}
                excludeIds={[currentUserId, ...additionalPeople.map((person) => person.id)]}
                selectedIds={pendingPeople.map((person) => person.id)}
                onToggle={(person) => {
                  setPendingPeople((current) => current.some((entry) => entry.id === person.id)
                    ? current.filter((entry) => entry.id !== person.id)
                    : [...current, person])
                }}
              />
              <div className="flex items-center justify-between gap-3 border-t border-[var(--coral-border)] pt-3">
                <span className="text-[0.6875rem] font-medium text-[var(--coral-text-muted)]">
                  {pendingPeople.length === 0 ? "Select people to add" : `${pendingPeople.length} selected`}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setPendingPeople([])
                      setAddPeopleOpen(false)
                    }}
                    className="quest-coral-tap h-9 rounded-xl px-3 text-[0.75rem] font-semibold text-[var(--coral-text-muted)]"
                  >
                    Cancel
                  </button>
                  <QcButton
                    size="sm"
                    disabled={pendingPeople.length === 0}
                    onClick={() => {
                      setAdditionalPeople((current) => [...current, ...pendingPeople])
                      setPendingPeople([])
                      setAddPeopleOpen(false)
                    }}
                  >
                    {pendingPeople.length === 1 ? "Add 1 person" : `Add ${pendingPeople.length} people`}
                  </QcButton>
                </div>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setPendingPeople([])
                setAddPeopleOpen(true)
              }}
              className="quest-coral-tap flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[var(--coral-border)] bg-[var(--coral-surface)] text-[0.8125rem] font-semibold text-[var(--coral-text)]"
            >
              Add people
            </button>
          )}
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-4">
          <Field label="Next step">
            <input
              value={nextStep}
              onChange={(event) => setNextStep(event.target.value)}
              placeholder="What's the next action or milestone?"
              className={inputClass}
            />
          </Field>
          <Field label="Due date (optional)">
            <input type="date" value={nextStepDue} onChange={(event) => setNextStepDue(event.target.value)} className={inputClass} />
          </Field>
        </div>
      )}

      {step === 3 && (
        <Field label="Timeline (optional)" hint="A quick note on what's happening right now is enough.">
          <textarea
            value={timelineNote}
            onChange={(event) => setTimelineNote(event.target.value)}
            rows={3}
            placeholder="e.g. Kicked off in July, testing this month, rollout in September"
            className={cn(inputClass, "resize-none")}
          />
        </Field>
      )}

      {step === 4 && (
        <div className="flex flex-col gap-4">
          <Field label="Starting status">
            <div className="flex flex-wrap gap-2">
              {PROJECT_STATUS_ORDER.map((candidate) => (
                <button
                  key={candidate}
                  type="button"
                  onClick={() => setStatus(candidate)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-sm font-semibold",
                    status === candidate
                      ? "border-[#FFD2C2] bg-[var(--coral-soft)] text-[var(--coral-strong)]"
                      : "border-[var(--coral-border)] text-[var(--coral-text-muted)]",
                  )}
                >
                  {PROJECT_STATUS_META[candidate].label}
                </button>
              ))}
            </div>
          </Field>
          <div className="rounded-2xl border border-[var(--coral-border)] bg-[var(--coral-surface-2)] p-3 text-[0.8125rem] text-[var(--coral-text-muted)]">
            <p className="font-semibold text-[var(--coral-text)]">{name || "Untitled project"}</p>
            {description && <p className="mt-1">{description}</p>}
          </div>
        </div>
      )}
    </QcSheet>
  )
}
