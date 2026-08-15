import type { SecretaryModule } from "@/lib/whatsapp-secretary/tool-registry"
import type { SelfContextSnapshot } from "@/lib/whatsapp-secretary/self-context"

/**
 * What this particular person is most likely to use the Secretary for.
 *
 * The catalog is broad enough now that "here is everything I can do" is the
 * wrong first message — it reads as a feature list and lands as noise. A Site
 * Supervisor and a recruiter want completely different first three examples,
 * and the Secretary already knows which one it is talking to.
 *
 * Two rules keep this honest, and they are the reason this file is data +
 * pure functions rather than anything the model touches:
 *
 * 1. **A role only ever *reorders* capabilities, never invents access.** The
 *    profile is intersected with the modules the sender's access policy really
 *    enabled, so a role string can never surface something they cannot reach.
 * 2. **An unrecognized or missing role falls through to what is actually on
 *    file** — their real linked jobs, projects and application records — never
 *    to a guess. Someone whose role is blank gets a profile derived from their
 *    relationships, and someone with neither gets the generic-but-true set.
 */

/** Coarse groupings that map onto how people actually describe their work. */
export type CapabilityAudience = "field-supervision" | "project-management" | "recruiting" | "operations" | "general"

/**
 * Matched against the person's role text, longest-first so "project manager"
 * wins over a bare "project". Deliberately small: a role we don't recognize is
 * a fallback case, not a reason to guess.
 */
const ROLE_PATTERNS: Array<{ pattern: RegExp; audience: CapabilityAudience }> = [
  { pattern: /\b(site supervisor|superintendent|foreman|field supervisor|site manager)\b/i, audience: "field-supervision" },
  { pattern: /\b(project manager|project lead|pm\b|estimator|scheduler)\b/i, audience: "project-management" },
  // Stems, not exact words: real titles are "Recruiting Coordinator" and
  // "Recruiter", and a trailing \b after "recruit" matches neither.
  { pattern: /\b(recruit\w*|talent|hiring|hr|human resources|people ops)\b/i, audience: "recruiting" },
  { pattern: /\b(operations|ops\b|coordinator|administrator|admin\b|office manager)\b/i, audience: "operations" },
]

/** Ordered most-relevant-first per audience. Intersected with real access before use. */
const AUDIENCE_MODULES: Record<CapabilityAudience, SecretaryModule[]> = {
  "field-supervision": ["reports", "clocking", "outlooks", "directory", "messages", "svc", "knowledge"],
  "project-management": ["outlooks", "reports", "questCoral", "directory", "messages", "svc", "knowledge"],
  recruiting: ["applications", "directory", "messages", "knowledge", "svc"],
  operations: ["questCoral", "reports", "messages", "directory", "outlooks", "svc", "knowledge"],
  general: ["directory", "svc", "knowledge", "reports", "outlooks", "questCoral", "messages"],
}

/** Short, human phrases — never internal module keys — for the "you'll probably use me for…" line. */
const MODULE_PHRASE: Record<SecretaryModule, string> = {
  directory: "people and contact lookup",
  questCoral: "Quest Coral projects",
  applications: "Applications and candidates",
  reports: "Daily Reports",
  clocking: "clock activity",
  outlooks: "3-Week Outlooks",
  messages: "Communications activity",
  knowledge: "how SVC works",
  me: "your own SVC context",
  svc: "job activity",
}

export function audienceForRole(role: string | null): CapabilityAudience | null {
  if (!role?.trim()) return null
  for (const { pattern, audience } of ROLE_PATTERNS) {
    if (pattern.test(role)) return audience
  }
  return null
}

/**
 * Derives an audience from what is genuinely linked to the person when their
 * role text is missing or unrecognized. This is the "don't invent" path: it
 * reads real records rather than guessing from a name or a company.
 */
export function audienceFromRelationships(snapshot: SelfContextSnapshot): CapabilityAudience {
  if (snapshot.application) return "recruiting"
  if (snapshot.projects.length > 0 && snapshot.jobs.length === 0) return "operations"
  if (snapshot.jobs.length > 0) return "field-supervision"
  return "general"
}

export interface CapabilityProfile {
  audience: CapabilityAudience
  /** True when the audience came from a recognized role rather than a fallback. */
  fromRole: boolean
  /** Enabled modules, ordered by likely usefulness to this person. */
  modules: SecretaryModule[]
  /** Human phrases for the top few, ready to drop into a sentence. */
  phrases: string[]
}

const MAX_HIGHLIGHTED = 5

/**
 * The ordered capability profile for one person.
 *
 * `enabledModules` is the hard boundary: anything the access policy did not
 * turn on is dropped before ordering, so this can only ever change *emphasis*.
 */
export function buildCapabilityProfile(snapshot: SelfContextSnapshot, enabledModules: SecretaryModule[]): CapabilityProfile {
  const fromRole = audienceForRole(snapshot.identity.role)
  const audience = fromRole ?? audienceFromRelationships(snapshot)
  const enabled = new Set(enabledModules)

  const preferred = AUDIENCE_MODULES[audience].filter((module) => enabled.has(module))
  // Anything enabled but not called out by the audience still belongs — it just
  // sorts after, so nothing the person can reach silently disappears.
  const remainder = enabledModules.filter((module) => !preferred.includes(module) && module !== "me")
  const modules = [...preferred, ...remainder]

  return {
    audience,
    fromRole: fromRole !== null,
    modules,
    phrases: modules.slice(0, MAX_HIGHLIGHTED).map((module) => MODULE_PHRASE[module]).filter(Boolean),
  }
}

/**
 * "For your work, you'll probably use me most for…" — stated only when there is
 * a real basis for it. With an unrecognized role the wording drops the
 * role claim and leans on what is actually linked to them instead, so the
 * sentence never implies SVC knows something it doesn't.
 */
export function capabilityFocusLine(profile: CapabilityProfile, snapshot: SelfContextSnapshot): string {
  if (profile.phrases.length === 0) return ""
  const listed = profile.phrases.slice(0, 4)
  const joined = listed.length > 1 ? `${listed.slice(0, -1).join(", ")} and ${listed.at(-1)}` : listed[0]

  if (profile.fromRole && snapshot.identity.role) {
    return `For ${snapshot.identity.role} work, you'll probably use me most for ${joined}.`
  }
  if (snapshot.jobs.length > 0 || snapshot.projects.length > 0) {
    return `Based on what's linked to you in SVC, you'll probably use me most for ${joined}.`
  }
  return `You can use me for ${joined}.`
}
