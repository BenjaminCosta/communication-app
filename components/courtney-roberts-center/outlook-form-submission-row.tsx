"use client"

import { ClipboardList } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatDateInAppZone, formatTimeInAppZone, isSameDayInAppZone } from "@/lib/datetime"
import type { OutlookFormSubmission } from "@/lib/outlook-form-submissions/types"

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
      className="w-full flex items-center gap-3 px-4 md:px-6 py-3 text-left active:bg-white/5 transition-colors duration-150"
    >
      <div className="w-11 h-11 rounded-full bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center shrink-0">
        <ClipboardList className="w-4.5 h-4.5 text-emerald-400" />
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-sm font-semibold truncate block">{submission.jobName}</span>
        <p className="text-xs text-muted-foreground/70 truncate mt-0.5">{submission.submittedByName}</p>
        <div className="flex items-center gap-1.5 mt-1.5">
          <span
            className={cn(
              "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium border",
              submission.status === "reviewed"
                ? "border-emerald-500/40 text-emerald-400 bg-emerald-500/10"
                : "border-amber-500/40 text-amber-400 bg-amber-500/10",
            )}
          >
            {submission.status === "reviewed" ? "Reviewed" : "New"}
          </span>
        </div>
      </div>
      <span className="text-[11px] text-muted-foreground/50 shrink-0 self-start pt-0.5">{formatTimestamp(submission.submittedAtMs)}</span>
    </button>
  )
}
