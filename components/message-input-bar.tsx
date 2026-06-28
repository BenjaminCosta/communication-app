"use client"

import { useEffect, useRef } from "react"
import { Plus, Send, X, Tag, Hash, CalendarDays } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  type Contact,
  type MessageType,
  type Project,
  type ImportedContact,
  type AppContext,
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
  contextIds?: string[]
  contexts?: AppContext[]
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
  onRemoveContext?: (id: string) => void
  onChipTapRecipients?: () => void
  onChipTapTags?: () => void
  onChipTapDates?: () => void
  onChipTapContexts?: () => void
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
  contextIds = [],
  contexts = [],
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
  onRemoveContext,
  onChipTapRecipients,
  onChipTapTags,
  onChipTapDates,
  onChipTapContexts,
  onClearType,
  onClearImage,
  onSend,
  showProjectChips = true,
}: MessageInputBarProps) {
  const visibleProjectIds = showProjectChips ? projectIds : []
  const totalRecipients = recipients.length + importedRecipients.length
  const hasContext =
    totalRecipients > 0 ||
    visibleProjectIds.length > 0 ||
    calendarDates.length > 0 ||
    contextIds.length > 0 ||
    type !== "none" ||
    !!imageFile
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

          {/* First person — avatar + name + X */}
          {totalRecipients > 0 && (() => {
            const firstIsReg = recipients.length > 0
            const firstId = firstIsReg ? recipients[0] : importedRecipients[0]
            const c = firstIsReg ? contacts.find((x) => x.id === firstId) : null
            const ic = !firstIsReg ? importedContacts.find((x) => x.id === firstId) : null
            if (!c && !ic) return null
            const name = (c ?? ic)!.name.split(" ")[0]
            const initials = c ? c.initials : ((ic!.name.match(/\b\w/g) ?? []).slice(0, 2).join("").toUpperCase() || "?")
            const color = c ? c.color : "bg-white/10"
            const onRemove = firstIsReg ? () => onRemoveRecipient(firstId) : () => onRemoveImportedRecipient?.(firstId)
            return (
              <Chip tone="people" onRemove={onRemove} onTap={onChipTapRecipients} extraCount={totalRecipients - 1}>
                <MiniAvatar initials={initials} color={color} />
                {name}
              </Chip>
            )
          })()}

          {/* Type chip */}
          {type !== "none" && (
            <Chip tone="type" onRemove={onClearType} onTap={onChipTapTags}>
              {MESSAGE_TYPE_CONFIG[type].label}
            </Chip>
          )}

          {/* First tag — icon + name + X */}
          {visibleProjectIds.length > 0 && (() => {
            const p = projects.find((x) => x.id === visibleProjectIds[0])
            if (!p) return null
            return (
              <Chip tone="tag" onRemove={() => onRemoveProject(visibleProjectIds[0])} onTap={onChipTapTags} extraCount={visibleProjectIds.length - 1}>
                <Tag className="w-3 h-3 shrink-0 text-violet-300" />
                {p.name}
              </Chip>
            )
          })()}

          {/* Calendar dates — always individual */}
          {calendarDates.map((date) => (
            <Chip key={date} tone="date" onRemove={() => onRemoveCalendarDate?.(date)} onTap={onChipTapDates}>
              <CalendarDays className="w-3 h-3 shrink-0 text-sky-300" />
              {formatDateChip(date)}
            </Chip>
          ))}

          {/* First context — hash + name + X */}
          {contextIds.length > 0 && (() => {
            const ctx = contexts.find((c) => c.id === contextIds[0])
            if (!ctx) return null
            return (
              <Chip tone="context" onRemove={() => onRemoveContext?.(contextIds[0])} onTap={onChipTapContexts} extraCount={contextIds.length - 1}>
                <Hash className="w-3 h-3 shrink-0 text-emerald-300" />
                {ctx.name}
              </Chip>
            )
          })()}

          {/* Image */}
          {imageFile && (
            <Chip tone="type" onRemove={onClearImage} onTap={onOpenSheet}>{imageFile.name}</Chip>
          )}
        </div>
      )}

      <div data-guide="stream-message-composer" className="mx-auto max-w-2xl flex items-end gap-2">
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

type ChipTone = "people" | "tag" | "context" | "date" | "type"

const CHIP_BORDER_BG: Record<ChipTone, string> = {
  people:  "border-amber-400/30  bg-amber-400/12",
  tag:     "border-violet-400/30 bg-violet-400/12",
  context: "border-emerald-400/30 bg-emerald-400/12",
  date:    "border-sky-400/30    bg-sky-400/12",
  type:    "border-primary/30   bg-primary/12",
}

const CHIP_COUNT_CLASS: Record<ChipTone, string> = {
  people:  "border-amber-400/25  bg-amber-400/14  text-amber-300",
  tag:     "border-violet-400/25 bg-violet-400/14 text-violet-300",
  context: "border-emerald-400/25 bg-emerald-400/14 text-emerald-300",
  date:    "border-sky-400/25    bg-sky-400/14    text-sky-300",
  type:    "border-primary/25     bg-primary/14     text-primary",
}

function Chip({
  children,
  onRemove,
  onTap,
  extraCount = 0,
  tone = "type",
}: {
  children: React.ReactNode
  onRemove: () => void
  onTap?: () => void
  extraCount?: number
  tone?: ChipTone
}) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap backdrop-blur-md text-white transition-transform active:scale-[0.98]",
        CHIP_BORDER_BG[tone],
      )}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); onTap?.() }}
    >
      <span className="flex items-center gap-1 max-w-28 truncate">{children}</span>
      {extraCount > 0 && (
        <span className={cn(
          "ml-0.5 inline-flex h-6 min-w-8 items-center justify-center rounded-full border px-2 font-mono text-xs font-bold",
          CHIP_COUNT_CLASS[tone]
        )}>
          +{extraCount}
        </span>
      )}
      <span
        role="button"
        tabIndex={0}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onRemove() }}
        className="rounded-full active:scale-90 text-white/55 hover:text-white transition-colors"
      >
        <X className="w-3 h-3" />
      </span>
    </button>
  )
}

function MiniAvatar({ initials, color }: { initials: string; color: string }) {
  return (
    <span className={cn("flex h-4 w-4 items-center justify-center rounded-full text-[8px] font-bold text-white shrink-0", color)}>
      {initials}
    </span>
  )
}

function formatDateChip(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number)
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" })
}
