"use client"

import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { BookUser, Check, ChevronDown, ClipboardCheck, Clock, FolderKanban, MessageCircle, X } from "lucide-react"
import { cn } from "@/lib/utils"

export type SvcModule = "communications" | "directory" | "applications" | "quest-coral" | "bye-bye-dpr"

interface ModuleSwitcherProps {
  activeModule: SvcModule
  onSelect: (module: SvcModule) => void
}

const MODULES: Array<{
  id: SvcModule
  title: string
  description: string
  productLabel: string
  icon: typeof MessageCircle
  accent: string
  surface: string
  border: string
  /** Accent for the header trigger. Defaults to `accent` — light modules
      override it so the label keeps its contrast on a white surface. */
  labelAccent?: string
}> = [
  {
    id: "communications",
    title: "Communications",
    description: "Team messages",
    productLabel: "Stream",
    icon: MessageCircle,
    accent: "#93C5FD",
    surface: "rgba(37,99,235,0.13)",
    border: "rgba(96,165,250,0.42)",
  },
  {
    id: "directory",
    title: "Directory",
    description: "People, companies & jobs",
    productLabel: "Directory",
    icon: BookUser,
    accent: "var(--directory-title)",
    surface: "var(--directory-title-soft)",
    border: "rgba(253,186,116,0.38)",
  },
  {
    id: "applications",
    title: "Applications",
    description: "Hiring & onboarding",
    productLabel: "Applications",
    icon: ClipboardCheck,
    accent: "#60A5FA",
    surface: "rgba(56,189,248,0.14)",
    border: "rgba(56,189,248,0.42)",
    labelAccent: "#2563EB",
  },
  {
    id: "quest-coral",
    title: "Quest Coral",
    description: "Projects & progress",
    productLabel: "Quest Coral",
    icon: FolderKanban,
    accent: "#FF7A59",
    surface: "rgba(255,122,89,0.14)",
    border: "rgba(255,122,89,0.42)",
    labelAccent: "#E8593A",
  },
  {
    // Reuses Directory's already-vetted violet (--directory-job) for the
    // dark popover instead of inventing a new one.
    id: "bye-bye-dpr",
    title: "ByeByeDPR",
    description: "Field clock-in & reports",
    productLabel: "ByeByeDPR",
    icon: Clock,
    accent: "#A78BFA",
    surface: "rgba(167,139,250,0.14)",
    border: "rgba(167,139,250,0.42)",
    labelAccent: "#5C4BB8",
  },
]

export function ModuleSwitcher({ activeModule, onSelect }: ModuleSwitcherProps) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [open])

  const active = MODULES.find((module) => module.id === activeModule) ?? MODULES[0]
  const selectModule = (module: SvcModule) => {
    setOpen(false)
    if (module === activeModule) return
    onSelect(module)
  }

  return (
    <div className="relative z-30">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="group flex items-center gap-2 rounded-lg py-1 pr-1.5 text-left transition-colors hover:bg-foreground/4 active:scale-[0.98]"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Current module: ${active.title}. Switch module`}
      >
        {/* Semantic tokens, not literal white: Applications re-themes them to
            navy on its light surface. */}
        <span className="text-lg font-bold tracking-tight text-foreground">
          SVC <span style={{ color: active.labelAccent ?? active.accent }}>{active.productLabel}</span>
        </span>
        <ChevronDown
          className={cn("h-4 w-4 text-muted-foreground transition-transform duration-200 group-hover:text-foreground/80", open && "rotate-180")}
          strokeWidth={1.8}
        />
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[100]" role="presentation">
          <button
            type="button"
            className="absolute inset-0 cursor-default bg-[#03070d]/20"
            onClick={() => setOpen(false)}
            aria-label="Close module switcher"
          />
          <section
            className="module-switcher-popover fixed w-[min(19rem,calc(var(--app-w,100vw)-2rem))] rounded-2xl border border-white/10 p-3 shadow-[0_16px_44px_rgba(0,0,0,0.42)]"
            style={{
              top: "calc(var(--app-y, 0px) + 3.65rem)",
              left: "calc(var(--app-x, 0px) + 1rem)",
            }}
            role="dialog"
            aria-label="Switch module"
          >
            <span className="absolute -top-1.5 left-8 h-3 w-3 rotate-45 border-l border-t border-white/10 bg-[#0d141e]" aria-hidden="true" />
            <header className="mb-2 flex items-center justify-between px-1">
              <p className="text-[11px] font-medium text-muted-foreground/75">Switch module</p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex h-6 w-6 items-center justify-center rounded-full text-white/40 transition-colors hover:bg-white/[0.04] hover:text-white/75 active:scale-[0.96]"
                aria-label="Close module switcher"
              >
                <X className="h-3.5 w-3.5" strokeWidth={1.8} />
              </button>
            </header>

            <div className="flex flex-col divide-y divide-white/[0.06]">
              {MODULES.map((module) => {
                const selected = module.id === activeModule
                const Icon = module.icon
                return (
                  <button
                    key={module.id}
                    type="button"
                    onClick={() => selectModule(module.id)}
                    className="group relative flex min-h-16 items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-[background-color,transform] duration-150 hover:bg-white/[0.035] active:scale-[0.99]"
                    style={{ background: selected ? module.surface : undefined }}
                    aria-pressed={selected}
                  >
                    <span
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border"
                      style={{ color: module.accent, background: module.surface, borderColor: selected ? module.border : "rgba(255,255,255,0.08)" }}
                    >
                      <Icon className="h-4.5 w-4.5" strokeWidth={1.8} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-foreground/90">{module.title}</span>
                      <span className="mt-0.5 block truncate text-[11px] text-muted-foreground/55">{module.description}</span>
                    </span>
                    {selected && (
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-white" style={{ background: module.accent }}>
                        <Check className="h-3 w-3" strokeWidth={2.2} />
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </section>
        </div>,
        document.body,
      )}
    </div>
  )
}
