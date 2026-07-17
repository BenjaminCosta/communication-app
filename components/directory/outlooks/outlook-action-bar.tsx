"use client"

import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export interface OutlookAction {
  id: string
  label: string
  icon?: ReactNode
  onClick: () => void
  disabled?: boolean
  tone?: "neutral" | "accent"
}

export function OutlookActionBar({ actions }: { actions: OutlookAction[] }) {
  return (
    <div className="sticky bottom-0 z-20 -mx-4 mt-5 border-t border-white/[0.08] bg-[#080d14]/92 px-3 pb-[max(0.75rem,var(--sab))] pt-2.5 backdrop-blur-xl md:-mx-6">
      <div className={cn("mx-auto grid w-full max-w-xl gap-2", actions.length === 3 ? "grid-cols-3" : "grid-cols-2")}>
        {actions.map((action) => (
          <button
            key={action.id}
            type="button"
            onClick={action.onClick}
            disabled={action.disabled}
            className={cn(
              "flex min-w-0 items-center justify-center gap-1.5 rounded-xl border px-2 py-2.5 text-[10px] font-semibold transition-[background-color,border-color,color,transform] active:scale-[0.98] disabled:opacity-35",
              action.tone === "accent"
                ? "border-violet-400/28 bg-violet-400/[0.11] text-violet-200"
                : "border-white/[0.09] bg-white/[0.035] text-foreground/78",
            )}
          >
            {action.icon}
            <span className="truncate">{action.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
