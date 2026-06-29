"use client"

import { useState } from "react"
import { Check, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { type Contact, type TagCategory } from "@/lib/store"

interface CreateProjectModalProps {
  onClose: () => void
  onSubmit: (name: string, memberIds: string[], category: TagCategory) => void
  contacts: Contact[]
}

export function CreateProjectModal({
  onClose,
  onSubmit,
  contacts: _contacts,
}: CreateProjectModalProps) {
  const [name, setName] = useState("")
  const [isSuccess, setIsSuccess] = useState(false)

  const handleCreate = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    setIsSuccess(true)
    setTimeout(() => onSubmit(trimmed, [], "custom"), 750)
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center px-5">
      <button
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        aria-label="Close"
      />

      <div className="relative z-10 w-full max-w-sm glass-modal rounded-3xl border border-white/10 shadow-2xl max-h-[90dvh] overflow-x-hidden overflow-y-auto scrollbar-hide animate-spring-pop -translate-y-[5%]">
        {isSuccess && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-5 glass-modal rounded-3xl animate-fade-in">
            <div className="animate-sent-pop">
              <div className="w-20 h-20 rounded-full bg-progress flex items-center justify-center shadow-[0_0_48px_rgba(34,197,94,0.55)]">
                <Check className="w-9 h-9 text-white animate-check-draw" strokeWidth={3} />
              </div>
            </div>
            <div className="flex flex-col items-center gap-1 animate-fade-up">
              <p className="text-base font-bold text-foreground">{name.trim()}</p>
              <p className="text-xs text-muted-foreground">Tag created</p>
            </div>
          </div>
        )}

        <div className="flex items-center justify-end px-5 pt-5 pb-0">
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full bg-white/5 border border-white/10 flex items-center justify-center active:scale-95 transition-transform"
            aria-label="Close"
          >
            <X className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        </div>

        <div className="px-5 pt-5 pb-6 animate-fade-up">
          <p className="text-[10px] font-bold tracking-[2px] uppercase text-muted-foreground font-mono mb-1">New Tag</p>
          <h2 className="text-xl font-bold mb-1">Tag name</h2>
          <p className="text-xs text-muted-foreground mb-5 leading-relaxed">
            Give it a clear, recognizable name.
          </p>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            placeholder="e.g. Cool Breeze Phase 2"
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3.5 text-sm text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-primary/50 transition-colors mb-4"
          />

          <button
            onClick={handleCreate}
            disabled={!name.trim()}
            className={cn(
              "w-full py-3.5 rounded-xl text-sm font-semibold tracking-wide transition-all",
              name.trim()
                ? "bg-primary text-white shadow-[0_4px_16px_rgba(37,99,235,0.4)] active:scale-[0.98]"
                : "bg-white/5 text-muted-foreground/40"
            )}
          >
            Create Tag
          </button>
        </div>
      </div>
    </div>
  )
}
