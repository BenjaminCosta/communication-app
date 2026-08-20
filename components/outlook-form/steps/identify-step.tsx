"use client"

import { Briefcase, Clock, ClipboardCheck, HardHat, MoreHorizontal, Phone } from "lucide-react"
import { cn } from "@/lib/utils"
import { OutlookFormStepLayout } from "@/components/outlook-form/step-layout"
import { OutlookFormCard, OutlookFormIconBadge } from "@/components/outlook-form/ui/outlook-form-primitives"
import { OutlookFormTextField } from "@/components/outlook-form/ui/outlook-form-fields"
import { canContinueFromIdentify } from "@/lib/outlook-form-submissions/wizard-core"
import type { OutlookFormSubmitterRole } from "@/lib/outlook-form-submissions/client"
import type { OutlookFormWizard } from "@/features/outlook-form/use-outlook-form-wizard"

const ROLE_OPTIONS: { value: OutlookFormSubmitterRole; label: string; icon: typeof HardHat }[] = [
  { value: "site_super", label: "Site Super", icon: HardHat },
  { value: "pm", label: "PM", icon: Briefcase },
  { value: "other", label: "Other", icon: MoreHorizontal },
]

export function IdentifyStep({ wizard }: { wizard: OutlookFormWizard }) {
  return (
    <OutlookFormStepLayout
      primary={{ label: "Continue", onClick: wizard.goNext, disabled: !canContinueFromIdentify(wizard.submittedByName) }}
    >
      <OutlookFormCard className="flex items-center gap-3.5 p-4">
        <OutlookFormIconBadge size="lg" icon={<ClipboardCheck className="h-7 w-7" strokeWidth={2} />} />
        <div className="min-w-0 flex-1">
          <p className="text-[0.95rem] font-bold leading-snug text-[var(--of-text)]">Let&apos;s get your 3-week outlook submitted</p>
          <p className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-[var(--of-text-muted)]">
            <Clock className="h-3.5 w-3.5" strokeWidth={2} />
            Takes about 2 minutes
          </p>
        </div>
      </OutlookFormCard>

      <div className="mt-5 flex flex-col gap-3">
        <OutlookFormTextField label="Your full name" value={wizard.submittedByName} onChange={wizard.setSubmittedByName} placeholder="Enter your full name" />
        <OutlookFormTextField
          label="Phone number"
          icon={<Phone className="h-4.5 w-4.5" strokeWidth={2} />}
          value={wizard.submittedByPhone}
          onChange={wizard.setSubmittedByPhone}
          placeholder="(555) 123-4567"
          type="tel"
          inputMode="tel"
        />
        <OutlookFormTextField label="Company (optional)" value={wizard.submittedByCompany} onChange={wizard.setSubmittedByCompany} placeholder="Enter your company" />

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-[var(--of-text-muted)]">I&apos;m a:</label>
          <div className="grid grid-cols-3 gap-2">
            {ROLE_OPTIONS.map(({ value, label, icon: Icon }) => {
              const selected = wizard.submittedByRole === value
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => wizard.setSubmittedByRole(value)}
                  aria-pressed={selected}
                  className={cn(
                    "outlook-form-tap flex min-h-[3rem] flex-col items-center justify-center gap-1 rounded-xl border px-2 text-xs font-semibold",
                    selected
                      ? "border-[var(--of-blue)] bg-[var(--of-blue-soft)] text-[var(--of-blue-strong)]"
                      : "border-[var(--of-border)] bg-[var(--of-surface)] text-[var(--of-text)] hover:bg-[var(--of-surface-2)]",
                  )}
                >
                  <Icon className="h-4 w-4" strokeWidth={2} />
                  {label}
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </OutlookFormStepLayout>
  )
}
