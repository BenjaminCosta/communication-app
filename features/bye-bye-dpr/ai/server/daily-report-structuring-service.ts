import { BYE_BYE_DPR_AI_LIMITS, canCallProvider, getByeByeDprAiConfig } from "@/lib/ai/config"
import { AiError } from "@/lib/ai/errors"
import { createStructuredJson } from "@/lib/ai/openai/client"
import type { OutlookAiOperation } from "@/lib/ai/server/safe-log"
import { dailyReportStructuredDataSchema, type DailyReportStructuredDataInput } from "@/features/bye-bye-dpr/contracts/report-contract"
import {
  buildDailyReportUserPrompt,
  DAILY_REPORT_JSON_SCHEMA,
  DAILY_REPORT_SYSTEM_PROMPT,
} from "@/features/bye-bye-dpr/ai/server/daily-report-prompt"

export interface StructureDailyReportResponse {
  structuredData: DailyReportStructuredDataInput
  mode: "mock" | "live"
}

const WORK_KEYWORDS = ["built", "completed", "finished", "framed", "installed", "poured", "ran", "started", "worked"]
const ISSUE_KEYWORDS = ["delay", "delayed", "wait", "waiting", "issue", "problem", "blocked", "short", "shortage"]
const NEXT_STEPS_KEYWORDS = ["tomorrow", "next", "plan is", "will start", "will finish"]

/**
 * Deterministic, dependency-free stand-in for the live parser — runs in mock
 * mode (no API key) so the optional organization step works offline. It only
 * copies source sentences into a field; text that does not belong to one of
 * the three requested fields stays in the editable original note.
 */
function mockStructureDailyReport(text: string): DailyReportStructuredDataInput {
  const sentences = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)

  const buckets: Record<keyof DailyReportStructuredDataInput, string[]> = {
    workCompleted: [],
    issuesOrDelays: [],
    nextSteps: [],
  }

  for (const sentence of sentences) {
    const lower = sentence.toLowerCase()
    if (ISSUE_KEYWORDS.some((word) => lower.includes(word))) {
      buckets.issuesOrDelays.push(sentence)
    } else if (NEXT_STEPS_KEYWORDS.some((word) => lower.includes(word))) {
      buckets.nextSteps.push(sentence)
    } else if (WORK_KEYWORDS.some((word) => lower.includes(word))) {
      buckets.workCompleted.push(sentence)
    }
  }

  const join = (parts: string[]): string | null => (parts.length > 0 ? parts.join(" ") : null)
  return {
    workCompleted: join(buckets.workCompleted),
    issuesOrDelays: join(buckets.issuesOrDelays),
    nextSteps: join(buckets.nextSteps),
  }
}

/**
 * The optional organizer is an extractor, not a summarizer. Reject any model
 * output that is not copied directly from the user-provided source text.
 */
function isVerbatimExcerpt(value: string | null, source: string): boolean {
  if (value === null) return true
  const normalized = (text: string) => text.replace(/\s+/g, " ").trim()
  return normalized(source).includes(normalized(value))
}

/**
 * Turn free text (typed or transcribed) into the 5 structured daily-report
 * fields. Never writes Firestore — the caller merges the result into the
 * draft, and the user can edit anything before submitting.
 */
export async function structureDailyReportDraft(
  text: string,
  trace?: { operation: OutlookAiOperation; requestId: string },
): Promise<StructureDailyReportResponse> {
  const config = getByeByeDprAiConfig()

  if (!canCallProvider(config)) {
    return { structuredData: mockStructureDailyReport(text), mode: "mock" }
  }

  const raw = await createStructuredJson(
    {
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      timeoutMs: BYE_BYE_DPR_AI_LIMITS.providerTimeoutMs,
      trace,
    },
    {
      model: config.parseModel,
      system: DAILY_REPORT_SYSTEM_PROMPT,
      user: buildDailyReportUserPrompt(text),
      schema: DAILY_REPORT_JSON_SCHEMA,
      reasoningEffort: config.parseModel.startsWith("gpt-5") ? "minimal" : undefined,
      verbosity: config.parseModel.startsWith("gpt-5") ? "low" : undefined,
    },
  )

  const parsed = dailyReportStructuredDataSchema.safeParse(raw)
  if (!parsed.success) {
    throw new AiError("invalid-output", "The report parser returned data that failed validation.")
  }
  if (!Object.values(parsed.data).every((value) => isVerbatimExcerpt(value, text))) {
    throw new AiError("invalid-output", "The report organizer returned content that was not in the original note.")
  }
  return { structuredData: parsed.data, mode: "live" }
}
