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

import { BYE_BYE_DPR_AI_LIMITS, DIRECTORY_AI_LIMITS, OUTLOOK_AI_LIMITS, QUEST_CORAL_AI_LIMITS } from "@/lib/ai/config-public"

export type OutlookAiMode = "mock" | "live"
/** Shared alias — both AI features use the same mock/live semantics. */
export type AiMode = OutlookAiMode

/** Default models. Overridable per-environment without touching code. */
const DEFAULT_TRANSCRIBE_MODEL = "gpt-4o-mini-transcribe"
const DEFAULT_PARSE_MODEL = "gpt-5-mini"
const DEFAULT_ASK_MODEL = "gpt-5-mini"
const DEFAULT_EMBED_MODEL = "text-embedding-3-small"

// Re-export the client-safe limits so server code has one import site.
export { OUTLOOK_AI_LIMITS, DIRECTORY_AI_LIMITS, QUEST_CORAL_AI_LIMITS, BYE_BYE_DPR_AI_LIMITS }

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

export interface DirectoryAiConfig {
  mode: AiMode
  apiKey: string | null
  askModel: string
  transcribeModel: string
  /** Embedding model used for semantic note retrieval. */
  embedModel: string
  baseUrl: string
}

/**
 * Resolve the "Ask SVC Directory" config at request time. Mirrors
 * `getOutlookAiConfig()` and deliberately reuses the same `OPENAI_API_KEY`
 * secret + base URL, but keeps its own mode flag and model env so the Directory
 * assistant can be tuned (or forced to mock) independently of the Outlook flow.
 */
export function getDirectoryAiConfig(): DirectoryAiConfig {
  if (typeof window !== "undefined") {
    throw new Error("getDirectoryAiConfig() must only run on the server.")
  }
  const apiKey = (process.env.OPENAI_API_KEY ?? "").trim() || null
  const raw = (process.env.DIRECTORY_AI_MODE ?? "").trim().toLowerCase()
  const mode: AiMode = raw === "mock" ? "mock" : raw === "live" ? "live" : apiKey ? "live" : "mock"
  return {
    mode,
    apiKey,
    askModel: (process.env.DIRECTORY_AI_ASK_MODEL ?? "").trim() || DEFAULT_ASK_MODEL,
    transcribeModel: (process.env.DIRECTORY_AI_TRANSCRIBE_MODEL ?? "").trim() || DEFAULT_TRANSCRIBE_MODEL,
    embedModel: (process.env.DIRECTORY_AI_EMBED_MODEL ?? "").trim() || DEFAULT_EMBED_MODEL,
    baseUrl: (process.env.OPENAI_BASE_URL ?? "").trim() || "https://api.openai.com/v1",
  }
}

export interface QuestCoralAiConfig {
  mode: AiMode
  apiKey: string | null
  askModel: string
  baseUrl: string
}

/**
 * Resolve the Quest Coral "Ask AI" / "AI Project Brief" config at request time.
 * Mirrors `getDirectoryAiConfig()` and reuses the same `OPENAI_API_KEY` secret +
 * base URL, but keeps its own mode flag and model env so Quest Coral can be
 * tuned (or forced to mock) independently of Outlook and Directory.
 *
 * Quest Coral needs no embedding/transcription model: the question is always
 * bounded to a single project (or the caller's own project list) that the
 * client already holds in full, so there is no retrieval step and no voice
 * input in this feature.
 */
export function getQuestCoralAiConfig(): QuestCoralAiConfig {
  if (typeof window !== "undefined") {
    throw new Error("getQuestCoralAiConfig() must only run on the server.")
  }
  const apiKey = (process.env.OPENAI_API_KEY ?? "").trim() || null
  const raw = (process.env.QUEST_CORAL_AI_MODE ?? "").trim().toLowerCase()
  const mode: AiMode = raw === "mock" ? "mock" : raw === "live" ? "live" : apiKey ? "live" : "mock"
  return {
    mode,
    apiKey,
    askModel: (process.env.QUEST_CORAL_AI_ASK_MODEL ?? "").trim() || DEFAULT_ASK_MODEL,
    baseUrl: (process.env.OPENAI_BASE_URL ?? "").trim() || "https://api.openai.com/v1",
  }
}

export interface ByeByeDprAiConfig {
  mode: AiMode
  apiKey: string | null
  transcribeModel: string
  parseModel: string
  baseUrl: string
}

/**
 * Resolve the ByeByeDPR AI config (report transcription + free-text →
 * structured-fields parsing) at request time. Mirrors `getOutlookAiConfig()`
 * and reuses the same `OPENAI_API_KEY` secret + base URL, with its own mode
 * flag and model env so it can be tuned (or forced to mock) independently.
 */
export function getByeByeDprAiConfig(): ByeByeDprAiConfig {
  if (typeof window !== "undefined") {
    throw new Error("getByeByeDprAiConfig() must only run on the server.")
  }
  const apiKey = (process.env.OPENAI_API_KEY ?? "").trim() || null
  const raw = (process.env.BYEBYEDPR_AI_MODE ?? "").trim().toLowerCase()
  const mode: AiMode = raw === "mock" ? "mock" : raw === "live" ? "live" : apiKey ? "live" : "mock"
  return {
    mode,
    apiKey,
    transcribeModel: (process.env.BYEBYEDPR_AI_TRANSCRIBE_MODEL ?? "").trim() || DEFAULT_TRANSCRIBE_MODEL,
    parseModel: (process.env.BYEBYEDPR_AI_PARSE_MODEL ?? "").trim() || DEFAULT_PARSE_MODEL,
    baseUrl: (process.env.OPENAI_BASE_URL ?? "").trim() || "https://api.openai.com/v1",
  }
}

/**
 * True when a live provider call is actually possible (mode live + key present).
 *
 * Structural + generic so both `OutlookAiConfig` and `DirectoryAiConfig` (and any
 * future per-feature config) narrow to a variant with a non-null `apiKey`.
 */
export function canCallProvider<T extends { mode: AiMode; apiKey: string | null }>(
  config: T,
): config is T & { apiKey: string } {
  return config.mode === "live" && typeof config.apiKey === "string" && config.apiKey.length > 0
}
