"use client"

import { ClipboardList, Construction, Hammer, Layers, PaintRoller, Wind, Wrench, Zap, type LucideIcon } from "lucide-react"
import { tradeIconKey, type OutlookFormTradeIconKey } from "@/lib/outlook-form-submissions/wizard-core"

const TRADE_ICON: Record<OutlookFormTradeIconKey, LucideIcon> = {
  framing: Hammer,
  electrical: Zap,
  drywall: Layers,
  painting: PaintRoller,
  plumbing: Wrench,
  concrete: Construction,
  hvac: Wind,
  roofing: Hammer,
  general: ClipboardList,
}

export function TradeIcon({ trade, className }: { trade: string; className?: string }) {
  const Icon = TRADE_ICON[tradeIconKey(trade)]
  return <Icon className={className} strokeWidth={2} />
}
