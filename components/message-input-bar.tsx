"use client"

import { useEffect, useRef } from "react"
import { Plus, Send, X } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  type Contact,
  type MessageType,
  type Project,
  MESSAGE_TYPE_CONFIG,
} from "@/lib/store"

interface MessageInputBarProps {
  text: string
  setText: (value: string) => void
  contacts: Contact[]
  projects: Project[]
  recipients: string[]
  projectIds: string[]
  type: MessageType
  imageFile: File | null
  imagePreview: string | null
  imageError?: string | null
  sendError?: string | null
  isSending: boolean
  isSent?: boolean
  onOpenSheet: () => void
  onRemoveRecipient: (id: string) => void
  onRemoveProject: (id: string) => void
  onClearType: () => void
  onClearImage: () => void
  onSend: () => void
  showProjectChips?: boolean
}

export function MessageInputBar({
  text,
  setText,
  contacts,
  projects,
  recipients,
  projectIds,
  type,
  imageFile,
  imagePreview,
  imageError,
  sendError,
  isSending,
  isSent = false,
  onOpenSheet,
  onRemoveRecipient,
  onRemoveProject,
  onClearType,
  onClearImage,
  onSend,
  showProjectChips = true,
}: MessageInputBarProps) {
  const visibleProjectIds = showProjectChips ? projectIds : []
  const hasContext = recipients.length > 0 || visibleProjectIds.length > 0 || type !== "none" || !!imageFile
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = "auto"
    textarea.style.height = `${Math.min(textarea.scrollHeight, 132)}px`
  }, [text])

  return (
    <div className="flex-shrink-0 border-t border-white/10 bg-[#071326]/95 backdrop-blur-xl px-3 pt-1 pb-[calc(env(safe-area-inset-bottom)+6px)]">
      {imagePreview && (
        <div className="mx-auto mb-2 max-w-2xl">
          <div className="relative w-24 overflow-hidden rounded-xl border border-white/10 bg-black/20">
            <img src={imagePreview} alt="Attachment preview" className="h-20 w-24 object-cover" />
            <button
              type="button"
              onClick={onClearImage}
              className="absolute right-1 top-1 w-6 h-6 rounded-full bg-black/55 border border-white/15 flex items-center justify-center"
            >
              <X className="w-3 h-3 text-white" />
            </button>
          </div>
        </div>
      )}

      {(imageError || sendError) && (
        <div className="mx-auto mb-2 max-w-2xl rounded-xl border border-destructive/25 bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive">
          {imageError || sendError}
        </div>
      )}

      {hasContext && (
        <div className="mx-auto mb-2 max-w-2xl flex gap-1.5 overflow-x-auto scrollbar-hide">
          {recipients.map((id) => {
            const contact = contacts.find((c) => c.id === id)
            if (!contact) return null
            return (
              <ContextChip key={id} onRemove={() => onRemoveRecipient(id)}>
                To: {contact.name.split(" ")[0]}
              </ContextChip>
            )
          })}
          {type !== "none" && (
            <ContextChip onRemove={onClearType}>
              {MESSAGE_TYPE_CONFIG[type].label}
            </ContextChip>
          )}
          {visibleProjectIds.map((id) => {
            const project = projects.find((p) => p.id === id)
            if (!project) return null
            return (
              <ContextChip key={id} onRemove={() => onRemoveProject(id)}>
                {project.name}
              </ContextChip>
            )
          })}
          {imageFile && (
            <ContextChip onRemove={onClearImage}>
              {imageFile.name}
            </ContextChip>
          )}
        </div>
      )}

      <div className="mx-auto max-w-2xl flex items-end gap-2">
        <button
          type="button"
          onClick={onOpenSheet}
          className="mb-0.5 w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center active:scale-95 transition-all"
        >
          <Plus className="w-5 h-5 text-muted-foreground" />
        </button>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              onSend()
            }
          }}
          rows={1}
          placeholder="Message"
          className="min-h-10 max-h-[132px] flex-1 resize-none overflow-y-auto rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm leading-5 outline-none placeholder:text-muted-foreground/60 focus:border-primary/35 scrollbar-hide"
        />
        <button
          type="button"
          onClick={onSend}
          disabled={(!text.trim() && !imageFile) || isSending || isSent}
          className={cn(
            "mb-0.5 w-10 h-10 rounded-full flex items-center justify-center transition-colors duration-300",
            isSent
              ? "bg-progress text-white shadow-[0_4px_14px_rgba(34,197,94,0.45)] animate-sent-pop"
              : (text.trim() || imageFile) && !isSending
                ? "bg-primary text-white shadow-[0_4px_14px_rgba(37,99,235,0.4)] active:scale-95"
                : "bg-white/10 text-muted-foreground"
          )}
        >
          {isSent ? (
            <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none">
              <path
                d="M3 8.5L6.5 12L13 4.5"
                stroke="white"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="animate-check-draw"
              />
            </svg>
          ) : isSending ? (
            <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
        </button>
      </div>
    </div>
  )
}

function ContextChip({ children, onRemove }: { children: React.ReactNode; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/12 px-2.5 py-1 text-[11px] font-semibold text-primary whitespace-nowrap">
      <span className="max-w-32 truncate">{children}</span>
      <button type="button" onClick={onRemove} className="rounded-full active:scale-90">
        <X className="w-3 h-3" />
      </button>
    </span>
  )
}
