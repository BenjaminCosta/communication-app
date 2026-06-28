"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { Info } from "lucide-react"
import { cn } from "@/lib/utils"

interface HelpTooltipProps {
  text: string
  className?: string
  size?: "sm" | "md"
  tone?: "default" | "chip"
}

export function HelpTooltip({ text, className, size = "sm", tone = "default" }: HelpTooltipProps) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<"top" | "bottom">("top")
  const btnRef = useRef<HTMLButtonElement>(null)
  const ref = useRef<HTMLDivElement>(null)

  const measure = useCallback(() => {
    if (!btnRef.current) return
    const rect = btnRef.current.getBoundingClientRect()
    setPosition(rect.top < 120 ? "bottom" : "top")
  }, [])

  useEffect(() => {
    if (!open) return
    function handleOutside(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("pointerdown", handleOutside)
    return () => document.removeEventListener("pointerdown", handleOutside)
  }, [open])

  const iconSize = size === "sm" ? "w-3 h-3" : "w-3.5 h-3.5"
  const btnSize = size === "sm" ? "w-[18px] h-[18px]" : "w-5 h-5"

  return (
    <div ref={ref} className={cn("relative inline-flex items-center", className)}>
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); measure(); setOpen(!open) }}
        className={cn(
          btnSize,
          "rounded-full flex items-center justify-center border transition-all duration-150",
          open
            ? tone === "chip"
              ? "border-white/18 bg-white/12 text-white/72"
              : "border-white/14 bg-white/10 text-white/70"
            : tone === "chip"
              ? "border-white/12 bg-white/[0.045] text-white/38 hover:bg-white/8 hover:text-white/62 active:scale-90"
              : "border-white/8 bg-white/[0.035] text-muted-foreground/38 hover:text-muted-foreground/65 active:scale-90"
        )}
        aria-label="Show chip hint"
      >
        <Info className={iconSize} />
      </button>

      {open && (
        <div
          className={cn(
            "absolute left-1/2 -translate-x-1/2 z-50",
            position === "top" ? "bottom-full mb-2.5" : "top-full mt-2.5"
          )}
        >
          <div
            className="max-w-[218px] min-w-[158px] rounded-xl border border-white/12 bg-[rgba(13,22,39,0.88)] px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_14px_36px_rgba(0,0,0,0.34)] backdrop-blur-2xl"
            style={{ animation: "tooltip-in 150ms ease-out" }}
          >
            <p className="text-[11px] font-medium leading-[1.45] text-white/62">{text}</p>
          </div>
          {/* Arrow */}
          <div className={cn("flex justify-center", position === "top" ? "-mt-px" : "-mt-[calc(100%+1px)] order-first")}>
            <div
              className={cn(
                "h-2.5 w-2.5 bg-[rgba(13,22,39,0.88)] border-white/12",
                position === "top"
                  ? "border-b border-r rotate-45 -translate-y-1.5"
                  : "border-t border-l rotate-45 translate-y-1.5"
              )}
            />
          </div>
        </div>
      )}
    </div>
  )
}
