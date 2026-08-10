import type { StructuredJsonSchema } from "@/lib/ai/openai/client"

/**
 * Prompt + strict JSON schema for turning a field crew's free-text/dictated
 * update into the 5 fixed daily-report fields. The model only ever
 * structures what's already in the text — it never invents progress,
 * decisions, dates or names not present in the input.
 */
export const DAILY_REPORT_SYSTEM_PROMPT = [
  "You convert a construction field update (typed or transcribed from voice) into a structured daily report.",
  "Extract into exactly these fields: workCompleted, issuesOrDelays, attendanceNotes, nextSteps, additionalNotes.",
  "Rules:",
  "- Use only what is stated in the text. Never invent facts, dates, quantities or names.",
  "- If a field has nothing relevant in the text, set it to null. Do not pad a field with unrelated content.",
  "- attendanceNotes is only for mentions of who was on/off site — not general crew activity.",
  "- Keep each field concise: a short paragraph, not a transcript dump.",
  "- Preserve names, materials and locations exactly as stated.",
].join("\n")

export function buildDailyReportUserPrompt(text: string): string {
  return `Field update:\n${text}`
}

/** OpenAI strict json_schema: every property required, `additionalProperties:false`. */
export const DAILY_REPORT_JSON_SCHEMA: StructuredJsonSchema = {
  name: "daily_report_fields",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["workCompleted", "issuesOrDelays", "attendanceNotes", "nextSteps", "additionalNotes"],
    properties: {
      workCompleted: { type: ["string", "null"] },
      issuesOrDelays: { type: ["string", "null"] },
      attendanceNotes: { type: ["string", "null"] },
      nextSteps: { type: ["string", "null"] },
      additionalNotes: { type: ["string", "null"] },
    },
  },
}
