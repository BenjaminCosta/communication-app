import type { Firestore } from "firebase-admin/firestore"
import { getFirebaseAdminApp } from "@/lib/ai/server/firebase-admin"
import type { WhatsAppSecretaryConversationMessage } from "@/lib/whatsapp-secretary/types"
import type { CompanyKnowledgeAccessScope } from "@/lib/whatsapp-access-policy"

const COMPANY_KNOWLEDGE_COLLECTION = "companyKnowledge"
const MAX_RETRIEVED_ENTRIES = 3
const MAX_QUERY_MESSAGES = 3
const MAX_ENTRY_CHARACTERS = 1_800
const MIN_RELEVANCE_SCORE = 2

const QUERY_TOKEN_SYNONYMS: Record<string, string[]> = {
  agreement: ["contract"],
  application: ["applications"],
  candidate: ["candidates"],
  communication: ["communications", "stream"],
  company: ["companies"],
  job: ["jobs"],
  project: ["projects"],
  report: ["reports", "daily"],
}

const STOP_WORDS = new Set([
  "a",
  "and",
  "are",
  "for",
  "how",
  "of",
  "the",
  "to",
  "what",
])

type RecordValue = Record<string, unknown>

export type CompanyKnowledgeContext = {
  id: string
  title: string
  content: string
  source: string
}

export type CompanyKnowledgeSeedEntry = CompanyKnowledgeContext & {
  /** Public entries are safe for unrecognized WhatsApp senders. */
  accessScope: CompanyKnowledgeAccessScope
  keywords: string[]
  sourceUpdatedAt: string
}

type SearchableCompanyKnowledgeEntry = CompanyKnowledgeContext & {
  accessScope: CompanyKnowledgeAccessScope
  keywords: string[]
}

async function getAdminDb(): Promise<Firestore> {
  const { getFirestore } = await import("firebase-admin/firestore")
  return getFirestore(await getFirebaseAdminApp())
}

function asRecord(value: unknown): RecordValue | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as RecordValue) : null
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
}

function tokenize(value: string): Set<string> {
  const tokens = normalize(value)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token))

  return new Set(tokens.flatMap((token) => [token, ...(QUERY_TOKEN_SYNONYMS[token] ?? [])]))
}

function hasToken(haystack: string, token: string): boolean {
  return haystack.split(/[^a-z0-9]+/).includes(token)
}

function parseKnowledgeEntry(id: string, data: unknown): SearchableCompanyKnowledgeEntry | null {
  const record = asRecord(data)
  if (
    record?.isActive !== true ||
    typeof record.title !== "string" ||
    typeof record.content !== "string" ||
    typeof record.source !== "string"
  ) {
    return null
  }

  const title = record.title.trim()
  const content = record.content.trim().slice(0, MAX_ENTRY_CHARACTERS)
  const source = record.source.trim()
  if (!title || !content || !source) {
    return null
  }

  return {
    id,
    title,
    content,
    source,
    // Existing, unclassified entries are deliberately private by default.
    accessScope: record.accessScope === "public" ? "public" : "internal",
    keywords: asStringArray(record.keywords).map((keyword) => keyword.trim()).filter(Boolean),
  }
}

function scoreKnowledgeEntry(entry: SearchableCompanyKnowledgeEntry, queryTokens: Set<string>): number {
  const normalizedTitle = normalize(entry.title)
  const normalizedKeywords = normalize(entry.keywords.join(" "))
  const normalizedContent = normalize(entry.content)
  let score = 0

  for (const token of queryTokens) {
    if (hasToken(normalizedKeywords, token)) score += 8
    if (hasToken(normalizedTitle, token)) score += 5
    if (hasToken(normalizedContent, token)) score += 1
  }

  return score
}

function userMessagesFromConversation(recentMessages: WhatsAppSecretaryConversationMessage[]): string[] {
  return recentMessages
    .filter((message) => message.role === "user")
    .slice(-MAX_QUERY_MESSAGES)
    .map((message) => message.content)
}

function queryTokensFromText(value: string): Set<string> {
  const tokens = tokenize(value)
  if (tokens.size > 1) {
    tokens.delete("svc")
  }
  return tokens
}

/**
 * Retrieves a small, scored subset of curated SVC product information. It
 * deliberately does not query Directory, contacts, messages, or other live
 * operational collections.
 */
export async function findRelevantCompanyKnowledge(
  recentMessages: WhatsAppSecretaryConversationMessage[],
  accessScope: CompanyKnowledgeAccessScope = "internal",
): Promise<CompanyKnowledgeContext[]> {
  const userMessages = userMessagesFromConversation(recentMessages)
  const currentQueryTokens = queryTokensFromText(userMessages.at(-1) ?? "")
  const conversationQueryTokens = queryTokensFromText(userMessages.join("\n"))
  if (conversationQueryTokens.size === 0) {
    return []
  }

  try {
    const db = await getAdminDb()
    // Public senders query only explicitly public documents. This is not a
    // post-query filter, so internal knowledge never enters this request path.
    const snapshot = accessScope === "public"
      ? await db.collection(COMPANY_KNOWLEDGE_COLLECTION).where("accessScope", "==", "public").limit(50).get()
      : await db.collection(COMPANY_KNOWLEDGE_COLLECTION).where("isActive", "==", true).limit(50).get()

    const entries = snapshot.docs
      .map((document) => parseKnowledgeEntry(document.id, document.data()))
      .filter((entry): entry is SearchableCompanyKnowledgeEntry => {
        if (entry === null) return false
        return accessScope === "internal" || entry.accessScope === "public"
      })
    const rankEntries = (queryTokens: Set<string>) =>
      entries
        .map((entry) => ({ entry, score: scoreKnowledgeEntry(entry, queryTokens) }))
        .filter(({ score }) => score >= MIN_RELEVANCE_SCORE)
        .sort((first, second) => second.score - first.score || first.entry.title.localeCompare(second.entry.title))
    const currentRankedEntries = rankEntries(currentQueryTokens)
    const rankedEntries = currentRankedEntries.length > 0 ? currentRankedEntries : rankEntries(conversationQueryTokens)
    const relevanceThreshold = Math.max(MIN_RELEVANCE_SCORE, (rankedEntries[0]?.score ?? 0) * 0.6)

    return rankedEntries
      .filter(({ score }) => score >= relevanceThreshold)
      .slice(0, MAX_RETRIEVED_ENTRIES)
      .map(({ entry }) => ({
        id: entry.id,
        title: entry.title,
        content: entry.content,
        source: entry.source,
      }))
  } catch {
    console.error("Unable to retrieve curated company knowledge.")
    return []
  }
}

export const INITIAL_COMPANY_KNOWLEDGE: CompanyKnowledgeSeedEntry[] = [
  {
    id: "svc-overview",
    title: "SVC overview and modules",
    content:
      "SVC is an internal, mobile-first web/PWA workspace. Its documented modules are Communications (also called Stream), Directory, Applications, Quest Coral, and ByeByeDPR. This knowledge is product orientation only: it does not expose live people, messages, projects, candidates, jobs, or operational records.",
    accessScope: "public",
    keywords: ["svc", "overview", "modules", "apps"],
    source: "docs/svc-project-context-for-ai-agents.md",
    sourceUpdatedAt: "2026-07-16",
  },
  {
    id: "communications-stream",
    title: "Communications / Stream",
    content:
      "Communications, called Stream inside SVC, organizes directed operational messages with their recipients, tags or projects, contexts, dates, replies, and image attachments. A message is visible only to its author and explicit recipients; linking a tag, context, or contact helps organization but never grants reading access. Messages with dates can appear in Calendar and support reminders. Stream is not a public channel, and SVC does not currently have a dedicated AI assistant for Communications.",
    accessScope: "internal",
    keywords: ["communications", "stream", "message", "messages", "recipient", "recipients", "tag", "tags", "calendar", "reminder", "privacy"],
    source: "docs/svc-communications-product-context.md",
    sourceUpdatedAt: "2026-07-31",
  },
  {
    id: "applications-onboarding",
    title: "Applications hiring and onboarding flow",
    content:
      "Applications manages the candidate journey from invitation to hiring confirmation. A staff reviewer creates an invitation and secure link; the candidate can complete mobile-friendly details, video, documents, and submit without a staff account. Staff review the case, can request missing information, and may approve it. Approval enables the Operating Agreement; signing creates timestamped evidence and moves the case to payroll. A reviewer marks the candidate hired only after that later step, so approved does not mean hired. Links are purpose-limited, expire, and can be revoked. Applications does not yet automatically update payroll or Directory.",
    accessScope: "internal",
    keywords: ["applications", "application", "onboarding", "candidate", "candidates", "hiring", "invite", "invitation", "agreement", "payroll", "hired"],
    source: "docs/svc-applications-product-context.md",
    sourceUpdatedAt: "2026-07-31",
  },
  {
    id: "quest-coral",
    title: "Quest Coral project tracking",
    content:
      "Quest Coral is SVC's shared project tracker for progress, people involved, next steps, blockers, feedback, and Red Team Reviews. A project has an owner, status, progress, mission fit, next step, and timeline. Contributors add Update, Feedback, Blocker, or Red Team Review activity; an activity can change status, progress, or the next step. Each project may also have a person-written Project Context, distinct from its activity history and AI-generated brief. Quest Coral does not automatically publish updates to Communications or alter the Applications pipeline.",
    accessScope: "internal",
    keywords: ["quest coral", "project", "projects", "blocker", "blockers", "feedback", "red team", "review", "next step", "progress"],
    source: "docs/svc-quest-coral-product-context.md",
    sourceUpdatedAt: "2026-07-31",
  },
  {
    id: "bye-bye-dpr",
    title: "ByeByeDPR field workflow",
    content:
      "ByeByeDPR is SVC's mobile field-crew workflow for job-site clocking and daily progress reports. A worker can select a job site, clock in or out, and correct a forgotten clock-out. For a daily report, the worker types or dictates what happened; a voice note is transcribed into editable source text, and optional AI can organize only that worker-provided text into work completed, issues or delays, and next steps. The worker reviews before submission, which creates a report document and an operational Communications post. ByeByeDPR is not an attendance dashboard and this knowledge does not reveal live job, location, clock, or report data.",
    accessScope: "internal",
    keywords: ["byebye dpr", "bye bye dpr", "field", "crew", "clock", "clock in", "clock out", "daily report", "job site", "voice", "transcription"],
    source: "docs/svc-bye-bye-dpr-product-context.md",
    sourceUpdatedAt: "2026-08-10",
  },
]
