import { ChevronRight, MapPin } from "lucide-react"
import { DirectoryEntityIcon } from "@/components/directory/directory-entity-icon"
import type { DirectoryListItem } from "@/lib/directory-config"
import { prefetchDirectoryProfile } from "@/lib/directory-profile-loader"
import { cn } from "@/lib/utils"

interface DirectoryResultRowProps {
  item: DirectoryListItem
  onSelect: (item: DirectoryListItem) => void
  compact?: boolean
  className?: string
  showChevron?: boolean
}

const RESULT_ROW_STYLE = { contentVisibility: "auto", containIntrinsicSize: "68px" } as const
const COMPACT_RESULT_ROW_STYLE = { contentVisibility: "auto", containIntrinsicSize: "52px" } as const

/** Small context breadcrumb above the name (Google's "site/URL" line). */
function kicker(item: DirectoryListItem): string {
  if (item.type === "person") return item.companyName || ""
  if (item.type === "company") return "Company"
  return item.companyName || "Job"
}

/** The description snippet under the name (Google's result description). */
function snippet(item: DirectoryListItem): string {
  if (item.type === "person") return item.description || item.role || item.subtitle || ""
  return item.description || item.subtitle || ""
}

export function DirectoryResultRow({ item, onSelect, compact = false, className, showChevron = false }: DirectoryResultRowProps) {
  const topLine = kicker(item)
  const description = snippet(item)
  const showDescription = description && description !== topLine
  const showLocation = item.location && !description.toLocaleLowerCase().includes(item.location.toLocaleLowerCase())
  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      onPointerDown={() => prefetchDirectoryProfile(item.id)}
      className={cn("flex w-full items-start gap-3 rounded-lg text-left transition-colors duration-150 hover:bg-white/3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--directory-ai)]/70", compact ? "px-2 py-2" : "px-2 py-2.5", className)}
      style={compact ? COMPACT_RESULT_ROW_STYLE : RESULT_ROW_STYLE}
      aria-label={`Open ${item.name}`}
    >
      <DirectoryEntityIcon item={item} size="xs" />
      <span className="min-w-0 flex-1">
        {topLine && (
          <span className="block truncate text-[11px] leading-4 text-muted-foreground/55">{topLine}</span>
        )}
        <span className="block truncate text-[15px] font-medium leading-5 tracking-[-0.01em] text-foreground/95">
          {item.name}
        </span>
        {showDescription && (
          <span className="mt-0.5 block text-[13px] leading-[1.35rem] text-muted-foreground/75 line-clamp-2">
            {description}
          </span>
        )}
        {showLocation && (
          <span className="mt-1 flex items-center gap-1 truncate text-[11px] leading-4 text-muted-foreground/55">
            <MapPin className="h-3 w-3 shrink-0" strokeWidth={1.8} />
            {item.location}
          </span>
        )}
      </span>
      {showChevron && <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground/45" strokeWidth={1.8} />}
    </button>
  )
}
