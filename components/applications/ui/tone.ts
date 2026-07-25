import type { ApplicationTone } from "@/lib/applications-core"

interface ToneStyle {
  /** Badge / pill: text + soft background + border in one string. */
  pill: string
  /** Text-only usage (helper lines, counters). */
  text: string
  /** Filled dot / icon chip background. */
  solid: string
  /** Soft background alone (icon squares, meters). */
  soft: string
}

export const TONE_STYLES: Record<ApplicationTone, ToneStyle> = {
  neutral: {
    pill: "text-[var(--apps-text-muted)] bg-[var(--apps-surface-2)] border-[var(--apps-border)]",
    text: "text-[var(--apps-text-muted)]",
    solid: "bg-[var(--apps-text-muted)]",
    soft: "bg-[var(--apps-surface-2)]",
  },
  info: {
    pill: "text-[var(--apps-blue-strong)] bg-[var(--apps-blue-soft)] border-[#BFDBFE]",
    text: "text-[var(--apps-blue-strong)]",
    solid: "bg-[var(--apps-blue)]",
    soft: "bg-[var(--apps-blue-soft)]",
  },
  pending: {
    pill: "text-[#B45309] bg-[var(--apps-pending-soft)] border-[#FDE68A]",
    text: "text-[#B45309]",
    solid: "bg-[var(--apps-pending)]",
    soft: "bg-[var(--apps-pending-soft)]",
  },
  missing: {
    pill: "text-[#DC5A5A] bg-[var(--apps-missing-soft)] border-[#FBD0D0]",
    text: "text-[#DC5A5A]",
    solid: "bg-[var(--apps-missing)]",
    soft: "bg-[var(--apps-missing-soft)]",
  },
  complete: {
    pill: "text-[#15803D] bg-[var(--apps-complete-soft)] border-[#BBF7D0]",
    text: "text-[#15803D]",
    solid: "bg-[var(--apps-complete)]",
    soft: "bg-[var(--apps-complete-soft)]",
  },
  ai: {
    pill: "text-[#6D3EE0] bg-[var(--apps-ai-soft)] border-[#E0D6FB]",
    text: "text-[#6D3EE0]",
    solid: "bg-[var(--apps-ai)]",
    soft: "bg-[var(--apps-ai-soft)]",
  },
}

/** Section states share the dashboard's tone vocabulary. */
export function toneForSectionState(state: "not_started" | "in_progress" | "complete"): ApplicationTone {
  if (state === "complete") return "complete"
  return state === "in_progress" ? "pending" : "missing"
}
