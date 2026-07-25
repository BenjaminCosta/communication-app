"use client"

import { Check, Mail } from "lucide-react"
import { AppsCard } from "@/components/applications/ui/apps-primitives"
import { formatApplicationDate, type CandidateApplication } from "@/lib/applications-core"

export function SubmittedStep({ application }: { application: CandidateApplication }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto scrollbar-hide">
      <div className="applications-step-enter mx-auto flex w-full max-w-xl flex-col items-center px-5 pb-10 pt-[clamp(2.5rem,10vh,5rem)] text-center md:px-6">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--apps-complete-soft)] text-[#15803D] animate-scale-in">
          <Check className="h-8 w-8" strokeWidth={2.5} />
        </span>
        <h1 className="mt-5 text-[1.75rem] font-bold leading-tight tracking-[-0.02em] text-[var(--apps-text)]">
          Application submitted
        </h1>
        <p className="mt-2 max-w-sm text-[0.9375rem] leading-relaxed text-[var(--apps-text-muted)]">
          Thanks{application.general.fullName ? `, ${application.general.fullName.split(" ")[0]}` : ""}. We received everything for{" "}
          <span className="font-semibold text-[var(--apps-text)]">{application.job.name}</span>.
        </p>

        <AppsCard className="mt-7 w-full p-5 text-left">
          <h2 className="text-[0.8125rem] font-semibold text-[var(--apps-text)]">What happens next</h2>
          <ol className="mt-3 flex flex-col gap-3">
            {[
              "Our team reviews your application and intro video.",
              "If anything is missing, we'll send you a message.",
              "Once approved, you'll receive your operating agreement to sign.",
            ].map((line, index) => (
              <li key={line} className="flex items-start gap-3">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--apps-blue-soft)] text-[0.625rem] font-bold text-[var(--apps-blue-strong)]">
                  {index + 1}
                </span>
                <span className="text-[0.8125rem] leading-relaxed text-[var(--apps-text-muted)]">{line}</span>
              </li>
            ))}
          </ol>
        </AppsCard>

        <div className="mt-5 flex items-center gap-2 text-xs text-[var(--apps-text-muted)]">
          <Mail className="h-3.5 w-3.5" strokeWidth={2} />
          Confirmation sent to {application.general.email || "your email"} · {formatApplicationDate(application.submittedAt)}
        </div>
      </div>
    </div>
  )
}
