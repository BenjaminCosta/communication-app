"use client"

import { useState } from "react"
import { ArrowLeft, LogOut, Mail, Phone, Bell, Check, X, Pencil, ChevronRight, Activity, Download, HelpCircle, Bot, MessageCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import { usePwaInstall } from "@/components/use-pwa-install"

// Client-facing by design — see .env.example. Undefined only if the env var
// genuinely isn't configured in this environment; the CTA hides itself then
// rather than linking to "https://wa.me/undefined".
const WHATSAPP_SECRETARY_NUMBER = process.env.NEXT_PUBLIC_WHATSAPP_SECRETARY_NUMBER

interface ProfileScreenProps {
  userName: string
  userEmail: string
  userInitials: string
  userColor: string
  /** Self-reported profile phone (not a verified WhatsApp link). Empty string when unset. */
  userPhone: string
  /** Returns whether the update was accepted — the editor stays open on `false`
   * (e.g. failed validation) so the user can correct their input instead of
   * losing it behind a silently-reverted row. */
  onUpdatePhone: (phone: string | null) => Promise<boolean>
  projectCount: number
  messageCount: number
  onBack: () => void
  onSignOut: () => void
  onNotifications: () => void
  isAdmin?: boolean
  onAdmin?: () => void
  onHelp?: () => void
  className?: string
}

export function ProfileScreen({ userName, userEmail, userInitials, userColor, userPhone, onUpdatePhone, projectCount, messageCount, onBack, onSignOut, onNotifications, isAdmin, onAdmin, onHelp, className }: ProfileScreenProps) {
  const [confirmSignOut, setConfirmSignOut] = useState(false)
  const [editingPhone, setEditingPhone] = useState(false)
  const [phoneValue, setPhoneValue] = useState(userPhone)
  const [savingPhone, setSavingPhone] = useState(false)
  const { openInstall, status: pwaInstallStatus } = usePwaInstall()

  const startEditPhone = () => {
    setPhoneValue(userPhone)
    setEditingPhone(true)
  }

  const cancelEditPhone = () => {
    setEditingPhone(false)
    setPhoneValue(userPhone)
  }

  const savePhone = async () => {
    if (savingPhone) return
    setSavingPhone(true)
    try {
      const succeeded = await onUpdatePhone(phoneValue.trim() || null)
      if (succeeded) setEditingPhone(false)
    } finally {
      setSavingPhone(false)
    }
  }

  const clearPhone = async () => {
    setSavingPhone(true)
    try {
      await onUpdatePhone(null)
    } finally {
      setSavingPhone(false)
    }
  }
  return (
    <div className={`flex-1 min-h-0 flex flex-col stream-glass-screen ${className ?? "animate-fade-in"}`}>
      {/* Header */}
      <div className="shrink-0 border-b border-white/10 animate-slide-down">
        <div className="max-w-2xl mx-auto px-4 md:px-6 app-topbar flex items-center gap-3">
          <button
            onClick={onBack}
            className="w-9 h-9 rounded-full bg-white/5 border border-white/10 flex items-center justify-center active:scale-95 hover:bg-white/8 transition-all duration-150"
          >
            <ArrowLeft className="w-4 h-4 text-muted-foreground" />
          </button>
          <h1 className="text-base font-bold tracking-tight">Profile</h1>
        </div>
      </div>

      {/* Centered content — scrolls when content exceeds viewport (e.g. Android zoom) */}
      <div className="max-w-2xl mx-auto w-full flex flex-col flex-1 min-h-0 overflow-y-auto scrollbar-hide">

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
        <StatCell label="Tags" value={projectCount > 0 ? String(projectCount) : "—"} />
        <StatCell label="Joined" value="—" />
      </div>

      {/* SVC Secretary AI — WhatsApp assistant entry point + the phone
          number that lets it recognize this account. */}
      <div className="mx-6 rounded-2xl bg-card border border-white/10 overflow-hidden animate-fade-up delay-250 mb-6">
        <div className="px-4 pt-4 pb-3 flex items-start gap-2.5">
          <div className="w-8 h-8 rounded-full bg-primary/15 border border-primary/25 flex items-center justify-center shrink-0">
            <Bot className="w-4 h-4 text-primary" />
          </div>
          <div className="min-w-0 pt-0.5">
            <h3 className="text-sm font-bold leading-tight">SVC Secretary AI</h3>
            <p className="text-xs text-muted-foreground leading-snug mt-0.5">
              Chat on WhatsApp for quick answers about jobs, reports, Directory and more.
            </p>
          </div>
        </div>

        {WHATSAPP_SECRETARY_NUMBER && (
          <div className="px-4 pb-4">
            <a
              href={`https://wa.me/${WHATSAPP_SECRETARY_NUMBER}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-primary/15 border border-primary/25 text-primary text-sm font-semibold active:scale-95 hover:bg-primary/20 transition-all duration-150"
            >
              <MessageCircle className="w-4 h-4" />
              Message the Secretary
            </a>
          </div>
        )}

        <div className="border-t border-white/10">
          {editingPhone ? (
            <div className="flex items-center gap-2 px-4 py-3.5">
              <Phone className="w-4 h-4 shrink-0 text-muted-foreground" />
              <input
                type="tel"
                value={phoneValue}
                onChange={(e) => setPhoneValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") savePhone()
                  if (e.key === "Escape") cancelEditPhone()
                }}
                placeholder="Your number"
                autoFocus
                className="flex-1 bg-white/5 border border-white/15 rounded-lg px-2.5 py-1.5 text-sm outline-none focus:border-primary/40 transition-colors"
              />
              <button
                onClick={savePhone}
                disabled={savingPhone}
                className="w-7 h-7 rounded-md bg-primary/15 border border-primary/25 flex items-center justify-center active:scale-95 transition-all disabled:opacity-40"
              >
                <Check className="w-3.5 h-3.5 text-primary" />
              </button>
              <button
                onClick={cancelEditPhone}
                className="w-7 h-7 rounded-md bg-white/5 border border-white/15 flex items-center justify-center active:scale-95 transition-all"
              >
                <X className="w-3.5 h-3.5 text-muted-foreground" />
              </button>
            </div>
          ) : (
            <button onClick={startEditPhone} className="flex items-center gap-3 px-4 py-3.5 w-full text-left active:bg-white/5 transition-colors duration-150">
              <span className="text-muted-foreground"><Phone className="w-4 h-4" /></span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-medium">
                  {userPhone || <span className="text-muted-foreground">Add your number</span>}
                </span>
                <span className="block text-[11px] text-muted-foreground/60 mt-0.5">
                  So the Secretary recognizes you
                </span>
              </span>
              {userPhone ? (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => { e.stopPropagation(); clearPhone() }}
                  className="w-6 h-6 flex items-center justify-center rounded hover:bg-destructive/10 transition-colors shrink-0"
                >
                  <X className="w-3 h-3 text-muted-foreground/40" />
                </span>
              ) : (
                <Pencil className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" />
              )}
            </button>
          )}
        </div>
      </div>

      {/* Settings rows */}
      <div className="mx-6 rounded-2xl bg-card border border-white/10 overflow-hidden flex flex-col divide-y divide-white/10 animate-fade-up delay-250">
        {pwaInstallStatus !== "checking" && pwaInstallStatus !== "installed" && (
          <SettingsRow icon={<Download className="w-4 h-4" />} label="Install app" onClick={openInstall} />
        )}
        <SettingsRow icon={<Bell className="w-4 h-4" />} label="Notifications" onClick={onNotifications} />
        <SettingsRow icon={<HelpCircle className="w-4 h-4" />} label="How it works" onClick={onHelp} />
        {isAdmin && onAdmin && (
          <SettingsRow
            icon={<Activity className="w-4 h-4 text-primary" />}
            label="Activity Monitor"
            onClick={onAdmin}
            badge="Admin"
          />
        )}
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

function SettingsRow({ icon, label, onClick, badge }: { icon: React.ReactNode; label: string; onClick?: () => void; badge?: string }) {
  return (
    <button onClick={onClick} className="flex items-center gap-3 px-4 py-3.5 w-full text-left active:bg-white/5 transition-colors duration-150">
      <span className="text-muted-foreground">{icon}</span>
      <span className="flex-1 text-sm font-medium">{label}</span>
      {badge && (
        <span className="text-[10px] bg-primary/15 text-primary border border-primary/25 rounded-full px-1.5 py-0.5 font-medium mr-1">
          {badge}
        </span>
      )}
      <ChevronRight className="w-4 h-4 text-muted-foreground/40" />
    </button>
  )
}
