"use client"

import { X, Tag, Hash, ArrowRight } from "lucide-react"

interface UniversalAddModalProps {
  onClose: () => void
  onChooseTag: () => void
  onChooseContext?: () => void
}

export function UniversalAddModal({
  onClose,
  onChooseTag,
  onChooseContext,
}: UniversalAddModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-5">
      <button onClick={onClose} className="absolute inset-0 bg-black/60 backdrop-blur-sm" aria-label="Close" />
      <div className="relative z-10 w-full max-w-sm glass-modal rounded-3xl border border-white/10 shadow-2xl animate-spring-pop -translate-y-[5%]">
        <div className="flex items-center justify-between px-5 pt-5 pb-0">
          <div className="w-7" />
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full bg-white/5 border border-white/10 flex items-center justify-center active:scale-95"
            aria-label="Close"
          >
            <X className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        </div>

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

            {onChooseContext && (
              <button
                onClick={() => { onChooseContext(); onClose() }}
                className="flex items-center gap-4 p-4 rounded-2xl bg-white/5 border border-white/10 hover:bg-emerald-400/8 hover:border-emerald-400/25 active:scale-[0.98] transition-all text-left group"
              >
                <div className="w-10 h-10 rounded-xl bg-emerald-400/15 border border-emerald-400/25 flex items-center justify-center flex-shrink-0">
                  <Hash className="w-5 h-5 text-emerald-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground">Context</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Global business context</p>
                </div>
                <ArrowRight className="w-4 h-4 text-muted-foreground/40 group-hover:text-emerald-400/60 transition-colors" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
