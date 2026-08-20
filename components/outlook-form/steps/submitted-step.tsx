"use client"

import { CalendarClock, Check, MapPin, Sparkle, User } from "lucide-react"
import { OutlookFormButton, OutlookFormCard } from "@/components/outlook-form/ui/outlook-form-primitives"
import type { OutlookFormWizard } from "@/features/outlook-form/use-outlook-form-wizard"

export function SubmittedStep({ wizard }: { wizard: OutlookFormWizard }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto scrollbar-hide">
      <div className="outlook-form-step-enter mx-auto flex w-full max-w-xl flex-col items-center px-5 pb-10 pt-[clamp(2.5rem,10vh,5rem)] text-center md:px-6">
        <div className="relative">
          <span className="outlook-form-scale-in flex h-20 w-20 items-center justify-center rounded-full bg-[var(--of-blue-soft)] text-[var(--of-blue-strong)]">
            <Check className="h-9 w-9" strokeWidth={2.5} />
          </span>
          <Sparkle className="absolute -right-2 -top-1 h-4 w-4 fill-[var(--of-blue)] text-[var(--of-blue)]" />
          <Sparkle className="absolute -bottom-1 -left-2.5 h-3 w-3 fill-[var(--of-blue)] text-[var(--of-blue)]" />
        </div>

        <h1 className="mt-5 text-[1.75rem] font-bold leading-tight tracking-[-0.02em] text-[var(--of-text)]">Thanks — your 3-week outlook was submitted.</h1>
        <p className="mt-2 max-w-sm text-[0.9375rem] leading-relaxed text-[var(--of-text-muted)]">Frank can now review it in Courtney Roberts Center.</p>

        <OutlookFormCard className="mt-7 w-full p-4 text-left">
          <dl className="flex flex-col gap-2.5 text-sm">
            <SummaryRow icon={<User className="h-4 w-4" strokeWidth={2} />} label="Supervisor" value={wizard.submittedByName} />
            <SummaryRow icon={<MapPin className="h-4 w-4" strokeWidth={2} />} label="Job" value={wizard.jobName} />
            <SummaryRow icon={<CalendarClock className="h-4 w-4" strokeWidth={2} />} label="" value="Submitted just now" plain />
          </dl>
        </OutlookFormCard>

        <div className="mt-7 flex w-full flex-col gap-2.5">
          <OutlookFormButton fullWidth onClick={() => window.close()}>
            Done
          </OutlookFormButton>
          <OutlookFormButton fullWidth variant="secondary" onClick={wizard.resetForAnother}>
            Submit another outlook
          </OutlookFormButton>
        </div>
      </div>
    </div>
  )
}

function SummaryRow({ icon, label, value, plain = false }: { icon: React.ReactNode; label: string; value: string; plain?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--of-surface-2)] text-[var(--of-text-muted)]">{icon}</span>
      {plain ? (
        <span className="text-sm font-medium text-[var(--of-text-muted)]">{value}</span>
      ) : (
        <>
          <dt className="text-xs font-medium text-[var(--of-text-muted)]">{label}:</dt>
          <dd className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--of-text)]">{value || "—"}</dd>
        </>
      )}
    </div>
  )
}
