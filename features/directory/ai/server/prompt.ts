import type { StructuredJsonSchema } from "@/lib/ai/openai/client"
import type {
  DirectoryAskContext,
  DirectoryAskRecord,
  DirectoryAskRefinement,
} from "@/features/directory/ai/directory-ask-contract"
import type { AnswerContext } from "@/features/directory/ai/server/answer-context"

/**
 * Answer-style prompt for Ask SVC Directory.
 *
 * The model is briefed like a knowledgeable SVC teammate: it receives a grounded
 * context (confirmed facts, relationships with their paths, relevant notes,
 * missing information, possible inferences, supporting record ids and the
 * question intent) and may call read-only Directory tools for anything else. It
 * writes a short, natural answer — never a database readout — grounding
 * confirmed facts as fact, hedging inference, and never inventing.
 */

export const DIRECTORY_ASK_SYSTEM_PROMPT = [
  "You are SVC Directory's assistant — a sharp, helpful teammate who knows the company's people, companies and jobs. You answer using only Directory data provided to you or returned by your tools.",
  "",
  "Tools:",
  "- Relevant context has usually been retrieved for you already. Call a tool only when you genuinely still need something (another entity, a relationship, a shared-contact check, a connecting path, or notes).",
  "- Tools are read-only and return small record sets. Never assume data you did not receive.",
  "",
  "Voice:",
  "- Answer the question directly in your first sentence. No preamble, no 'Based on the records', no 'the system found', no 'there are N records'.",
  "- Natural, professional English, like a colleague explaining what matters — not a field-by-field dump. Usually 2–6 sentences.",
  "- The user sees record cards and source chips below your answer, so don't re-list every record — refer to them instead.",
  "- Explain *why* a record is relevant when that's the point of the question.",
  "",
  "Truth:",
  "- State CONFIRMED FACTS as fact ('is listed as', 'is recorded as').",
  "- Present inference as inference ('appears to be', 'looks like', 'suggests') — never as certainty.",
  "- An indirect or shared connection is NOT proof of a direct relationship. Say how they're connected (e.g. 'both are linked to the same job'), never imply more.",
  "- Correlation is not a confirmed fact. Do not upgrade a pattern into a claim.",
  "- Never invent people, companies, jobs, roles, counts, contacts, statuses, locations or dates.",
  "- If information is missing, say plainly what the Directory doesn't have, then give the useful related information it does have.",
  "",
  "Adapt to the question intent:",
  "- direct lookup: the specific answer plus the one or two facts that matter.",
  "- comparison: how the two records relate or differ, grounded only in known facts.",
  "- shared contacts / connecting jobs: lead with what is actually shared, and cite the connection.",
  "- relationship analysis: describe the chain, using the path provided.",
  "- recommendation: suggest the most fitting record and why, based only on listed roles/relationships — hedge it.",
  "- summary: a crisp characterization — what it is, its status, its most notable connections.",
  "- missing-data check: answer whether the Directory has it, and what exists instead.",
  "- semantic note search: quote/paraphrase only what the notes actually say.",
  "",
  "Output JSON fields: `answer` (prose), `notFound` (true only when nothing useful was found), `confirmedFacts` (short factual statements you relied on), `inferredInsights` (hedged interpretations), `limitations` (what's missing or uncertain), `usedRecordIds` (ids you actually relied on), `confidence` (high/medium/low — low when the answer leans on inference or thin data).",
].join("\n")

function truncate(value: string, max: number): string {
  const trimmed = value.trim()
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed
}

/** Compact, id-tagged record line so the model can map facts back to cards. */
function recordLine(record: DirectoryAskRecord, maxChars: number): string {
  const bits = [`${record.name} (${record.type})`]
  if (record.role) bits.push(record.role)
  if (record.companyName) bits.push(record.companyName)
  if (record.location) bits.push(record.location)
  if (record.status) bits.push(record.status)
  if (record.relation) bits.push(record.relation)
  const detail = record.description || record.subtitle
  if (detail) bits.push(truncate(detail, maxChars))
  return `- ${bits.join(" · ")} [${record.id}]`
}

function section(title: string, lines: string[]): string[] {
  if (lines.length === 0) return []
  return ["", title, ...lines.map((line) => (line.startsWith("-") ? line : `- ${line}`))]
}

export function buildAskUserPrompt(
  question: string,
  answerContext: AnswerContext,
  context: DirectoryAskContext,
  refinement?: DirectoryAskRefinement | null,
  maxRecordChars = 600,
): string {
  const contextLines: string[] = []
  if (context.today) contextLines.push(`Today is ${context.today}.`)
  if (context.scope && context.scope !== "all") contextLines.push(`The user is focused on ${context.scope} records.`)
  for (const ref of context.entityRefs) contextLines.push(`Pinned ${ref.type}: ${ref.name}.`)

  const refinementBlock = refinement
    ? section("This is a follow-up. Previous exchange (continuity only):", [
        `Previously asked: ${refinement.previousQuestion}`,
        `You answered: ${truncate(refinement.previousAnswerSummary, maxRecordChars)}`,
      ])
    : []

  const lines: string[] = [
    `QUESTION INTENT: ${answerContext.questionIntent}`,
    `QUESTION: ${question.trim()}`,
    ...(contextLines.length ? ["", "CONTEXT:", ...contextLines.map((line) => `- ${line}`)] : []),
    ...section("CONFIRMED FACTS (state as fact):", answerContext.confirmedFacts),
    ...section("RELATIONSHIPS (how these records connect):", answerContext.relationships),
    ...section("RELEVANT NOTES (free text — quote carefully):", answerContext.relevantNotes.map((note) => truncate(note.text, maxRecordChars))),
    ...section("POSSIBLE INFERENCES (hedge these):", answerContext.possibleInferences),
    ...section("MISSING INFORMATION (not in the Directory):", answerContext.missingInformation),
    ...section(
      "SUPPORTING RECORDS (shown to the user as cards — reference by name, not id):",
      answerContext.records.map((record) => recordLine(record, maxRecordChars)),
    ),
    ...refinementBlock,
  ]
  if (!answerContext.hasData) {
    lines.push("", "Nothing was retrieved. Tell the user it isn't in the Directory and suggest how to refine the question.")
  }
  return lines.join("\n")
}

/** OpenAI strict json_schema: every property required, additionalProperties:false. */
export const DIRECTORY_ASK_JSON_SCHEMA: StructuredJsonSchema = {
  name: "directory_answer",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["answer", "notFound", "confirmedFacts", "inferredInsights", "limitations", "usedRecordIds", "confidence"],
    properties: {
      answer: { type: "string", description: "Natural, concise answer (usually 2–6 sentences)." },
      notFound: { type: "boolean", description: "True only when nothing useful was found." },
      confirmedFacts: { type: "array", items: { type: "string" }, description: "Short factual statements the answer relies on." },
      inferredInsights: { type: "array", items: { type: "string" }, description: "Hedged interpretations, not facts." },
      limitations: { type: "array", items: { type: "string" }, description: "What is missing, uncertain, or out of scope." },
      usedRecordIds: { type: "array", items: { type: "string" }, description: "Ids of the records the answer relied on." },
      confidence: { type: "string", enum: ["high", "medium", "low"] },
    },
  },
}
