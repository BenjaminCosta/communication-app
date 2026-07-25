"use client"

import { Check, FileText, ShieldCheck } from "lucide-react"
import { AppsCard } from "@/components/applications/ui/apps-primitives"
import { OPERATING_AGREEMENT_TEMPLATE, formatApplicationDate, type CandidateApplication } from "@/lib/applications-core"

export function AgreementSignedStep({ application }: { application: CandidateApplication }) {
  const signedAt = application.agreement.signedAt
  const signedName = application.agreement.signedName || application.general.fullName || application.candidateName

  return (
    <div className="min-h-0 flex-1 overflow-y-auto scrollbar-hide">
      <div className="applications-step-enter mx-auto flex w-full max-w-xl flex-col items-center px-5 pb-10 pt-[clamp(2.5rem,10vh,5rem)] text-center md:px-6">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--apps-complete-soft)] text-[#15803D] animate-scale-in">
          <Check className="h-8 w-8" strokeWidth={2.5} />
        </span>
        <h1 className="mt-5 text-[1.75rem] font-bold leading-tight tracking-[-0.02em] text-[var(--apps-text)]">
          Agreement signed
        </h1>
        <p className="mt-2 max-w-sm text-[0.9375rem] leading-relaxed text-[var(--apps-text-muted)]">
          Thanks{signedName ? `, ${signedName.split(" ")[0]}` : ""}. You're all set for{" "}
          <span className="font-semibold text-[var(--apps-text)]">{application.job.name}</span>.
        </p>

        {/* What was signed — the record the candidate can point back to. */}
        <AppsCard className="mt-7 w-full p-4 text-left">
          <dl className="flex flex-col gap-2.5 text-[0.8125rem]">
            {[
              ["Document", `${OPERATING_AGREEMENT_TEMPLATE.title} v${OPERATING_AGREEMENT_TEMPLATE.version}`],
              ["Signed by", signedName || "—"],
              ["Date", formatApplicationDate(signedAt)],
            ].map(([label, value]) => (
              <div key={label} className="flex items-start justify-between gap-4">
                <dt className="shrink-0 text-[var(--apps-text-muted)]">{label}</dt>
                <dd className="min-w-0 truncate text-right font-medium text-[var(--apps-text)]">{value}</dd>
              </div>
            ))}
          </dl>
        </AppsCard>

        <div className="mt-3 flex w-full items-center gap-3 rounded-2xl border border-[var(--apps-border)] bg-[var(--apps-surface-2)] p-4 text-left">
          <FileText className="h-4 w-4 shrink-0 text-[var(--apps-text-muted)]" strokeWidth={2} />
          <p className="text-xs leading-relaxed text-[var(--apps-text-muted)]">
            A sealed PDF copy will be emailed to you and stored with your file.
          </p>
        </div>

        <div className="mt-5 flex items-center gap-2 text-xs text-[var(--apps-text-muted)]">
          <ShieldCheck className="h-3.5 w-3.5" strokeWidth={2} />
          Payroll setup starts next — we'll be in touch.
        </div>
      </div>
    </div>
  )
}
