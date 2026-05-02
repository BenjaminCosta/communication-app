"use client"

import { useState } from "react"
import { Check, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { type Contact } from "@/lib/store"

interface AddMembersModalProps {
  currentMembers: string[]
  onSave: (memberIds: string[]) => void
  onClose: () => void
  contacts: Contact[]
}

export function AddMembersModal({ currentMembers, onSave, onClose, contacts }: AddMembersModalProps) {
  const [selected, setSelected] = useState<string[]>(currentMembers)

  const toggle = (id: string) =>
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    )

  const added = selected.filter((id) => !currentMembers.includes(id)).length
  const removed = currentMembers.filter((id) => !selected.includes(id)).length
  const changed = added > 0 || removed > 0

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end md:items-center md:justify-center">
      {/* Backdrop */}
      <button
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-[1px]"
        aria-label="Close"
      />

      {/* Sheet */}
      <div className="relative z-10 w-full md:w-[420px] md:mb-6 md:rounded-3xl bg-[#0d1c35] border-t md:border border-white/10 rounded-t-3xl animate-slide-up md:shadow-2xl max-h-[80dvh] flex flex-col">
        {/* Handle */}
        <div className="w-10 h-1 rounded-full bg-white/20 mx-auto mt-3 shrink-0" />

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-4 shrink-0">
          <div>
            <h3 className="text-sm font-bold">Members</h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {selected.length === 0 ? "No members selected" : `${selected.length} selected`}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center active:scale-95 transition-transform"
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* Contact list */}
        <div className="flex-1 overflow-y-auto scrollbar-hide px-4 pb-2">
          {contacts.map((contact) => {
            const isSelected = selected.includes(contact.id)
            return (
              <button
                key={contact.id}
                onClick={() => toggle(contact.id)}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all duration-150 mb-1",
                  isSelected ? "bg-primary/10" : "active:bg-white/5"
                )}
              >
                {/* Avatar */}
                <div className={cn(
                  "w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0",
                  contact.color
                )}>
                  {contact.initials}
                </div>
                <span className={cn(
                  "flex-1 text-sm font-medium text-left",
                  isSelected ? "text-foreground" : "text-foreground/80"
                )}>
                  {contact.name}
                </span>
                {/* Check indicator */}
                <div className={cn(
                  "w-5 h-5 rounded-full border flex items-center justify-center transition-all duration-150 flex-shrink-0",
                  isSelected
                    ? "bg-primary border-primary"
                    : "border-white/20 bg-white/5"
                )}>
                  {isSelected && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                </div>
              </button>
            )
          })}
        </div>

        {/* Save button */}
        <div className="shrink-0 px-4 pt-3 pb-8 safe-area-pb border-t border-white/10">
          <button
            onClick={() => onSave(selected)}
            className={cn(
              "w-full py-3.5 rounded-xl text-sm font-semibold tracking-wide transition-all",
              changed || selected.length > 0
                ? "bg-primary text-white shadow-[0_4px_14px_rgba(37,99,235,0.35)] active:scale-[0.98]"
                : "bg-white/8 text-muted-foreground/50"
            )}
          >
            {selected.length === 0 ? "Save (no members)" : `Save ${selected.length} member${selected.length !== 1 ? "s" : ""}`}
          </button>
        </div>
      </div>
    </div>
  )
}
