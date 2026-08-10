import type { StructuredJsonSchema } from "@/lib/ai/openai/client"

/**
 * Prompt + strict JSON schema for turning a field crew's free-text/dictated
 * update into the three optional daily-report fields. The model only ever
 * classifies exact excerpts from the text — it never invents or paraphrases
 * progress, decisions, dates or names.
 */
export const DAILY_REPORT_SYSTEM_PROMPT = [
  "You convert a construction field update (typed or transcribed from voice) into a structured daily report.",
  "Extract into exactly these fields: workCompleted, issuesOrDelays, nextSteps.",
  "Rules:",
  "- Each non-null value must be an exact, contiguous excerpt copied from the input text. Never paraphrase, infer, merge, or add information.",
  "- If a field has nothing relevant in the text, set it to null. Do not put unrelated information in a field.",
  "- Preserve names, materials, locations, quantities, and dates exactly as stated.",
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
    required: ["workCompleted", "issuesOrDelays", "nextSteps"],
    properties: {
      workCompleted: { type: ["string", "null"] },
      issuesOrDelays: { type: ["string", "null"] },
      nextSteps: { type: ["string", "null"] },
    },
  },
}
