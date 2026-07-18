import { OUTLOOK_TASK_STATUSES } from "@/features/outlooks/ai/outlook-parser-contract"
import type { ParseOutlookContext } from "@/features/outlooks/ai/outlook-parser-contract"
import type { StructuredJsonSchema } from "@/lib/ai/openai/client"

/**
 * Prompt + strict JSON schema for the `gpt-5-mini` parser.
 *
 * The model returns *suggestions only*. It must not invent dates or durations,
 * must not emit `endDate` (the scheduler owns that), and must reference the
 * bounded company / task lists we provide rather than guessing new entities.
 */

export const OUTLOOK_PARSE_SYSTEM_PROMPT = [
  "You convert a construction supervisor's free-text or dictated notes into structured 3-week outlook task suggestions.",
  "You only propose data. You never schedule, never compute end dates, and never confirm anything.",
  "Rules:",
  "- Extract one suggestion per distinct planned activity.",
  "- Use ISO dates (YYYY-MM-DD). Resolve relative dates ('today', 'tomorrow', 'next Monday') against the provided current date.",
  "- If a date or duration is not clearly stated, set it to null. Never guess.",
  "- durationDays is a positive integer count of calendar days.",
  "- companyName must be copied verbatim from the provided company list when it clearly matches; otherwise return the spoken name and let review resolve it.",
  "- dependencyReference may be the title of another task (existing or a sibling suggestion) or a sibling clientSuggestionId. Use null when there is no dependency.",
  "- warnings is a short list of caveats for the reviewer.",
  "- Do not output endDate, ids beyond clientSuggestionId, or any field not in the schema.",
].join("\n")

const GENERIC_CONTEXT_WORDS = new Set([
  "and",
  "company",
  "construction",
  "contractor",
  "corp",
  "group",
  "inc",
  "llc",
  "services",
  "the",
  "compania",
  "construccion",
  "constructora",
  "grupo",
  "servicios",
])

function searchable(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

/**
 * The workspace can contain hundreds of companies/tasks, but only names that
 * overlap the note help extraction. Sending every option increases prompt
 * processing time and can distract the model with irrelevant candidates.
 */
function relevantToNote<T>(
  text: string,
  entries: T[],
  label: (entry: T) => string,
  limit = 24,
): T[] {
  const haystack = searchable(text)
  const noteTokens = new Set(haystack.split(" ").filter(Boolean))

  return entries
    .map((entry, index) => {
      const candidate = searchable(label(entry))
      if (!candidate) return { entry, index, score: 0 }
      if (` ${haystack} `.includes(` ${candidate} `)) {
        return { entry, index, score: 10_000 + candidate.length }
      }
      const tokens = candidate
        .split(" ")
        .filter((token) => token.length >= 3 && !GENERIC_CONTEXT_WORDS.has(token))
      const overlap = tokens.filter((token) => noteTokens.has(token))
      return {
        entry,
        index,
        score: overlap.length * 100 + overlap.reduce((total, token) => total + token.length, 0),
      }
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map(({ entry }) => entry)
}

export function buildParseUserPrompt(text: string, context: ParseOutlookContext): string {
  const relevantCompanies = relevantToNote(text, context.companies, (company) => company.name)
  const relevantTasks = relevantToNote(text, context.existingTasks, (task) => task.title)
  const companies = relevantCompanies.length
    ? relevantCompanies.map((company) => `- ${company.name}`).join("\n")
    : "- (none matched)"
  const tasks = relevantTasks.length
    ? relevantTasks
        .map((task) => `- ${task.title} (${task.startDate ?? "?"} → ${task.endDate ?? "?"})`)
        .join("\n")
    : "- (none matched)"

  return [
    `Current date: ${context.today}`,
    `Outlook window: ${context.windowStart} to ${context.windowEnd}`,
    context.jobName ? `Job: ${context.jobName}` : null,
    context.location ? `Location: ${context.location}` : null,
    "",
    "Relevant company candidates:",
    companies,
    "",
    "Relevant existing tasks (for dependencies):",
    tasks,
    "",
    "Notes to parse:",
    text,
  ]
    .filter((line): line is string => line !== null)
    .join("\n")
}

const statusEnum: Array<string | null> = [...OUTLOOK_TASK_STATUSES, null]

/** OpenAI strict json_schema: every property required, `additionalProperties:false`. */
export const OUTLOOK_SUGGESTIONS_JSON_SCHEMA: StructuredJsonSchema = {
  name: "outlook_task_suggestions",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["suggestions"],
    properties: {
      suggestions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "clientSuggestionId",
            "title",
            "description",
            "trade",
            "companyName",
            "startDate",
            "durationDays",
            "dependencyReference",
            "status",
            "completionPercent",
            "warnings",
          ],
          properties: {
            clientSuggestionId: { type: "string" },
            title: { type: "string" },
            description: { type: ["string", "null"] },
            trade: { type: ["string", "null"] },
            companyName: { type: ["string", "null"] },
            startDate: { type: ["string", "null"], description: "ISO YYYY-MM-DD or null" },
            durationDays: { type: ["number", "null"] },
            dependencyReference: { type: ["string", "null"] },
            status: { type: ["string", "null"], enum: statusEnum },
            completionPercent: { type: ["number", "null"] },
            warnings: { type: "array", items: { type: "string" } },
          },
        },
      },
    },
  },
}
