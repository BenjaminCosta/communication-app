"use client"

import { Activity, Folder, Hexagon, ListTodo } from "lucide-react"
import { cn } from "@/lib/utils"

const CATEGORY_ICON_SIZE = "h-4 w-4"
const CATEGORY_ICON_STROKE = 2

type CategoryVisual = {
  Icon: typeof Activity
  container: string
  icon: string
}

function getCategoryVisual(categoryId: string): CategoryVisual {
  if (categoryId === "status" || categoryId === "systemType") {
    return {
      Icon: Activity,
      container: "border-emerald-400/18 bg-emerald-400/[0.08] shadow-[inset_0_1px_0_rgba(255,255,255,0.10),0_10px_26px_-18px_rgba(52,211,153,0.60)]",
      icon: "text-emerald-400",
    }
  }

  if (categoryId === "task") {
    return {
      Icon: ListTodo,
      container: "border-sky-400/18 bg-sky-400/[0.08] shadow-[inset_0_1px_0_rgba(255,255,255,0.10),0_10px_26px_-18px_rgba(56,189,248,0.60)]",
      icon: "text-sky-400",
    }
  }

  if (categoryId === "custom" || !categoryId) {
    return {
      Icon: Hexagon,
      container: "border-violet-400/18 bg-violet-400/[0.08] shadow-[inset_0_1px_0_rgba(255,255,255,0.10),0_10px_26px_-18px_rgba(167,139,250,0.58)]",
      icon: "text-violet-400",
    }
  }

  return {
    Icon: Folder,
    container: "border-blue-700/35 bg-blue-950/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.10),0_10px_26px_-18px_rgba(29,78,216,0.62)]",
    icon: "text-blue-500",
  }
}

export function getCategoryDotClass(categoryId: string): string {
  if (categoryId === "status" || categoryId === "systemType") return "bg-progress"
  if (categoryId === "task") return "bg-sky-400"
  if (categoryId === "custom" || !categoryId) return "bg-violet-500"
  return "bg-blue-600"
}

export function getCategoryDotShellClass(categoryId: string): string {
  if (categoryId === "status" || categoryId === "systemType") return "border-emerald-400/16 bg-emerald-400/[0.08]"
  if (categoryId === "task") return "border-sky-400/16 bg-sky-400/[0.08]"
  if (categoryId === "custom" || !categoryId) return "border-violet-400/16 bg-violet-400/[0.08]"
  return "border-blue-700/30 bg-blue-950/30"
}

export function CategoryDot({
  categoryId,
  dotClassName,
  shellClassName,
  className,
}: {
  categoryId: string
  dotClassName?: string
  shellClassName?: string
  className?: string
}) {
  return (
    <span
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border backdrop-blur-md shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]",
        shellClassName ?? getCategoryDotShellClass(categoryId),
        className
      )}
    >
      <span className={cn("h-3 w-3 rounded-full", dotClassName ?? getCategoryDotClass(categoryId))} />
    </span>
  )
}

export function CategoryIcon({
  categoryId,
  className,
}: {
  categoryId: string
  className?: string
}) {
  const visual = getCategoryVisual(categoryId)
  const Icon = visual.Icon

  return (
    <span
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border backdrop-blur-md",
        visual.container,
        className
      )}
    >
      <Icon className={cn(CATEGORY_ICON_SIZE, visual.icon)} strokeWidth={CATEGORY_ICON_STROKE} />
    </span>
  )
}
