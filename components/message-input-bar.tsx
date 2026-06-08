"use client"

import { useEffect, useRef } from "react"
import { Plus, Send, X } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  type Contact,
  type MessageType,
  type Project,
  type ImportedContact,
  MESSAGE_TYPE_CONFIG,
} from "@/lib/store"

interface MessageInputBarProps {
  text: string
  setText: (value: string) => void
  contacts: Contact[]
  projects: Project[]
  recipients: string[]
  projectIds: string[]
  calendarDates?: string[]
  type: MessageType
  imageFile: File | null
  imagePreview: string | null
  imageError?: string | null
  sendError?: string | null
  importedContacts?: ImportedContact[]
  importedRecipients?: string[]
  onRemoveImportedRecipient?: (id: string) => void
  isSending: boolean
  isSent?: boolean
  onOpenSheet: () => void
  onRemoveRecipient: (id: string) => void
  onRemoveProject: (id: string) => void
  onRemoveCalendarDate?: (date: string) => void
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
  calendarDates = [],
  type,
  imageFile,
  imagePreview,
  imageError,
  sendError,
  importedContacts = [],
  importedRecipients = [],
  onRemoveImportedRecipient,
  isSending,
  isSent = false,
  onOpenSheet,
  onRemoveRecipient,
  onRemoveProject,
  onRemoveCalendarDate,
  onClearType,
  onClearImage,
  onSend,
  showProjectChips = true,
}: MessageInputBarProps) {
  const visibleProjectIds = showProjectChips ? projectIds : []
  const hasContext = recipients.length > 0 || importedRecipients.length > 0 || visibleProjectIds.length > 0 || calendarDates.length > 0 || type !== "none" || !!imageFile
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = "auto"
    textarea.style.height = `${Math.min(textarea.scrollHeight, 132)}px`
  }, [text])

  return (
    <div className="glass-compose flex-shrink-0 px-3 pt-2" style={{ paddingBottom: 'max(20px, env(safe-area-inset-bottom, 0px))' }}>
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
          {importedRecipients.map((id) => {
            const ic = importedContacts.find((c) => c.id === id)
            if (!ic) return null
            return (
              <ContextChip key={`ic-${id}`} onRemove={() => onRemoveImportedRecipient?.(id)}>
                To: {ic.name.split(" ")[0]}
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
          {calendarDates.map((date) => (
            <ContextChip key={date} tone="date" onRemove={() => onRemoveCalendarDate?.(date)}>
              {formatDateChip(date)}
            </ContextChip>
          ))}
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
          className="glass-button mb-0.5 w-9 h-9 rounded-full border flex items-center justify-center active:scale-[0.98] transition-all duration-150"
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
          className="glass-compose-pill min-h-[38px] max-h-[132px] flex-1 resize-none overflow-y-auto rounded-full border px-4 py-2 text-sm leading-5 outline-none placeholder:text-muted-foreground/60 focus:border-primary/40 scrollbar-hide transition-colors duration-150"
        />
        <button
          type="button"
          onClick={onSend}
          disabled={(!text.trim() && !imageFile) || isSending || isSent}
          className={cn(
            "mb-0.5 w-9 h-9 rounded-full flex items-center justify-center border transition-all duration-300",
            isSent
              ? "border-progress/35 bg-progress text-white shadow-[0_4px_16px_rgba(34,197,94,0.42)] animate-sent-pop"
              : (text.trim() || imageFile) && !isSending
                ? "border-primary/30 bg-[linear-gradient(135deg,rgba(37,99,235,0.96),rgba(99,102,241,0.92))] text-white glow-blue active:scale-[0.98]"
                : "glass-button text-muted-foreground"
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

function ContextChip({ children, onRemove, tone = "primary" }: { children: React.ReactNode; onRemove: () => void; tone?: "primary" | "date" }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap backdrop-blur-md",
      tone === "date"
        ? "border-sky-400/30 bg-sky-400/12 text-sky-300"
        : "border-primary/30 bg-primary/12 text-blue-300"
    )}>
      <span className="max-w-32 truncate">{children}</span>
      <button type="button" onClick={onRemove} className="rounded-full active:scale-90">
        <X className="w-3 h-3" />
      </button>
    </span>
  )
}

function formatDateChip(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number)
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" })
}
