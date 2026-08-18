"use client"

/**
 * Header with the real, shared module switcher (components/module-switcher.tsx).
 * ByeByeDPR is now a real in-app screen of app/page.tsx like the other four
 * modules, so picking one here is a plain in-app screen swap — same
 * `onSelect` branching pattern as stream-screen.tsx/directory-screen.tsx/
 * applications-list-screen.tsx/quest-coral-screen.tsx, no navigation. The
 * info button mirrors Quest Coral's "About" entry point exactly (bordered
 * circle, same Info icon) — this module's own tutorial screen instead of a
 * notifications feed, which doesn't exist here.
 */

import { Info } from "lucide-react"
import { ModuleSwitcher } from "@/components/module-switcher"

interface ByeByeDprHeaderProps {
  onOpenAbout: () => void
  onSwitchToStream: () => void
  onSwitchToDirectory: () => void
  onSwitchToApplications: () => void
  onSwitchToQuestCoral: () => void
  onCourtneyRobertsCenter?: () => void
}

export function ByeByeDprHeader({
  onOpenAbout,
  onSwitchToStream,
  onSwitchToDirectory,
  onSwitchToApplications,
  onSwitchToQuestCoral,
  onCourtneyRobertsCenter,
}: ByeByeDprHeaderProps) {
  return (
    <header className="byebye-dpr-topbar app-topbar flex shrink-0 items-center justify-between border-b px-4">
      <ModuleSwitcher
        activeModule="bye-bye-dpr"
        showCourtneyRobertsCenter={Boolean(onCourtneyRobertsCenter)}
        onSelect={(module) => {
          if (module === "communications") onSwitchToStream()
          if (module === "directory") onSwitchToDirectory()
          if (module === "applications") onSwitchToApplications()
          if (module === "quest-coral") onSwitchToQuestCoral()
          if (module === "courtney-roberts-center") onCourtneyRobertsCenter?.()
        }}
      />
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
