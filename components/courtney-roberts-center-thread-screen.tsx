"use client"

import { useEffect, useState } from "react"
import { ArrowLeft, Check, Copy, Link2, Loader2, Lock, MessageCircleOff, Pause, Paperclip, Play, Send } from "lucide-react"
import { cn, getUserAvatarColor } from "@/lib/utils"
import { deriveInitials } from "@/lib/store"
import { formatDateInAppZone, formatDateTimeInAppZone, formatTimeInAppZone, isSameDayInAppZone } from "@/lib/datetime"
import {
  fetchCourtneyRobertsCenterThread,
  linkCourtneyRobertsCenterConversation,
  sendCourtneyRobertsCenterManualReply,
  resumeCourtneyRobertsCenterAi,
  type CourtneyRobertsCenterLinkResult,
  CourtneyRobertsCenterClientError,
} from "@/lib/courtney-roberts-center/client"
import type { CourtneyRobertsCenterConversationSummary, CourtneyRobertsCenterMessage } from "@/lib/courtney-roberts-center/types"

interface CourtneyRobertsCenterThreadScreenProps {
  conversationId: string
  onBack: () => void
  className?: string
}

type ThreadData = { conversation: CourtneyRobertsCenterConversationSummary; messages: CourtneyRobertsCenterMessage[] }

// One page covers any real conversation for v1 — see lib/courtney-roberts-center/read-api.ts.
const THREAD_PAGE_SIZE = 200

function formatMessageTimestamp(ms: number): string {
  const date = new Date(ms)
  const now = new Date()
  const time = formatTimeInAppZone(date, { hour: "numeric", minute: "2-digit" })
  if (isSameDayInAppZone(date, now)) return time
  return `${formatDateInAppZone(date, { month: "short", day: "numeric" })} · ${time}`
}

/** Plain-text export of the full thread — readable on its own, no app-specific markup. */
function buildConversationTranscript(conversation: CourtneyRobertsCenterConversationSummary, messages: CourtneyRobertsCenterMessage[]): string {
  const header = `Courtney Roberts Center — ${conversation.displayName}\n${
    conversation.identityStatus === "internal" ? "Internal" : "Public"
  }${conversation.phoneNumber ? ` · +${conversation.phoneNumber}` : ""}\n`

  const lines = messages.map((message) => {
    const who = message.role === "assistant" ? "Courtney" : conversation.displayName
    const when = formatDateTimeInAppZone(new Date(message.createdAtMs), {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    })
    const attachments = message.attachments?.length
      ? `\n${message.attachments.map((attachment) => `  [attachment: ${attachment.filename ?? attachment.kind}]`).join("\n")}`
      : ""
    return `[${when}] ${who}: ${message.text}${attachments}`
  })

  return `${header}\n${lines.join("\n")}`
}

/** Same clipboard-write + textarea fallback as `handleCopyMessage` in app/page.tsx. */
function copyToClipboard(text: string): void {
  const fallback = () => {
    try {
      const el = document.createElement("textarea")
      el.value = text
      el.style.cssText = "position:fixed;opacity:0;pointer-events:none"
      document.body.appendChild(el)
      el.select()
      document.execCommand("copy")
      document.body.removeChild(el)
    } catch {
      /* best-effort */
    }
  }
  if (navigator?.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(fallback)
  } else {
    fallback()
  }
}

export function CourtneyRobertsCenterThreadScreen({ conversationId, onBack, className }: CourtneyRobertsCenterThreadScreenProps) {
  const [data, setData] = useState<ThreadData | null>(null)
  const [errorStatus, setErrorStatus] = useState<number | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  // Survives the identityStatus flip that would otherwise unmount the banner
  // the instant it succeeds, taking the outcome with it.
  const [linkOutcome, setLinkOutcome] = useState<LinkOutcome | null>(null)
  const [composeText, setComposeText] = useState("")
  const [isSending, setIsSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [isResuming, setIsResuming] = useState(false)

  useEffect(() => {
    let cancelled = false
    setData(null)
    setErrorStatus(null)
    setErrorMessage(null)
    setCopied(false)
    setComposeText("")
    setSendError(null)
    fetchCourtneyRobertsCenterThread(conversationId, { limit: THREAD_PAGE_SIZE })
      .then((page) => {
        if (!cancelled) setData({ conversation: page.conversation, messages: page.messages })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setErrorStatus(err instanceof CourtneyRobertsCenterClientError ? err.status : null)
        setErrorMessage(err instanceof CourtneyRobertsCenterClientError ? err.message : "Unable to load this conversation.")
      })
    return () => {
      cancelled = true
    }
  }, [conversationId])

  const isLoading = !data && !errorMessage
  const isDenied = errorStatus === 401 || errorStatus === 403
  const conversation = data?.conversation

  const handleCopy = () => {
    if (!data) return
    copyToClipboard(buildConversationTranscript(data.conversation, data.messages))
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  const handleSend = () => {
    const text = composeText.trim()
    if (!text || isSending) return
    setIsSending(true)
    setSendError(null)
    const clientMessageId =
      typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
    sendCourtneyRobertsCenterManualReply(conversationId, text, clientMessageId)
      .then((message) => {
        setComposeText("")
        setData((current) =>
          current
            ? {
                conversation: { ...current.conversation, aiPaused: true, aiPausedByName: message.sentByName },
                messages: [...current.messages, message],
              }
            : current,
        )
      })
      .catch((err: unknown) => {
        setSendError(err instanceof CourtneyRobertsCenterClientError ? err.message : "Unable to send this message.")
      })
      .finally(() => setIsSending(false))
  }

  const handleResume = () => {
    if (isResuming) return
    setIsResuming(true)
    resumeCourtneyRobertsCenterAi(conversationId)
      .then(() => {
        setData((current) =>
          current ? { conversation: { ...current.conversation, aiPaused: false, aiPausedByName: undefined }, messages: current.messages } : current,
        )
      })
      .catch((err: unknown) => {
        setSendError(err instanceof CourtneyRobertsCenterClientError ? err.message : "Unable to resume AI.")
      })
      .finally(() => setIsResuming(false))
  }

  return (
    <div className={cn("flex-1 min-h-0 flex flex-col courtney-roberts-center-glass-screen", className ?? "animate-fade-in")}>
      {/* Header */}
      <div className="shrink-0 border-b border-white/10 animate-slide-down">
        <div className="max-w-2xl mx-auto px-4 md:px-6 app-topbar flex items-center gap-3">
          <button
            onClick={onBack}
            className="w-9 h-9 rounded-full bg-white/5 border border-white/10 flex items-center justify-center active:scale-95 hover:bg-white/8 transition-all duration-150 shrink-0"
          >
            <ArrowLeft className="w-4 h-4 text-muted-foreground" />
          </button>
          {conversation ? (
            <>
              <div
                className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0",
                  getUserAvatarColor(conversation.id),
                )}
              >
                {deriveInitials(conversation.displayName)}
              </div>
              <div className="flex-1 min-w-0">
                <h1 className="text-sm font-bold tracking-tight truncate">{conversation.displayName}</h1>
                <p className="text-[11px] text-muted-foreground/60 font-mono">
                  {conversation.identityStatus === "internal" ? "Internal" : "Public"}
                  {conversation.phoneNumber ? ` · +${conversation.phoneNumber}` : ""}
                </p>
              </div>
            </>
          ) : (
            <h1 className="text-base font-bold tracking-tight">Conversation</h1>
          )}
          {data && (
            <button
              onClick={handleCopy}
              aria-label="Copy conversation"
              className={cn(
                "w-9 h-9 rounded-full border flex items-center justify-center active:scale-95 transition-all duration-150 shrink-0",
                copied
                  ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-400"
                  : "bg-white/5 border-white/10 text-muted-foreground hover:bg-white/8",
              )}
            >
              {copied ? <Check className="w-4 h-4" strokeWidth={2.5} /> : <Copy className="w-4 h-4" strokeWidth={1.8} />}
            </button>
          )}
        </div>
      </div>

      {(conversation?.identityStatus === "public" || linkOutcome) && (
        <LinkIdentityBanner
          conversationId={conversationId}
          outcome={linkOutcome}
          onLinked={(linked) => {
            setLinkOutcome({ displayName: linked.displayName, recognitionNotice: linked.recognitionNotice })
            setData((current) => (current ? { ...current, conversation: { ...current.conversation, ...linked } } : current))
          }}
        />
      )}

      {conversation?.aiPaused && (
        <div className="shrink-0 border-b border-white/10 bg-amber-500/8">
          <div className="max-w-2xl mx-auto w-full px-4 md:px-6 py-2.5 flex items-center gap-2">
            <Pause className="w-3.5 h-3.5 text-amber-400 shrink-0" strokeWidth={2.5} />
            <span className="text-[11px] text-amber-200/80 flex-1">
              Courtney is paused{conversation.aiPausedByName ? ` — ${conversation.aiPausedByName} is replying manually` : " — a human is replying manually"}
            </span>
            <button
              onClick={handleResume}
              disabled={isResuming}
              className="px-3 py-1 rounded-full text-[11px] font-semibold border border-emerald-500/30 bg-emerald-500/15 text-emerald-300 disabled:opacity-40 active:scale-95 transition-all duration-150 shrink-0 flex items-center gap-1.5"
            >
              {isResuming ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" strokeWidth={2.5} />}
              Resume AI
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide">
        <div className="max-w-2xl mx-auto w-full px-4 md:px-6 py-4">
          {isDenied ? (
            <EmptyState icon={<Lock className="w-5 h-5" />} title="Not approved" description={errorMessage ?? "You are not approved to view this."} />
          ) : isLoading ? (
            <ThreadSkeleton />
          ) : errorMessage ? (
            <EmptyState icon={<MessageCircleOff className="w-5 h-5" />} title="Can't load this conversation" description={errorMessage} />
          ) : !data || data.messages.length === 0 ? (
            <EmptyState icon={<MessageCircleOff className="w-5 h-5" />} title="No messages" description="This conversation has no recorded messages." />
          ) : (
            <div className="flex flex-col gap-2.5">
              {data.messages.map((message) => (
                <MessageBubble key={message.id} message={message} />
              ))}
            </div>
          )}
        </div>
      </div>

      {data && (
        <div className="glass-compose shrink-0 px-4 md:px-6 pt-2" style={{ paddingBottom: "max(20px, env(safe-area-inset-bottom, 0px))" }}>
          {sendError && (
            <div className="max-w-2xl mx-auto mb-2 rounded-xl border border-destructive/25 bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive">
              {sendError}
            </div>
          )}
          <div className="max-w-2xl mx-auto flex items-end gap-2">
            <textarea
              value={composeText}
              onChange={(event) => setComposeText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault()
                  handleSend()
                }
              }}
              rows={1}
              placeholder="Reply as Courtney…"
              className="glass-compose-pill min-h-[38px] max-h-[132px] flex-1 resize-none overflow-y-auto rounded-full border px-4 py-2 text-sm leading-5 outline-none placeholder:text-muted-foreground/60 focus:border-emerald-500/40 scrollbar-hide transition-colors duration-150"
            />
            <button
              onClick={handleSend}
              disabled={!composeText.trim() || isSending}
              aria-label="Send"
              className={cn(
                "mb-0.5 w-9 h-9 rounded-full flex items-center justify-center border transition-all duration-150 shrink-0",
                composeText.trim() && !isSending
                  ? "border-emerald-500/30 bg-emerald-500 text-white active:scale-95"
                  : "bg-white/5 border-white/10 text-muted-foreground",
              )}
            >
              {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
          <p className="max-w-2xl mx-auto mt-1.5 text-[10px] text-muted-foreground/40 px-1">
            Sending pauses Courtney for this conversation.
          </p>
        </div>
      )}
    </div>
  )
}

/**
 * Manual recovery for a sender Courtney could not recognize.
 *
 * Senders can enroll themselves by replying with their SVC email, so this is
 * the fallback for the cases that path cannot reach — no `/users` account to
 * match, a number linked to the wrong person, or simply an admin fixing a
 * thread in front of them instead of running the CLI link script. Shown while
 * the conversation is unlinked, and then once more to report what the person
 * was actually told — linking someone silently is exactly what this feature
 * exists to stop.
 */
type LinkOutcome = { displayName: string; recognitionNotice: CourtneyRobertsCenterLinkResult["recognitionNotice"] }

/** What the admin needs to know: whether the person heard about it, and if not, when they will. */
const RECOGNITION_NOTICE_LABEL: Record<LinkOutcome["recognitionNotice"], string> = {
  sent: "and told them Courtney recognizes them now",
  deferred: "— they'll be told the next time they message, since the 24h window has closed",
  skipped: "— they'd already been told Courtney recognizes them",
}

function LinkIdentityBanner({
  conversationId,
  outcome,
  onLinked,
}: {
  conversationId: string
  outcome: LinkOutcome | null
  onLinked: (linked: CourtneyRobertsCenterLinkResult) => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [email, setEmail] = useState("")
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleLink = () => {
    if (isSaving || !email.trim()) return
    setIsSaving(true)
    setError(null)
    linkCourtneyRobertsCenterConversation(conversationId, email.trim())
      .then(onLinked)
      .catch((err: unknown) => {
        setError(err instanceof CourtneyRobertsCenterClientError ? err.message : "Unable to link this conversation.")
        setIsSaving(false)
      })
  }

  if (outcome) {
    return (
      <div className="shrink-0 border-b border-white/10">
        <div className="max-w-2xl mx-auto w-full px-4 md:px-6 py-2.5 flex items-center gap-2">
          <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" strokeWidth={2.5} />
          <span className="text-[11px] text-muted-foreground/70">
            Linked to {outcome.displayName} {RECOGNITION_NOTICE_LABEL[outcome.recognitionNotice]}
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="shrink-0 border-b border-white/10">
      <div className="max-w-2xl mx-auto w-full px-4 md:px-6 py-2.5 flex flex-col gap-2">
        {isOpen ? (
          <>
            <div className="flex items-center gap-2">
              <input
                type="email"
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleLink()}
                placeholder="person@supervisioncompany.com"
                className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded-full px-3.5 py-2 text-sm outline-none placeholder:text-muted-foreground/50 focus:border-white/20 transition-colors"
              />
              <button
                onClick={handleLink}
                disabled={isSaving || !email.trim()}
                className="px-3.5 py-2 rounded-full text-xs font-semibold border border-emerald-500/30 bg-emerald-500/15 text-emerald-300 disabled:opacity-40 active:scale-95 transition-all duration-150 shrink-0 flex items-center gap-1.5"
              >
                {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Link
              </button>
            </div>
            {error && <p className="text-[11px] text-red-400/90 px-1">{error}</p>}
          </>
        ) : (
          <button
            onClick={() => setIsOpen(true)}
            className="flex items-center gap-2 text-left active:scale-[0.99] transition-transform duration-150"
          >
            <Link2 className="w-3.5 h-3.5 text-muted-foreground/60 shrink-0" />
            <span className="text-[11px] text-muted-foreground/70 flex-1">Not linked to an SVC account</span>
            <span className="text-[11px] font-semibold text-emerald-400/90 shrink-0">Link</span>
          </button>
        )}
      </div>
    </div>
  )
}

function MessageBubble({ message }: { message: CourtneyRobertsCenterMessage }) {
  const isAssistant = message.role === "assistant"
  return (
    <div className={cn("flex", isAssistant ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
          isAssistant ? "bg-emerald-500/16 border border-emerald-500/25 text-emerald-50" : "bg-white/6 border border-white/10 text-foreground",
        )}
      >
        {isAssistant && (
          <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-400/80 mb-0.5">
            {message.sentBy === "human" ? (message.sentByName ?? "Admin") : "Courtney"}
          </p>
        )}
        <p className="whitespace-pre-wrap break-words">{message.text}</p>
        {message.attachments && message.attachments.length > 0 && (
          <div className="flex flex-col gap-1 mt-2">
            {message.attachments.map((attachment, index) => (
              <div key={index} className="flex items-center gap-1.5 text-xs text-muted-foreground/70">
                <Paperclip className="w-3 h-3 shrink-0" />
                <span className="truncate">{attachment.filename ?? (attachment.kind === "image" ? "Image" : "Document")}</span>
              </div>
            ))}
          </div>
        )}
        <p className={cn("text-[10px] mt-1.5", isAssistant ? "text-emerald-200/50" : "text-muted-foreground/50")}>
          {formatMessageTimestamp(message.createdAtMs)}
        </p>
      </div>
    </div>
  )
}

function ThreadSkeleton() {
  return (
    <div className="flex flex-col gap-2.5">
      {[0, 1, 2, 3].map((index) => (
        <div key={index} className={cn("flex", index % 2 === 1 ? "justify-end" : "justify-start")}>
          <div className={cn("h-12 rounded-2xl bg-white/6 animate-pulse", index % 2 === 1 ? "w-2/3" : "w-1/2")} />
        </div>
      ))}
    </div>
  )
}

function EmptyState({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="flex flex-col items-center text-center gap-2 px-6 py-16">
      <div className="w-12 h-12 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-muted-foreground/50">
        {icon}
      </div>
      <p className="text-sm font-semibold">{title}</p>
      <p className="text-xs text-muted-foreground/60 max-w-[240px]">{description}</p>
    </div>
  )
}
