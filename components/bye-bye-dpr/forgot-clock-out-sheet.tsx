"use client"

/**
 * "Forgot to clock out" — self-service correction, no approval step (see
 * PRODUCT.md design principles). The real backend always keeps audit
 * metadata (previous value, corrected-by, corrected-at); this mock only
 * shows the worker-facing time picker.
 */

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer"
import { BdButton } from "@/components/bye-bye-dpr/ui/byebye-dpr-primitives"

interface ForgotClockOutSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultTime: string
  onConfirm: (time: string) => void
  busy?: boolean
}

export function ForgotClockOutSheet({ open, onOpenChange, defaultTime, onConfirm, busy = false }: ForgotClockOutSheetProps) {
  const [time, setTime] = useState(defaultTime)

  // The default reflects the active clock's start time, computed fresh each
  // time the sheet opens — keep the picker in sync rather than freezing on
  // whatever the first mount saw.
  useEffect(() => {
    if (open) setTime(defaultTime)
  }, [open, defaultTime])

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="byebye-dpr-scope byebye-dpr-sheet-glass mx-auto max-w-md rounded-t-3xl border-t border-[var(--bd-border)] px-4 pb-6">
        <DrawerTitle className="pt-2 text-[1.0625rem] font-bold text-[var(--bd-text)]">What time did you finish?</DrawerTitle>
        <p className="mt-1 text-[0.8125rem] text-[var(--bd-text-muted)]">You can adjust this any time — no approval needed.</p>

        <input
          type="time"
          value={time}
          onChange={(event) => setTime(event.target.value)}
          disabled={busy}
          className="mt-5 h-14 w-full rounded-xl border border-[var(--bd-border)] bg-[var(--bd-surface)] px-4 text-center text-2xl font-bold tabular-nums text-[var(--bd-text)] outline-none focus:border-[var(--bd-purple)] focus:shadow-[0_0_0_3px_rgba(109,91,208,0.14)] disabled:opacity-70"
        />

        <BdButton
          variant="primary"
          size="lg"
          fullWidth
          className="mt-5"
          onClick={() => onConfirm(time)}
          disabled={busy}
          icon={busy ? <Loader2 className="h-4.5 w-4.5 animate-spin" /> : undefined}
        >
          {busy ? "Updating..." : "Update Clock Out"}
        </BdButton>
      </DrawerContent>
    </Drawer>
  )
}
