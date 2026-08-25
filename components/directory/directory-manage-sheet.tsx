"use client"

import { ChevronRight, Flag, GitMerge, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer"
import { TYPE_LABEL } from "@/components/directory/directory-delete-confirm-sheet"
import { type DirectoryProfileViewModel, type ProfileAction } from "@/lib/directory-view-models"

interface DirectoryManageSheetProps {
  vm: DirectoryProfileViewModel
  actions: ProfileAction[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onAction: (action: ProfileAction) => void
}

const ROW_ICON: Partial<Record<ProfileAction["kind"], typeof Flag>> = {
  flag: Flag,
  merge: GitMerge,
  delete: Trash2,
}

const ROW_SUBTITLE: Partial<Record<ProfileAction["kind"], string>> = {
  flag: "Available to everyone",
  merge: "Admin only",
  delete: "Admin only",
}

/**
 * "More" bottom sheet for the profile's management actions (flag/merge/
 * delete). These stay out of the QuickActions pill row on purpose: flag is
 * everyday and open to everyone, but merge/delete are admin-only database
 * maintenance that should sit one tap deeper so they're harder to hit by
 * mistake. Rows are driven entirely by `actions` — already filtered to what
 * the view model exposes for this entity/user — so a non-admin sees only
 * Flag here, and any action added to the view model later shows up
 * automatically with no changes to this component.
 */
export function DirectoryManageSheet({ vm, actions, open, onOpenChange, onAction }: DirectoryManageSheetProps) {
  if (actions.length === 0) return null
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="glass-panel mx-auto max-w-md rounded-t-3xl border-t border-white/10 pb-6">
        <DrawerTitle className="px-4 pt-2 text-center text-[15px] font-semibold text-foreground/90">
          Manage {TYPE_LABEL[vm.type]}
        </DrawerTitle>
        <div className="mt-3 divide-y divide-white/8 border-t border-white/8">
          {actions.map((action) => {
            const Icon = ROW_ICON[action.kind]
            const destructive = action.kind === "delete"
            return (
              <button
                key={action.kind}
                type="button"
                onClick={() => {
                  onOpenChange(false)
                  onAction(action)
                }}
                className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors active:bg-white/[0.04]"
              >
                <span
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                    destructive ? "bg-red-400/[0.12] text-red-300/90" : "bg-white/[0.05] text-foreground/70",
                  )}
                >
                  {Icon && <Icon className="h-4 w-4" strokeWidth={1.8} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cn("block text-sm font-medium", destructive ? "text-red-300/90" : "text-foreground/85")}>
                    {action.label}
                  </span>
                  <span className={cn("block text-xs", destructive ? "text-red-300/55" : "text-muted-foreground/55")}>
                    {ROW_SUBTITLE[action.kind]}
                  </span>
                </span>
                <ChevronRight className={cn("h-4 w-4 shrink-0", destructive ? "text-red-300/45" : "text-muted-foreground/40")} strokeWidth={1.8} />
              </button>
            )
          })}
        </div>
      </DrawerContent>
    </Drawer>
  )
}
