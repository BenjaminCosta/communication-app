import type { QuestCoralTone } from "@/lib/quest-coral-core"

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

/** Same semantic vocabulary as Applications' TONE_STYLES — pending/missing/
 * complete/ai carry app-wide meaning, so Quest Coral reuses the same colors
 * rather than inventing new ones. Only "info" swaps blue for coral. */
export const TONE_STYLES: Record<QuestCoralTone, ToneStyle> = {
  neutral: {
    pill: "text-[var(--coral-text-muted)] bg-[var(--coral-surface-2)] border-[var(--coral-border)]",
    text: "text-[var(--coral-text-muted)]",
    solid: "bg-[var(--coral-text-muted)]",
    soft: "bg-[var(--coral-surface-2)]",
  },
  info: {
    pill: "text-[var(--coral-strong)] bg-[var(--coral-soft)] border-[#FFD2C2]",
    text: "text-[var(--coral-strong)]",
    solid: "bg-[var(--coral)]",
    soft: "bg-[var(--coral-soft)]",
  },
  pending: {
    pill: "text-[#B45309] bg-[var(--coral-pending-soft)] border-[#FDE68A]",
    text: "text-[#B45309]",
    solid: "bg-[var(--coral-pending)]",
    soft: "bg-[var(--coral-pending-soft)]",
  },
  missing: {
    pill: "text-[#DC5A5A] bg-[var(--coral-missing-soft)] border-[#FBD0D0]",
    text: "text-[#DC5A5A]",
    solid: "bg-[var(--coral-missing)]",
    soft: "bg-[var(--coral-missing-soft)]",
  },
  complete: {
    pill: "text-[#15803D] bg-[var(--coral-complete-soft)] border-[#BBF7D0]",
    text: "text-[#15803D]",
    solid: "bg-[var(--coral-complete)]",
    soft: "bg-[var(--coral-complete-soft)]",
  },
  ai: {
    pill: "text-[var(--coral-strong)] bg-[var(--coral-ai-soft)] border-[#FFD2C2]",
    text: "text-[var(--coral-strong)]",
    solid: "bg-[var(--coral-ai)]",
    soft: "bg-[var(--coral-ai-soft)]",
  },
}
