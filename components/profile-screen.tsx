"use client"

import { useState } from "react"
import { ArrowLeft, LogOut, Mail, Bell, Shield, FolderOpen, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

interface ProfileScreenProps {
  userName: string
  userEmail: string
  userInitials: string
  userColor: string
  projectCount: number
  messageCount: number
  onBack: () => void
  onSignOut: () => void
  onNotifications: () => void
  onPrivacy: () => void
  onProjects: () => void
  className?: string
}

export function ProfileScreen({ userName, userEmail, userInitials, userColor, projectCount, messageCount, onBack, onSignOut, onNotifications, onPrivacy, onProjects, className }: ProfileScreenProps) {
  const [confirmSignOut, setConfirmSignOut] = useState(false)
  return (
    <div className={`flex-1 flex flex-col bg-background ${className ?? "animate-fade-in"}`}>
      {/* Header */}
      <div className="flex-shrink-0 border-b border-white/10 animate-slide-down">
        <div className="max-w-2xl mx-auto px-4 md:px-6 py-3 flex items-center gap-3">
          <button
            onClick={onBack}
            className="w-9 h-9 rounded-full bg-white/5 border border-white/10 flex items-center justify-center active:scale-95 hover:bg-white/8 transition-all duration-150"
          >
            <ArrowLeft className="w-4 h-4 text-muted-foreground" />
          </button>
          <h1 className="text-base font-bold tracking-tight">Profile</h1>
        </div>
      </div>

      {/* Centered content */}
      <div className="max-w-2xl mx-auto w-full flex flex-col flex-1">

      {/* Avatar + Info */}
      <div className="flex flex-col items-center gap-3 pt-10 pb-8 px-6">
        <div className="relative animate-spring-pop">
          <div className={cn("w-20 h-20 rounded-full flex items-center justify-center shadow-lg", userColor)}>
            <span className="text-2xl font-bold text-white">{userInitials}</span>
          </div>
          {/* Online indicator */}
          <div className="absolute bottom-0.5 right-0.5 w-4 h-4 rounded-full bg-progress border-2 border-background shadow-[0_0_8px_rgba(34,197,94,0.5)]" />
        </div>
        <div className="text-center animate-fade-up delay-100">
          <h2 className="text-lg font-bold">{userName}</h2>
        </div>
        {/* Email chip */}
        <div className="flex items-center gap-1.5 bg-white/5 border border-white/10 rounded-full px-3 py-1.5 animate-fade-up delay-150">
          <Mail className="w-3 h-3 text-muted-foreground" />
          <span className="text-xs text-muted-foreground font-mono">{userEmail}</span>
        </div>
      </div>

      {/* Stats row */}
      <div className="mx-6 rounded-2xl bg-card border border-white/10 flex divide-x divide-white/10 mb-6 animate-fade-up delay-200">
        <StatCell label="Messages" value={messageCount > 0 ? String(messageCount) : "—"} />
        <StatCell label="Projects" value={projectCount > 0 ? String(projectCount) : "—"} />
        <StatCell label="Joined" value="—" />
      </div>

      {/* Settings rows */}
      <div className="mx-6 rounded-2xl bg-card border border-white/10 overflow-hidden flex flex-col divide-y divide-white/10 animate-fade-up delay-250">
        <SettingsRow icon={<FolderOpen className="w-4 h-4" />} label="Projects" onClick={onProjects} />
        <SettingsRow icon={<Bell className="w-4 h-4" />} label="Notifications" onClick={onNotifications} />
        <SettingsRow icon={<Shield className="w-4 h-4" />} label="Privacy & Security" onClick={onPrivacy} />
      </div>

      <div className="flex-1" />

      {/* Sign Out */}
      <div className="px-6 pb-10 safe-area-pb animate-fade-up delay-300">
        {confirmSignOut ? (
          <div className="flex gap-2">
            <button
              onClick={() => setConfirmSignOut(false)}
              className="flex-1 py-3.5 rounded-xl border border-white/10 bg-white/5 text-sm font-semibold text-muted-foreground active:scale-[0.98] transition-all duration-150 hover:bg-white/8"
            >
              Cancel
            </button>
            <button
              onClick={onSignOut}
              className="flex-1 py-3.5 rounded-xl border border-destructive/30 bg-destructive/15 text-destructive text-sm font-bold active:scale-[0.98] transition-all duration-150 hover:bg-destructive/25 flex items-center justify-center gap-2"
            >
              <LogOut className="w-4 h-4" />
              Confirm
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmSignOut(true)}
            className="w-full py-3.5 rounded-xl border border-destructive/20 bg-destructive/8 text-destructive text-sm font-semibold flex items-center justify-center gap-2 active:scale-[0.98] transition-all duration-150 hover:bg-destructive/15"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        )}
      </div>
      </div>{/* end centered content */}
    </div>
  )
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex-1 flex flex-col items-center py-4 gap-0.5">
      <span className="text-base font-bold">{value}</span>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground font-mono">
        {label}
      </span>
    </div>
  )
}

function SettingsRow({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-3 px-4 py-3.5 w-full text-left active:bg-white/5 transition-colors duration-150">
      <span className="text-muted-foreground">{icon}</span>
      <span className="flex-1 text-sm font-medium">{label}</span>
      <ChevronRight className="w-4 h-4 text-muted-foreground/40" />
    </button>
  )
}
