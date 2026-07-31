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
  generationRequestsPerWindow: 20,
  transcriptionRequestsPerWindow: 10,
  requestWindowMs: 10 * 60 * 1000,
  /** Max task suggestions returned from a single parse request. */
  maxSuggestions: 20,
  /** Upstream provider timeout (ms) for a single request. */
  providerTimeoutMs: 30_000,
} as const

/**
 * Client-safe limits for the "Ask SVC Directory" assistant.
 *
 * Kept independent from `OUTLOOK_AI_LIMITS` so the two AI features have separate
 * budgets, prompts and payload caps. A Directory question is short and the model
 * only ever sees a tiny, pre-retrieved set of records (never the whole index),
 * so the caps here are deliberately small.
 */
export const DIRECTORY_AI_LIMITS = {
  /** Max characters accepted for a single question or transcript. */
  maxQuestionChars: 400,
  /** Max records referenced in a single answer / carried in a refinement. */
  maxRecords: 10,
  /** Per-record text budget (name/role/description) sent to the model. */
  maxRecordChars: 600,
  /** Tool-loop budget: bounded rounds and bounded records per call. */
  maxToolRounds: 3,
  maxRecordsPerTool: 12,
  /** Total records handed to the model across every tool call in one question. */
  maxTotalRecords: 24,
  maxNotesPerTool: 5,
  maxNoteChars: 400,
  /** Max characters retained from the previous answer during a refinement. */
  maxSummaryChars: 600,
  /** Upper bound on completion tokens → keeps answers to ~150–250 words. */
  maxAnswerTokens: 500,
  /** Max lightweight refinements allowed on a single question. */
  maxRefinements: 2,
  /** Max audio payload accepted by the transcription endpoint (bytes). */
  maxAudioBytes: 8 * 1024 * 1024,
  /** A spoken question is short; cap the recorder well below the outlook cap. */
  maxAudioSeconds: 60,
  /** Per-user rolling application limits. Enforced transactionally server-side. */
  askRequestsPerWindow: 30,
  transcriptionRequestsPerWindow: 15,
  requestWindowMs: 10 * 60 * 1000,
  /** Upstream provider timeout (ms) for a single request. */
  providerTimeoutMs: 30_000,
} as const

/**
 * Client-safe limits for Quest Coral's "Ask AI" and "AI Project Brief".
 *
 * The question is always answered from a small, already-loaded slice of data
 * the client sends along (one project + its updates, or the caller's own
 * project list for the portfolio-wide question) — never a server-side
 * retrieval step. Caps here bound both the question and the payload describing
 * that project data.
 */
export const QUEST_CORAL_AI_LIMITS = {
  /** Max characters accepted for a single question. */
  maxQuestionChars: 400,
  /** Max updates (of one project, or across the portfolio) sent per request. */
  maxUpdates: 40,
  /** Max projects sent for a portfolio-wide question. */
  maxPortfolioProjects: 40,
  /** Per-field text budget on project/update fields sent to the model. */
  maxFieldChars: 600,
  /** Full human-authored Markdown brief allowed for one project. */
  maxContextChars: 12_000,
  /** Bounds portfolio prompts even when several projects have full briefs. */
  maxPortfolioContextChars: 40_000,
  /** Upper bound on completion tokens for an answer. */
  maxAnswerTokens: 500,
  /** Per-user rolling application limits. Enforced transactionally server-side. */
  askRequestsPerWindow: 30,
  requestWindowMs: 10 * 60 * 1000,
  /** Upstream provider timeout (ms) for a single request. */
  providerTimeoutMs: 30_000,
} as const
