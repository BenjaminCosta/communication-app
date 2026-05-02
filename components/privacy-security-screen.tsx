"use client"

import { ArrowLeft, Shield, Lock, Eye, Smartphone, Trash2, ChevronRight } from "lucide-react"

interface PrivacySecurityScreenProps {
  onBack: () => void
  className?: string
}

export function PrivacySecurityScreen({ onBack, className }: PrivacySecurityScreenProps) {
  return (
    <div className={`flex-1 flex flex-col bg-background ${className ?? "animate-fade-in"}`}>
      {/* Header */}
      <div className="shrink-0 border-b border-white/10">
        <div className="max-w-2xl mx-auto px-4 md:px-6 py-3 flex items-center gap-3">
          <button
            onClick={onBack}
            className="w-9 h-9 rounded-full bg-white/5 border border-white/10 flex items-center justify-center active:scale-95 hover:bg-white/8 transition-all duration-150"
          >
            <ArrowLeft className="w-4 h-4 text-muted-foreground" />
          </button>
          <h1 className="text-base font-bold tracking-tight">Privacy & Security</h1>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 md:px-6 py-6 flex flex-col gap-6">

          {/* Security section */}
          <section className="flex flex-col gap-3">
            <p className="text-[10px] font-bold tracking-[1.5px] uppercase text-muted-foreground px-1">Security</p>
            <div className="rounded-2xl bg-card border border-white/10 overflow-hidden flex flex-col divide-y divide-white/10">
              <SettingRow
                icon={<Lock className="w-4 h-4" />}
                label="Change Password"
                description="Update your account password"
              />
              <SettingRow
                icon={<Smartphone className="w-4 h-4" />}
                label="Two-Factor Authentication"
                description="Add an extra layer of security"
                badge="Off"
              />
              <SettingRow
                icon={<Smartphone className="w-4 h-4" />}
                label="Active Sessions"
                description="Manage devices signed in to your account"
              />
            </div>
          </section>

          {/* Privacy section */}
          <section className="flex flex-col gap-3">
            <p className="text-[10px] font-bold tracking-[1.5px] uppercase text-muted-foreground px-1">Privacy</p>
            <div className="rounded-2xl bg-card border border-white/10 overflow-hidden flex flex-col divide-y divide-white/10">
              <SettingRow
                icon={<Eye className="w-4 h-4" />}
                label="Read Receipts"
                description="Let others know when you've read their messages"
                badge="On"
              />
              <SettingRow
                icon={<Eye className="w-4 h-4" />}
                label="Profile Visibility"
                description="Control who can see your profile"
                badge="Team"
              />
              <SettingRow
                icon={<Shield className="w-4 h-4" />}
                label="Data & Analytics"
                description="Manage what data is collected"
              />
            </div>
          </section>

          {/* Danger zone */}
          <section className="flex flex-col gap-3">
            <p className="text-[10px] font-bold tracking-[1.5px] uppercase text-muted-foreground px-1">Danger Zone</p>
            <div className="rounded-2xl bg-destructive/5 border border-destructive/15 overflow-hidden">
              <SettingRow
                icon={<Trash2 className="w-4 h-4 text-destructive" />}
                label="Delete Account"
                description="Permanently remove your account and data"
                danger
              />
            </div>
          </section>

        </div>
      </div>
    </div>
  )
}

function SettingRow({
  icon,
  label,
  description,
  badge,
  danger,
}: {
  icon: React.ReactNode
  label: string
  description?: string
  badge?: string
  danger?: boolean
}) {
  return (
    <button className="flex items-center gap-3 px-4 py-3.5 w-full text-left active:bg-white/5 transition-colors duration-150">
      <span className={danger ? "text-destructive" : "text-muted-foreground"}>{icon}</span>
      <div className="flex-1 flex flex-col gap-0.5 min-w-0">
        <span className={`text-sm font-medium ${danger ? "text-destructive" : ""}`}>{label}</span>
        {description && (
          <span className="text-xs text-muted-foreground/70 truncate">{description}</span>
        )}
      </div>
      {badge ? (
        <span className="text-[10px] font-bold tracking-wide uppercase px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-muted-foreground font-mono shrink-0">
          {badge}
        </span>
      ) : (
        <ChevronRight className={`w-4 h-4 shrink-0 ${danger ? "text-destructive/40" : "text-muted-foreground/40"}`} />
      )}
    </button>
  )
}
