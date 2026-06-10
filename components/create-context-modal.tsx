"use client"

import { useState } from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"

interface CreateContextModalProps {
  onClose: () => void
  onSubmit: (name: string, description: string) => Promise<void>
}

export function CreateContextModal({ onClose, onSubmit }: CreateContextModalProps) {
  const [name, setName] = useState("")
  const [isSuccess, setIsSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleCreate = async () => {
    if (!name.trim() || loading) return
    setLoading(true)
    try {
      await onSubmit(name.trim(), "")
      setIsSuccess(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center px-5">
      <button
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        aria-label="Close"
      />

      <div className="relative z-10 w-full max-w-sm glass-modal rounded-3xl border border-white/10 shadow-2xl overflow-y-auto max-h-[92dvh] animate-spring-pop -translate-y-[5%]">

        {/* Success overlay */}
        {isSuccess && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-5 glass-modal rounded-3xl animate-fade-in">
            <div className="animate-sent-pop">
              <div className="w-20 h-20 rounded-full bg-emerald-500 flex items-center justify-center shadow-[0_0_48px_rgba(52,211,153,0.55)]">
                <svg className="w-9 h-9" viewBox="0 0 36 36" fill="none">
                  <path
                    d="M7 19L14 26L29 11"
                    stroke="white"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{
                      strokeDasharray: 32,
                      strokeDashoffset: 32,
                      animation: "check-draw 0.4s cubic-bezier(0.22,0.97,0.52,1) 0.12s forwards",
                    }}
                  />
                </svg>
              </div>
            </div>
            <div className="flex flex-col items-center gap-1 animate-fade-up">
              <p className="text-base font-bold text-foreground">{name.trim()}</p>
              <p className="text-xs text-muted-foreground">Context created</p>
            </div>
          </div>
        )}

        {/* Top bar */}
        <div className="flex items-center justify-end px-5 pt-5 pb-0">
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full bg-white/5 border border-white/10 flex items-center justify-center active:scale-95 transition-transform"
          >
            <X className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        </div>

        <div className="px-5 pt-5 pb-6 animate-fade-up">
          <p className="text-[10px] font-bold tracking-[2px] uppercase text-muted-foreground font-mono mb-1">New Context</p>
          <h2 className="text-xl font-bold mb-1">Context name</h2>
          <p className="text-xs text-muted-foreground mb-5 leading-relaxed">
            Give it a clear, recognizable name.
          </p>

          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && name.trim() && handleCreate()}
            placeholder="e.g. Acme Corp, Q3 Project"
            autoFocus
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3.5 text-sm text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-emerald-400/40 transition-colors mb-4"
          />

          <button
            onClick={handleCreate}
            disabled={!name.trim() || loading}
            className={cn(
              "w-full py-3.5 rounded-xl text-sm font-semibold tracking-wide transition-all",
              name.trim() && !loading
                ? "bg-emerald-500 text-white shadow-[0_4px_16px_rgba(52,211,153,0.35)] active:scale-[0.98]"
                : "bg-white/5 text-muted-foreground/40"
            )}
          >
            Create Context
          </button>
        </div>
      </div>
    </div>
  )
}
