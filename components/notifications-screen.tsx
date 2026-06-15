"use client"

import { useState, useEffect } from "react"
import { ArrowLeft, Bell, BellOff, BellRing } from "lucide-react"
import { doc, updateDoc } from "firebase/firestore"
import { db } from "@/lib/firebase"
import { requestNotificationPermission, type NotificationPreference } from "@/lib/fcm"

interface NotificationsScreenProps {
  onBack: () => void
  className?: string
  userId: string
  notificationPreference: NotificationPreference
  onPreferenceChange: (pref: NotificationPreference) => void
}

export function NotificationsScreen({
  onBack,
  className,
  userId,
  notificationPreference,
  onPreferenceChange,
}: NotificationsScreenProps) {
  const [permission, setPermission] = useState<NotificationPermission>("default")
  const [requesting, setRequesting] = useState(false)

  useEffect(() => {
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
  const isDenied  = permission === "denied"

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

          {/* Push section */}
          <section className="flex flex-col gap-3">
            <p className="text-[10px] font-bold tracking-[1.5px] uppercase text-muted-foreground px-1">
              Push Notifications
            </p>

            <div className="rounded-2xl bg-card border border-white/10 overflow-hidden">
              {isGranted ? (
                /* Enabled state */
                <div className="flex items-center gap-3 px-4 py-3.5">
                  <div className="w-9 h-9 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
                    <BellRing className="w-4 h-4 text-emerald-400" />
                  </div>
                  <div className="flex-1 flex flex-col gap-0.5">
                    <span className="text-sm font-medium">Notifications enabled</span>
                    <span className="text-xs text-muted-foreground/70">
                      This device will receive push notifications
                    </span>
                  </div>
                  <span className="text-[10px] font-bold tracking-wide uppercase px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-mono shrink-0">
                    On
                  </span>
                </div>
              ) : (
                /* Not granted state */
                <div className="flex items-center gap-3 px-4 py-4">
                  <div className="w-9 h-9 rounded-full bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                    <Bell className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1 flex flex-col gap-0.5 min-w-0">
                    <span className="text-sm font-medium">Enable push notifications</span>
                    <span className="text-xs text-muted-foreground/70 leading-relaxed">
                      {isDenied
                        ? "Blocked — allow notifications in your browser's site settings"
                        : "Get notified when new messages arrive"}
                    </span>
                  </div>
                  {!isDenied && (
                    <button
                      onClick={handleEnable}
                      disabled={requesting}
                      className="shrink-0 px-3 py-1.5 rounded-lg bg-foreground text-background text-xs font-semibold active:scale-95 transition-all duration-150 disabled:opacity-50"
                    >
                      {requesting ? "…" : "Enable"}
                    </button>
                  )}
                </div>
              )}
            </div>
          </section>

          {/* Alert mode (only shown when permission is granted) */}
          {isGranted && (
            <section className="flex flex-col gap-3">
              <p className="text-[10px] font-bold tracking-[1.5px] uppercase text-muted-foreground px-1">
                Alert mode
              </p>
              <div className="rounded-2xl bg-card border border-white/10 overflow-hidden flex flex-col divide-y divide-white/10">
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

          <p className="text-xs text-muted-foreground/40 text-center px-4 leading-relaxed">
            Notifications show who sent a message — never the content.
          </p>

        </div>
      </div>
    </div>
  )
}

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
      <span className="text-muted-foreground">{icon}</span>
      <div className="flex-1 flex flex-col gap-0.5 min-w-0">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-muted-foreground/70">{description}</span>
      </div>
      <div
        className={`w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center transition-all duration-150 ${
          selected ? "border-foreground bg-foreground" : "border-white/20"
        }`}
      >
        {selected && <div className="w-1.5 h-1.5 rounded-full bg-background" />}
      </div>
    </button>
  )
}
