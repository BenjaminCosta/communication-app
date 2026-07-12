import { BriefcaseBusiness, Building2 } from "lucide-react"
import { DIRECTORY_ENTITY_META, type DirectoryListItem } from "@/lib/directory-config"

interface DirectoryEntityIconProps {
  item: Pick<DirectoryListItem, "type" | "name">
  size?: "xs" | "sm" | "lg"
}

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "?"
}

export function DirectoryEntityIcon({ item, size = "sm" }: DirectoryEntityIconProps) {
  const meta = DIRECTORY_ENTITY_META[item.type]
  const isPerson = item.type === "person"
  const dimensions = size === "lg" ? "h-16 w-16" : size === "xs" ? "h-7 w-7" : "h-8 w-8"
  const roundedClass = isPerson ? "rounded-full" : size === "lg" ? "rounded-2xl" : "rounded-lg"
  const iconSize = size === "lg" ? "h-7 w-7" : size === "xs" ? "h-3 w-3" : "h-3.5 w-3.5"
  const initialsClass = size === "lg" ? "text-lg" : size === "xs" ? "text-[9px]" : "text-[10px]"
  const shadowClass = size === "lg" ? "shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]" : ""
  return (
    <div
      className={`${dimensions} ${roundedClass} ${shadowClass} shrink-0 border flex items-center justify-center`}
      style={{ color: meta.color, background: meta.softBackground, borderColor: meta.border }}
      aria-hidden="true"
    >
      {isPerson ? (
        <span className={`${initialsClass} font-semibold tracking-tight`}>
          {initials(item.name)}
        </span>
      ) : item.type === "company" ? (
        <Building2 className={iconSize} strokeWidth={1.8} />
      ) : (
        <BriefcaseBusiness className={iconSize} strokeWidth={1.8} />
      )}
    </div>
  )
}
