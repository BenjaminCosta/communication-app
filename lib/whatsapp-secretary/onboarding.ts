import type { SecretaryModule } from "@/lib/whatsapp-secretary/tool-registry"
import type { SelfContextSnapshot } from "@/lib/whatsapp-secretary/self-context"
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

const MAX_STANDALONE_EXAMPLES = 3

/**
 * The full introduction, sent on its own when the sender's message was just a
 * greeting or a "what can you do" — there is no separate answer to attach it
 * to, so this IS the answer.
 */
export function buildStandaloneIntroduction(snapshot: SelfContextSnapshot, decision: Extract<IntroductionDecision, { show: true }>): string {
  const examples = buildPersonalizedExamples(snapshot).slice(0, MAX_STANDALONE_EXAMPLES)
  const opening =
    decision.reason === "first-contact"
      ? `Hi ${firstName(snapshot.identity.name)} — I'm the SVC AI Secretary.`
      : `Hi ${firstName(snapshot.identity.name)} — quick catch-up on what I can do for you.`

  return [
    opening,
    recognitionLine(snapshot),
    ...(decision.reason === "capabilities-changed" ? [newCapabilityLine(decision.newModules)] : []),
    coverageLine(snapshot),
    "Ask me anything in plain English — follow-ups work, and I'll say so when something isn't on file.",
    ...(examples.length > 0 ? ["Try:", ...examples.map((example) => `• ${example}`)] : []),
  ]
    .filter(Boolean)
    .join("\n")
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
      ? `Hi ${firstName(snapshot.identity.name)} — I'm the SVC AI Secretary. ${recognitionLine(snapshot)}`
      : `Hi ${firstName(snapshot.identity.name)} — ${recognitionLine(snapshot).replace(/^I know you as/, "still have you as")}`
  return `${opening} Ask “what can you do?” any time.`
}
