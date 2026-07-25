"use client"

/**
 * Invite a new candidate — collects the up-front details so the created
 * application isn't a blank draft. On submit it hands back the details; the
 * caller creates the application + link and opens the share sheet.
 */

import { useState } from "react"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { AppsSheet } from "@/components/applications/ui/apps-sheet"
import { AppsButton } from "@/components/applications/ui/apps-primitives"
import { TRADE_OPTIONS, type InviteDetails } from "@/lib/applications-core"

const CONTROL =
  "h-12 w-full rounded-xl border border-[var(--apps-border)] bg-[var(--apps-surface)] px-3.5 text-base text-[var(--apps-text)] outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-[#94A3B8] focus:border-[var(--apps-blue)] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.12)]"

export function InviteCandidateSheet({
  open,
  onClose,
  onCreate,
}: {
  open: boolean
  onClose: () => void
  onCreate: (details: InviteDetails) => void
}) {
  const [candidateName, setCandidateName] = useState("")
  const [trade, setTrade] = useState("")
  const [jobName, setJobName] = useState("")
  const [showError, setShowError] = useState(false)

  const reset = () => {
    setCandidateName("")
    setTrade("")
    setJobName("")
    setShowError(false)
  }

  const submit = () => {
    if (!candidateName.trim()) {
      setShowError(true)
      return
    }
    onCreate({ candidateName: candidateName.trim(), trade, jobName: jobName.trim() })
    reset()
  }

  return (
    <AppsSheet
      open={open}
      title="Invite a candidate"
      description="Start their application and get a secure link to send them."
      onClose={() => {
        reset()
        onClose()
      }}
      footer={
        <AppsButton fullWidth onClick={submit}>
          Create link
        </AppsButton>
      }
    >
      <div className="flex flex-col gap-3.5">
        <div>
          <label htmlFor="invite-name" className="mb-1.5 block px-1 text-[0.8125rem] font-semibold text-[var(--apps-text)]">
            Candidate name
          </label>
          <input
            id="invite-name"
            value={candidateName}
            onChange={(event) => setCandidateName(event.target.value)}
            placeholder="First and last name"
            autoComplete="off"
            className={cn(CONTROL, showError && !candidateName.trim() && "border-[#F3B4B4]")}
          />
          {showError && !candidateName.trim() && <p className="mt-1 px-1 text-xs font-medium text-[#DC5A5A]">Required</p>}
        </div>

        <div>
          <label htmlFor="invite-trade" className="mb-1.5 block px-1 text-[0.8125rem] font-semibold text-[var(--apps-text)]">
            Trade <span className="font-normal text-[var(--apps-text-muted)]">(optional)</span>
          </label>
          <div className="relative">
            <select
              id="invite-trade"
              value={trade}
              onChange={(event) => setTrade(event.target.value)}
              className={cn(CONTROL, "appearance-none pr-10", !trade && "text-[#94A3B8]")}
            >
              <option value="">Select a trade</option>
              {TRADE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <ChevronDown
              className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--apps-text-muted)]"
              strokeWidth={2}
            />
          </div>
        </div>

        <div>
          <label htmlFor="invite-job" className="mb-1.5 block px-1 text-[0.8125rem] font-semibold text-[var(--apps-text)]">
            Job <span className="font-normal text-[var(--apps-text-muted)]">(optional)</span>
          </label>
          <input
            id="invite-job"
            value={jobName}
            onChange={(event) => setJobName(event.target.value)}
            placeholder="e.g. RW Dake Construction"
            autoComplete="off"
            className={CONTROL}
          />
        </div>

        <p className="px-1 text-xs leading-relaxed text-[var(--apps-text-muted)]">
          The candidate fills in the rest from their phone. You can update the job later from their profile.
        </p>
      </div>
    </AppsSheet>
  )
}
