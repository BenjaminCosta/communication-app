/**
 * Client-safe feature flags for the Outlook AI capture flow.
 *
 * These only gate UI visibility. They must never expose provider keys — every
 * live provider call happens server-side behind the `/api/outlooks/*` routes.
 * When these flags are off, the Outlook keeps working with manual typing only.
 *
 * Both flags read `NEXT_PUBLIC_*` env vars so they are inlined into the client
 * bundle at build time. Enable them locally to exercise the full mock UX
 * without any real API key (the server auto-selects mock responses).
 */

function readBooleanFlag(value: string | undefined): boolean {
  return value === "true" || value === "1"
}

/** Show the natural-language / AI task capture entry point in the Outlook. */
export const OUTLOOK_AI_ENABLED = readBooleanFlag(process.env.NEXT_PUBLIC_OUTLOOK_AI_ENABLED)

/**
 * Show the microphone / voice recording control inside the AI capture flow.
 * Voice is additive: it is just another way to produce the same editable text
 * that the parser consumes, so it can be toggled independently of AI parsing.
 */
export const OUTLOOK_VOICE_ENABLED =
  OUTLOOK_AI_ENABLED && readBooleanFlag(process.env.NEXT_PUBLIC_OUTLOOK_VOICE_ENABLED)
