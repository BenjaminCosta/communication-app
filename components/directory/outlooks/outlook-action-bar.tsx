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
    <div className="sticky bottom-0 z-20 -mx-4 mt-5 border-t border-white/[0.08] bg-[#080d14]/94 px-3 pb-[max(2rem,calc(var(--sab)+1.25rem))] pt-2.5 shadow-[0_-12px_30px_rgba(3,7,12,0.32)] backdrop-blur-xl md:-mx-6">
      <div className={cn("mx-auto grid w-full max-w-xl gap-2", actions.length === 3 ? "grid-cols-3" : "grid-cols-2")}>
        {actions.map((action) => (
          <button
            key={action.id}
            type="button"
            onClick={action.onClick}
            disabled={action.disabled}
            className={cn(
              "flex min-h-12 min-w-0 items-center justify-center gap-2 rounded-[13px] border px-1.5 py-3 text-[9px] font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.055)] transition-[background-color,border-color,color,transform] active:scale-[0.98] disabled:opacity-35 min-[390px]:px-2 min-[390px]:text-[10px] [&>svg]:size-4",
              action.tone === "accent"
                ? "border-violet-400/45 bg-violet-600/80 text-violet-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.16)]"
                : "border-white/[0.11] bg-[#121923]/92 text-foreground/82",
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
