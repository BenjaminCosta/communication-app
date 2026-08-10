"use client"

import { Loader2 } from "lucide-react"
import { Drawer, DrawerClose, DrawerContent, DrawerTitle } from "@/components/ui/drawer"
import { BdButton } from "@/components/bye-bye-dpr/ui/byebye-dpr-primitives"

interface ClockOutConfirmSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  jobName: string
  onConfirm: () => void
  busy?: boolean
}

export function ClockOutConfirmSheet({ open, onOpenChange, jobName, onConfirm, busy = false }: ClockOutConfirmSheetProps) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="byebye-dpr-scope byebye-dpr-sheet-glass mx-auto max-w-md rounded-t-3xl border-t border-[var(--bd-border)] px-4 pb-6 text-center">
        <DrawerTitle className="pt-2 text-[1.0625rem] font-bold text-[var(--bd-text)]">
          Clock out from {jobName}?
        </DrawerTitle>
        <div className="mt-5 flex flex-col gap-2.5">
          <BdButton
            variant="primary"
            size="lg"
            fullWidth
            onClick={onConfirm}
            disabled={busy}
            icon={busy ? <Loader2 className="h-4.5 w-4.5 animate-spin" /> : undefined}
          >
            {busy ? "Clocking out..." : "Clock Out"}
          </BdButton>
          <DrawerClose asChild>
            <BdButton variant="ghost" size="lg" fullWidth disabled={busy}>
              Cancel
            </BdButton>
          </DrawerClose>
        </div>
      </DrawerContent>
    </Drawer>
  )
}
