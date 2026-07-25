"use client"

import { useState } from "react"
import { StepLayout } from "@/components/applications/candidate/step-layout"
import { AppsField } from "@/components/applications/ui/apps-form"
import { GENERAL_FIELDS, missingGeneralFields, type GeneralApplication, type GeneralFieldId } from "@/lib/applications-core"

interface GeneralStepProps {
  general: GeneralApplication
  onChange: (field: GeneralFieldId, value: string) => void
  onContinue: () => void
}

export function GeneralStep({ general, onChange, onContinue }: GeneralStepProps) {
  // Errors appear only after a failed continue — never while typing.
  const [showErrors, setShowErrors] = useState(false)
  const missing = missingGeneralFields(general)

  const handleContinue = () => {
    if (missing.length > 0) {
      setShowErrors(true)
      return
    }
    onContinue()
  }

  const inputs = GENERAL_FIELDS.filter((field) => field.kind !== "upload")
  const uploads = GENERAL_FIELDS.filter((field) => field.kind === "upload")

  return (
    <StepLayout
      primary={{ label: "Continue to intro video", onClick: handleContinue }}
      note={
        showErrors && missing.length > 0
          ? `${missing.length} required field${missing.length === 1 ? "" : "s"} left`
          : "Saved automatically as you type."
      }
    >
      <div className="flex flex-col gap-2.5">
        {inputs.map((field) => (
          <AppsField
            key={field.id}
            field={field}
            value={general[field.id] ?? ""}
            onChange={(value) => onChange(field.id, value)}
            error={showErrors && field.required && !general[field.id]?.trim() ? "Required" : undefined}
          />
        ))}
      </div>

      <div className="mt-5 flex flex-col gap-2.5">
        {uploads.map((field) => (
          <AppsField
            key={field.id}
            field={field}
            value={general[field.id] ?? ""}
            onChange={(value) => onChange(field.id, value)}
          />
        ))}
      </div>
    </StepLayout>
  )
}
