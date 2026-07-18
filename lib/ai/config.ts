/**
 * Server-side AI configuration for the Outlook capture flow.
 *
 * This module is the single source of truth for provider models, safety limits
 * and — crucially — whether we run in `mock` or `live` mode. It must only ever be
 * imported from server code (API routes / server services) so the OpenAI key
 * can never leak into the client bundle. The runtime guard below fails loudly if
 * the key is ever read in a browser context.
 *
 * Mock mode is the default whenever no key is configured, which lets the entire
 * voice → transcript → parse → review UX be tested end to end before an API key
 * exists. Setting `OUTLOOK_AI_MODE=mock` forces mock even when a key is present.
 */

import { OUTLOOK_AI_LIMITS } from "@/lib/ai/config-public"

export type OutlookAiMode = "mock" | "live"

/** Default models. Overridable per-environment without touching code. */
const DEFAULT_TRANSCRIBE_MODEL = "gpt-4o-mini-transcribe"
const DEFAULT_PARSE_MODEL = "gpt-5-mini"

// Re-export the client-safe limits so server code has one import site.
export { OUTLOOK_AI_LIMITS }

function readMode(hasKey: boolean): OutlookAiMode {
  const raw = (process.env.OUTLOOK_AI_MODE ?? "").trim().toLowerCase()
  if (raw === "mock") return "mock"
  if (raw === "live") return "live"
  // No explicit mode: live only when a key is actually present.
  return hasKey ? "live" : "mock"
}

export interface OutlookAiConfig {
  mode: OutlookAiMode
  apiKey: string | null
  transcribeModel: string
  parseModel: string
  baseUrl: string
}

/**
 * Resolve the effective config at request time. Never cache the key across
 * requests; read env each call so rotating the secret does not require a redeploy
 * beyond what the platform already does.
 */
export function getOutlookAiConfig(): OutlookAiConfig {
  if (typeof window !== "undefined") {
    throw new Error("getOutlookAiConfig() must only run on the server.")
  }
  const apiKey = (process.env.OPENAI_API_KEY ?? "").trim() || null
  const mode = readMode(Boolean(apiKey))
  return {
    mode,
    apiKey,
    transcribeModel: (process.env.OUTLOOK_AI_TRANSCRIBE_MODEL ?? "").trim() || DEFAULT_TRANSCRIBE_MODEL,
    parseModel: (process.env.OUTLOOK_AI_PARSE_MODEL ?? "").trim() || DEFAULT_PARSE_MODEL,
    baseUrl: (process.env.OPENAI_BASE_URL ?? "").trim() || "https://api.openai.com/v1",
  }
}

/** True when a live provider call is actually possible (mode live + key present). */
export function canCallProvider(config: OutlookAiConfig): config is OutlookAiConfig & { apiKey: string } {
  return config.mode === "live" && typeof config.apiKey === "string" && config.apiKey.length > 0
}
