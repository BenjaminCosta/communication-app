"use client"

import { createContext, useContext } from "react"

export type PwaInstallStatus = "checking" | "available" | "ios" | "macos-safari" | "manual" | "installed"

export interface PwaInstallContextValue {
  status: PwaInstallStatus
  openInstall: () => void
  requestInstallPromotion: () => void
}

export const PwaInstallContext = createContext<PwaInstallContextValue | null>(null)

/**
 * Isolated from the install UI module so Fast Refresh can preserve the active
 * app screen while the install UI is edited during development.
 */
export function usePwaInstall(): PwaInstallContextValue {
  const context = useContext(PwaInstallContext)
  if (!context) {
    throw new Error("usePwaInstall must be used inside PwaInstallProvider")
  }
  return context
}
