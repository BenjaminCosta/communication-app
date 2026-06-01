"use client"

import { CalendarDays, LayoutGrid, MessageSquare, Tag, Users, X } from "lucide-react"
import { cn } from "@/lib/utils"

type NavTarget = "stream" | "people" | "projects" | "calendar"

interface NavigationMenuModalProps {
  onClose: () => void
  onNavigate: (target: NavTarget) => void
  activeScreen?: NavTarget
}

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
    iconClass: "text-blue-200 bg-blue-400/18 border-blue-200/35",
    glowClass: "hover:border-blue-200/35 hover:bg-blue-400/12",
    activeClass: "border-blue-200/50 bg-blue-400/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_16px_38px_rgba(37,99,235,0.22)]",
    dotClass: "bg-blue-300",
  },
  {
    id: "people",
    icon: <Users className="w-4.5 h-4.5" />,
    title: "People",
    description: "Contacts & members",
    iconClass: "text-amber-100 bg-amber-400/18 border-amber-200/35",
    glowClass: "hover:border-amber-200/35 hover:bg-amber-400/12",
    activeClass: "border-amber-200/50 bg-amber-400/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_16px_38px_rgba(245,158,11,0.20)]",
    dotClass: "bg-amber-400",
  },
  {
    id: "projects",
    icon: <Tag className="w-4.5 h-4.5" />,
    title: "Tags",
    description: "Browse your tags",
    iconClass: "text-indigo-100 bg-decision/18 border-blue-200/35",
    glowClass: "hover:border-blue-200/35 hover:bg-decision/12",
    activeClass: "border-blue-200/50 bg-decision/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_16px_38px_rgba(59,130,246,0.20)]",
    dotClass: "bg-blue-300",
  },
  {
    id: "calendar",
    icon: <CalendarDays className="w-4.5 h-4.5" />,
    title: "Calendar",
    description: "Scheduled messages",
    iconClass: "text-cyan-100 bg-cyan-400/18 border-cyan-200/35",
    glowClass: "hover:border-cyan-200/35 hover:bg-cyan-400/12",
    activeClass: "border-cyan-200/50 bg-cyan-400/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_16px_38px_rgba(34,211,238,0.18)]",
    dotClass: "bg-cyan-300",
  },
]

export function NavigationMenuModal({ onClose, onNavigate, activeScreen }: NavigationMenuModalProps) {
  const handleNavigate = (target: NavTarget) => {
    onNavigate(target)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-5">
      <button
        onClick={onClose}
        className="absolute inset-0 bg-[#020817]/62 backdrop-blur-xl animate-fade-in"
        aria-label="Close navigation menu"
      />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(37,99,235,0.20),transparent_34%),radial-gradient(circle_at_90%_80%,rgba(14,165,233,0.14),transparent_32%)]" />

      <div
        className={cn(
          "glass-menu-panel relative z-10 w-full max-w-[23.75rem]",
          "rounded-3xl border overflow-hidden",
          "animate-spring-pop -translate-y-[6%]",
        )}
      >
        <div className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-white/30 to-transparent" />

        <div className="flex items-center justify-between px-6 pt-5 pb-4">
          <div>
            <p className="text-[10px] font-bold tracking-[2.5px] uppercase text-white/45 font-mono mb-0.5">
              SVC
            </p>
            <h2 className="text-xl font-bold tracking-tight text-white">Navigate</h2>
          </div>
          <button
            onClick={onClose}
            className="glass-button w-8 h-8 rounded-full border flex items-center justify-center active:scale-[0.98] transition-all duration-150"
            aria-label="Close"
          >
            <X className="w-3.5 h-3.5 text-white/75" />
          </button>
        </div>

        <div className="h-px bg-white/10 mx-6" />

        <div className="grid grid-cols-2 gap-3 p-5 pt-4">
          {NAV_ITEMS.map((item, i) => {
            const isActive = activeScreen === item.id
            return (
              <button
                key={item.id}
                onClick={() => handleNavigate(item.id)}
                className={cn(
                  "glass-menu-item relative group flex min-h-[132px] flex-col items-start gap-4 rounded-2xl border p-4",
                  "active:scale-[0.96] transition-all duration-200",
                  isActive
                    ? item.activeClass
                    : item.glowClass,
                  "animate-fade-up",
                )}
                style={{ animationDelay: `${i * 60}ms` }}
              >
                {isActive && (
                  <span className={cn("absolute right-3 top-3 h-2 w-2 rounded-full shadow-[0_0_12px_currentColor]", item.dotClass)} />
                )}
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

        <div className="h-1" />
      </div>
    </div>
  )
}
