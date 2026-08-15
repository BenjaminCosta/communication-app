import {
  buildApplicationDeepLink,
  buildDirectoryProfileDeepLink,
  buildModuleDeepLink,
  buildQuestCoralProjectDeepLink,
} from "@/lib/whatsapp-secretary/guidance"
import type { SecretaryToolResult } from "@/lib/whatsapp-secretary/tool-registry"

const MAX_LIST_ROWS = 10
const MAX_LIST_TITLE_CHARACTERS = 24
const MAX_LIST_DESCRIPTION_CHARACTERS = 72
const MAX_CTA_BODY_CHARACTERS = 1_000

type RecordValue = Record<string, unknown>

export type WhatsAppListRow = {
  id: string
  title: string
  description?: string
}

export type WhatsAppReplyPresentation =
  | {
      kind: "list"
      body: string
      buttonText: string
      sectionTitle: string
      rows: WhatsAppListRow[]
    }
  | {
      kind: "cta_url"
      body: string
      buttonText: string
      url: string
    }

/**
 * A file to send as a native follow-up WhatsApp message (image or document),
 * built here from already-authorized tool `presentation` data — never from
 * anything the model saw or could invent. `url` must already be a real,
 * directly-fetchable link (a Firestore-stored download URL, or an
 * Admin-SDK-minted signed URL) resolved by the tool that produced it.
 */
export type WhatsAppMediaAttachment = {
  kind: "image" | "document"
  url: string
  /** Required in practice for `"document"` — WhatsApp shows this as the file name. */
  filename?: string
  caption?: string
}

/** The persisted assistant text plus the optional native WhatsApp rendering. */
export type WhatsAppOutgoingReply = {
  text: string
  presentation?: WhatsAppReplyPresentation
  /** Sent as follow-up messages after the primary reply — see `sendWhatsAppReply`. */
  attachments?: WhatsAppMediaAttachment[]
}

export type WhatsAppSecretaryToolExecution = {
  name: string
  result: SecretaryToolResult
}

type Candidate = {
  name: string
  description?: string
}

type CandidateSet = {
  labelPlural: string
  rows: Candidate[]
}

function asRecord(value: unknown): RecordValue | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as RecordValue) : null
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

/** Single-line clamp — for native list row titles/descriptions, where WhatsApp allows no line breaks at all. */
function clamp(value: string, max: number): string {
  const trimmed = value.replace(/\s+/g, " ").trim()
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, Math.max(0, max - 1)).trimEnd()}…`
}

/**
 * Body clamp that keeps line structure. The single-line {@link clamp} was
 * previously used for message bodies too, which silently collapsed every
 * newline into a space — so the short bullet lists the system prompt asks for
 * (and the personalized introduction card) rendered as one run-on paragraph in
 * WhatsApp. Runs of blank lines are still normalized so a stray model newline
 * can't pad the reply.
 */
function clampBody(value: string, max: number): string {
  const trimmed = value
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[^\S\n]*\n[^\S\n]*/g, "\n")
    .trim()
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, Math.max(0, max - 1)).trimEnd()}…`
}

function compactDescription(...values: unknown[]): string | undefined {
  const parts = values.map(asString).filter(Boolean)
  return parts.length > 0 ? clamp(parts.join(" · "), MAX_LIST_DESCRIPTION_CHARACTERS) : undefined
}

function namedCandidates(value: unknown, description: (record: RecordValue) => string | undefined): Candidate[] {
  if (!Array.isArray(value)) return []
  return value
    .map(asRecord)
    .filter((record): record is RecordValue => record !== null)
    .map((record) => ({ name: asString(record.name) || asString(record.candidateName), description: description(record) }))
    .filter((candidate) => candidate.name)
}

/**
 * Pulls only explicit ambiguous/search result candidates from already-authorized
 * tool output. This never queries data and deliberately ignores relationship
 * lists, which are answers rather than a disambiguation prompt.
 */
function candidateSetFromExecutions(executions: WhatsAppSecretaryToolExecution[]): CandidateSet | null {
  for (const execution of executions) {
    const data = asRecord(execution.result.data)
    if (!data) continue

    // Only an EXPLICIT ambiguity signal becomes a disambiguation list.
    //
    // This used to also fire whenever a search tool merely returned several
    // records — which conflated two different things: "a search found ten
    // matches, here is the data" (input for the model's next step) and "I
    // cannot proceed until you pick one" (a question for the user). Turning
    // the former into a list hijacked the turn: a live eval of a broad
    // question like "what's going on with North Ridge?" showed the model
    // running one exploratory Directory search, the presentation layer
    // replacing the whole reply with "I found 10 possible records", and the
    // real answer never being produced.
    //
    // Ambiguity now has exactly one shape — the shared resolver's
    // `describeUnresolved()` emits `data.candidates` and nothing else does —
    // so keying on that alone is both simpler and correct.
    const ambiguous = namedCandidates(data.candidates, (record) =>
      compactDescription(record.role, record.companyName, record.location, record.status, record.ownerName),
    )
    if (ambiguous.length > 1) {
      const kind = asString((asRecord(Array.isArray(data.candidates) ? data.candidates[0] : null))?.kind)
      return { labelPlural: kind ? `${kind}s` : "matches", rows: ambiguous }
    }
  }
  return null
}

function directCtaFromExecutions(executions: WhatsAppSecretaryToolExecution[]): { buttonText: string; url: string } | null {
  let applicationCta: { buttonText: string; url: string } | null = null
  let directoryCta: { buttonText: string; url: string } | null = null

  for (const execution of executions) {
    const data = asRecord(execution.result.data)
    const presentation = asRecord(execution.result.presentation)
    if (!data && !presentation) continue

    if (execution.name === "outlooks_get") {
      const deepLink = asString(presentation?.deepLink)
      if (deepLink) return { buttonText: "Open Outlook", url: deepLink }
    }

    if (execution.name === "questCoral_searchProjects" || execution.name === "questCoral_getProject") {
      const id = asString(presentation?.projectId)
      if (id) return { buttonText: "Open Project", url: buildQuestCoralProjectDeepLink(id) }
    }

    if (data && (execution.name === "directory_search" || execution.name === "directory_getEntity")) {
      const [record] = namedCandidates(data.records, () => undefined)
      const recordData = Array.isArray(data.records) ? asRecord(data.records[0]) : null
      const id = asString(recordData?.id)
      if (record && id) directoryCta = { buttonText: "Open Directory", url: buildDirectoryProfileDeepLink(id) }
    }

    if (execution.name === "applications_search") {
      const id = asString(presentation?.applicationId)
      if (id) applicationCta = { buttonText: "Open Application", url: buildApplicationDeepLink(id) }
    }
  }
  return applicationCta ?? directoryCta
}

const MAX_ATTACHMENTS = 3

/**
 * Only attach a file when the question actually asked for one — otherwise
 * every ordinary report/message question would push an unwanted PDF/image
 * follow-up. Mirrors `continuationCta`'s question-intent-matching pattern.
 */
const ATTACHMENT_INTENT_PATTERN = /\b(?:send|share|show|give|get|attach)\w*\b[\s\S]{0,40}\b(?:files?|pdfs?|documents?|docs?|photos?|pictures?|images?|pics?|links?|attachments?)\b/i

/**
 * Pulls ready-to-send attachments straight from already-authorized tool
 * `presentation` data (never `data`, which is what the model saw) — each
 * qualifying tool (`reports.ts`, `messages.ts`) builds its own
 * `presentation.attachments` entries, already shaped as `{kind, url,
 * filename?, caption?}`, since only the tool itself knows what kind of file
 * it actually has. This function only filters by question intent, picks the
 * most recent qualifying tool call, and caps the count.
 */
function attachmentsFromExecutions(executions: WhatsAppSecretaryToolExecution[], question: string): WhatsAppMediaAttachment[] {
  if (!ATTACHMENT_INTENT_PATTERN.test(question)) return []

  for (const execution of [...executions].reverse()) {
    const presentation = asRecord(execution.result.presentation)
    const items = presentation && Array.isArray(presentation.attachments) ? presentation.attachments : null
    if (!items || items.length === 0) continue

    const attachments = items
      .map(asRecord)
      .filter((record): record is RecordValue => record !== null)
      .map((record): WhatsAppMediaAttachment | null => {
        const url = asString(record.url)
        const kind = record.kind === "image" ? "image" as const : record.kind === "document" ? "document" as const : null
        if (!url || !kind) return null
        return { kind, url, filename: asString(record.filename) || undefined, caption: asString(record.caption) || undefined }
      })
      .filter((attachment): attachment is WhatsAppMediaAttachment => attachment !== null)

    if (attachments.length > 0) return attachments.slice(0, MAX_ATTACHMENTS)
  }
  return []
}

function continuationCta(question: string): { buttonText: string; url: string } | null {
  if (/\b(?:approve|reject|review|request information)\b[\s\S]{0,60}\b(?:application|candidate)\b/i.test(question)) {
    return { buttonText: "Open Applications", url: buildModuleDeepLink("applications") }
  }
  if (/\b(?:submit|finalize|finish)\b[\s\S]{0,60}\b(?:daily )?report\b/i.test(question)) {
    return { buttonText: "Open ByeByeDPR", url: buildModuleDeepLink("bye-bye-dpr") }
  }
  if (/\b(?:create|edit|update|manage)\b[\s\S]{0,60}\b(?:project|quest coral)\b/i.test(question)) {
    return { buttonText: "Open Projects", url: buildModuleDeepLink("quest-coral") }
  }
  if (/\b(?:edit|update|change|add)\b[\s\S]{0,60}\b(?:directory|contact|company|job|context)\b/i.test(question)) {
    return { buttonText: "Open Directory", url: buildModuleDeepLink("directory") }
  }
  return null
}

/**
 * Converts the existing, already-authorized tool results into a native
 * WhatsApp list or a single SVC CTA. Presentation is deterministic: the model
 * never receives record IDs or invents URLs, and no new data is retrieved.
 */
export function createWhatsAppSecretaryPresentation(input: {
  answer: string
  question: string
  executions: WhatsAppSecretaryToolExecution[]
}): WhatsAppOutgoingReply {
  const candidates = candidateSetFromExecutions(input.executions)
  if (candidates) {
    const rows = candidates.rows.slice(0, MAX_LIST_ROWS).map((candidate, index) => ({
      id: `svc-choice-${index + 1}`,
      title: clamp(candidate.name, MAX_LIST_TITLE_CHARACTERS),
      ...(candidate.description ? { description: candidate.description } : {}),
    }))
    const text = `I found ${rows.length} possible ${candidates.labelPlural}. Select the right one to continue.`
    return {
      text,
      presentation: {
        kind: "list",
        body: text,
        buttonText: "Select one",
        sectionTitle: "Matches",
        rows,
      },
    }
  }

  const cta = directCtaFromExecutions(input.executions) ?? continuationCta(input.question)
  const text = clampBody(input.answer, MAX_CTA_BODY_CHARACTERS)
  const attachments = attachmentsFromExecutions(input.executions, input.question)
  return {
    text,
    ...(cta ? { presentation: { kind: "cta_url" as const, body: text, buttonText: cta.buttonText, url: cta.url } } : {}),
    ...(attachments.length > 0 ? { attachments } : {}),
  }
}

/**
 * A message with no request in it — a bare greeting, or a question about the
 * assistant itself. On an introduction turn these get the full, deterministic
 * personalized card *instead of* the model's answer: there is no real request
 * to preserve, and the card is guaranteed grounded in the live snapshot.
 *
 * Outside an introduction turn this classification is not used at all — a
 * later "what can you do?" is answered by the model through
 * `me_getSecretaryGuide`, so it adapts to how the question was actually
 * phrased instead of replaying a fixed card.
 */
export function isDiscoveryMessage(value: string): boolean {
  const text = value.trim()
  if (/^(?:hi|hello|hey|hola|help|start|menu|good morning|good afternoon|good evening)[!.?\s]*$/i.test(text)) return true
  return /^(?:what can you do|what do you do|how can you help|what are you|who are you|how do i use (?:this|you)|what can i ask)[^?]*\??$/i.test(text)
}

/**
 * Attaches the Secretary's personalized introduction to an outgoing reply.
 *
 * The introduction text itself is built by
 * `lib/whatsapp-secretary/onboarding.ts` from the live self-context snapshot;
 * this function only decides how it composes with the answer that was already
 * generated, and keeps the native presentation body in sync with the final
 * text. Never shown to public/unrecognized senders — the caller gates on a
 * resolved identity.
 */
export function addSecretaryIntroduction(
  reply: WhatsAppOutgoingReply,
  input: { standalone: string; prefix: string; message: string },
): WhatsAppOutgoingReply {
  const text = clampBody(
    isDiscoveryMessage(input.message) ? input.standalone : `${input.prefix}\n\n${reply.text}`,
    MAX_CTA_BODY_CHARACTERS,
  )

  // A disambiguation list is a question, not an answer — replacing it with the
  // intro card would strand the user, so the list survives and only its body
  // gains the prefix.
  if (!reply.presentation) return { text, ...(reply.attachments ? { attachments: reply.attachments } : {}) }
  return {
    text,
    presentation: { ...reply.presentation, body: text },
    ...(reply.attachments ? { attachments: reply.attachments } : {}),
  }
}
