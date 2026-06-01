"use client"

import { CalendarDays, LayoutGrid, MessageSquare, Tag, Users, X } from "lucide-react"
import { cn } from "@/lib/utils"

type NavTarget = "stream" | "people" | "projects" | "calendar"

interface NavigationMenuModalProps {
  onClose: () => void
  onNavigate: (target: NavTarget) => void
  activeScreen?: NavTarget
}

// Color tokens consistent with the rest of the app:
// Stream  → primary blue  (#2563EB)
// People  → amber/yellow  (#F59E0B = feedback)
// Tags    → decision blue (#3B82F6)
// Calendar→ cyan          (#06B6D4)
const NAV_ITEMS: {
  id: NavTarget
  icon: React.ReactNode
  title: string
  description: string
  iconClass: string
  glowClass: string
  activeClass: string    // card bg+border+shadow when selected
  dotClass: string       // active indicator dot color
}[] = [
  {
    id: "stream",
    icon: <MessageSquare className="w-4.5 h-4.5" />,
    title: "Stream",
    description: "Your message feed",
    iconClass: "text-blue-400 bg-blue-400/12 border-blue-400/20",
    glowClass: "hover:border-blue-400/30 hover:bg-blue-400/7",
    activeClass: "border-blue-400/35 bg-blue-400/10 shadow-[0_0_24px_rgba(96,165,250,0.14)]",
    dotClass: "bg-blue-400",
  },
  {
    id: "people",
    icon: <Users className="w-4.5 h-4.5" />,
    title: "People",
    description: "Contacts & members",
    iconClass: "text-amber-400 bg-amber-400/12 border-amber-400/20",
    glowClass: "hover:border-amber-400/30 hover:bg-amber-400/7",
    activeClass: "border-amber-400/35 bg-amber-400/10 shadow-[0_0_24px_rgba(251,191,36,0.14)]",
    dotClass: "bg-amber-400",
  },
  {
    id: "projects",
    icon: <Tag className="w-4.5 h-4.5" />,
    title: "Tags",
    description: "Browse your tags",
    iconClass: "text-decision bg-decision/10 border-decision/20",
    glowClass: "hover:border-decision/30 hover:bg-decision/7",
    activeClass: "border-decision/40 bg-decision/10 shadow-[0_0_24px_rgba(59,130,246,0.14)]",
    dotClass: "bg-decision",
  },
  {
    id: "calendar",
    icon: <CalendarDays className="w-4.5 h-4.5" />,
    title: "Calendar",
    description: "Scheduled messages",
    iconClass: "text-cyan-400 bg-cyan-400/12 border-cyan-400/20",
    glowClass: "hover:border-cyan-400/30 hover:bg-cyan-400/7",
    activeClass: "border-cyan-400/35 bg-cyan-400/10 shadow-[0_0_24px_rgba(34,211,238,0.14)]",
    dotClass: "bg-cyan-400",
  },
]

export function NavigationMenuModal({ onClose, onNavigate, activeScreen }: NavigationMenuModalProps) {
  const handleNavigate = (target: NavTarget) => {
    onNavigate(target)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-5">
      {/* Backdrop — stronger blur for glassmorphism depth */}
      <button
        onClick={onClose}
        className="absolute inset-0 bg-black/55 backdrop-blur-lg animate-fade-in"
        aria-label="Close navigation menu"
      />

      {/* Modal card — glass effect */}
      <div
        className={cn(
          "relative z-10 w-full max-w-95",
          "bg-white/6 backdrop-blur-2xl",
          "rounded-3xl border border-white/12",
          "shadow-[0_32px_80px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(255,255,255,0.08)]",
          "animate-spring-pop -translate-y-[6%]",
        )}
      >
        {/* Subtle top sheen */}
        <div className="absolute inset-x-0 top-0 h-px rounded-t-3xl bg-linear-to-r from-transparent via-white/20 to-transparent" />

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-5">
          <div>
            <p className="text-[10px] font-bold tracking-[2.5px] uppercase text-white/35 font-mono mb-0.5">
              SVC
            </p>
            <h2 className="text-xl font-bold tracking-tight text-white">Navigate</h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/8 border border-white/10 flex items-center justify-center active:scale-90 transition-all duration-150 hover:bg-white/12"
          >
            <X className="w-3.5 h-3.5 text-white/60" />
          </button>
        </div>

        {/* Divider */}
        <div className="h-px bg-white/8 mx-6" />

        {/* 2×2 grid */}
        <div className="grid grid-cols-2 gap-3 p-6 pt-5">
          {NAV_ITEMS.map((item, i) => {
            const isActive = activeScreen === item.id
            return (
              <button
                key={item.id}
                onClick={() => handleNavigate(item.id)}
                className={cn(
                  "relative group flex flex-col items-start gap-4 rounded-2xl border p-4",
                  "active:scale-[0.96] transition-all duration-200",
                  isActive
                    ? item.activeClass
                    : ["bg-white/4 border-white/9", item.glowClass],
                  "animate-fade-up",
                )}
                style={{ animationDelay: `${i * 60}ms` }}
              >
                {/* Icon badge */}
                <div
                  className={cn(
                    "w-10 h-10 rounded-xl border flex items-center justify-center",
                    "transition-transform duration-200",
                    item.iconClass,
                    isActive
                      ? "scale-110 shadow-[0_4px_16px_rgba(0,0,0,0.4)]"
                      : "shadow-[0_2px_8px_rgba(0,0,0,0.3)]",
                  )}
                >
                  {item.icon}
                </div>

                {/* Text */}
                <div className="flex flex-col items-start gap-0.5">
                  <span className={cn(
                    "text-sm font-semibold leading-tight transition-colors duration-200",
                    isActive ? "text-white" : "text-white/90",
                  )}>
                    {item.title}
                  </span>
                  <span className="text-[11px] text-white/40 leading-snug">{item.description}</span>
                </div>
              </button>
            )
          })}
        </div>

        {/* Bottom padding for safe area feel */}
        <div className="h-1" />
      </div>
    </div>
  )
}
