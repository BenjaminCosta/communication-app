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

const ISSUE_KEYWORDS = ["delay", "delayed", "wait", "waiting", "issue", "problem", "blocked", "short", "shortage"]
const NEXT_STEPS_KEYWORDS = ["tomorrow", "next", "plan is", "will start", "will finish"]
const ATTENDANCE_KEYWORDS = ["everyone was", "was on site", "called in sick", "absent", "present", "no show", "off site"]

/**
 * Deterministic, dependency-free stand-in for the live parser — runs in mock
 * mode (no API key) so the draft -> structure -> review flow works offline.
 * Splits the text into sentences and buckets each one by simple keyword
 * matching; never invents content, so anything unmatched lands in
 * additionalNotes rather than being dropped.
 */
function mockStructureDailyReport(text: string): DailyReportStructuredDataInput {
  const sentences = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)

  const buckets: Record<keyof DailyReportStructuredDataInput, string[]> = {
    workCompleted: [],
    issuesOrDelays: [],
    attendanceNotes: [],
    nextSteps: [],
    additionalNotes: [],
  }

  for (const sentence of sentences) {
    const lower = sentence.toLowerCase()
    if (ATTENDANCE_KEYWORDS.some((word) => lower.includes(word))) {
      buckets.attendanceNotes.push(sentence)
    } else if (ISSUE_KEYWORDS.some((word) => lower.includes(word))) {
      buckets.issuesOrDelays.push(sentence)
    } else if (NEXT_STEPS_KEYWORDS.some((word) => lower.includes(word))) {
      buckets.nextSteps.push(sentence)
    } else {
      buckets.workCompleted.push(sentence)
    }
  }

  const join = (parts: string[]): string | null => (parts.length > 0 ? parts.join(" ") : null)
  return {
    workCompleted: join(buckets.workCompleted),
    issuesOrDelays: join(buckets.issuesOrDelays),
    attendanceNotes: join(buckets.attendanceNotes),
    nextSteps: join(buckets.nextSteps),
    additionalNotes: join(buckets.additionalNotes),
  }
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
  return { structuredData: parsed.data, mode: "live" }
}
