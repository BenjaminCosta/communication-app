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

/**
 * Client-safe limits for the WhatsApp SVC AI Secretary's cross-module
 * orchestrator (Directory, Quest Coral, Applications, ByeByeDPR reports,
 * clocking, Outlooks). Kept independent from `DIRECTORY_AI_LIMITS` so the
 * two tool-calling assistants have separate budgets, even though Directory's
 * own tool set is reused inside this one. `maxToolRounds` and
 * `providerTimeoutMs` still respect the Vercel Hobby-plan `maxDuration = 60`
 * ceiling on the webhook route (`app/api/whatsapp/webhook/route.ts`), but are
 * no longer the most conservative values that fit — see the 2026-08-14 note
 * below for why they were loosened.
 */
export const WHATSAPP_SECRETARY_AI_LIMITS = {
  /** Tool-loop budget: bounded rounds and bounded records per call.
   * 4 (not 3, as of 2026-08-14): a genuinely multi-hop question (e.g. person
   * -> their jobs -> recent reports -> related project) can need one more
   * round than 3 allowed; tool-bearing rounds always run at
   * `reasoning_effort: "none"`, so this is cheap/fast to extend. */
  maxToolRounds: 4,
  /** 15 (not 12, as of 2026-08-14): a modest bump so a single tool call is
   * less likely to be the truncation point on a broad question. */
  maxRecordsPerTool: 15,
  /** Total records handed to the model across every tool call in one question.
   * 60 (not 40, as of 2026-08-14): real production usage has stayed well
   * under budget on tokens/cost, so this was raised again to reduce silent
   * truncation on rich multi-module questions — still a hard bound, not
   * unlimited. */
  maxTotalRecords: 60,
  /** Directory's note sub-budget for `directory_searchRelevantNotes`, matching Directory's own defaults. */
  maxNotesPerTool: 5,
  maxNoteChars: 400,
  /** Upper bound on completion tokens → keeps answers to ~150–250 words.
   * Already generous relative to the 700-character WhatsApp reply cap
   * (`MAX_REPLY_CHARACTERS` in `orchestrator.ts`), which is a UX choice
   * (scannable WhatsApp replies), not a cost cut — left unchanged. */
  maxAnswerTokens: 500,
  /** Per-user rolling application limits. Enforced transactionally server-side. */
  askRequestsPerWindow: 30,
  requestWindowMs: 10 * 60 * 1000,
  /** Upstream provider timeout (ms) for a single request. 45s (not 30s, as of
   * 2026-08-14): gives more headroom now that the final round runs at
   * `reasoning_effort: "medium"` instead of "low", while staying well under
   * the 60s Vercel function ceiling even with tool-round overhead on top —
   * live-tested latencies for "medium"/"high" stayed in the 1.5-7s range per
   * call, so this remains a comfortable margin, not a tight fit. */
  providerTimeoutMs: 45_000,
} as const

/**
 * Client-safe limits for ByeByeDPR (clock-in/out + daily reports): audio
 * transcription and free-text → structured-fields parsing. Kept independent
 * from the other features' budgets/collections.
 */
export const BYE_BYE_DPR_AI_LIMITS = {
  /** Max characters accepted for a single free-text report body / transcript. */
  maxTextChars: 4000,
  /** Max audio payload accepted by the transcription endpoint (bytes). */
  maxAudioBytes: 8 * 1024 * 1024,
  /** Max recording duration surfaced to the recorder UI (seconds) — a field update can run longer than a quick note. */
  maxAudioSeconds: 300,
  /** Per-user rolling application limits. Enforced transactionally server-side. */
  generationRequestsPerWindow: 20,
  transcriptionRequestsPerWindow: 10,
  requestWindowMs: 10 * 60 * 1000,
  /** Upstream provider timeout (ms) for a single request. */
  providerTimeoutMs: 30_000,
} as const
