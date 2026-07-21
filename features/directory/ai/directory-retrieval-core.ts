import { DIRECTORY_AI_LIMITS } from "@/lib/ai/config-public"
import type { DirectorySearchDoc } from "@/lib/directory"
import { type DirectoryListItem } from "@/lib/directory-config"
import type {
  DirectoryAskIntent,
  DirectoryAskRecord,
} from "@/features/directory/ai/directory-ask-contract"

/**
 * Firebase-free pieces of Ask SVC Directory retrieval: intent detection, record
 * projection, deterministic lookup answers and local suggestions. Kept separate
 * from `directory-retrieval.ts` (which pulls in the MiniSearch index +
 * /directoryRelations) so this logic is unit-testable in plain Node.
 */

const MAX_RECORD_CHARS = DIRECTORY_AI_LIMITS.maxRecordChars

export interface AskSuggestion {
  id: string
  text: string
  intent: DirectoryAskIntent
  entity?: DirectoryListItem
}

// ── Text helpers ─────────────────────────────────────────────────────────────

export function normalizeAskText(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim()
}

function truncate(value: string | undefined | null, max: number): string | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed
}

// ── Intent detection ─────────────────────────────────────────────────────────

const INTENT_PATTERNS: Array<{ intent: DirectoryAskIntent; re: RegExp }> = [
  { intent: "who_works_at", re: /\b(who(?:'s| is| are)?\s+(?:works?|working|employed)|people|contacts|employees|staff|team)\b/i },
  { intent: "jobs_for", re: /\b(jobs?|projects?|active jobs?|work)\b/i },
  { intent: "related_to", re: /\b(related|connected|connections?|linked|relationships?)\b/i },
  { intent: "summarize", re: /\b(summar(?:y|ize|ise)|overview|tell me about|about|describe)\b/i },
]

/** Strip the question phrasing down to a probable entity name. */
export function extractEntityHint(question: string): string {
  return question
    .trim()
    .replace(/[?.!]+$/g, "")
    .replace(/^\s*(who(?:'s| is| are)?|show|list|find|give me|what|which|how many|tell me about|summar(?:y|ize|ise)|overview of|about)\b/i, " ")
    .replace(/\b(works?|working|employed|people|contacts|employees|staff|team|members?)\b/gi, " ")
    .replace(/\b(active\s+)?(jobs?|projects?|work)\b/gi, " ")
    .replace(/\b(related|connected|connections?|linked)\b/gi, " ")
    .replace(/\b(at|for|of|in|with|to|the|a|an|are|is)\b/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
}

export function detectAskIntent(question: string): { intent: DirectoryAskIntent; entityHint: string } {
  const entityHint = extractEntityHint(question)
  for (const { intent, re } of INTENT_PATTERNS) {
    if (re.test(question)) return { intent, entityHint }
  }
  if (entityHint && entityHint.split(" ").length <= 4 && question.trim().split(" ").length <= 5) {
    return { intent: "lookup", entityHint }
  }
  return { intent: "general", entityHint }
}

// ── Record projection ────────────────────────────────────────────────────────

const JOB_STATUS_RE = /\b(in\s*progress|planning|complete[d]?|cancell?ed|on\s*hold|active|open|closed)\b/i

/** Jobs carry their status inside the subtitle/description text, not a field. */
export function extractJobStatus(doc: Pick<DirectorySearchDoc, "subtitle" | "description">): string | undefined {
  const hit = `${doc.subtitle ?? ""} ${doc.description ?? ""}`.match(JOB_STATUS_RE)
  return hit ? hit[1].replace(/\s+/g, " ") : undefined
}

export function buildAskRecordFromDoc(doc: DirectorySearchDoc, relation?: string): DirectoryAskRecord {
  return {
    id: doc.id,
    type: doc.type,
    name: doc.name,
    companyName: truncate(doc.companyName, 200),
    location: truncate(doc.location, 200),
    role: truncate(doc.role, 200),
    subtitle: truncate(doc.subtitle, 300),
    description: truncate(doc.description, MAX_RECORD_CHARS),
    status: doc.type === "job" ? extractJobStatus(doc) : undefined,
    relation: relation ? truncate(relation, 160) : undefined,
  }
}

/** Pure DirectorySearchDoc → DirectoryListItem projection (display type only). */
export function docToListItem(doc: DirectorySearchDoc): DirectoryListItem {
  return {
    id: doc.id,
    type: doc.type === "other" ? "person" : doc.type,
    name: doc.name,
    subtitle: doc.subtitle ?? "",
    companyName: doc.companyName ?? "",
    location: doc.location ?? "",
    role: doc.role ?? "",
    description: doc.description ?? "",
  }
}

/** One-line deterministic answer for a trivial single-record lookup. */
export function buildLookupAnswer(doc: DirectorySearchDoc): string {
  if (doc.type === "person") {
    const role = doc.role ? doc.role : "a contact"
    const at = doc.companyName ? ` at ${doc.companyName}` : ""
    const loc = doc.location ? ` Based in ${doc.location}.` : ""
    return `${doc.name} is ${role}${at} in the Directory.${loc}`.trim()
  }
  if (doc.type === "company") {
    const loc = doc.location ? ` It is located in ${doc.location}.` : ""
    return `${doc.name} is a company in the Directory.${loc}`.trim()
  }
  const status = extractJobStatus(doc)
  const loc = doc.location ? ` in ${doc.location}` : ""
  return `${doc.name} is a job${loc}${status ? ` with status ${status}` : ""} in the Directory.`.trim()
}
