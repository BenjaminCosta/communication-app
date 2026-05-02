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
    hideTimer.current = setTimeout(onDismiss, 280)
  }, [onDismiss])

  useEffect(() => {
    // Defer entrance so the CSS transition fires after mount
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
        // Position: above the FAB (fixed bottom-6 + h-14 = ~80px, so bottom-24 clears it)
        "fixed z-50 bottom-24 left-4 right-4",
        "flex items-center gap-3 px-4 py-3 rounded-2xl",
        "bg-[#1e2d4a] border border-white/15 shadow-[0_8px_32px_rgba(0,0,0,0.45)]",
        "transition-all duration-[280ms] ease-out pointer-events-auto",
        visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3"
      )}
    >
      <span className="text-sm font-medium text-foreground/90 flex-1">{message}</span>
      {action && (
        <button
          onClick={handleAction}
          className="text-sm font-bold text-primary shrink-0 active:opacity-70 transition-opacity"
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
