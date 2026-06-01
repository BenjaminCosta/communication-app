"use client"

import { ArrowLeft, Bell } from "lucide-react"

interface NotificationsScreenProps {
  onBack: () => void
  className?: string
}

export function NotificationsScreen({ onBack, className }: NotificationsScreenProps) {
  return (
    <div className={`flex-1 flex flex-col stream-glass-screen ${className ?? "animate-fade-in"}`}>
      {/* Header */}
      <div className="shrink-0 border-b border-white/10">
        <div className="max-w-2xl mx-auto px-4 md:px-6 app-topbar flex items-center gap-3">
          <button
            onClick={onBack}
            className="w-9 h-9 rounded-full bg-white/5 border border-white/10 flex items-center justify-center active:scale-95 hover:bg-white/8 transition-all duration-150"
          >
            <ArrowLeft className="w-4 h-4 text-muted-foreground" />
          </button>
          <h1 className="text-base font-bold tracking-tight">Notifications</h1>
        </div>
      </div>

      {/* Empty state */}
      <div className="flex-1 flex flex-col items-center justify-center gap-4 px-8 pb-16">
        <div className="w-20 h-20 rounded-full bg-white/5 border border-white/10 flex items-center justify-center animate-scale-in">
          <Bell className="w-8 h-8 text-muted-foreground/40" />
        </div>
        <div className="flex flex-col items-center gap-1.5 animate-fade-up">
          <p className="text-base font-semibold text-foreground/80">No notifications</p>
          <p className="text-sm text-muted-foreground text-center leading-relaxed">
            {"You're all caught up. Notifications will appear here."}
          </p>
        </div>
      </div>
    </div>
  )
}
