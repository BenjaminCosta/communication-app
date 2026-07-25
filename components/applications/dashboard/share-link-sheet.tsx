"use client"

/**
 * Share a secure link.
 *
 * One sheet for the three purposes. The native share menu covers SMS,
 * WhatsApp, mail and anything else the phone has installed, so there is one
 * primary action instead of four buttons; copy is the desktop fallback.
 */

import { useState } from "react"
import { Check, Copy, Link2, MessageCircle, RefreshCw, Share2, ShieldOff } from "lucide-react"
import { cn } from "@/lib/utils"
import { AppsSheet } from "@/components/applications/ui/apps-sheet"
import { AppsButton, StatusPill } from "@/components/applications/ui/apps-primitives"
import {
  LINK_PURPOSE_META,
  applicationLinkUrl,
  describeLinkExpiry,
  linkState,
  type ApplicationLink,
} from "@/lib/applications-core"

interface ShareLinkSheetProps {
  open: boolean
  link: ApplicationLink | null
  /** Live mode issues the link asynchronously; set while there is no link yet. */
  error?: string | null
  candidateName?: string
  jobName?: string
  onClose: () => void
  onRegenerate: () => void
  onRevoke: () => void
}

function shareMessage(link: ApplicationLink, url: string, candidateName?: string, jobName?: string): string {
  const greeting = candidateName?.trim() ? `Hi ${candidateName.trim().split(/\s+/)[0]}, ` : ""
  if (link.purpose === "agreement") {
    return `${greeting}your operating agreement is ready to sign:\n${url}`
  }
  if (link.purpose === "step") {
    return `${greeting}here's the link to finish the missing item:\n${url}`
  }
  const forJob = jobName ? ` for ${jobName}` : ""
  return `${greeting}here's your SVC application link${forJob}:\n${url}`
}

export function ShareLinkSheet({
  open,
  link,
  error = null,
  candidateName,
  jobName,
  onClose,
  onRegenerate,
  onRevoke,
}: ShareLinkSheetProps) {
  const [copied, setCopied] = useState(false)

  // Live mode creates the link asynchronously — show a status until it lands.
  if (!link) {
    if (!open) return null
    return (
      <AppsSheet open={open} title="Secure link" onClose={onClose}>
        {error ? (
          <p className="rounded-xl border border-[#FBD0D0] bg-[var(--apps-missing-soft)] px-3.5 py-3 text-[0.8125rem] font-medium text-[#DC5A5A]">
            {error}
          </p>
        ) : (
          <div className="flex items-center gap-3 py-4 text-[var(--apps-text-muted)]">
            <span
              className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--apps-blue-soft)] border-t-[var(--apps-blue)]"
              aria-hidden="true"
            />
            <span className="text-[0.875rem] font-medium">Creating a secure link…</span>
          </div>
        )}
      </AppsSheet>
    )
  }

  const origin = typeof window !== "undefined" ? window.location.origin : ""
  const url = applicationLinkUrl(link.token, origin)
  const state = linkState(link)
  const meta = LINK_PURPOSE_META[link.purpose]
  const message = shareMessage(link, url, candidateName, jobName)

  const copy = () => {
    navigator.clipboard?.writeText(url).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  const share = async () => {
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title: "SVC Applications", text: message, url })
        return
      } catch {
        // Cancelled or unsupported — fall through to copying.
      }
    }
    copy()
  }

  const shareBySms = () => {
    if (typeof window === "undefined") return
    window.location.href = `sms:?&body=${encodeURIComponent(message)}`
  }

  const shareByWhatsApp = () => {
    if (typeof window === "undefined") return
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer")
  }

  return (
    <AppsSheet
      open={open}
      title={meta.label}
      description={meta.description}
      onClose={onClose}
      footer={
        <AppsButton
          fullWidth
          disabled={state !== "active"}
          onClick={share}
          icon={<Share2 className="h-4 w-4" strokeWidth={2} />}
        >
          Share with other apps
        </AppsButton>
      }
    >
      <div
        className={cn(
          "flex items-center gap-3 rounded-2xl border p-4",
          state === "active" ? "border-[#BFDBFE] bg-[var(--apps-blue-soft)]/45" : "border-[var(--apps-border)] bg-[var(--apps-surface-2)]",
        )}
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--apps-surface)] text-[var(--apps-blue-strong)]">
          <Link2 className="h-4 w-4" strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-[0.75rem] text-[var(--apps-text)]">{url}</p>
          <p className="mt-0.5 text-xs text-[var(--apps-text-muted)]">{describeLinkExpiry(link)}</p>
        </div>
        <StatusPill
          label={state === "active" ? "Active" : state === "expired" ? "Expired" : "Revoked"}
          tone={state === "active" ? "complete" : state === "expired" ? "pending" : "missing"}
        />
      </div>

      <p className="mt-3 px-1 text-xs leading-relaxed text-[var(--apps-text-muted)]">
        The candidate does not need an account or an app — the link opens straight into the form on their phone.
      </p>

      <div className="mt-4 overflow-hidden rounded-2xl border border-[var(--apps-border)]">
        <button
          type="button"
          disabled={state !== "active"}
          onClick={shareBySms}
          className="applications-tap flex min-h-[3.5rem] w-full items-center gap-3 border-b border-[var(--apps-border)] px-3.5 text-left hover:bg-[var(--apps-surface-2)] disabled:opacity-45"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--apps-blue-soft)] text-[var(--apps-blue-strong)]">
            <MessageCircle className="h-4 w-4" strokeWidth={2} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-[var(--apps-text)]">Share by text message</span>
            <span className="mt-0.5 block text-xs text-[var(--apps-text-muted)]">Open SMS with the secure link included.</span>
          </span>
        </button>
        <button
          type="button"
          disabled={state !== "active"}
          onClick={shareByWhatsApp}
          className="applications-tap flex min-h-[3.5rem] w-full items-center gap-3 border-b border-[var(--apps-border)] px-3.5 text-left hover:bg-[var(--apps-surface-2)] disabled:opacity-45"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--apps-complete-soft)] text-[#15803D]">
            <MessageCircle className="h-4 w-4" strokeWidth={2} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-[var(--apps-text)]">Share via WhatsApp</span>
            <span className="mt-0.5 block text-xs text-[var(--apps-text-muted)]">Open WhatsApp with the secure link included.</span>
          </span>
        </button>
        <button
          type="button"
          disabled={state !== "active"}
          onClick={copy}
          className="applications-tap flex min-h-[3.5rem] w-full items-center gap-3 px-3.5 text-left hover:bg-[var(--apps-surface-2)] disabled:opacity-45"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--apps-surface-2)] text-[var(--apps-text-muted)]">
            {copied ? <Check className="h-4 w-4" strokeWidth={2.5} /> : <Copy className="h-4 w-4" strokeWidth={2} />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-[var(--apps-text)]">{copied ? "Link copied" : "Copy link"}</span>
            <span className="mt-0.5 block text-xs text-[var(--apps-text-muted)]">Paste it in any message or email.</span>
          </span>
        </button>
      </div>

      <div className="mt-4 flex gap-2">
        <AppsButton variant="secondary" size="md" onClick={onRegenerate} icon={<RefreshCw className="h-4 w-4" strokeWidth={2} />}>
          Regenerate
        </AppsButton>
        <AppsButton
          variant="ghost"
          size="md"
          disabled={state !== "active"}
          onClick={onRevoke}
          icon={<ShieldOff className="h-4 w-4" strokeWidth={2} />}
        >
          Revoke
        </AppsButton>
      </div>

      <div className="mt-4 rounded-xl bg-[var(--apps-surface-2)] px-3.5 py-3">
        <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-[var(--apps-text-muted)]">
          Message preview
        </p>
        <p className="mt-1.5 whitespace-pre-line break-words text-[0.8125rem] leading-relaxed text-[var(--apps-text)]">
          {message}
        </p>
      </div>
    </AppsSheet>
  )
}
