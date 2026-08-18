"use client"

/** Edit the project identity shared by Quest Coral and Communications. */

import { useEffect, useState } from "react"
import { Check } from "lucide-react"
import { QcSheet } from "@/components/quest-coral/ui/quest-coral-sheet"
import { QcButton } from "@/components/quest-coral/ui/quest-coral-primitives"
import type { Project } from "@/lib/quest-coral-core"

interface EditProjectDetailsSheetProps {
  open: boolean
  project: Pick<Project, "name" | "description">
  onClose: () => void
  onSave: (patch: Pick<Project, "name" | "description">) => void | Promise<unknown>
}

export function EditProjectDetailsSheet({ open, project, onClose, onSave }: EditProjectDetailsSheetProps) {
  const [name, setName] = useState(project.name)
  const [description, setDescription] = useState(project.description)
  const [isSaving, setIsSaving] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setName(project.name)
    setDescription(project.description)
    setIsSaving(false)
    setSubmitError(null)
  }, [open, project.name, project.description])

  const trimmedName = name.trim()
  const canSave = trimmedName.length > 0 && !isSaving

  const submit = async () => {
    if (!canSave) {
      if (!trimmedName) setSubmitError("Enter a project name before saving.")
      return
    }
    setIsSaving(true)
    setSubmitError(null)
    try {
      await onSave({ name: trimmedName, description: description.trim() })
      onClose()
    } catch {
      setSubmitError("The project details could not be saved. Please try again.")
      setIsSaving(false)
    }
  }

  const close = () => {
    if (!isSaving) onClose()
  }

  return (
    <QcSheet
      open={open}
      eyebrow="SVC Quest Coral"
      title="Edit project details"
      description="These details also update this project's context in Communications."
      onClose={close}
      footer={
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={close}
            disabled={isSaving}
            className="quest-coral-tap min-h-[3rem] rounded-xl border border-[var(--coral-border)] bg-[var(--coral-surface)] px-4 text-sm font-semibold text-[var(--coral-text)] disabled:opacity-50"
          >
            Cancel
          </button>
          <QcButton size="md" disabled={!canSave} icon={<Check className="h-4 w-4" strokeWidth={2.4} />} onClick={submit} className="min-h-[3rem]">
            {isSaving ? "Saving…" : "Save changes"}
          </QcButton>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-2">
          <span className="text-[0.8125rem] font-semibold text-[var(--coral-text)]">Project name</span>
          <input
            value={name}
            onChange={(event) => {
              setName(event.target.value)
              setSubmitError(null)
            }}
            autoComplete="off"
            className="h-11 w-full rounded-xl border border-[var(--coral-border)] bg-[var(--coral-surface)] px-3.5 text-[0.9375rem] font-medium text-[var(--coral-text)] outline-none placeholder:text-[#94A3B8] focus:border-[var(--coral)] focus:shadow-[0_0_0_3px_rgba(255,122,89,0.12)]"
          />
        </label>

        <label className="flex flex-col gap-2">
          <span className="text-[0.8125rem] font-semibold text-[var(--coral-text)]">Project description <span className="font-normal text-[var(--coral-text-muted)]">(optional)</span></span>
          <textarea
            value={description}
            onChange={(event) => {
              setDescription(event.target.value)
              setSubmitError(null)
            }}
            rows={5}
            placeholder="What is this project for?"
            className="min-h-32 w-full resize-y rounded-2xl border border-[var(--coral-border)] bg-[var(--coral-surface)] px-3.5 py-3 text-[0.9375rem] leading-relaxed text-[var(--coral-text)] outline-none placeholder:text-[#94A3B8] focus:border-[var(--coral)] focus:shadow-[0_0_0_3px_rgba(255,122,89,0.12)]"
          />
          <p className="text-[0.6875rem] leading-relaxed text-[var(--coral-text-muted)]">Keep this description current so people can find the right project context in Communications.</p>
        </label>

        {submitError && <p role="alert" className="text-[0.75rem] font-medium text-[var(--coral-missing)]">{submitError}</p>}
      </div>
    </QcSheet>
  )
}
