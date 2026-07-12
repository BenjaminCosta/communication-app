/**
 * SVC Directory — narrative "About" descriptions.
 *
 * A single 2–3 sentence paragraph that reads like a human interpretation of the
 * entity, assembled from prioritized narrative BLOCKS (identity → operational
 * context → recent activity) rather than one rigid template. Each block is
 * conditional on available data, phrasing varies between a few variants chosen
 * DETERMINISTICALLY (stable per entity, never random), and nothing is invented.
 *
 * Gender-safe: never uses he/she/his/her (we don't store gender) — it uses the
 * name, the first name, or subjectless sentences instead.
 *
 * Pure and dependency-light: safe to call from a `useMemo` on profile load; no
 * LLM call. Returns the text plus metadata (which fields it used + a data hash)
 * so a caller could later persist/regenerate it only when inputs change.
 */

import type {
  CompanyProfileViewModel,
  DirectoryProfileViewModel,
  JobProfileViewModel,
  PersonProfileViewModel,
} from "@/lib/directory-view-models"
import type { DirectoryRelations } from "@/lib/directory-relations"
import type { DirectoryActivitySummary } from "@/lib/directory-activity"

export interface DirectoryDescription {
  text: string
  /** Which data points the description drew from (for debugging/regeneration). */
  generatedFrom: string[]
  /** Hash of the inputs — changes only when the description should change. */
  dataVersion: string
  generatedAt: Date
}

// ── Text helpers ─────────────────────────────────────────────────────────────

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"]

function numberWord(n: number): string {
  return n >= 0 && n <= 12 ? NUMBER_WORDS[n] : String(n)
}

function noun(n: number, singular: string, pluralForm?: string): string {
  return n === 1 ? singular : (pluralForm ?? `${singular}s`)
}

function count(n: number, singular: string, pluralForm?: string): string {
  return `${numberWord(n)} ${noun(n, singular, pluralForm)}`
}

function firstName(full: string): string {
  return full.trim().split(/\s+/)[0] || full
}

function capitalize(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value
}

function lowerFirst(value: string): string {
  return value ? value.charAt(0).toLowerCase() + value.slice(1) : value
}

function aOrAn(word: string): string {
  return /^[aeiou]/i.test(word.trim()) ? "an" : "a"
}

function ensureSentence(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ""
  const capped = capitalize(trimmed)
  return /[.!?]$/.test(capped) ? capped : `${capped}.`
}

/** "A, B and C" for positive lists. */
function humanList(items: string[]): string {
  const unique = [...new Set(items.filter(Boolean))]
  if (unique.length === 0) return ""
  if (unique.length === 1) return unique[0]
  if (unique.length === 2) return `${unique[0]} and ${unique[1]}`
  return `${unique.slice(0, -1).join(", ")}, and ${unique[unique.length - 1]}`
}

/** "A, B or C" for negative/missing lists ("no A, B or C"). */
function negativeList(items: string[]): string {
  const unique = [...new Set(items.filter(Boolean))]
  if (unique.length === 0) return ""
  if (unique.length === 1) return unique[0]
  if (unique.length === 2) return `${unique[0]} or ${unique[1]}`
  return `${unique.slice(0, -1).join(", ")}, or ${unique[unique.length - 1]}`
}

function weeksPhrase(duration: string | null): string | null {
  if (!duration) return null
  const n = Number(duration)
  if (Number.isFinite(n) && n > 0) return count(n, "week")
  return `${duration} weeks` // non-numeric ranges like "8-10"
}

function relativeWhen(date: Date): string {
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000)
  if (days <= 0) return "today"
  if (days === 1) return "yesterday"
  if (days < 7) return `${numberWord(days)} days ago`
  if (days < 14) return "last week"
  if (days < 30) return `${count(Math.floor(days / 7), "week")} ago`
  if (days < 60) return "last month"
  const months = Math.floor(days / 30)
  if (months < 12) return `${count(months, "month")} ago`
  return date.toLocaleDateString(undefined, { month: "short", year: "numeric" })
}

function hashString(value: string): number {
  let hash = 5381
  for (let i = 0; i < value.length; i += 1) hash = (hash * 33) ^ value.charCodeAt(i)
  return Math.abs(hash)
}

function pickVariant<T>(seed: number, variants: T[]): T {
  return variants[seed % variants.length]
}

function assemble(sentences: Array<string | null | undefined>, from: string[]): DirectoryDescription {
  const text = sentences.filter((s): s is string => Boolean(s && s.trim())).slice(0, 3).join(" ").replace(/\s+/g, " ").trim()
  return { text, generatedFrom: [...new Set(from)], dataVersion: hashString(text).toString(36), generatedAt: new Date() }
}

// ── Recent-activity block (shared) ───────────────────────────────────────────

function recentBlock(activity: DirectoryActivitySummary | null, seed: number, from: string[]): string | null {
  if (!activity) return null
  if (activity.latestNoteAt) {
    from.push("latestNote")
    const when = relativeWhen(activity.latestNoteAt)
    return pickVariant(seed, [
      `The latest note was added ${when}.`,
      `The most recent activity was a note added ${when}.`,
    ])
  }
  if (activity.latestFileAt && activity.fileCount > 0) {
    from.push("files")
    return `${capitalize(count(activity.fileCount, "file"))} ${activity.fileCount === 1 ? "is" : "are"} stored on this profile.`
  }
  return null
}

// ── Person ───────────────────────────────────────────────────────────────────

function personDescription(
  vm: PersonProfileViewModel,
  relations: DirectoryRelations | null,
  activity: DirectoryActivitySummary | null,
): DirectoryDescription {
  const from: string[] = []
  const seed = hashString([vm.name, vm.role, vm.companyName, vm.isInternalUser, vm.location].join("|"))
  const fn = firstName(vm.name)
  const role = vm.role
  const company = vm.companyName
  const loc = vm.location

  // 1. Identity
  let identity: string
  if (role && company) {
    from.push("role", "company", vm.isInternalUser ? "internal" : "external")
    const rolePhrase = vm.isInternalUser ? `an internal ${role}` : `a ${role}`
    if (loc) from.push("location")
    identity = pickVariant(seed, [
      `${vm.name} is ${rolePhrase} at ${company}${loc ? `, based in ${loc}` : ""}.`,
      loc ? `Based in ${loc}, ${vm.name} works as ${rolePhrase} for ${company}.` : `${vm.name} works as ${rolePhrase} for ${company}.`,
      `${vm.name} is ${rolePhrase} at ${company}.`,
    ])
  } else if (role && !company) {
    from.push("role")
    if (loc) from.push("location")
    identity = `${vm.name} is a ${role}${loc ? ` based in ${loc}` : ""}.`
  } else if (!role && company) {
    from.push("company", vm.isInternalUser ? "internal" : "external")
    identity = `${vm.name} is ${vm.isInternalUser ? "an internal team member at" : "an external contact associated with"} ${company}.`
  } else {
    from.push(vm.isInternalUser ? "internal" : "external")
    if (loc) from.push("location")
    identity = loc
      ? `${vm.name} is ${vm.isInternalUser ? "an internal SVC user" : "an external contact"} based in ${loc}.`
      : `${vm.name} is ${vm.isInternalUser ? "an internal SVC user" : "an external contact"}.`
  }

  // 2. Operational context
  const jobCount = relations?.jobs.length ?? 0
  const currentJob = vm.currentJobName
  let operational: string | null = null
  if (jobCount > 0) {
    from.push("jobs")
    const including = currentJob ? `, including the ${currentJob}` : ""
    if (currentJob) from.push("currentJob")
    operational = pickVariant(seed, [
      `${fn} is currently connected to ${count(jobCount, "job")} in SVC${including}.`,
      `${fn} is connected to ${count(jobCount, "job")} in SVC${including}.`,
    ])
    if (!company) { operational = operational.replace(/\.$/, ", but no company has been confirmed."); from.push("missing") }
  } else if (currentJob) {
    from.push("currentJob")
    operational = `${fn}'s current work is on the ${currentJob}.`
  } else {
    const missing: string[] = []
    if (!currentJob) missing.push("current job")
    if (!role) missing.push("confirmed role")
    if (missing.length) { from.push("missing"); operational = `No ${negativeList(missing)} is available yet.` }
  }

  // 3. Recent activity
  const recent = recentBlock(activity, seed, from)

  return assemble([identity, operational, recent], from)
}

// ── Company ──────────────────────────────────────────────────────────────────

/** Turn a raw description into a predicate type phrase ("a general contractor"). */
function asType(description: string): string {
  const clean = lowerFirst(description.trim().replace(/\.$/, ""))
  if (/^(a |an |the )/i.test(clean)) return clean
  if (/s$/i.test(clean)) return clean // plural / "services" — no article
  return `${aOrAn(clean)} ${clean}`
}

function companyDescription(
  vm: CompanyProfileViewModel,
  relations: DirectoryRelations | null,
  activity: DirectoryActivitySummary | null,
): DirectoryDescription {
  const from: string[] = []
  const seed = hashString([vm.name, vm.description, vm.location, vm.website].join("|"))
  const people = relations?.people.length ?? 0
  const jobs = relations?.jobs.length ?? 0

  // 1. Lead — name + (optional type) + connections
  const typePhrase = vm.description ? asType(vm.description) : null
  if (vm.description) from.push("description")
  const connections: string[] = []
  if (people > 0) { connections.push(count(people, "person", "people")); from.push("people") }
  if (jobs > 0) { connections.push(count(jobs, "job")); from.push("jobs") }
  const connectClause = connections.length ? `connected to ${humanList(connections)} in SVC` : "tracked in the SVC directory"
  const lead = typePhrase
    ? `${vm.name} is ${typePhrase} ${connectClause}.`
    : `${vm.name} is ${connectClause}.`

  // 2. Location / recent
  let second: string | null = null
  const recent = activity?.latestNoteAt || activity?.latestFileAt
  if (recent) {
    const when = relativeWhen((activity!.latestNoteAt ?? activity!.latestFileAt)!)
    from.push("recent")
    second = `The latest update was added ${when}.`
  } else if (vm.location) {
    from.push("location")
    second = `It is based in ${vm.location}.`
  }

  // 3. Missing critical info (only if something notable is absent)
  let third: string | null = null
  if (jobs === 0 && !vm.website) { from.push("missing"); third = "No active jobs are linked yet, and the profile is missing a confirmed website." }
  else if (!vm.website && !vm.phone) { from.push("missing"); third = "The profile is still missing confirmed contact details." }

  return assemble([lead, second, third], from)
}

// ── Job ──────────────────────────────────────────────────────────────────────

function jobDescription(
  vm: JobProfileViewModel,
  relations: DirectoryRelations | null,
  activity: DirectoryActivitySummary | null,
): DirectoryDescription {
  const from: string[] = []
  const seed = hashString([vm.name, vm.status, vm.projectType, vm.companyName, vm.location].join("|"))
  const name = vm.name && vm.name !== "Unknown" ? vm.name : "This project"
  const status = vm.status
  const type = vm.projectType
  const company = vm.companyName
  const where = vm.location || vm.address

  // 1. Identity — status + type + company + location
  let identity: string
  if (type) {
    from.push("projectType")
    if (status) from.push("status")
    const head = `${aOrAn(status || type)} ${status ? `${status.toLowerCase()} ` : ""}${type.toLowerCase()}`
    identity = `${name} is ${head}${company ? ` for ${company}` : ""}${where ? `, located in ${where}` : ""}.`
    if (company) from.push("company")
    if (where) from.push("location")
  } else if (status) {
    from.push("status")
    if (where) from.push("location")
    identity = `${name} is ${aOrAn(status)} ${status.toLowerCase()} project${company ? ` for ${company}` : ""}${where ? ` in ${where}` : ""}.`
    if (company) from.push("company")
  } else {
    identity = `${name} is a project${company ? ` for ${company}` : ""}${where ? ` in ${where}` : ""}.`
    if (company) from.push("company")
    if (where) from.push("location")
  }

  // 2. Team + duration
  const lead = relations?.projectLead?.name ?? vm.projectLeadName
  const manager = relations?.projectManager?.name ?? vm.projectManagerName
  const weeks = weeksPhrase(vm.durationWeeks)
  const durationClause = weeks ? `, and the project is expected to run for ${weeks}` : ""
  let team: string | null = null
  if (lead) { from.push("projectLead"); if (weeks) from.push("duration"); team = `${lead} is assigned as Project Lead${durationClause}.` }
  else if (manager) { from.push("projectManager"); if (weeks) from.push("duration"); team = `${manager} is the Project Manager${durationClause}.` }
  else if (weeks) { from.push("duration"); team = `The project is expected to run for ${weeks}.` }

  // 3. Recent activity, or related counts + missing critical info
  let third: string | null = recentBlock(activity, seed, from)
  if (!third) {
    const contacts = relations ? (relations.contacts.length || relations.people.length) : 0
    const parts: string[] = []
    if (contacts > 0) { parts.push(count(contacts, "related contact")); from.push("contacts") }
    if (activity && activity.fileCount > 0) { parts.push(`${activity.fileCount} stored ${noun(activity.fileCount, "file")}`); from.push("files") }
    const missing: string[] = []
    if (!company) missing.push("parent company")
    if (!lead && !manager) missing.push("Project Manager")
    const missingClause = missing.length ? `no confirmed ${negativeList(missing)} ${missing.length > 1 ? "are" : "is"} currently linked` : ""
    if (missing.length) from.push("missing")
    if (parts.length && missingClause) third = `It has ${humanList(parts)}, but ${missingClause}.`
    else if (parts.length) third = `It has ${humanList(parts)}.`
    else if (missingClause) third = `${capitalize(missingClause)}.`
  }

  return assemble([identity, team, third], from)
}

// ── Other ────────────────────────────────────────────────────────────────────

function otherDescription(vm: DirectoryProfileViewModel & { type: "other" }): DirectoryDescription {
  const from: string[] = []
  const sentences: string[] = []
  if (vm.description) { from.push("description"); sentences.push(ensureSentence(vm.description)) }
  else sentences.push(`${vm.name} is a record in the SVC directory.`)
  return assemble(sentences, from)
}

// ── Dispatcher ───────────────────────────────────────────────────────────────

export function buildDirectoryDescription(
  vm: DirectoryProfileViewModel,
  relations: DirectoryRelations | null,
  activity: DirectoryActivitySummary | null,
): DirectoryDescription {
  switch (vm.type) {
    case "person": return personDescription(vm, relations, activity)
    case "company": return companyDescription(vm, relations, activity)
    case "job": return jobDescription(vm, relations, activity)
    default: return otherDescription(vm)
  }
}
