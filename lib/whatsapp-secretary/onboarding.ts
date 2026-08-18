import type { SecretaryModule } from "@/lib/whatsapp-secretary/tool-registry"
import type { SelfContextSnapshot } from "@/lib/whatsapp-secretary/self-context"
import { buildCapabilityProfile, capabilityFocusLine } from "@/lib/whatsapp-secretary/capability-profiles"
import { buildPersonalizedExamples } from "@/lib/whatsapp-secretary/tools/me"

/**
 * When (and how) the Secretary introduces itself to a recognized employee.
 *
 * The old behavior was a single fixed greeting on the very first inbound
 * message, keyed off "this conversation has no history at all" — so it fired
 * once, forever, said the same thing to everyone, and could never mention a
 * capability added afterwards. This replaces it with three deliberate
 * triggers and personalized, grounded copy:
 *
 * - **first-contact** — no intro has ever been recorded for this sender.
 * - **capabilities-changed** — the sender's real capability signature moved
 *   (a module they can reach was added, they got linked to an SVC app
 *   account, their role changed, or the Secretary's own capability version was
 *   bumped). The signature carries its module list, so the refresher can name
 *   exactly what is newly available instead of vaguely re-pitching.
 * - **refresher** — nothing changed, but it has been
 *   {@link INTRO_REFRESH_INTERVAL_MS} since the last introduction.
 *
 * Anything else gets no introduction at all. That is the whole point: it must
 * not become the thing that greets you every morning.
 *
 * Every personalized line is built only from what
 * `lib/whatsapp-secretary/self-context.ts` actually returned. There is no
 * branch in this file that can name a job, project, company, or role that the
 * live data did not supply.
 */

/**
 * Bump when the Secretary gains a capability that everyone should be told
 * about, even though their own access policy didn't change. This is the one
 * deliberate lever for re-surfacing capabilities across the whole user base.
 */
export const SECRETARY_CAPABILITY_VERSION = 2

/** ~6 weeks: long enough to never feel repetitive, short enough that a quiet user is re-oriented eventually. */
export const INTRO_REFRESH_INTERVAL_MS = 45 * 24 * 60 * 60 * 1_000

export interface WhatsAppOnboardingState {
  lastIntroAtMs: number
  capabilitySignature: string
  /** First time this sender was ever seen. Purely additive — old documents simply lack it. */
  firstSeenAtMs?: number
  /** Set once the sender has actually been walked through the guided tour. */
  guideCompletedAtMs?: number
  /** What the tour/intro told them to focus on, so a later nudge doesn't repeat it. */
  suggestedCapabilities?: SecretaryModule[]
  /** Rate-limits progressive discovery, so capability hints stay occasional. */
  lastCapabilityNudgeAtMs?: number
  /**
   * When the one-time "got you, I recognize you now" confirmation went out —
   * see `lib/whatsapp-secretary/recognition-notice.ts`. Its only job is to
   * make that message unrepeatable: a number can be re-linked, re-resolved or
   * re-introduced any number of times, and the person is still only ever told
   * once that the Secretary started recognizing them.
   */
  recognitionNoticeAtMs?: number
}

export type IntroductionReason = "first-contact" | "capabilities-changed" | "refresher"

export type IntroductionDecision =
  | { show: false }
  | { show: true; reason: IntroductionReason; newModules: SecretaryModule[] }

/** Short, human labels for the capability-change line — never internal module keys. */
const MODULE_LABELS: Record<SecretaryModule, string> = {
  directory: "SVC Directory",
  questCoral: "Quest Coral",
  applications: "Applications",
  reports: "Daily Reports",
  clocking: "clock history",
  outlooks: "3-Week Outlooks",
  messages: "Communications",
  knowledge: "SVC how-to knowledge",
  me: "your own SVC context",
  svc: "cross-module summaries of any job or project",
}

/**
 * A compact, comparable fingerprint of what this sender can actually do right
 * now. Deliberately built from the resolved access policy and identity rather
 * than anything the model sees, and deliberately readable/parseable so a later
 * comparison can name what changed.
 */
export function buildCapabilitySignature(input: {
  level: "public" | "internal"
  modules: SecretaryModule[]
  role: string | null
  hasLinkedAccount: boolean
}): string {
  const modules = [...input.modules].sort().join(",")
  return [
    `v${SECRETARY_CAPABILITY_VERSION}`,
    input.level,
    modules,
    `role=${(input.role ?? "").trim().toLocaleLowerCase() || "-"}`,
    `account=${input.hasLinkedAccount ? "linked" : "unlinked"}`,
  ].join("|")
}

function modulesFromSignature(signature: string): SecretaryModule[] {
  const modules = signature.split("|")[2] ?? ""
  return modules.split(",").filter(Boolean) as SecretaryModule[]
}

export function decideIntroduction(input: {
  state: WhatsAppOnboardingState | null
  signature: string
  nowMs: number
  /** Distinguishes a genuinely new sender from an existing one who predates onboarding tracking. */
  hasConversationHistory: boolean
}): IntroductionDecision {
  if (!input.state) {
    return input.hasConversationHistory
      ? { show: true, reason: "refresher", newModules: [] }
      : { show: true, reason: "first-contact", newModules: [] }
  }

  if (input.state.capabilitySignature !== input.signature) {
    const previous = new Set(modulesFromSignature(input.state.capabilitySignature))
    const newModules = modulesFromSignature(input.signature).filter((module) => !previous.has(module))
    return { show: true, reason: "capabilities-changed", newModules }
  }

  if (input.nowMs - input.state.lastIntroAtMs >= INTRO_REFRESH_INTERVAL_MS) {
    return { show: true, reason: "refresher", newModules: [] }
  }

  return { show: false }
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/, 1)[0] || "there"
}

/**
 * "I know you as X" — only ever states what the snapshot really carries. With
 * no role on file it says so, because inventing a plausible title from a
 * company or job name is exactly the failure this feature exists to avoid.
 */
function recognitionLine(snapshot: SelfContextSnapshot): string {
  const { name, role } = snapshot.identity
  const company = snapshot.profile?.companyName
  if (role && company) return `I know you as ${name}, ${role} at ${company}.`
  if (role) return `I know you as ${name}, ${role}.`
  if (company) return `I know you as ${name} at ${company} — no role on file.`
  return `I know you as ${name} — no role on file yet.`
}

/** "— connected to 3 jobs and 2 projects", or "" when nothing is linked. Folded into the recognition line. */
function linkedCountFragment(snapshot: SelfContextSnapshot): string {
  const parts = [
    snapshot.jobs.length > 0 ? `${snapshot.jobs.length} job${snapshot.jobs.length === 1 ? "" : "s"}` : "",
    snapshot.projects.length > 0 ? `${snapshot.projects.length} Quest Coral project${snapshot.projects.length === 1 ? "" : "s"}` : "",
  ].filter(Boolean)
  return parts.length > 0 ? `You're connected to ${parts.join(" and ")}.` : ""
}

/** One line naming only the sections that genuinely have data. Returns "" when there is nothing true to say. */
function coverageLine(snapshot: SelfContextSnapshot): string {
  const parts: string[] = []
  if (snapshot.jobs.length > 0) {
    parts.push(snapshot.jobs.length === 1 ? `your job ${snapshot.jobs[0].name}` : `your ${snapshot.jobs.length} linked jobs`)
  }
  if (snapshot.projects.length > 0) {
    parts.push(snapshot.projects.length === 1 ? `your project ${snapshot.projects[0].name}` : `your ${snapshot.projects.length} Quest Coral projects`)
  }
  if (snapshot.reports.length > 0) parts.push("your Daily Reports")
  if (snapshot.clock) parts.push(`your open clock at ${snapshot.clock.jobName}`)
  if (parts.length === 0) return ""
  const listed = parts.slice(0, 3)
  return `I can see ${listed.length > 1 ? `${listed.slice(0, -1).join(", ")} and ${listed.at(-1)}` : listed[0]}.`
}

function newCapabilityLine(newModules: SecretaryModule[]): string {
  const labels = newModules.map((module) => MODULE_LABELS[module]).filter(Boolean)
  if (labels.length === 0) return "A quick refresher on what I can do:"
  const listed = labels.slice(0, 3)
  return `New since we last spoke: I can now read ${listed.length > 1 ? `${listed.slice(0, -1).join(", ")} and ${listed.at(-1)}` : listed[0]}.`
}

const MAX_STANDALONE_EXAMPLES = 4

/**
 * The four openers that turn a greeting into a first real answer.
 *
 * A capability list is not an onboarding — the failure mode this is built
 * against is someone trying two vague questions, getting two shrugs, and never
 * finding out what the Secretary is for. These are ordered so the first one is
 * the strongest possible demonstration: a question that makes it go read live
 * data across several modules and come back with something the person did not
 * already know.
 *
 * Each is dropped when the live snapshot cannot back it, so nobody is invited
 * to ask about "my jobs" when no job is linked to them.
 */
function starterQuestions(snapshot: SelfContextSnapshot): string[] {
  const hasWork = snapshot.jobs.length > 0 || snapshot.projects.length > 0
  return [
    ...(hasWork || snapshot.clock ? ["What should I know today?"] : []),
    ...(snapshot.jobs.length > 0 ? ["What's happening on my jobs?"] : []),
    ...(snapshot.projects.length > 0 && snapshot.jobs.length === 0 ? ["What's the status of my projects?"] : []),
    "What can you do for me?",
    "Show me how SVC works.",
  ]
}

/**
 * The full introduction, sent on its own when the sender's message was just a
 * greeting — there is no separate answer to attach it to, so this IS the
 * answer, and it has about twenty seconds to be worth reading.
 *
 * Structure, in priority order: recognition (proof it is really connected to
 * SVC), breadth (what it can reach *for them*), a focus line when their role is
 * known, then openers. The "you don't need commands" line matters more than it
 * looks — people assume a bot needs exact syntax, and the entity refs plus
 * cross-turn memory underneath make follow-ups genuinely work.
 */
export function buildStandaloneIntroduction(
  snapshot: SelfContextSnapshot,
  decision: Extract<IntroductionDecision, { show: true }>,
  enabledModules: SecretaryModule[] = [],
): string {
  const profile = buildCapabilityProfile(snapshot, enabledModules)
  const opening =
    decision.reason === "first-contact"
      ? `Hey ${firstName(snapshot.identity.name)} — I'm Courtney Roberts, your SVC assistant. I recognize you in SVC.`
      : `Hey ${firstName(snapshot.identity.name)} — Courtney Roberts here. Quick catch-up on what I can do for you.`

  // Scope + focus in ONE line. A live eval showed the earlier version listing
  // the same four capabilities three times over — a generic breadth line, then
  // a role focus line, then a coverage line — which reads as padding exactly
  // where the card has the least attention to spend.
  const focus = capabilityFocusLine(profile, snapshot)
  const breadth = focus
    ? `I can search SVC company knowledge and live operational data. ${focus}`
    : profile.phrases.length > 0
      ? `I can search SVC company knowledge and live operational data — ${profile.phrases.slice(0, 4).join(", ")} and more.`
      : ""

  const examples = starterQuestions(snapshot).slice(0, MAX_STANDALONE_EXAMPLES)

  return [
    opening,
    // Coverage is folded into recognition so the card states each fact once.
    [recognitionLine(snapshot), linkedCountFragment(snapshot)].filter(Boolean).join(" "),
    ...(decision.reason === "capabilities-changed" ? [newCapabilityLine(decision.newModules)] : []),
    breadth,
    ...(examples.length > 0 ? ["", "A few good ways to start:", ...examples.map((example) => `• ${example}`)] : []),
    "",
    "No commands or exact names needed — just ask normally, and follow-ups work (\u201cwhat about yesterday?\u201d).",
  ]
    .filter((line) => line !== undefined && line !== null)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
}

/**
 * The compact version, prefixed to a real answer when the sender's very first
 * message was already a substantive request — they asked for something, so
 * they get it, with one short line of context rather than a tutorial.
 */
export function buildPrefixIntroduction(snapshot: SelfContextSnapshot, decision: Extract<IntroductionDecision, { show: true }>): string {
  if (decision.reason === "capabilities-changed") {
    return `${newCapabilityLine(decision.newModules)} Ask “what can you do?” for the full picture.`
  }
  const opening =
    decision.reason === "first-contact"
      ? `Hey ${firstName(snapshot.identity.name)} — I'm Courtney Roberts, your SVC assistant. I recognize you in SVC. ${recognitionLine(snapshot)}`
      : `Hi ${firstName(snapshot.identity.name)} — Courtney Roberts here. ${recognitionLine(snapshot).replace(/^I know you as/, "I still have you as")}`
  return `${opening} Ask “what can you do?” any time.`
}


// ── Progressive discovery ────────────────────────────────────────────────

/**
 * Capabilities worth mentioning *right after* a question about a job, keyed by
 * what the turn did NOT already use.
 *
 * Teaching twenty features up front does not work — people retain the one or
 * two they needed that day. Teaching one adjacent capability at the exact
 * moment it would have applied does, because the person has the context
 * loaded. That is the whole design here: never a menu, never more than one
 * line, and only after a real answer.
 */
const ADJACENT_PHRASE: Partial<Record<SecretaryModule, string>> = {
  reports: "its recent Daily Reports",
  outlooks: "its 3-Week Outlook",
  clocking: "who's clocked in",
  messages: "its Communications activity",
  questCoral: "related Quest Coral projects",
  applications: "candidates linked to it",
}

/** At most one hint every few days — often enough to teach, rare enough not to nag. */
export const CAPABILITY_NUDGE_INTERVAL_MS = 3 * 24 * 60 * 60 * 1_000

/**
 * Tools that already answer across several areas at once, and what they cover.
 *
 * Rate limiting alone was not enough to stop the hint reading as boilerplate.
 * The cross-module dossier and the daily brief each report as a *single*
 * module (`svc`, `me`) while actually having just covered reports, outlooks,
 * clocking and Communications — so a naive "which modules went unused?" check
 * cheerfully offered to go check the very things the answer had already
 * covered. Expanding coverage before diffing is what makes the hint teach
 * something genuinely new instead of repeating the answer back.
 */
const MODULE_COVERS: Partial<Record<SecretaryModule, SecretaryModule[]>> = {
  svc: ["reports", "outlooks", "clocking", "messages", "applications", "questCoral", "directory"],
  // The daily brief spans everything the person is connected to, including
  // their own Applications record — so nothing adjacent is left to teach.
  me: ["reports", "outlooks", "clocking", "messages", "questCoral", "applications", "directory"],
}

const MAX_NUDGED_CAPABILITIES = 3

export interface CapabilityNudge {
  line: string
  modules: SecretaryModule[]
}

/**
 * Decides whether to teach one adjacent capability after an answer.
 *
 * Requires all of: the turn actually answered something entity-shaped, at
 * least one *unused* adjacent capability the sender can really reach, and
 * enough time since the last hint. Anything else returns null — a hint that
 * fires on every turn stops being a hint and becomes chrome.
 */
export function buildCapabilityNudge(input: {
  usedModules: SecretaryModule[]
  enabledModules: SecretaryModule[]
  state: WhatsAppOnboardingState | null
  nowMs: number
  /** True when the turn was about a specific record, which is what makes an adjacent capability meaningful. */
  answeredAboutEntity: boolean
  /** The introduction already lists capabilities, so never teach on the same turn. */
  introducedThisTurn?: boolean
}): CapabilityNudge | null {
  if (!input.answeredAboutEntity || input.introducedThisTurn) return null

  const lastNudge = input.state?.lastCapabilityNudgeAtMs ?? 0
  if (lastNudge && input.nowMs - lastNudge < CAPABILITY_NUDGE_INTERVAL_MS) return null

  const used = new Set(input.usedModules.flatMap((module) => [module, ...(MODULE_COVERS[module] ?? [])]))
  const enabled = new Set(input.enabledModules)
  const candidates = (Object.keys(ADJACENT_PHRASE) as SecretaryModule[]).filter(
    (module) => enabled.has(module) && !used.has(module),
  )
  if (candidates.length === 0) return null

  const modules = candidates.slice(0, MAX_NUDGED_CAPABILITIES)
  const phrases = modules.map((module) => ADJACENT_PHRASE[module] as string)
  const joined = phrases.length > 1 ? `${phrases.slice(0, -1).join(", ")} or ${phrases.at(-1)}` : phrases[0]
  return { line: `I can also check ${joined} — just ask.`, modules }
}
