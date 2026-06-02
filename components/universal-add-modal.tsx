"use client"

import { useState } from "react"
import { X, Tag, FolderPlus, ArrowRight, Check } from "lucide-react"
import { cn, haptic } from "@/lib/utils"

interface UniversalAddModalProps {
  onClose: () => void
  onChooseTag: () => void
  onCreateCategory: (name: string) => Promise<void> | void
}

export function UniversalAddModal({ onClose, onChooseTag, onCreateCategory }: UniversalAddModalProps) {
  const [mode, setMode] = useState<"choose" | "category">("choose")
  const [catName, setCatName] = useState("")
  const [isCreating, setIsCreating] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleCreateCategory = async () => {
    if (!catName.trim()) return
    setIsCreating(true)
    setError(null)
    try {
      await onCreateCategory(catName.trim())
      haptic.success()
      setIsSuccess(true)
      setTimeout(onClose, 750)
    } catch {
      setError("Could not create this category. Check permissions and try again.")
      setIsCreating(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-5">
      <button onClick={onClose} className="absolute inset-0 bg-black/60 backdrop-blur-sm" aria-label="Close" />
      <div className="relative z-10 w-full max-w-sm glass-modal rounded-3xl border border-white/10 shadow-2xl animate-spring-pop -translate-y-[5%]">
        {isSuccess && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-5 glass-modal rounded-3xl animate-fade-in">
            <div className="animate-sent-pop">
              <div className="w-20 h-20 rounded-full bg-progress flex items-center justify-center shadow-[0_0_48px_rgba(34,197,94,0.55)]">
                <Check className="w-9 h-9 text-white animate-check-draw" strokeWidth={3} />
              </div>
            </div>
            <div className="flex flex-col items-center gap-1 animate-fade-up">
              <p className="text-base font-bold text-foreground">{catName.trim()}</p>
              <p className="text-xs text-muted-foreground">Category created</p>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between px-5 pt-5 pb-0">
          {mode === "category" ? (
            <button
              onClick={() => setMode("choose")}
              className="w-7 h-7 rounded-full bg-white/5 border border-white/10 flex items-center justify-center active:scale-95"
            >
              <ArrowRight className="w-4 h-4 text-muted-foreground rotate-180" />
            </button>
          ) : <div className="w-7" />}
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full bg-white/5 border border-white/10 flex items-center justify-center active:scale-95"
          >
            <X className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        </div>

        {mode === "choose" && (
          <div className="px-5 pt-4 pb-6 animate-fade-up">
            <p className="text-[10px] font-bold tracking-[2px] uppercase text-muted-foreground font-mono mb-1">New</p>
            <h2 className="text-xl font-bold mb-5">What do you want to add?</h2>
            <div className="flex flex-col gap-3">
              <button
                onClick={onChooseTag}
                className="flex items-center gap-4 p-4 rounded-2xl bg-white/5 border border-white/10 hover:bg-primary/8 hover:border-primary/25 active:scale-[0.98] transition-all text-left group"
              >
                <div className="w-10 h-10 rounded-xl bg-primary/15 border border-primary/25 flex items-center justify-center flex-shrink-0">
                  <Tag className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground">Tag</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Label for messages and threads</p>
                </div>
                <ArrowRight className="w-4 h-4 text-muted-foreground/40 group-hover:text-primary/60 transition-colors" />
              </button>

              <button
                onClick={() => setMode("category")}
                className="flex items-center gap-4 p-4 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/[0.08] hover:border-white/20 active:scale-[0.98] transition-all text-left group"
              >
                <div className="w-10 h-10 rounded-xl bg-white/8 border border-white/15 flex items-center justify-center flex-shrink-0">
                  <FolderPlus className="w-5 h-5 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground">Category</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Group to organize your tags</p>
                </div>
                <ArrowRight className="w-4 h-4 text-muted-foreground/40 group-hover:text-foreground/60 transition-colors" />
              </button>
            </div>
          </div>
        )}

        {mode === "category" && (
          <div className="px-5 pt-4 pb-6 animate-fade-up">
            <p className="text-[10px] font-bold tracking-[2px] uppercase text-muted-foreground font-mono mb-1">New Category</p>
            <h2 className="text-xl font-bold mb-1">Category name</h2>
            <p className="text-xs text-muted-foreground mb-5">
              Create a custom category to organize your tags.
            </p>
            <input
              autoFocus
              value={catName}
              onChange={e => { setCatName(e.target.value); setError(null) }}
              onKeyDown={e => e.key === "Enter" && catName.trim() && !isCreating && handleCreateCategory()}
              placeholder="e.g. Marketing, Legal, Finance…"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3.5 text-sm text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-primary/50 transition-colors mb-4"
            />
            {error && (
              <p className="text-[11px] text-problem/85 px-1 -mt-2 mb-3 animate-fade-in">
                {error}
              </p>
            )}
            <button
              onClick={handleCreateCategory}
              disabled={!catName.trim() || isCreating}
              className={cn(
                "w-full py-3.5 rounded-xl text-sm font-semibold tracking-wide transition-all",
                catName.trim() && !isCreating
                  ? "bg-primary text-white shadow-[0_4px_16px_rgba(37,99,235,0.4)] active:scale-[0.98]"
                  : "bg-white/5 text-muted-foreground/40"
              )}
            >
              {isCreating ? "Creating..." : "Create Category"}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
