"use client"

import { useEffect } from "react"
import { Check, MapPin, Search } from "lucide-react"
import { cn, getUserAvatarColor } from "@/lib/utils"
import { OutlookFormStepLayout } from "@/components/outlook-form/step-layout"
import { canContinueFromJob, outlookFormInitials } from "@/lib/outlook-form-submissions/wizard-core"
import type { OutlookFormJobOption } from "@/lib/outlook-form-submissions/client"
import type { OutlookFormWizard } from "@/features/outlook-form/use-outlook-form-wizard"

export function JobStep({ wizard }: { wizard: OutlookFormWizard }) {
  useEffect(() => {
    wizard.loadJobs()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const isLoading = wizard.jobs === null

  return (
    <OutlookFormStepLayout
      title="Choose your job"
      intro="Pick the project this outlook is for."
      primary={{ label: "Continue", onClick: wizard.goNext, disabled: !canContinueFromJob(wizard.jobName) }}
    >
      <div className="mb-4 flex items-center gap-2 rounded-xl border border-[var(--of-border)] bg-[var(--of-surface)] px-3.5 py-2.5">
        <Search className="h-4 w-4 shrink-0 text-[var(--of-text-muted)]" strokeWidth={2} />
        <input
          value={wizard.jobSearch}
          onChange={(event) => wizard.setJobSearch(event.target.value)}
          placeholder="Search job name or location"
          className="min-w-0 flex-1 bg-transparent text-sm text-[var(--of-text)] outline-none placeholder:text-[#94A3B8]"
        />
      </div>

      {wizard.jobsError && <p className="mb-3 text-xs font-medium text-[#DC5A5A]">{wizard.jobsError}</p>}

      <div className="flex flex-col gap-2.5">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-[4.5rem] animate-pulse rounded-2xl bg-[var(--of-surface-2)]" />
          ))
        ) : (
          <>
            {wizard.filteredJobs.map((job) => (
              <JobRow key={job.id} job={job} selected={wizard.jobSelection === job.id} onSelect={() => wizard.setJobSelection(job.id)} />
            ))}

            {wizard.filteredJobs.length === 0 && (
              <p className="py-4 text-center text-sm text-[var(--of-text-muted)]">No jobs match your search.</p>
            )}

            <OtherJobRow
              selected={wizard.jobSelection === "other"}
              onSelect={() => wizard.setJobSelection("other")}
              value={wizard.otherJobName}
              onChange={wizard.setOtherJobName}
            />
          </>
        )}
      </div>
    </OutlookFormStepLayout>
  )
}

function JobRow({ job, selected, onSelect }: { job: OutlookFormJobOption; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "outlook-form-tap flex w-full items-center gap-3.5 rounded-2xl border p-3.5 text-left",
        selected ? "border-[var(--of-blue)] bg-[var(--of-blue-soft)]" : "border-[var(--of-border)] bg-[var(--of-surface)] hover:bg-[var(--of-surface-2)]",
      )}
    >
      <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white", getUserAvatarColor(job.id))}>
        {outlookFormInitials(job.name)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-[var(--of-text)]">{job.name}</p>
        {job.address && (
          <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-[var(--of-text-muted)]">
            <MapPin className="h-3 w-3 shrink-0" strokeWidth={2} />
            <span className="truncate">{job.address}</span>
          </p>
        )}
      </div>
      <span
        className={cn(
          "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2",
          selected ? "border-[var(--of-blue)] bg-[var(--of-blue)] text-white" : "border-[var(--of-border)] bg-transparent",
        )}
      >
        {selected && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
      </span>
    </button>
  )
}

function OtherJobRow({
  selected,
  onSelect,
  value,
  onChange,
}: {
  selected: boolean
  onSelect: () => void
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className={cn("rounded-2xl border p-3.5", selected ? "border-[var(--of-blue)] bg-[var(--of-blue-soft)]" : "border-[var(--of-border)] bg-[var(--of-surface)]")}>
      <button type="button" onClick={onSelect} className="flex w-full items-center gap-3.5 text-left">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--of-surface-2)] text-[var(--of-text-muted)]">
          <MapPin className="h-4.5 w-4.5" strokeWidth={2} />
        </span>
        <span className="min-w-0 flex-1 text-sm font-bold text-[var(--of-text)]">Other / not listed</span>
        <span
          className={cn(
            "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2",
            selected ? "border-[var(--of-blue)] bg-[var(--of-blue)] text-white" : "border-[var(--of-border)] bg-transparent",
          )}
        >
          {selected && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
        </span>
      </button>
      {selected && (
        <input
          autoFocus
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Type the job name"
          className="mt-3 w-full rounded-xl border border-[var(--of-border)] bg-[var(--of-surface)] px-3.5 py-2.5 text-sm text-[var(--of-text)] outline-none placeholder:text-[#94A3B8] focus:border-[var(--of-blue)]"
        />
      )}
    </div>
  )
}
