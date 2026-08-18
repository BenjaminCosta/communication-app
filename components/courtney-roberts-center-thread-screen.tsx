"use client"

import { useEffect, useState } from "react"
import { ArrowLeft, Lock, MessageCircleOff, Paperclip } from "lucide-react"
import { cn, getUserAvatarColor } from "@/lib/utils"
import { deriveInitials } from "@/lib/store"
import { fetchCourtneyRobertsCenterThread, CourtneyRobertsCenterClientError } from "@/lib/courtney-roberts-center/client"
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
  const time = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
  if (date.toDateString() === now.toDateString()) return time
  return `${date.toLocaleDateString("en-US", { month: "short", day: "numeric" })} · ${time}`
}

export function CourtneyRobertsCenterThreadScreen({ conversationId, onBack, className }: CourtneyRobertsCenterThreadScreenProps) {
  const [data, setData] = useState<ThreadData | null>(null)
  const [errorStatus, setErrorStatus] = useState<number | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setData(null)
    setErrorStatus(null)
    setErrorMessage(null)
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
        </div>
      </div>

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
        {isAssistant && <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-400/80 mb-0.5">Courtney</p>}
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
