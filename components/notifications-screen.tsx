"use client"

import { useState, useEffect } from "react"
import { ArrowLeft, Bell, BellOff, BellRing, Share2, Plus, Smartphone, Check, Globe } from "lucide-react"
import { doc, updateDoc } from "firebase/firestore"
import { db } from "@/lib/firebase"
import { requestNotificationPermission, type NotificationPreference } from "@/lib/fcm"

// --- Environment detection (client-side only) ---

type Env =
  | "ios-safari-install"  // iOS Safari, not installed as PWA
  | "ios-other-install"   // iOS Chrome/Firefox, not installed as PWA
  | "ios-standalone"      // iOS, installed as PWA
  | "standard"            // Non-iOS browser

function detectEnv(): Env {
  if (typeof window === "undefined") return "standard"
  const ua = navigator.userAgent
  const ios =
    /iPhone|iPad|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  if (!ios) return "standard"
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as any).standalone === true
  if (standalone) return "ios-standalone"
  const isOtherBrowser = /CriOS|FxiOS|EdgiOS/.test(ua)
  return isOtherBrowser ? "ios-other-install" : "ios-safari-install"
}

// --- Props ---

interface NotificationsScreenProps {
  onBack: () => void
  className?: string
  userId: string
  notificationPreference: NotificationPreference
  onPreferenceChange: (pref: NotificationPreference) => void
}

// --- Main component ---

export function NotificationsScreen({
  onBack,
  className,
  userId,
  notificationPreference,
  onPreferenceChange,
}: NotificationsScreenProps) {
  const [env, setEnv] = useState<Env>("standard")
  const [permission, setPermission] = useState<NotificationPermission>("default")
  const [requesting, setRequesting] = useState(false)

  useEffect(() => {
    setEnv(detectEnv())
    if (typeof window !== "undefined" && "Notification" in window) {
      setPermission(Notification.permission)
    }
  }, [])

  const handleEnable = async () => {
    setRequesting(true)
    try {
      const result = await requestNotificationPermission(userId)
      setPermission(result)
    } finally {
      setRequesting(false)
    }
  }

  const handlePreference = async (pref: NotificationPreference) => {
    onPreferenceChange(pref)
    await updateDoc(doc(db, "users", userId), { notificationPreference: pref })
  }

  const isGranted = permission === "granted"
  const isDenied = permission === "denied"

  return (
    <div className={`flex-1 min-h-0 flex flex-col stream-glass-screen ${className ?? "animate-fade-in"}`}>
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

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 md:px-6 py-6 flex flex-col gap-6">

          {/* ── iOS: NOT installed as PWA ── */}
          {(env === "ios-safari-install" || env === "ios-other-install") && (
            <IOSInstallGuide isSafari={env === "ios-safari-install"} />
          )}

          {/* ── iOS: installed as PWA  OR  standard browser ── */}
          {(env === "ios-standalone" || env === "standard") && (
            <>
              {/* Push permission card */}
              <section className="flex flex-col gap-3">
                <p className="text-[10px] font-bold tracking-[1.5px] uppercase text-muted-foreground/60 px-1">
                  Push Notifications
                </p>

                <div className="rounded-2xl bg-card border border-white/10 overflow-hidden">
                  {isGranted ? (
                    <div className="flex items-center gap-3 px-4 py-3.5">
                      <div className="w-9 h-9 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
                        <BellRing className="w-4 h-4 text-emerald-400" />
                      </div>
                      <div className="flex-1 flex flex-col gap-0.5">
                        <span className="text-sm font-semibold">Notifications active</span>
                        <span className="text-xs text-muted-foreground/60">
                          This device will receive push alerts
                        </span>
                      </div>
                      <span className="text-[10px] font-bold tracking-wide uppercase px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 shrink-0">
                        On
                      </span>
                    </div>
                  ) : isDenied ? (
                    <div className="flex items-start gap-3 px-4 py-4">
                      <div className="w-9 h-9 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0 mt-0.5">
                        <BellOff className="w-4 h-4 text-amber-400" />
                      </div>
                      <div className="flex-1 flex flex-col gap-1">
                        <span className="text-sm font-semibold">Notifications blocked</span>
                        <span className="text-xs text-muted-foreground/60 leading-relaxed">
                          You blocked notifications for this site.
                          Open your browser&apos;s site settings and allow
                          notifications for this app, then reload.
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 px-4 py-4">
                      <div className="w-10 h-10 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shrink-0">
                        <Bell className="w-4.5 h-4.5 text-blue-400" />
                      </div>
                      <div className="flex-1 flex flex-col gap-0.5 min-w-0">
                        <span className="text-sm font-semibold">Enable push notifications</span>
                        <span className="text-xs text-muted-foreground/60 leading-relaxed">
                          Get alerted when new messages or tags arrive
                        </span>
                      </div>
                      <button
                        onClick={handleEnable}
                        disabled={requesting}
                        className="shrink-0 px-4 py-2 rounded-xl bg-blue-500 hover:bg-blue-400 text-white text-xs font-semibold active:scale-95 transition-all duration-150 disabled:opacity-50"
                      >
                        {requesting ? "…" : "Enable"}
                      </button>
                    </div>
                  )}
                </div>
              </section>

              {/* Alert mode (only when granted) */}
              {isGranted && (
                <section className="flex flex-col gap-3">
                  <p className="text-[10px] font-bold tracking-[1.5px] uppercase text-muted-foreground/60 px-1">
                    Alert mode
                  </p>
                  <div className="rounded-2xl bg-card border border-white/10 overflow-hidden flex flex-col divide-y divide-white/8">
                    <PreferenceRow
                      icon={<BellRing className="w-4 h-4" />}
                      label="Instant"
                      description="Notify me as messages arrive"
                      selected={notificationPreference === "instant"}
                      onSelect={() => handlePreference("instant")}
                    />
                    <PreferenceRow
                      icon={<BellOff className="w-4 h-4" />}
                      label="Muted"
                      description="No push notifications"
                      selected={notificationPreference === "muted"}
                      onSelect={() => handlePreference("muted")}
                    />
                  </div>
                </section>
              )}
            </>
          )}

          {/* Privacy note */}
          <p className="text-xs text-muted-foreground/35 text-center px-6 leading-relaxed">
            Notifications show who sent a message — never the content.
          </p>

        </div>
      </div>
    </div>
  )
}

// --- iOS Install Guide ---

function IOSInstallGuide({ isSafari }: { isSafari: boolean }) {
  return (
    <section className="flex flex-col gap-3">
      <p className="text-[10px] font-bold tracking-[1.5px] uppercase text-muted-foreground/60 px-1">
        Install to enable notifications
      </p>

      {!isSafari && (
        <div className="rounded-2xl bg-amber-500/8 border border-amber-500/20 px-4 py-3.5 flex items-center gap-3">
          <Globe className="w-5 h-5 text-amber-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-300 leading-tight">Open in Safari first</p>
            <p className="text-xs text-amber-400/70 leading-relaxed mt-0.5">
              iOS notifications only work via Safari.
              Copy the URL and paste it into Safari, then follow the steps below.
            </p>
          </div>
        </div>
      )}

      <div className="rounded-2xl bg-card border border-white/10 overflow-hidden">
        {/* Title */}
        <div className="px-4 pt-4 pb-3 border-b border-white/8">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-blue-500/15 border border-blue-500/20 flex items-center justify-center shrink-0">
              <Smartphone className="w-4 h-4 text-blue-400" />
            </div>
            <div>
              <p className="text-sm font-semibold leading-tight">Add SVC to your Home Screen</p>
              <p className="text-xs text-muted-foreground/60 mt-0.5">Takes 30 seconds — works like a native app</p>
            </div>
          </div>
        </div>

        {/* Steps */}
        <div className="flex flex-col divide-y divide-white/8">
          <InstallStep
            number={1}
            icon={<Share2 className="w-4 h-4" />}
            iconBg="bg-blue-500/10 border-blue-500/20"
            iconColor="text-blue-400"
            title="Tap the Share button"
            detail="The square with an arrow pointing up, in Safari's toolbar"
          />
          <InstallStep
            number={2}
            icon={<Plus className="w-4 h-4" />}
            iconBg="bg-blue-500/10 border-blue-500/20"
            iconColor="text-blue-400"
            title='Tap "Add to Home Screen"'
            detail="Scroll down in the share sheet to find it"
          />
          <InstallStep
            number={3}
            icon={<Check className="w-4 h-4" />}
            iconBg="bg-blue-500/10 border-blue-500/20"
            iconColor="text-blue-400"
            title='Tap "Add" to confirm'
            detail="Top-right corner of the dialog"
          />
          <InstallStep
            number={4}
            icon={<Smartphone className="w-4 h-4" />}
            iconBg="bg-emerald-500/10 border-emerald-500/20"
            iconColor="text-emerald-400"
            title="Open SVC from your Home Screen"
            detail="Then come back here and tap Enable"
            isLast
          />
        </div>
      </div>
    </section>
  )
}

function InstallStep({
  number,
  icon,
  iconBg,
  iconColor,
  title,
  detail,
  isLast = false,
}: {
  number: number
  icon: React.ReactNode
  iconBg: string
  iconColor: string
  title: string
  detail: string
  isLast?: boolean
}) {
  return (
    <div className="flex items-start gap-3 px-4 py-3.5">
      <div className="flex flex-col items-center gap-1 shrink-0 pt-0.5">
        <div
          className={`w-8 h-8 rounded-full border flex items-center justify-center ${iconBg} ${iconColor}`}
        >
          {icon}
        </div>
        {!isLast && <div className="w-px h-3 bg-white/10 rounded-full" />}
      </div>
      <div className="flex-1 min-w-0 pb-0.5">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-muted-foreground/40 font-mono">{number}</span>
          <span className="text-sm font-medium leading-tight">{title}</span>
        </div>
        <p className="text-xs text-muted-foreground/50 mt-0.5 leading-relaxed">{detail}</p>
      </div>
    </div>
  )
}

// --- Preference row ---

function PreferenceRow({
  icon,
  label,
  description,
  selected,
  onSelect,
}: {
  icon: React.ReactNode
  label: string
  description: string
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      onClick={onSelect}
      className="flex items-center gap-3 px-4 py-3.5 w-full text-left active:bg-white/5 transition-colors duration-150"
    >
      <span className="text-muted-foreground/70">{icon}</span>
      <div className="flex-1 flex flex-col gap-0.5 min-w-0">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-muted-foreground/55">{description}</span>
      </div>
      <div
        className={`w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center transition-all duration-150 ${
          selected ? "border-blue-400 bg-blue-400" : "border-white/20"
        }`}
      >
        {selected && <div className="w-1.5 h-1.5 rounded-full bg-background" />}
      </div>
    </button>
  )
}
