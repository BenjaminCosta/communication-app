"use client"

/**
 * Header with the real, shared module switcher (components/module-switcher.tsx)
 * — it used to be a decorative lookalike ("SVC ByeByeDPR" + chevron with no
 * onClick) that visually matched the switcher but did nothing when tapped.
 * ByeByeDPR is a standalone route, not one of app/page.tsx's internal
 * screens, so picking any of the other 4 modules here does a real page nav
 * back to `/` rather than an in-app screen swap — there's no deep-link
 * support today to land directly on a specific module from outside the
 * shell. The info button mirrors Quest Coral's "About" entry point exactly
 * (bordered circle, same Info icon) — this module's own tutorial screen
 * instead of a notifications feed, which doesn't exist here.
 */

import { useRouter } from "next/navigation"
import { Info } from "lucide-react"
import { ModuleSwitcher } from "@/components/module-switcher"

interface ByeByeDprHeaderProps {
  onOpenAbout: () => void
}

export function ByeByeDprHeader({ onOpenAbout }: ByeByeDprHeaderProps) {
  const router = useRouter()

  return (
    <header className="byebye-dpr-topbar app-topbar flex shrink-0 items-center justify-between border-b px-4">
      <ModuleSwitcher activeModule="bye-bye-dpr" onSelect={() => router.push("/")} />
      <button
        type="button"
        onClick={onOpenAbout}
        className="byebye-dpr-tap flex h-9 w-9 items-center justify-center rounded-full border border-[var(--bd-border)] bg-[var(--bd-surface)] text-[var(--bd-text)]"
        aria-label="About ByeByeDPR"
      >
        <Info className="h-4 w-4" strokeWidth={2} />
      </button>
    </header>
  )
}
