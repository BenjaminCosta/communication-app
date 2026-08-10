export type ByeByeDprTone = "neutral" | "info" | "pending" | "missing" | "complete" | "ai"

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

/**
 * Same app-wide semantic vocabulary as Applications/Quest Coral's
 * TONE_STYLES — pending/missing/complete carry app-wide meaning, so this
 * module reuses the same colors rather than inventing new ones. `info` swaps
 * to this module's sky-blue (location/links); `ai` keeps ByeByeDPR's own
 * purple identity rather than a second competing accent.
 */
export const TONE_STYLES: Record<ByeByeDprTone, ToneStyle> = {
  neutral: {
    pill: "text-[var(--bd-text-muted)] bg-[var(--bd-surface-2)] border-[var(--bd-border)]",
    text: "text-[var(--bd-text-muted)]",
    solid: "bg-[var(--bd-text-muted)]",
    soft: "bg-[var(--bd-surface-2)]",
  },
  info: {
    pill: "text-[#1D4ED8] bg-[var(--bd-sky-soft)] border-[#BFDBFE]",
    text: "text-[#1D4ED8]",
    solid: "bg-[var(--bd-sky)]",
    soft: "bg-[var(--bd-sky-soft)]",
  },
  pending: {
    pill: "text-[#B45309] bg-[var(--bd-pending-soft)] border-[#FDE68A]",
    text: "text-[#B45309]",
    solid: "bg-[var(--bd-pending)]",
    soft: "bg-[var(--bd-pending-soft)]",
  },
  missing: {
    pill: "text-[#DC5A5A] bg-[var(--bd-missing-soft)] border-[#FBD0D0]",
    text: "text-[#DC5A5A]",
    solid: "bg-[var(--bd-missing)]",
    soft: "bg-[var(--bd-missing-soft)]",
  },
  complete: {
    pill: "text-[#15803D] bg-[var(--bd-complete-soft)] border-[#BBF7D0]",
    text: "text-[#15803D]",
    solid: "bg-[var(--bd-complete)]",
    soft: "bg-[var(--bd-complete-soft)]",
  },
  ai: {
    pill: "text-[var(--bd-purple-strong)] bg-[var(--bd-ai-soft)] border-[#DDD6F5]",
    text: "text-[var(--bd-purple-strong)]",
    solid: "bg-[var(--bd-ai)]",
    soft: "bg-[var(--bd-ai-soft)]",
  },
}
