"use client"

import { Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Compact Ask AI affordance placed inside the Directory search field.
 */
export function DirectoryAskEntry({ onClick, className }: { onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-full border px-3 py-2 text-[13px] font-medium",
        "border-[var(--directory-ai-border)] bg-[rgba(36,25,59,0.74)] text-[var(--directory-ai)]",
        "shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_8px_18px_rgba(0,0,0,0.18)] backdrop-blur-xl transition-[border-color,background-color,transform] duration-200",
        "hover:border-[color-mix(in_srgb,var(--directory-ai)_75%,transparent)] hover:bg-[rgba(52,35,82,0.82)] active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--directory-ai)]/70",
        className,
      )}
      aria-label="Ask SVC Directory with AI"
    >
      <Sparkles className="h-4 w-4 directory-ai-spark" strokeWidth={1.8} />
      Ask AI
    </button>
  )
}
