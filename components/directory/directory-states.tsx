import { AlertCircle, SearchX, Star, TimerReset } from "lucide-react"
import { cn } from "@/lib/utils"

export function DirectoryRowsSkeleton({ count = 5, ai = false }: { count?: number; ai?: boolean }) {
  return (
    <div aria-label={ai ? "Generating" : "Loading results"}>
      {Array.from({ length: count }, (_, index) => {
        const delay = ai ? { animationDelay: `${index * 0.15}s` } : undefined
        return (
          <div key={index} className="flex items-center gap-3 px-2 py-2.5">
            <div className={cn("h-8 w-8 shrink-0 rounded-full", ai ? "directory-ai-shimmer" : "animate-pulse bg-white/[0.07]")} style={delay} />
            <div className="flex-1 space-y-2">
              <div className={cn("h-3.5 w-[42%] rounded", ai ? "directory-ai-shimmer" : "animate-pulse bg-white/[0.08]")} style={delay} />
              <div className={cn("h-3 w-[64%] rounded", ai ? "directory-ai-shimmer" : "animate-pulse bg-white/[0.05]")} style={delay} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function DirectoryEmptyState({ kind }: { kind: "results" | "recent" | "favorites" }) {
  const content = {
    results: { icon: SearchX, title: "No matches found", body: "Try another name, company, role or location." },
    recent: { icon: TimerReset, title: "No recent items", body: "Entities you open will appear here." },
    favorites: { icon: Star, title: "No favorites yet", body: "Open an entity and use the star to save it." },
  }[kind]
  const Icon = content.icon
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.035]">
        <Icon className="h-5 w-5 text-[var(--directory-title)]/70" strokeWidth={1.7} />
      </div>
      <p className="text-sm font-medium text-foreground/80">{content.title}</p>
      <p className="mt-1 max-w-64 text-xs leading-5 text-muted-foreground/60">{content.body}</p>
    </div>
  )
}

export function DirectoryErrorState({ onRetry, compact = false }: { onRetry: () => void; compact?: boolean }) {
  return (
    <div className={`flex items-center gap-3 rounded-2xl border border-orange-400/20 bg-orange-400/[0.055] ${compact ? "px-4 py-3" : "px-4 py-4"}`} role="alert">
      <AlertCircle className="h-4 w-4 shrink-0 text-[var(--directory-focus)]" strokeWidth={1.8} />
      <p className="min-w-0 flex-1 text-xs leading-5 text-muted-foreground">Directory could not be loaded.</p>
      <button type="button" onClick={onRetry} className="text-xs font-semibold text-[var(--directory-title)] hover:text-white active:scale-[0.97]">
        Retry
      </button>
    </div>
  )
}
