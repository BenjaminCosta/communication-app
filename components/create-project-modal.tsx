"use client"

import { useState } from "react"
import { X, ArrowRight, ChevronLeft, Check } from "lucide-react"
import { cn } from "@/lib/utils"
import { type Contact } from "@/lib/store"

interface CreateProjectModalProps {
  onClose: () => void
  onSubmit: (name: string, memberIds: string[]) => void
  contacts: Contact[]
}

export function CreateProjectModal({ onClose, onSubmit, contacts }: CreateProjectModalProps) {
  const [step, setStep] = useState<1 | 2>(1)
  const [name, setName] = useState("")
  const [members, setMembers] = useState<string[]>([])

  const toggle = (id: string) =>
    setMembers((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-5">
      {/* Backdrop */}
      <button
        onClick={onClose}
        className="absolute inset-0 bg-black/65 backdrop-blur-sm"
        aria-label="Close"
      />

      {/* Modal card */}
      <div className="relative z-10 w-full max-w-sm bg-[#0d1c35] rounded-3xl border border-white/10 shadow-2xl overflow-hidden animate-spring-pop -translate-y-[5%]">

        {/* Top bar: back, dots, close */}
        <div className="relative flex items-center justify-between px-5 pt-5 pb-0">
          <div className="w-7 h-7">
            {step === 2 && (
              <button
                onClick={() => setStep(1)}
                className="w-7 h-7 rounded-full bg-white/5 border border-white/10 flex items-center justify-center active:scale-95 transition-transform"
              >
                <ChevronLeft className="w-4 h-4 text-muted-foreground" />
              </button>
            )}
          </div>

          {/* Step dots */}
          <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1.5">
            <span className={cn("h-1.5 rounded-full transition-all duration-300", step === 1 ? "w-4 bg-primary" : "w-1.5 bg-white/25")} />
            <span className={cn("h-1.5 rounded-full transition-all duration-300", step === 2 ? "w-4 bg-primary" : "w-1.5 bg-white/25")} />
          </div>

          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full bg-white/5 border border-white/10 flex items-center justify-center active:scale-95 transition-transform"
          >
            <X className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        </div>

        {/* ── Step 1: Name ── */}
        {step === 1 && (
          <div className="px-5 pt-5 pb-6 animate-fade-up">
            <p className="text-[10px] font-bold tracking-[2px] uppercase text-muted-foreground font-mono mb-1">New Project</p>
            <h2 className="text-xl font-bold mb-1">Project name</h2>
            <p className="text-xs text-muted-foreground mb-5 leading-relaxed">
              Give it a clear, recognizable name.
            </p>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && name.trim() && setStep(2)}
              placeholder="e.g. Cool Breeze Phase 2"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3.5 text-sm text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-primary/50 transition-colors mb-4"
            />
            <button
              onClick={() => name.trim() && setStep(2)}
              disabled={!name.trim()}
              className={cn(
                "w-full py-3.5 rounded-xl text-sm font-semibold tracking-wide transition-all flex items-center justify-center gap-2",
                name.trim()
                  ? "bg-primary text-white shadow-[0_4px_16px_rgba(37,99,235,0.4)] active:scale-[0.98]"
                  : "bg-white/5 text-muted-foreground/40"
              )}
            >
              Next <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* ── Step 2: Members ── */}
        {step === 2 && (
          <div className="animate-fade-up flex flex-col">
            <div className="px-5 pt-5 pb-3">
              <p className="text-[10px] font-bold tracking-[2px] uppercase text-muted-foreground font-mono mb-1">New Project</p>
              <h2 className="text-xl font-bold mb-0.5">Add members</h2>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Optional — you can always change this later.
              </p>
            </div>

            {/* Contact list */}
            <div className="max-h-60 overflow-y-auto scrollbar-hide px-3 py-1">
              {contacts.map((contact) => {
                const sel = members.includes(contact.id)
                return (
                  <button
                    key={contact.id}
                    onClick={() => toggle(contact.id)}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-150 mb-0.5",
                      sel ? "bg-primary/10" : "active:bg-white/5"
                    )}
                  >
                    <div className={cn(
                      "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0",
                      contact.color
                    )}>
                      {contact.initials}
                    </div>
                    <span className={cn(
                      "flex-1 text-sm font-medium text-left",
                      sel ? "text-foreground" : "text-foreground/80"
                    )}>
                      {contact.name}
                    </span>
                    <div className={cn(
                      "w-5 h-5 rounded-full border flex items-center justify-center transition-all duration-150 flex-shrink-0",
                      sel ? "bg-primary border-primary" : "border-white/20 bg-transparent"
                    )}>
                      {sel && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                    </div>
                  </button>
                )
              })}
            </div>

            {/* Create button */}
            <div className="px-5 pt-3 pb-6 border-t border-white/5 mt-2">
              <button
                onClick={() => onSubmit(name.trim(), members)}
                className="w-full py-3.5 rounded-xl text-sm font-semibold tracking-wide bg-primary text-white shadow-[0_4px_16px_rgba(37,99,235,0.4)] active:scale-[0.98] transition-all"
              >
                {members.length > 0
                  ? `Create with ${members.length} member${members.length !== 1 ? "s" : ""}`
                  : "Create Project"}
              </button>
              <button
                onClick={() => onSubmit(name.trim(), [])}
                className="w-full mt-2 py-2 text-xs text-muted-foreground/50 active:opacity-70 transition-opacity"
              >
                Skip for now
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
