"use client"

import { useState, useEffect } from "react"
import { Bell, X } from "lucide-react"
import { requestNotificationPermission } from "@/lib/fcm"
import { usePwaInstall } from "@/components/use-pwa-install"

const SNOOZE_KEY = "svc_notif_prompt_snoozed_until"

function isSnoozed(): boolean {
  try {
    const val = localStorage.getItem(SNOOZE_KEY)
    return !!val && Date.now() < parseInt(val, 10)
  } catch {
    return false
  }
}

function snooze(days: number) {
  try {
    localStorage.setItem(SNOOZE_KEY, String(Date.now() + days * 86_400_000))
  } catch {}
}

type BannerType = "ios-install" | "enable"

function detectBannerType(): BannerType | null {
  if (typeof window === "undefined") return null
  const ua = navigator.userAgent
  const ios =
    /iPhone|iPad|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as any).standalone === true

  if (ios && !standalone) return "ios-install"
  if ("Notification" in window && Notification.permission === "default") return "enable"
  return null
}

function hide(setVisible: (v: boolean) => void, setType: (t: null) => void) {
  setVisible(false)
  setTimeout(() => setType(null), 300)
}

export function NotificationPromptBanner({
  userId,
  onNavigateToNotifications,
}: {
  userId: string
  onNavigateToNotifications: () => void
}) {
  const { status: pwaInstallStatus } = usePwaInstall()
  const [type, setType] = useState<BannerType | null>(null)
  const [visible, setVisible] = useState(false)
  const [requesting, setRequesting] = useState(false)

  useEffect(() => {
    if (pwaInstallStatus === "available" || pwaInstallStatus === "ios" || pwaInstallStatus === "macos-safari") return
    if (isSnoozed()) return
    const detected = detectBannerType()
    if (!detected) return
    setType(detected)
    const t = setTimeout(() => setVisible(true), 800)
    return () => clearTimeout(t)
  }, [pwaInstallStatus])

  const handleDismiss = () => {
    snooze(7)
    hide(setVisible, setType)
  }

  // "Enable" button: request permission directly — no double-click needed.
  // On grant  → snooze 365 days (effectively permanent) + hide.
  // On deny   → navigate to screen showing how to unblock + snooze 30 days.
  // On ios    → navigate to install guide.
  const handleCTA = async () => {
    if (type === "ios-install") {
      onNavigateToNotifications()
      return
    }
    setRequesting(true)
    const result = await requestNotificationPermission(userId)
    setRequesting(false)

    if (result === "granted") {
      snooze(365)
      hide(setVisible, setType)
    } else if (result === "denied") {
      snooze(30)
      hide(setVisible, setType)
      onNavigateToNotifications()
    }
    // "default" = dialog dismissed without choosing → do nothing, let them decide later
  }

  // Installation is the first required action on these platforms. Avoid
  // stacking the notification banner beneath the centered install promotion.
  if (
    !type ||
    pwaInstallStatus === "available" ||
    pwaInstallStatus === "ios" ||
    pwaInstallStatus === "macos-safari"
  ) return null

  return (
    <div className="fixed bottom-20 left-4 right-4 z-30 flex justify-center pointer-events-none">
      <div
        className={`w-full max-w-lg pointer-events-auto transition-all duration-300 ease-out ${
          visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3"
        }`}
      >
        <div className="rounded-2xl bg-[#141820]/96 backdrop-blur-xl border border-white/10 shadow-2xl shadow-black/50 px-4 py-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-blue-500/15 border border-blue-500/25 flex items-center justify-center shrink-0">
            <Bell className="w-4 h-4 text-blue-400" />
          </div>

          <div className="flex-1 min-w-0">
            {type === "ios-install" ? (
              <>
                <p className="text-sm font-semibold leading-tight">Get notifications</p>
                <p className="text-xs text-muted-foreground/70 mt-0.5 leading-snug">
                  Install the app on your Home Screen to enable alerts
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-semibold leading-tight">Enable notifications</p>
                <p className="text-xs text-muted-foreground/70 mt-0.5 leading-snug">
                  Get alerted when messages arrive
                </p>
              </>
            )}
          </div>

          <button
            onClick={handleCTA}
            disabled={requesting}
            className="shrink-0 px-3 py-1.5 rounded-xl bg-blue-500 hover:bg-blue-400 text-white text-xs font-semibold active:scale-95 transition-all duration-150 disabled:opacity-60"
          >
            {requesting ? "…" : type === "ios-install" ? "How" : "Enable"}
          </button>

          <button
            onClick={handleDismiss}
            className="shrink-0 w-7 h-7 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center active:scale-95 transition-all duration-150"
          >
            <X className="w-3.5 h-3.5 text-muted-foreground/60" />
          </button>
        </div>
      </div>
    </div>
  )
}
