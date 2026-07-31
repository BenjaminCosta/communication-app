/**
 * Client-safe feature flags for Quest Coral.
 *
 * `QUEST_CORAL_BACKEND_ENABLED` switches `use-quest-coral-dashboard.ts` between
 * the local-mock store and real Firestore (lib/quest-coral-writes.ts). It is
 * on in production (svc-comms) as of 2026-07-29 — see
 * docs/svc-quest-coral-module.md.
 *
 * `QUEST_CORAL_AI_ENABLED` independently gates whether "Ask AI about this
 * project" and the portfolio-wide "Ask AI" call the real `/api/quest-coral/ask`
 * route (billable OpenAI usage) or fall back to the local keyword-matched mock
 * answerer in `features/quest-coral/quest-coral-mock-ai.ts`. Off by default —
 * flip only once approved, same posture NEXT_PUBLIC_DIRECTORY_AI_ENABLED had
 * before Directory's Ask AI went live.
 */

function readBooleanFlag(value: string | undefined): boolean {
  return value === "true" || value === "1"
}

export const QUEST_CORAL_BACKEND_ENABLED = readBooleanFlag(process.env.NEXT_PUBLIC_QUEST_CORAL_BACKEND)
export const QUEST_CORAL_AI_ENABLED = readBooleanFlag(process.env.NEXT_PUBLIC_QUEST_CORAL_AI_ENABLED)
