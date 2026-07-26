"use client"

/**
 * Request information — a full screen, not a sheet: choosing what's missing
 * and writing the message is a task, not a confirmation.
 *
 * Picking items rewrites the message automatically, but stops as soon as the
 * reviewer types: their words always win.
 */

import { useMemo, useState } from "react"
import { ArrowLeft, Check, Copy, Link2, Send } from "lucide-react"
import { cn } from "@/lib/utils"
import { AppsButton, StatusPill } from "@/components/applications/ui/apps-primitives"
import { AppsTextarea } from "@/components/applications/ui/apps-form"
import { generateLinkToken, issueApplicationLink } from "@/features/applications/candidate-links"
import { APPLICATIONS_BACKEND_ENABLED } from "@/lib/applications-flags"
import { saveApplicationLink } from "@/lib/applications-writes"
import {
  REQUEST_MESSAGE_MAX,
  applicationLinkUrl,
  composeRequestMessage,
  createApplicationLink,
  describeLinkExpiry,
  requestableItems,
  type ApplicationSectionId,
  type CandidateApplication,
} from "@/lib/applications-core"

/** Which step a requested item belongs to — decides where the link lands. */
const ITEM_STEP: Record<string, ApplicationSectionId> = {
  "intro-video": "video",
  resume: "general",
  "work-reference": "general",
}

const STEP_LABEL: Record<ApplicationSectionId, string> = {
  general: "the application form",
  video: "the intro video",
  documents: "the documents step",
}

function stepForItems(itemIds: string[]): ApplicationSectionId {
  const first = itemIds[0]
  if (!first) return "documents"
  return ITEM_STEP[first] ?? "documents"
}

interface RequestInfoScreenProps {
  application: CandidateApplication
  onClose: () => void
  onSend: (message: string) => Promise<boolean>
}

export function RequestInfoScreen({ application, onClose, onSend }: RequestInfoScreenProps) {
  const items = useMemo(() => requestableItems(application), [application])
  const preselected = useMemo(() => items.filter((item) => item.missing).map((item) => item.id), [items])
  const [selected, setSelected] = useState<string[]>(preselected)

  // The direct link always follows the final selection. In live mode it stays
  // local until Send is confirmed, so cancelling this screen leaves no active
  // credential behind.
  const targetStep = stepForItems(selected)
  const link = useMemo(
    () => {
      const input = { applicationId: application.id, purpose: "step" as const, step: targetStep }
      return APPLICATIONS_BACKEND_ENABLED
        ? createApplicationLink({ ...input, token: generateLinkToken() })
        : issueApplicationLink(input)
    },
    [application.id, targetStep],
  )
  const origin = typeof window !== "undefined" ? window.location.origin : ""
  const url = applicationLinkUrl(link.token, origin)

  const [message, setMessage] = useState(() =>
    composeRequestMessage(
      application.candidateName,
      items.filter((item) => item.missing).map((item) => item.label),
      url,
    ),
  )
  const [edited, setEdited] = useState(false)
  const [copied, setCopied] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [linkError, setLinkError] = useState<string | null>(null)

  const selectedLabels = items.filter((item) => selected.includes(item.id)).map((item) => item.label)

  const toggle = (id: string) => {
    const next = selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id]
    setSelected(next)
    if (!edited) {
      setMessage(
        composeRequestMessage(
          application.candidateName,
          items.filter((item) => next.includes(item.id)).map((item) => item.label),
          url,
        ),
      )
    }
  }

  const canSend = selected.length > 0 && message.trim().length > 0

  const copyMessage = () => {
    navigator.clipboard?.writeText(message).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  const send = async () => {
    if (!canSend || isSending) return
    setIsSending(true)
    setLinkError(null)
    if (APPLICATIONS_BACKEND_ENABLED) {
      try {
        await saveApplicationLink(link)
      } catch {
        setIsSending(false)
        setLinkError("The secure link couldn't be created. Please try again.")
        return
      }
    }

    // An edited message may still contain the preview URL from a previous
    // selection. Replace it with the final link, or append one if it was
    // removed, so the candidate always lands on the selected step.
    const trimmedMessage = message.trim()
    const messageHasLink = /https?:\/\/\S+\/?\?apply=\S+/.test(trimmedMessage)
    const finalMessage = messageHasLink
      ? trimmedMessage.replace(/https?:\/\/\S+\/?\?apply=\S+/g, url)
      : `${trimmedMessage}\n\n${url}`
    const sent = await onSend(finalMessage)
    setIsSending(false)
    if (sent) onClose()
  }

  return (
    <div className="applications-canvas absolute inset-0 z-30 flex flex-col overflow-hidden">
      <header className="applications-topbar app-topbar flex shrink-0 items-center justify-between gap-2 border-b px-4">
        <button
          type="button"
          onClick={onClose}
          className="applications-tap -ml-1.5 flex h-9 w-9 items-center justify-center rounded-full text-[var(--apps-text)] hover:bg-[var(--apps-surface-2)]"
          aria-label="Cancel request"
        >
          <ArrowLeft className="h-5 w-5" strokeWidth={2} />
        </button>
        <span className="truncate text-[0.9375rem] font-bold text-[var(--apps-blue)]">Request information</span>
        <span className="h-9 w-9" aria-hidden="true" />
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-hide">
        <div className="applications-step-enter mx-auto w-full max-w-xl px-5 pb-8 pt-4 md:px-6">
          <p className="text-[0.9375rem] leading-relaxed text-[var(--apps-text-muted)]">
            Choose what the candidate still needs.
          </p>

          <ul className="mt-4 flex flex-col gap-2">
            {items.map((item) => {
              const checked = selected.includes(item.id)
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => toggle(item.id)}
                    aria-pressed={checked}
                    className={cn(
                      "applications-tap flex min-h-[3.5rem] w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left",
                      checked
                        ? "border-[#BFDBFE] bg-[var(--apps-blue-soft)]/45"
                        : "border-[var(--apps-border)] bg-[var(--apps-surface)]",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-5 w-5 shrink-0 items-center justify-center rounded-[0.375rem] border",
                        checked
                          ? "border-transparent bg-[var(--apps-blue)] text-white"
                          : "border-[#C3D4E6] bg-[var(--apps-surface)]",
                      )}
                    >
                      {checked && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-[var(--apps-text)]">{item.label}</span>
                      <span
                        className={cn(
                          "mt-0.5 block text-xs font-medium",
                          item.requirement === "Required" ? "text-[var(--apps-text-muted)]" : "text-[var(--apps-text-muted)]",
                        )}
                      >
                        {item.requirement}
                      </span>
                    </span>
                    {item.missing && <StatusPill label="Missing" tone="missing" />}
                  </button>
                </li>
              )
            })}
          </ul>

          <div className="mt-5">
            <label htmlFor="request-message" className="mb-1.5 block px-1 text-[0.8125rem] font-semibold text-[var(--apps-text)]">
              Message to candidate
            </label>
            <AppsTextarea
              id="request-message"
              value={message}
              onChange={(value) => {
                setMessage(value)
                setEdited(true)
              }}
              rows={5}
              maxLength={REQUEST_MESSAGE_MAX}
              placeholder="What do you need from the candidate?"
            />
            {!edited && selectedLabels.length > 0 && (
              <p className="mt-1.5 px-1 text-xs text-[var(--apps-text-muted)]">
                Written for you from the items above — edit it if you want.
              </p>
            )}
          </div>

          {/* The link opens the exact step, so the candidate never restarts. */}
          <div className="mt-4 rounded-2xl border border-[#BFDBFE] bg-[var(--apps-blue-soft)]/45 p-4">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--apps-surface)] text-[var(--apps-blue-strong)]">
                <Link2 className="h-4 w-4" strokeWidth={2} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[0.8125rem] font-semibold text-[var(--apps-text)]">Direct link ready</p>
                <p className="mt-0.5 text-xs leading-snug text-[var(--apps-text-muted)]">
                  Opens straight at {STEP_LABEL[link.step ?? "documents"]} — no app, no restart.
                </p>
              </div>
              <StatusPill label={canSend ? "Ready to send" : "Pick an item"} tone={canSend ? "complete" : "neutral"} />
            </div>
            <div className="mt-3 flex items-center gap-2 rounded-xl bg-[var(--apps-surface)] px-3 py-2">
              <p className="min-w-0 flex-1 truncate font-mono text-[0.6875rem] text-[var(--apps-text)]">{url}</p>
              <span className="shrink-0 text-[0.625rem] font-semibold text-[var(--apps-text-muted)]">
                {describeLinkExpiry(link)}
              </span>
            </div>
          </div>
          {linkError && (
            <p className="mt-3 rounded-xl border border-[#FBD0D0] bg-[var(--apps-missing-soft)] px-3.5 py-2.5 text-[0.8125rem] font-medium text-[#DC5A5A]">
              {linkError}
            </p>
          )}
        </div>
      </div>

      <div
        className="shrink-0 border-t border-[var(--apps-border)] bg-[var(--apps-surface)] px-5 pt-3.5 md:px-6"
        style={{ paddingBottom: "max(1rem, var(--sab))" }}
      >
        <div className="mx-auto flex w-full max-w-xl flex-col gap-2.5">
          <AppsButton
            fullWidth
            disabled={!canSend || isSending}
            onClick={send}
            icon={<Send className="h-4 w-4" strokeWidth={2} />}
          >
            {isSending ? "Sending…" : "Send link"}
          </AppsButton>
          <AppsButton
            variant="secondary"
            fullWidth
            onClick={copyMessage}
            icon={copied ? <Check className="h-4 w-4" strokeWidth={2.5} /> : <Copy className="h-4 w-4" strokeWidth={2} />}
          >
            {copied ? "Copied" : "Copy message"}
          </AppsButton>
        </div>
      </div>
    </div>
  )
}
