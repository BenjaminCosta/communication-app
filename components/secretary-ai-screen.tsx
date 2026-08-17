"use client"

import { useState } from "react"
import { ArrowLeft, Bot, MessageCircle, Phone, Check, X, Pencil } from "lucide-react"

// Client-facing by design — see .env.example. Undefined only if the env var
// genuinely isn't configured in this environment; the CTA hides itself then
// rather than linking to "https://wa.me/undefined".
const WHATSAPP_SECRETARY_NUMBER = process.env.NEXT_PUBLIC_WHATSAPP_SECRETARY_NUMBER

interface SecretaryAiScreenProps {
  onBack: () => void
  /** Self-reported profile phone (not a verified WhatsApp link). Empty string when unset. */
  userPhone: string
  /** Returns whether the update was accepted — the editor stays open on `false`
   * (e.g. failed validation) so the user can correct their input instead of
   * losing it behind a silently-reverted row. */
  onUpdatePhone: (phone: string | null) => Promise<boolean>
  className?: string
}

export function SecretaryAiScreen({ onBack, userPhone, onUpdatePhone, className }: SecretaryAiScreenProps) {
  const [editingPhone, setEditingPhone] = useState(false)
  const [phoneValue, setPhoneValue] = useState(userPhone)
  const [savingPhone, setSavingPhone] = useState(false)

  const startEditPhone = () => {
    setPhoneValue(userPhone)
    setEditingPhone(true)
  }

  const cancelEditPhone = () => {
    setEditingPhone(false)
    setPhoneValue(userPhone)
  }

  const savePhone = async () => {
    if (savingPhone) return
    setSavingPhone(true)
    try {
      const succeeded = await onUpdatePhone(phoneValue.trim() || null)
      if (succeeded) setEditingPhone(false)
    } finally {
      setSavingPhone(false)
    }
  }

  const clearPhone = async () => {
    setSavingPhone(true)
    try {
      await onUpdatePhone(null)
    } finally {
      setSavingPhone(false)
    }
  }

  return (
    <div className={`flex-1 min-h-0 flex flex-col stream-glass-screen ${className ?? "animate-fade-in"}`}>
      {/* Header */}
      <div className="shrink-0 border-b border-white/10 animate-slide-down">
        <div className="max-w-2xl mx-auto px-4 md:px-6 app-topbar flex items-center gap-3">
          <button
            onClick={onBack}
            className="w-9 h-9 rounded-full bg-white/5 border border-white/10 flex items-center justify-center active:scale-95 hover:bg-white/8 transition-all duration-150"
          >
            <ArrowLeft className="w-4 h-4 text-muted-foreground" />
          </button>
          <h1 className="text-base font-bold tracking-tight">SVC Secretary AI</h1>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 md:px-6 py-6 flex flex-col gap-6">

          {/* Intro */}
          <div className="flex flex-col items-center text-center gap-3 pt-2">
            <div className="w-14 h-14 rounded-2xl bg-primary/15 border border-primary/25 flex items-center justify-center">
              <Bot className="w-6 h-6 text-primary" />
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed px-4">
              Chat with the SVC Secretary on WhatsApp for quick answers about jobs, reports, Directory, and more.
            </p>
          </div>

          {WHATSAPP_SECRETARY_NUMBER && (
            <a
              href={`https://wa.me/${WHATSAPP_SECRETARY_NUMBER}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full py-3.5 rounded-xl bg-primary/15 border border-primary/25 text-primary text-sm font-semibold active:scale-[0.98] hover:bg-primary/20 transition-all duration-150"
            >
              <MessageCircle className="w-4 h-4" />
              Message the Secretary
            </a>
          )}

          {/* Phone */}
          <section className="flex flex-col gap-3">
            <p className="text-[10px] font-bold tracking-[1.5px] uppercase text-muted-foreground/60 px-1">
              Your number
            </p>
            <div className="rounded-2xl bg-card border border-white/10 overflow-hidden">
              {editingPhone ? (
                <div className="flex items-center gap-2 px-4 py-3.5">
                  <Phone className="w-4 h-4 shrink-0 text-muted-foreground" />
                  <input
                    type="tel"
                    value={phoneValue}
                    onChange={(e) => setPhoneValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") savePhone()
                      if (e.key === "Escape") cancelEditPhone()
                    }}
                    placeholder="Your number"
                    autoFocus
                    className="flex-1 bg-white/5 border border-white/15 rounded-lg px-2.5 py-1.5 text-sm outline-none focus:border-primary/40 transition-colors"
                  />
                  <button
                    onClick={savePhone}
                    disabled={savingPhone}
                    className="w-7 h-7 rounded-md bg-primary/15 border border-primary/25 flex items-center justify-center active:scale-95 transition-all disabled:opacity-40"
                  >
                    <Check className="w-3.5 h-3.5 text-primary" />
                  </button>
                  <button
                    onClick={cancelEditPhone}
                    className="w-7 h-7 rounded-md bg-white/5 border border-white/15 flex items-center justify-center active:scale-95 transition-all"
                  >
                    <X className="w-3.5 h-3.5 text-muted-foreground" />
                  </button>
                </div>
              ) : (
                <button onClick={startEditPhone} className="flex items-center gap-3 px-4 py-3.5 w-full text-left active:bg-white/5 transition-colors duration-150">
                  <span className="text-muted-foreground"><Phone className="w-4 h-4" /></span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium">
                      {userPhone || <span className="text-muted-foreground">Add your number</span>}
                    </span>
                    <span className="block text-[11px] text-muted-foreground/60 mt-0.5">
                      So the Secretary recognizes you
                    </span>
                  </span>
                  {userPhone ? (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => { e.stopPropagation(); clearPhone() }}
                      className="w-6 h-6 flex items-center justify-center rounded hover:bg-destructive/10 transition-colors shrink-0"
                    >
                      <X className="w-3 h-3 text-muted-foreground/40" />
                    </span>
                  ) : (
                    <Pencil className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" />
                  )}
                </button>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
