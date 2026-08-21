import {
  buildApplicationDeepLink,
  buildApplicationsQueueDeepLink,
  buildDirectoryProfileDeepLink,
  getAppBaseUrl,
  buildModuleDeepLink,
  buildQuestCoralProjectDeepLink,
} from "@/lib/whatsapp-secretary/guidance"
import type { SecretaryDeepLinkCta } from "@/lib/whatsapp-secretary/guidance"
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

/**
 * Appends one short progressive-discovery hint to an answer.
 *
 * Kept in the presentation layer, and appended *after* the model's reply rather
 * than asked of the model, for the same reason every other contract line is
 * deterministic here: a hint that drifts into "I can also do X" for an X the
 * sender cannot reach would be worse than no hint. Skipped when the reply is
 * already at the length cap, so teaching never costs the answer.
 */
export function addCapabilityHint(reply: WhatsAppOutgoingReply, hint: string): WhatsAppOutgoingReply {
  if (!hint || reply.presentation?.kind === "list") return reply
  const text = `${reply.text}\n\n${hint}`
  if (text.length > MAX_CTA_BODY_CHARACTERS) return reply
  return {
    ...reply,
    text,
    ...(reply.presentation ? { presentation: { ...reply.presentation, body: text } } : {}),
  }
}

/**
 * Composes this turn's identity notices onto an already-generated reply:
 * a `prefix` confirming a WhatsApp number was just linked to an SVC account,
 * and/or a `suffix` inviting an unrecognized sender to enroll.
 *
 * Kept next to {@link addCapabilityHint} and {@link addSecretaryIntroduction}
 * because it shares their two obligations — never overflow the CTA body cap,
 * and keep a native presentation's `body` identical to the persisted text.
 * The notices are dropped rather than truncated when they would not fit: a
 * half-sentence about identity is worse than none, and the state change they
 * describe has already happened server-side either way.
 */
export function addIdentityNotice(
  reply: WhatsAppOutgoingReply,
  input: { prefix?: string; suffix?: string },
): WhatsAppOutgoingReply {
  const parts = [input.prefix, reply.text, input.suffix].filter((part): part is string => Boolean(part))
  if (parts.length === 1) return reply

  const text = parts.join("\n\n")
  // A native list's rows are the answer; padding its body with notices risks
  // pushing it past the cap and stranding the selection UI.
  if (text.length > MAX_CTA_BODY_CHARACTERS || reply.presentation?.kind === "list") return reply
  return {
    ...reply,
    text,
    ...(reply.presentation ? { presentation: { ...reply.presentation, body: text } } : {}),
  }
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

type Cta = SecretaryDeepLinkCta

/**
 * Tool presentation never reaches the model, but it is still validated here
 * before becoming a clickable WhatsApp URL. This keeps one centralized app
 * destination registry even if another server tool is added later.
 */
function explicitCtaFromPresentation(presentation: RecordValue | null): Cta | null {
  const cta = asRecord(presentation?.cta)
  const buttonText = asString(cta?.buttonText)
  const url = asString(cta?.url)
  if (!buttonText || buttonText.length > 20 || !url) return null

  try {
    const appUrl = new URL(getAppBaseUrl())
    const destination = new URL(url)
    if (destination.origin !== appUrl.origin) return null
  } catch {
    return null
  }
  return { buttonText, url }
}

function directCtaFromExecutions(executions: WhatsAppSecretaryToolExecution[]): Cta | null {
  // A tool that resolved an exact, authorized target is always the primary
  // next step. The last tool call is the most specific one when Courtney made
  // a supporting lookup first and drilled into a detail second.
  for (const execution of [...executions].reverse()) {
    const cta = explicitCtaFromPresentation(asRecord(execution.result.presentation))
    if (cta) return cta
  }

  // Compatibility with tool results stored before the centralized `cta`
  // contract. These can be deleted once no older responses remain in flight.
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
      const records = Array.isArray(data.records) ? data.records : []
      if (records.length !== 1) continue
      const [record] = namedCandidates(records, () => undefined)
      const recordData = Array.isArray(data.records) ? asRecord(data.records[0]) : null
      const id = asString(recordData?.id)
      if (record && id) directoryCta = { buttonText: "Open Directory", url: buildDirectoryProfileDeepLink(id) }
    }

    if (execution.name === "applications_search") {
      const id = asString(presentation?.applicationId)
      if (id) applicationCta = { buttonText: "Open Application", url: buildApplicationDeepLink(id) }
    }
  }
  if (applicationCta ?? directoryCta) return applicationCta ?? directoryCta

  // Broader, non-entity results open the real module rather than a made-up
  // detail route. These remain below exact object CTAs on purpose.
  if (executions.some((execution) => execution.name.startsWith("messages_"))) {
    return { buttonText: "Open Communications", url: buildModuleDeepLink("communications") }
  }
  if (executions.some((execution) => execution.name.startsWith("clocking_") || execution.name.startsWith("reports_"))) {
    return { buttonText: "Open ByeByeDPR", url: buildModuleDeepLink("bye-bye-dpr") }
  }
  if (executions.some((execution) => execution.name === "questCoral_listRecentActivity")) {
    return { buttonText: "Open Projects", url: buildModuleDeepLink("quest-coral") }
  }
  if (executions.some((execution) => execution.name === "applications_getReviewQueue")) {
    return { buttonText: "Open Review Queue", url: buildApplicationsQueueDeepLink("ready_for_review") }
  }
  if (executions.some((execution) => execution.name.startsWith("outlooks_") || execution.name.startsWith("directory_"))) {
    return { buttonText: "Open Directory", url: buildModuleDeepLink("directory") }
  }
  if (executions.some((execution) => execution.name.startsWith("applications_"))) {
    return { buttonText: "Open Applications", url: buildModuleDeepLink("applications") }
  }
  if (executions.some((execution) => execution.name.startsWith("questCoral_"))) {
    return { buttonText: "Open Projects", url: buildModuleDeepLink("quest-coral") }
  }
  return null
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
  if (/\b(?:clock|time[ -]?(?:in|out)|timesheet)\b/i.test(question)) {
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
  return isGreetingOnly(value) || isCapabilityQuestion(value)
}

/** A bare hello — no request to preserve, so an introduction can stand in for the answer. */
export function isGreetingOnly(value: string): boolean {
  return /^(?:hi|hello|hey|hola|help|start|menu|good morning|good afternoon|good evening)[!.?\s]*$/i.test(value.trim())
}

/**
 * The "what can you do?" family, in the many ways people actually ask it.
 *
 * Outside an introduction turn these are answered by the model through
 * `me_getSecretaryGuide`, so the answer is built from the person's real records
 * and adapts to the phrasing — rather than replaying one fixed card, which is
 * exactly the generic feature list this whole effort exists to avoid.
 */
export function isCapabilityQuestion(value: string): boolean {
  return /^(?:what can you do(?: for me)?|what do you do|how can you help(?: me)?|what are you|who are you|how do i use (?:this|you)|how should i use you|what can i ask(?: you)?(?: about.*)?|give me (?:some )?examples|what are you good (?:at|for))[^?]*\??$/i.test(
    value.trim(),
  )
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
