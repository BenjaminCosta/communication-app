"use client"

import { Globe, Lock, Users, Eye, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"

interface MakeGlobalModalProps {
  open: boolean
  contactName: string
  onConfirm: () => void
  onCancel: () => void
}

export function MakeGlobalModal({ open, contactName, onConfirm, onCancel }: MakeGlobalModalProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel() }}>
      <DialogContent className="max-w-sm rounded-2xl glass-modal border border-white/10 p-0 overflow-hidden">
        <div className="flex flex-col">
          {/* Header */}
          <DialogHeader className="px-6 pt-6 pb-4">
            <div className="flex items-center gap-3 mb-1">
              <div className="w-10 h-10 rounded-full bg-blue-500/15 flex items-center justify-center shrink-0">
                <Globe className="w-5 h-5 text-blue-400" />
              </div>
              <DialogTitle className="text-base font-semibold text-foreground leading-snug">
                Share <span className="text-blue-400">{contactName}</span> with everyone
              </DialogTitle>
            </div>
            <DialogDescription className="sr-only">
              Make this contact visible to all workspace members.
            </DialogDescription>
          </DialogHeader>

          {/* Explanation */}
          <div className="px-6 pb-5 space-y-3">
            <p className="text-sm text-muted-foreground leading-relaxed">
              Making a contact <span className="text-foreground font-medium">globally visible</span> means all workspace members will be able to see and message them — even if they didn&apos;t import this contact themselves.
            </p>

            <div className="rounded-xl border border-white/8 bg-white/3 divide-y divide-white/8">
              <div className="flex items-start gap-3 px-4 py-3">
                <Eye className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Their name, email, phone, and labels become visible to all members.
                </p>
              </div>
              <div className="flex items-start gap-3 px-4 py-3">
                <Users className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                <p className="text-xs text-muted-foreground leading-relaxed">
                  They will appear in everyone&apos;s People screen and can be added to streams.
                </p>
              </div>
              <div className="flex items-start gap-3 px-4 py-3">
                <Lock className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                <p className="text-xs text-muted-foreground leading-relaxed">
                  You can make them private again at any time from their contact card.
                </p>
              </div>
              <div className="flex items-start gap-3 px-4 py-3">
                <ShieldCheck className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Only you (the owner) can edit or delete this contact.
                </p>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="px-6 pb-6 flex gap-2">
            <Button
              variant="outline"
              className="flex-1 rounded-xl border-white/10 text-muted-foreground hover:text-foreground"
              onClick={onCancel}
            >
              Cancel
            </Button>
            <Button
              className="flex-1 rounded-xl bg-blue-600 hover:bg-blue-500 text-white"
              onClick={onConfirm}
            >
              <Globe className="w-4 h-4 mr-1.5" />
              Make Global
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
