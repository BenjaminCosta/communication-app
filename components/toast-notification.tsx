"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { cn } from "@/lib/utils"

interface ToastNotificationProps {
  message: string
  action?: { label: string; onClick: () => void }
  duration?: number
  onDismiss: () => void
}

export function ToastNotification({
  message,
  action,
  duration = 3500,
  onDismiss,
}: ToastNotificationProps) {
  const [visible, setVisible] = useState(false)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const dismiss = useCallback(() => {
    setVisible(false)
    hideTimer.current = setTimeout(onDismiss, 300)
  }, [onDismiss])

  useEffect(() => {
    const showTimer = setTimeout(() => setVisible(true), 10)
    const autoHide = setTimeout(dismiss, duration)
    return () => {
      clearTimeout(showTimer)
      clearTimeout(autoHide)
      clearTimeout(hideTimer.current)
    }
  }, [duration, dismiss])

  const handleAction = () => {
    clearTimeout(hideTimer.current)
    action?.onClick()
    dismiss()
  }

  return (
    <div
      className={cn(
        "fixed z-50 bottom-24 left-3 right-3",
        "flex items-center gap-3 px-4 py-3 rounded-2xl",
        "bg-gradient-to-br from-[#1a3f7f]/40 to-[#0f1f4d]/20 backdrop-blur-3xl",
        "border border-[#2563eb]/20 shadow-inner",
        "shadow-[0_8px_32px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(37,99,235,0.15),0_0_0_1px_rgba(37,99,235,0.1)]",
        "transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] pointer-events-none",
        visible
          ? "opacity-100 translate-y-0 scale-100"
          : "opacity-0 translate-y-3 scale-[0.95]"
      )}
    >
      {/* Accent dot */}
      <div className="w-1.5 h-1.5 rounded-full bg-primary/70 shrink-0" />

      <span className="text-sm font-medium text-foreground/85 flex-1 leading-snug">
        {message}
      </span>

      {action && (
        <button
          onClick={handleAction}
          className="text-xs font-bold text-[#60a5fa] shrink-0 bg-gradient-to-br from-[#2563eb]/30 to-[#1d4ed8]/20 border border-[#2563eb]/40 rounded-lg px-3 py-1.5 active:scale-95 active:bg-gradient-to-br active:from-[#2563eb]/40 active:to-[#1d4ed8]/30 active:border-[#2563eb]/50 transition-all backdrop-blur-sm pointer-events-auto"
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
