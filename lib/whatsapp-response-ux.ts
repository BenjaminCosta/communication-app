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

function clamp(value: string, max: number): string {
  const trimmed = value.replace(/\s+/g, " ").trim()
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

    if (/^directory_searchPeople$/.test(execution.name)) {
      const rows = namedCandidates(data.records, (record) => compactDescription(record.role, record.companyName, record.location))
      if (rows.length > 1) return { labelPlural: "people", rows }
    }
    if (/^directory_searchCompanies$/.test(execution.name)) {
      const rows = namedCandidates(data.records, (record) => compactDescription(record.location, record.subtitle))
      if (rows.length > 1) return { labelPlural: "companies", rows }
    }
    if (/^directory_searchJobs$/.test(execution.name)) {
      const rows = namedCandidates(data.records, (record) => compactDescription(record.companyName, record.location, record.status))
      if (rows.length > 1) return { labelPlural: "jobs", rows }
    }
    if (/^questCoral_searchProjects$/.test(execution.name)) {
      const rows = namedCandidates(data.projects, (record) => compactDescription(record.status, record.ownerName))
      if (rows.length > 1) return { labelPlural: "projects", rows }
    }
    if (/^(?:questCoral_getProject|questCoral_getProjectUpdates|reports_searchDailyReportsForJob|clocking_getClockHistoryForJob|outlooks_getOutlookForJob|applications_getApplicationsForJob)$/.test(execution.name)) {
      const rows = namedCandidates(data.candidates, (record) => compactDescription(record.location, record.status, record.ownerName))
      if (rows.length > 1) return { labelPlural: "matches", rows }
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

    if (execution.name === "outlooks_getOutlookForJob") {
      const deepLink = asString(presentation?.deepLink)
      if (deepLink) return { buttonText: "Open Outlook", url: deepLink }
    }

    if (execution.name === "questCoral_searchProjects" || execution.name === "questCoral_getProject" || execution.name === "questCoral_getProjectUpdates") {
      const id = asString(presentation?.projectId)
      if (id) return { buttonText: "Open Project", url: buildQuestCoralProjectDeepLink(id) }
    }

    if (data && (execution.name === "directory_searchPeople" || execution.name === "directory_searchCompanies" || execution.name === "directory_searchJobs" || execution.name === "directory_getEntityDetails")) {
      const [record] = namedCandidates(data.records, () => undefined)
      const recordData = Array.isArray(data.records) ? asRecord(data.records[0]) : null
      const id = asString(recordData?.id)
      if (record && id) directoryCta = { buttonText: "Open Directory", url: buildDirectoryProfileDeepLink(id) }
    }

    if (execution.name === "applications_searchCandidates" || execution.name === "applications_getApplicationsForJob") {
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
  const text = clamp(input.answer, MAX_CTA_BODY_CHARACTERS)
  const attachments = attachmentsFromExecutions(input.executions, input.question)
  return {
    text,
    ...(cta ? { presentation: { kind: "cta_url" as const, body: text, buttonText: cta.buttonText, url: cta.url } } : {}),
    ...(attachments.length > 0 ? { attachments } : {}),
  }
}

function firstName(name: string): string {
  return name.trim().split(/\s+/, 1)[0] || "there"
}

function isDiscoveryMessage(value: string): boolean {
  return /^(?:hi|hello|hey|help|start|what can you do|how can you help)[!.?\s]*$/i.test(value.trim())
}

/** First-contact greeting for a resolved SVC employee; never shown to public senders. */
export function addFirstInteractionWelcome(reply: WhatsAppOutgoingReply, input: { name: string; message: string }): WhatsAppOutgoingReply {
  const greeting = `Hi ${firstName(input.name)} — I’m the SVC AI Secretary.`
  const discovery = "You can ask about people, jobs, projects, applications, reports, or how to use SVC. Try “Who manages North Ridge?” or “What needs review?”"
  const prefix = isDiscoveryMessage(input.message) ? `${greeting}\n${discovery}` : greeting
  const text = isDiscoveryMessage(input.message) ? prefix : `${prefix}\n\n${reply.text}`

  if (!reply.presentation) return { text }
  if (reply.presentation.kind === "list") {
    return { text, presentation: { ...reply.presentation, body: text } }
  }
  return { text, presentation: { ...reply.presentation, body: text } }
}
