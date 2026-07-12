"use client"

import { BriefcaseBusiness, Building2, UserRound } from "lucide-react"
import { cn } from "@/lib/utils"
import { DIRECTORY_ENTITY_META, DIRECTORY_SCOPES, type DirectoryScope } from "@/lib/directory-config"

interface DirectoryScopeTabsProps {
  value: DirectoryScope
  onChange: (scope: DirectoryScope) => void
  includeAll?: boolean
  variant?: "home" | "results"
}

function ScopeIcon({ scope, className }: { scope: Exclude<DirectoryScope, "all">; className?: string }) {
  const props = { className: cn("h-4 w-4", className), strokeWidth: 1.8 }
  if (scope === "person") return <UserRound {...props} />
  if (scope === "company") return <Building2 {...props} />
  return <BriefcaseBusiness {...props} />
}

export function DirectoryScopeTabs({ value, onChange, includeAll = true, variant = "results" }: DirectoryScopeTabsProps) {
  const scopes = includeAll ? DIRECTORY_SCOPES : DIRECTORY_SCOPES.filter((scope) => scope.id !== "all")
  return (
    <div
      className={cn(
        "flex items-center overflow-x-auto scrollbar-hide",
        variant === "home" ? "gap-2 md:gap-3" : "gap-2",
      )}
      role="tablist"
      aria-label="Directory scope"
    >
      {scopes.map((scope) => {
        const active = value === scope.id
        const entityMeta = scope.id === "all" ? null : DIRECTORY_ENTITY_META[scope.id]
        return (
          <button
            key={scope.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(scope.id)}
            className={cn(
              "flex shrink-0 items-center justify-center gap-2 border font-medium transition-[background-color,border-color,color,transform] duration-200 active:scale-[0.97]",
              variant === "home"
                ? "h-11 flex-1 rounded-2xl px-4 text-sm md:h-12 md:min-w-36"
                : "h-9 rounded-full px-4 text-xs",
              active ? "text-white" : "border-white/10 bg-white/[0.035] text-muted-foreground hover:bg-white/[0.06] hover:text-foreground/85",
            )}
            style={active ? {
              borderColor: entityMeta?.border ?? "rgba(253,186,116,0.65)",
              background: entityMeta?.softBackground ?? "var(--directory-title-soft)",
              color: entityMeta?.color ?? "var(--directory-title)",
            } : undefined}
          >
            {scope.id !== "all" && <ScopeIcon scope={scope.id} />}
            {scope.label}
          </button>
        )
      })}
    </div>
  )
}
