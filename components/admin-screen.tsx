"use client"

import { useMemo } from "react"
import { ArrowLeft, Activity, Clock, Wifi, WifiOff } from "lucide-react"
import { cn } from "@/lib/utils"
import { type Contact } from "@/lib/store"

interface AdminScreenProps {
  currentUser: Contact
  allUsers: Contact[]
  onBack: () => void
  className?: string
}

function timeAgo(date: Date | null | undefined): string {
  if (!date) return "Never"
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (seconds < 60) return "Just now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return "Yesterday"
  if (days < 7) return `${days} days ago`
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

function getStatus(lastSeen: Date | null | undefined): "online" | "recent" | "away" | "offline" {
  if (!lastSeen) return "offline"
  const minutes = (Date.now() - lastSeen.getTime()) / 60000
  if (minutes < 2) return "online"
  if (minutes < 10) return "recent"
  if (minutes < 60) return "away"
  return "offline"
}

const STATUS_CONFIG = {
  online:  { dot: "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)]", label: "Online",  labelClass: "text-emerald-400" },
  recent:  { dot: "bg-amber-400",   label: "Active",  labelClass: "text-amber-400" },
  away:    { dot: "bg-orange-400",  label: "Away",    labelClass: "text-orange-400" },
  offline: { dot: "bg-white/20",    label: "Offline", labelClass: "text-muted-foreground/50" },
}

export function AdminScreen({ currentUser, allUsers, onBack, className }: AdminScreenProps) {
  const sorted = useMemo(() => {
    return [...allUsers].sort((a, b) => {
      const ta = a.lastSeen?.getTime() ?? 0
      const tb = b.lastSeen?.getTime() ?? 0
      return tb - ta
    })
  }, [allUsers])

  const onlineCount = sorted.filter((u) => getStatus(u.lastSeen) === "online").length

  return (
    <div className={cn("flex-1 flex flex-col bg-background overflow-hidden", className)}>
      {/* Header */}
      <div className="shrink-0 border-b border-white/10">
        <div className="max-w-2xl mx-auto px-4 md:px-6 app-topbar flex items-center gap-3">
          <button
            onClick={onBack}
            className="w-9 h-9 rounded-full bg-white/5 border border-white/10 flex items-center justify-center active:scale-95 hover:bg-white/8 transition-all duration-150"
          >
            <ArrowLeft className="w-4 h-4 text-muted-foreground" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-bold tracking-tight">Activity Monitor</h1>
            <p className="text-xs text-muted-foreground/60 -mt-0.5">Admin only</p>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-medium">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            {onlineCount} online
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto scrollbar-hide">
        <div className="max-w-2xl mx-auto px-4 md:px-6 py-5 flex flex-col gap-3">

          {/* Summary row */}
          <div className="grid grid-cols-3 gap-2">
            <StatCard
              label="Total users"
              value={String(sorted.length)}
              icon={<Activity className="w-3.5 h-3.5" />}
            />
            <StatCard
              label="Online now"
              value={String(onlineCount)}
              icon={<Wifi className="w-3.5 h-3.5 text-emerald-400" />}
              highlight
            />
            <StatCard
              label="Offline"
              value={String(sorted.filter((u) => getStatus(u.lastSeen) === "offline").length)}
              icon={<WifiOff className="w-3.5 h-3.5" />}
            />
          </div>

          {/* User list */}
          <div className="rounded-2xl bg-card border border-white/10 overflow-hidden divide-y divide-white/8">
            {sorted.map((user) => {
              const status = getStatus(user.lastSeen)
              const cfg = STATUS_CONFIG[status]
              const isMe = user.id === currentUser.id
              return (
                <div key={user.id} className="flex items-center gap-3 px-4 py-3">
                  {/* Avatar */}
                  <div className="relative shrink-0">
                    <div className={cn("w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white", user.color)}>
                      {user.initials}
                    </div>
                    <div className={cn("absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-background", cfg.dot)} />
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-semibold truncate">{user.name}</span>
                      {isMe && <span className="text-[10px] text-muted-foreground/40">(you)</span>}
                      {user.isAdmin && (
                        <span className="text-[10px] bg-primary/15 text-primary border border-primary/25 rounded-full px-1.5 py-0.5 font-medium shrink-0">
                          admin
                        </span>
                      )}
                    </div>
                    {user.email && (
                      <span className="text-xs text-muted-foreground/50 truncate block">{user.email}</span>
                    )}
                  </div>

                  {/* Last seen */}
                  <div className="flex flex-col items-end gap-0.5 shrink-0">
                    <span className={cn("text-xs font-medium", cfg.labelClass)}>{cfg.label}</span>
                    <div className="flex items-center gap-1 text-muted-foreground/40">
                      <Clock className="w-2.5 h-2.5" />
                      <span className="text-[11px]">{timeAgo(user.lastSeen)}</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          <p className="text-center text-[11px] text-muted-foreground/30 pb-2">
            Updates in real time · heartbeat every 30s
          </p>
        </div>
      </div>
    </div>
  )
}

function StatCard({ label, value, icon, highlight }: { label: string; value: string; icon: React.ReactNode; highlight?: boolean }) {
  return (
    <div className={cn(
      "rounded-xl border px-3 py-2.5 flex flex-col gap-1",
      highlight ? "bg-emerald-500/8 border-emerald-500/20" : "bg-card border-white/10"
    )}>
      <div className={cn("flex items-center gap-1.5", highlight ? "text-emerald-400" : "text-muted-foreground/60")}>
        {icon}
        <span className="text-[11px] font-medium uppercase tracking-wide">{label}</span>
      </div>
      <span className={cn("text-2xl font-bold tabular-nums", highlight ? "text-emerald-400" : "text-foreground")}>
        {value}
      </span>
    </div>
  )
}
