/**
 * Client-safe AI limits.
 *
 * These are plain constants with no secrets, so both the server config and
 * browser hooks can import them. Kept separate from `lib/ai/config.ts` (which
 * reads the provider key) so the client never pulls the key-reading module.
 */
export const OUTLOOK_AI_LIMITS = {
  /** Max characters accepted for a single free-text / transcript parse. */
  maxTextChars: 2000,
  /** Max audio payload accepted by the transcription endpoint (bytes). */
  maxAudioBytes: 8 * 1024 * 1024,
  /** Max recording duration surfaced to the recorder UI (seconds). */
  maxAudioSeconds: 180,
  /** Per-user rolling application limits. Enforced transactionally server-side. */
  generationRequestsPerWindow: 10,
  transcriptionRequestsPerWindow: 5,
  requestWindowMs: 10 * 60 * 1000,
  /** Max task suggestions returned from a single parse request. */
  maxSuggestions: 20,
  /** Upstream provider timeout (ms) for a single request. */
  providerTimeoutMs: 30_000,
} as const
