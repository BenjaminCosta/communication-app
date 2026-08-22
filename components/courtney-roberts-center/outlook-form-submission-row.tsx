"use client"

import { ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { deriveInitials } from "@/lib/store"
import { formatDateInAppZone, formatTimeInAppZone, isSameDayInAppZone } from "@/lib/datetime"
import { formatOutlookRange } from "@/lib/outlook-core"
import type { OutlookFormSubmission, OutlookFormSubmitterRole } from "@/lib/outlook-form-submissions/types"

const SUBMITTER_ROLE_LABEL: Record<OutlookFormSubmitterRole, string> = {
  site_super: "Site Super",
  pm: "PM",
  other: "Other",
}

function formatTimestamp(ms: number): string {
  if (!ms) return ""
  const date = new Date(ms)
  const now = new Date()
  if (isSameDayInAppZone(date, now)) return formatTimeInAppZone(date, { hour: "numeric", minute: "2-digit" })
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  if (isSameDayInAppZone(date, yesterday)) return "Yesterday"
  return formatDateInAppZone(date, { month: "short", day: "numeric" })
}

export function OutlookFormSubmissionRow({ submission, onSelect }: { submission: OutlookFormSubmission; onSelect: () => void }) {
  return (
    <button
      onClick={onSelect}
      className="w-full flex items-center gap-3 px-4 md:px-6 py-3.5 text-left active:bg-white/5 transition-colors duration-150"
    >
      <div className="w-11 h-11 rounded-full bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center shrink-0">
        <span className="text-sm font-bold text-emerald-400">{deriveInitials(submission.jobName)}</span>
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-sm font-semibold truncate block">{submission.jobName}</span>
        <p className="text-xs text-muted-foreground/70 truncate mt-0.5">
          {submission.submittedByName} · {SUBMITTER_ROLE_LABEL[submission.submittedByRole]}
        </p>
        <div className="flex items-center gap-1.5 mt-1.5">
          <span
            className={cn(
              "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium border",
              submission.status === "converted"
                ? "border-emerald-500/60 text-white bg-emerald-500"
                : submission.status === "reviewed"
                  ? "border-sky-500/40 text-sky-400 bg-sky-500/10"
                  : "border-amber-500/40 text-amber-400 bg-amber-500/10",
            )}
          >
            {submission.status === "converted" ? "Converted" : submission.status === "reviewed" ? "Reviewed" : "New"}
          </span>
        </div>
        <p className="text-[11px] text-muted-foreground/50 mt-1.5">
          {submission.tasks.length} task{submission.tasks.length === 1 ? "" : "s"} · {formatOutlookRange(submission.window)}
        </p>
      </div>
      <div className="flex flex-col items-end gap-2 shrink-0 self-stretch justify-between py-0.5">
        <span className="text-[11px] text-muted-foreground/50">{formatTimestamp(submission.submittedAtMs)}</span>
        <ChevronRight className="w-4 h-4 text-muted-foreground/30" />
      </div>
    </button>
  )
}
