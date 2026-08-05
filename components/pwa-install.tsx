"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import { Check, ChevronRight, Copy, Download, ExternalLink, MonitorDown, Plus, Share2, X } from "lucide-react"

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{
    outcome: "accepted" | "dismissed"
    platform: string
  }>
}

declare global {
  interface Window {
    __svcDeferredInstallPrompt?: BeforeInstallPromptEvent
  }
}

export type PwaInstallStatus = "checking" | "available" | "ios" | "macos-safari" | "manual" | "installed"

interface PwaInstallContextValue {
  status: PwaInstallStatus
  openInstall: () => void
  requestInstallPromotion: () => void
}

const PwaInstallContext = createContext<PwaInstallContextValue | null>(null)
const PROMOTION_SNOOZE_KEY = "svc_pwa_install_prompt_snoozed_until"

function isPromotionSnoozed(): boolean {
  try {
    const value = localStorage.getItem(PROMOTION_SNOOZE_KEY)
    return !!value && Date.now() < Number.parseInt(value, 10)
  } catch {
    return false
  }
}

function snoozePromotion(days: number) {
  try {
    localStorage.setItem(PROMOTION_SNOOZE_KEY, String(Date.now() + days * 86_400_000))
  } catch {
    // Storage can be unavailable in private or managed browser sessions.
  }
}

function useEscapeDismiss(onDismiss: () => void) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss()
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [onDismiss])
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

function fallbackStatus(): Exclude<PwaInstallStatus, "checking" | "available" | "installed"> {
  const ua = navigator.userAgent
  const ios =
    /iPhone|iPad|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  if (ios) return "ios"

  const macosSafari =
    /Macintosh/.test(ua) &&
    /Safari/.test(ua) &&
    !/Chrome|Chromium|CriOS|Edg|OPR|Firefox/.test(ua)
  if (macosSafari) return "macos-safari"

  return "manual"
}

export function usePwaInstall(): PwaInstallContextValue {
  const context = useContext(PwaInstallContext)
  if (!context) {
    throw new Error("usePwaInstall must be used inside PwaInstallProvider")
  }
  return context
}

export function PwaInstallProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<PwaInstallStatus>("checking")
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [isPromotionOpen, setIsPromotionOpen] = useState(false)
  const [isPrompting, setIsPrompting] = useState(false)

  const useInstallPrompt = useCallback((event: BeforeInstallPromptEvent) => {
    event.preventDefault()
    window.__svcDeferredInstallPrompt = event
    setInstallPrompt(event)
    setStatus(isStandalone() ? "installed" : "available")
  }, [])

  useEffect(() => {
    if (isStandalone()) {
      setStatus("installed")
      return
    }

    const savedPrompt = window.__svcDeferredInstallPrompt
    if (savedPrompt) useInstallPrompt(savedPrompt)

    const handleBeforeInstallPrompt = (event: Event) => {
      useInstallPrompt(event as BeforeInstallPromptEvent)
    }
    const handlePromptAvailable = () => {
      const deferredPrompt = window.__svcDeferredInstallPrompt
      if (deferredPrompt) useInstallPrompt(deferredPrompt)
    }
    const handleInstalled = () => {
      setInstallPrompt(null)
      window.__svcDeferredInstallPrompt = undefined
      setStatus("installed")
      setIsOpen(false)
    }

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt)
    window.addEventListener("svc-pwa-install-available", handlePromptAvailable)
    window.addEventListener("appinstalled", handleInstalled)

    // Browsers can dispatch beforeinstallprompt later than hydration. Keep the
    // profile row quiet for a beat, then surface the appropriate manual path.
    const fallbackTimer = window.setTimeout(() => {
      setStatus((current) => (current === "checking" ? fallbackStatus() : current))
    }, 1000)

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt)
      window.removeEventListener("svc-pwa-install-available", handlePromptAvailable)
      window.removeEventListener("appinstalled", handleInstalled)
      window.clearTimeout(fallbackTimer)
    }
  }, [useInstallPrompt])

  const openInstall = useCallback(() => {
    if (status === "available" || status === "ios" || status === "macos-safari") {
      setIsPromotionOpen(true)
      return
    }
    if (status !== "installed") setIsOpen(true)
  }, [status])

  const requestInstallPromotion = useCallback(() => {
    if (status === "available" || status === "ios" || status === "macos-safari") {
      setIsPromotionOpen(true)
    }
  }, [status])

  const closeInstall = useCallback(() => {
    if (!isPrompting) setIsOpen(false)
  }, [isPrompting])

  const dismissPromotion = useCallback(() => {
    snoozePromotion(7)
    setIsPromotionOpen(false)
  }, [])

  const continueFromPromotion = useCallback(() => {
    snoozePromotion(7)
    setIsPromotionOpen(false)
    setIsOpen(true)
  }, [])

  const install = useCallback(async () => {
    if (!installPrompt) return

    setIsPromotionOpen(false)
    setIsPrompting(true)
    try {
      await installPrompt.prompt()
      const { outcome } = await installPrompt.userChoice
      setInstallPrompt(null)
      window.__svcDeferredInstallPrompt = undefined
      if (outcome === "accepted") {
        setStatus("installed")
        setIsOpen(false)
      } else {
        setStatus(fallbackStatus())
      }
    } catch {
      setStatus(fallbackStatus())
    } finally {
      setIsPrompting(false)
    }
  }, [installPrompt])

  const value = useMemo(() => ({ status, openInstall, requestInstallPromotion }), [status, openInstall, requestInstallPromotion])

  return (
    <PwaInstallContext.Provider value={value}>
      {children}
      {isPromotionOpen && (status === "available" || status === "ios" || status === "macos-safari") && (
        <InstallPromotion
          status={status}
          onDismiss={dismissPromotion}
          onInstall={install}
          onContinue={continueFromPromotion}
        />
      )}
      {isOpen && status !== "installed" && (
        <InstallSheet
          status={status}
          isPrompting={isPrompting}
          onClose={closeInstall}
          onInstall={install}
        />
      )}
    </PwaInstallContext.Provider>
  )
}

export function PwaInstallAutoPrompt() {
  const { requestInstallPromotion, status } = usePwaInstall()

  useEffect(() => {
    const canInstallHere = status === "available" || status === "ios" || status === "macos-safari"
    if (!canInstallHere || isPromotionSnoozed()) return

    // Wait until the Stream has settled before asking. This keeps the prompt
    // intentional rather than competing with loading and sign-in states.
    const timer = window.setTimeout(requestInstallPromotion, 1800)
    return () => window.clearTimeout(timer)
  }, [requestInstallPromotion, status])

  return null
}

function InstallPromotion({
  status,
  onDismiss,
  onInstall,
  onContinue,
}: {
  status: Extract<PwaInstallStatus, "available" | "ios" | "macos-safari">
  onDismiss: () => void
  onInstall: () => void
  onContinue: () => void
}) {
  const nativeInstall = status === "available"
  const actionLabel = nativeInstall ? "Install" : status === "ios" ? "How to install" : "Add to Dock"
  useEscapeDismiss(onDismiss)

  return (
    <div className="fixed inset-0 z-[70] flex min-h-[100dvh] items-center justify-center px-4 py-6">
      <button
        type="button"
        aria-label="Dismiss install prompt"
        onClick={onDismiss}
        className="absolute inset-0 bg-[#070a10]/68 backdrop-blur-[3px] animate-in fade-in duration-200"
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="pwa-promotion-title"
        className="relative z-10 w-full max-w-[32rem] overflow-hidden rounded-[2rem] border border-white/12 bg-[#121923] shadow-[0_24px_90px_rgba(1,4,10,0.62),inset_0_1px_0_rgba(255,255,255,0.12)]"
      >
        <div className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-blue-200/45 to-transparent" />
        <div className="flex items-center gap-4 px-5 pb-4 pt-5 sm:px-6 sm:pt-6">
          <div className="flex h-15 w-15 shrink-0 items-center justify-center overflow-hidden rounded-[1.15rem] border border-white/10 bg-[#090e16] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
            <img src="/icon-192x192.png" alt="" className="h-full w-full object-cover" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-blue-200/65">SVC on your device</p>
            <h2 id="pwa-promotion-title" className="mt-1 text-[19px] font-bold tracking-tight text-white">Install SVC?</h2>
            <p className="mt-1 text-sm leading-snug text-muted-foreground/72">
              {nativeInstall ? "Open SVC faster from its own app window." : "Keep SVC one tap away from your device."}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-white/8 bg-white/[0.018] px-5 py-3.5 sm:px-6">
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-xl px-3.5 py-2 text-sm font-semibold text-muted-foreground/82 transition-colors duration-200 hover:bg-white/[0.06] hover:text-white active:scale-[0.98]"
          >
            Not now
          </button>
          <button
            type="button"
            onClick={nativeInstall ? onInstall : onContinue}
            className="rounded-xl border border-blue-200/20 bg-blue-400 px-4 py-2 text-sm font-bold text-[#07101d] shadow-[inset_0_1px_0_rgba(255,255,255,0.38)] transition-all duration-200 hover:bg-blue-300 active:scale-[0.98]"
          >
            {actionLabel}
          </button>
        </div>
      </section>
    </div>
  )
}

function InstallSheet({
  status,
  isPrompting,
  onClose,
  onInstall,
}: {
  status: PwaInstallStatus
  isPrompting: boolean
  onClose: () => void
  onInstall: () => void
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle")
  useEscapeDismiss(onClose)

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopyState("copied")
    } catch {
      setCopyState("error")
    }
  }

  const nativeInstall = status === "available"
  const ios = status === "ios"
  const macosSafari = status === "macos-safari"

  const title = nativeInstall
    ? "Install SVC"
    : ios
      ? "Add SVC to your Home Screen"
      : macosSafari
        ? "Add SVC to your Dock"
        : "Install SVC on this device"
  const description = nativeInstall
    ? "Keep SVC one tap away in its own focused app window."
    : ios
      ? "It will open like an app and can receive alerts once notifications are enabled."
      : macosSafari
        ? "Open SVC from your Dock in a dedicated app window."
        : "This browser cannot open the install dialog directly, but you can still add SVC from its menu."

  return (
    <div className="fixed inset-0 z-[70] flex min-h-[100dvh] items-center justify-center px-3 py-5 sm:px-6">
      <button
        type="button"
        aria-label="Close install guide"
        onClick={onClose}
        className="absolute inset-0 bg-[#05070c]/72 backdrop-blur-sm animate-in fade-in duration-200"
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="pwa-install-title"
        className="relative z-10 max-h-[calc(100dvh-2.5rem)] w-full max-w-md overflow-y-auto rounded-[1.75rem] border border-white/12 bg-[#111720] shadow-[0_24px_80px_rgba(1,4,10,0.6),inset_0_1px_0_rgba(255,255,255,0.1)]"
      >
        <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-blue-300/45 to-transparent" />
        <div className="px-5 pb-5 pt-5 sm:px-6 sm:pb-6 sm:pt-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3.5">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-blue-400/20 bg-blue-400/12 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]">
                {nativeInstall ? <Download className="h-5 w-5 text-blue-300" /> : <MonitorDown className="h-5 w-5 text-blue-300" />}
              </div>
              <div className="min-w-0">
                <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-blue-300/75">SVC on your device</p>
                <h2 id="pwa-install-title" className="mt-0.5 text-[17px] font-bold tracking-tight text-white">
                  {title}
                </h2>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={isPrompting}
              aria-label="Close install guide"
              className="-mr-1 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/8 bg-white/[0.045] text-muted-foreground/75 transition-all duration-200 hover:bg-white/[0.09] hover:text-white active:scale-95 disabled:opacity-40"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <p className="mt-4 max-w-sm text-sm leading-relaxed text-muted-foreground/75">{description}</p>

          {nativeInstall ? (
            <NativeInstallContent isPrompting={isPrompting} onInstall={onInstall} />
          ) : ios ? (
            <IOSInstallContent copyState={copyState} onCopyLink={copyLink} />
          ) : macosSafari ? (
            <MacInstallContent />
          ) : (
            <ManualInstallContent copyState={copyState} onCopyLink={copyLink} />
          )}
        </div>
      </section>
    </div>
  )
}

function NativeInstallContent({ isPrompting, onInstall }: { isPrompting: boolean; onInstall: () => void }) {
  return (
    <div className="mt-6">
      <div className="rounded-2xl border border-white/8 bg-white/[0.035] p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
        <div className="flex gap-3">
          <div className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-blue-300 shadow-[0_0_0_3px_rgba(147,197,253,0.08)]" />
          <p className="text-xs leading-relaxed text-muted-foreground/70">
            SVC will appear in your app launcher or Home Screen. You can remove it anytime from your device settings.
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={onInstall}
        disabled={isPrompting}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-blue-300/20 bg-blue-400 px-4 py-3 text-sm font-bold text-[#07101d] shadow-[inset_0_1px_0_rgba(255,255,255,0.38)] transition-all duration-200 hover:bg-blue-300 active:scale-[0.98] disabled:cursor-wait disabled:opacity-70"
      >
        <Download className="h-4 w-4" />
        {isPrompting ? "Opening install dialog…" : "Install app"}
      </button>
    </div>
  )
}

function IOSInstallContent({ copyState, onCopyLink }: { copyState: "idle" | "copied" | "error"; onCopyLink: () => void }) {
  return (
    <div className="mt-5">
      <div className="overflow-hidden rounded-2xl border border-white/8 bg-white/[0.035] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
        <InstallStep number={1} icon={<Share2 className="h-4 w-4" />} title="Open the Share menu" detail="Tap the square with an arrow in your browser toolbar." />
        <InstallStep number={2} icon={<Plus className="h-4 w-4" />} title="Choose “Add to Home Screen”" detail="If it is not available here, open this link in Safari and try again." />
        <InstallStep number={3} icon={<Check className="h-4 w-4" />} title="Tap “Add”" detail="Then open SVC from its new Home Screen icon." isLast />
      </div>
      <CopyLinkButton copyState={copyState} onCopyLink={onCopyLink} />
    </div>
  )
}

function MacInstallContent() {
  return (
    <div className="mt-5 overflow-hidden rounded-2xl border border-white/8 bg-white/[0.035] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
      <InstallStep number={1} icon={<Share2 className="h-4 w-4" />} title="Open Safari’s Share menu" detail="Use the Share button in the toolbar." />
      <InstallStep number={2} icon={<MonitorDown className="h-4 w-4" />} title="Choose “Add to Dock”" detail="SVC will appear in your Dock and Applications folder." isLast />
    </div>
  )
}

function ManualInstallContent({ copyState, onCopyLink }: { copyState: "idle" | "copied" | "error"; onCopyLink: () => void }) {
  return (
    <div className="mt-5">
      <div className="overflow-hidden rounded-2xl border border-white/8 bg-white/[0.035] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
        <InstallStep number={1} icon={<ExternalLink className="h-4 w-4" />} title="Open SVC in Chrome or Edge" detail="Use a full browser, not an in-app browser or a managed kiosk." />
        <InstallStep number={2} icon={<Download className="h-4 w-4" />} title="Use “Install app” or “Add to Home Screen”" detail="You will find it in the browser’s main menu." isLast />
      </div>
      <CopyLinkButton copyState={copyState} onCopyLink={onCopyLink} />
    </div>
  )
}

function InstallStep({
  number,
  icon,
  title,
  detail,
  isLast = false,
}: {
  number: number
  icon: React.ReactNode
  title: string
  detail: string
  isLast?: boolean
}) {
  return (
    <div className="flex gap-3 px-3.5 py-3.5 not-last:border-b not-last:border-white/8">
      <div className="flex w-7 shrink-0 flex-col items-center pt-0.5">
        <div className="flex h-7 w-7 items-center justify-center rounded-xl border border-blue-400/18 bg-blue-400/10 text-blue-300">
          {icon}
        </div>
        {!isLast && <div className="mt-1.5 h-3 w-px bg-white/10" />}
      </div>
      <div className="min-w-0 flex-1 pb-0.5">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] font-bold text-muted-foreground/45">0{number}</span>
          <span className="text-sm font-semibold text-white/90">{title}</span>
        </div>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground/62">{detail}</p>
      </div>
    </div>
  )
}

function CopyLinkButton({ copyState, onCopyLink }: { copyState: "idle" | "copied" | "error"; onCopyLink: () => void }) {
  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={onCopyLink}
        className="flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.045] px-4 py-3 text-sm font-semibold text-white/85 transition-all duration-200 hover:bg-white/[0.08] active:scale-[0.98]"
      >
        {copyState === "copied" ? <Check className="h-4 w-4 text-emerald-300" /> : <Copy className="h-4 w-4 text-muted-foreground" />}
        {copyState === "copied" ? "Link copied" : "Copy link"}
        {copyState === "idle" && <ChevronRight className="h-4 w-4 text-muted-foreground/45" />}
      </button>
      {copyState === "error" && (
        <p className="mt-2 px-1 text-center text-xs text-amber-300/80">Copying is blocked here. Copy the address from your browser instead.</p>
      )}
    </div>
  )
}
