/**
 * SVC Directory — derived data layer for unified search and presentation.
 *
 * Maps existing /contacts and /contexts documents into a normalized
 * taxonomy: person | company | job | other.
 *
 * ARCHITECTURE DECISIONS (v2):
 *  - Composite IDs: every Directory entity is keyed `{type}__{sourceId}` so
 *    /contacts and /contexts can never collide in /directoryIndex.
 *  - Fully derived + regenerable: /contacts and /contexts remain the sole
 *    source of truth. This module never writes to them.
 *  - Job → Company is NOT resolved yet. The Jobs "Company" field actually
 *    holds a location string, so it is normalized as `location` and
 *    `companyEntityId` stays null.
 *  - Person → Company IS resolved when a matching Company context exists
 *    (via an injectable resolver), otherwise companyEntityId is null.
 *  - The index carries display + search fields (normalizedName, aliases,
 *    keywords, role, location, companyName, companyEntityId, quality flags)
 *    plus a compact projection (DirectorySearchDoc) for a MiniSearch index
 *    that the client can build lazily on Directory open and cache locally.
 */

import type { ImportedContact, ImportedContactPoint, ImportedContactAddress, AppContext, ContextField } from "./store"

// ── Directory taxonomy ──────────────────────────────────────────────────

export type DirectoryType = "person" | "company" | "job" | "other"

// ── Composite ID helpers ────────────────────────────────────────────────

export function directoryId(type: DirectoryType, sourceId: string): string {
  return `${type}__${sourceId}`
}

export function parseDirectoryId(id: string): { type: DirectoryType; sourceId: string } | null {
  const idx = id.indexOf("__")
  if (idx === -1) return null
  const type = id.slice(0, idx) as DirectoryType
  const sourceId = id.slice(idx + 2)
  if (!["person", "company", "job", "other"].includes(type) || !sourceId) return null
  return { type, sourceId }
}

// ── Normalized Directory entries ────────────────────────────────────────

export interface DirectoryPerson {
  type: "person"
  sourceCollection: "contacts"
  sourceId: string
  name: string
  emails: ImportedContactPoint[]
  phones: ImportedContactPoint[]
  addresses: ImportedContactAddress[]
  urls: ImportedContactPoint[]
  company: string | null
  companies: string[]
  role: string | null
  roles: string[]
  tags: string[]
  notes: string | null
  linkedUserId: string | null
  source: string
  sourceSheet: string | null
  sourceRecordId: string | null
  sourceCompanyId: string | null
  visibility: string
}

export interface DirectoryCompany {
  type: "company"
  sourceCollection: "contexts"
  sourceId: string
  name: string
  description: string | null
  phone: string | null
  address: string | null
  timezone: string | null
  website: string | null
  sourceSheet: string | null
  sourceRecordId: string | null
  fields: ContextField[]
}

export interface DirectoryJob {
  type: "job"
  sourceCollection: "contexts"
  sourceId: string
  name: string
  description: string | null
  address: string | null
  /** From the Jobs "Company" column, which actually contains a location string. */
  location: string | null
  /** Always null for now — job→company resolution is deferred. */
  companyEntityId: string | null
  projectManager: string | null
  projectLead: string | null
  status: string | null
  estimatedStartDate: string | null
  confirmedStartDate: string | null
  durationWeeks: string | null
  relatedContacts: string | null
  sourceSheet: string | null
  sourceRecordId: string | null
  fields: ContextField[]
}

export interface DirectoryOther {
  type: "other"
  sourceCollection: "contacts" | "contexts"
  sourceId: string
  name: string
  description: string | null
  fields: ContextField[]
  sourceSheet: string | null
  sourceRecordId: string | null
}

export type DirectoryEntry = DirectoryPerson | DirectoryCompany | DirectoryJob | DirectoryOther

// ── DirectoryIndex — derived doc for display + search ───────────────────

export interface DirectoryQualityFlags {
  hasEmail: boolean
  hasPhone: boolean
  hasCompany: boolean
  hasRole: boolean
  hasLocation: boolean
  isLinkedUser: boolean
  /** True when the entry has enough signal to present cleanly. */
  isComplete: boolean
  /** Human-readable data-quality warnings. */
  issues: string[]
}

export interface DirectoryIndexEntry {
  id: string                         // composite id — e.g. person__abc123
  type: DirectoryType
  sourceCollection: "contacts" | "contexts"
  sourceId: string
  name: string
  normalizedName: string             // accent-stripped, lowercased, collapsed
  aliases: string[]                  // alternate identifiers (email local parts, etc.)
  keywords: string[]                 // deduped significant tokens for search
  searchText: string                 // full lowercase haystack (fallback search)
  subtitle: string | null            // "Role @ Company" / address / description
  email: string | null               // primary email
  phone: string | null               // primary phone
  role: string | null
  location: string | null            // person address locality / job location
  companyName: string | null         // parent company display name
  companyEntityId: string | null     // composite company id when resolved, else null
  linkedUserId: string | null        // Firebase Auth UID when this person registered
  sourceSheet: string | null
  sourceRecordId: string | null
  quality: DirectoryQualityFlags
  updatedAt: Date
}

// ── Compact projection for a MiniSearch index ───────────────────────────

/**
 * The minimal per-entity document a client feeds into MiniSearch.
 * Kept tiny so the full ~7.6k-doc index can be shipped once on Directory
 * open and cached in localStorage/IndexedDB.
 */
export interface DirectorySearchDoc {
  id: string
  type: DirectoryType
  name: string
  aliases: string      // space-joined
  keywords: string     // space-joined
  companyName: string
  location: string
  role: string
  subtitle: string
}

/**
 * Shared MiniSearch configuration. Import this on the client so the index
 * built from DirectorySearchDoc[] behaves identically everywhere.
 */
export const DIRECTORY_MINISEARCH_CONFIG = {
  idField: "id",
  fields: ["name", "aliases", "keywords", "companyName", "location", "role"],
  storeFields: ["type", "name", "subtitle", "companyName", "location"],
  searchOptions: {
    boost: { name: 3, aliases: 2, companyName: 1.5 },
    prefix: true,
    fuzzy: 0.2,
  },
} as const

export function buildSearchDoc(entry: DirectoryIndexEntry): DirectorySearchDoc {
  return {
    id: entry.id,
    type: entry.type,
    name: entry.name,
    aliases: entry.aliases.join(" "),
    keywords: entry.keywords.join(" "),
    companyName: entry.companyName ?? "",
    location: entry.location ?? "",
    role: entry.role ?? "",
    subtitle: entry.subtitle ?? "",
  }
}

// ── Classification ──────────────────────────────────────────────────────

export function classifyContext(ctx: AppContext): DirectoryType {
  const kind = getFieldValue(ctx.fields, "Kind")?.toLowerCase() ?? ""
  const sheet = ctx.sourceSheet?.toLowerCase() ?? ""

  if (kind === "company" || sheet === "companies") return "company"
  if (kind === "project/job" || kind === "job" || sheet === "jobs") return "job"

  // Heuristic fallbacks for contexts without an explicit Kind field
  if (hasAnyField(ctx.fields, ["Phone", "Website", "Timezone"])) return "company"
  if (hasAnyField(ctx.fields, ["Project Manager", "Project Lead", "Duration in Weeks", "Job Rate"])) return "job"

  return "other"
}

// ── Normalizers ─────────────────────────────────────────────────────────

export function normalizeContact(contact: ImportedContact): DirectoryPerson {
  return {
    type: "person",
    sourceCollection: "contacts",
    sourceId: contact.id,
    name: contact.name,
    emails: contact.emails ?? (contact.email ? [{ label: "email", value: contact.email, normalized: contact.emailNormalized }] : []),
    phones: contact.phones ?? (contact.phone ? [{ label: "phone", value: contact.phone, normalized: contact.phoneNormalized }] : []),
    addresses: contact.addresses ?? [],
    urls: contact.urls ?? [],
    company: contact.company ?? null,
    companies: contact.companies ?? (contact.company ? [contact.company] : []),
    role: contact.role ?? null,
    roles: contact.roles ?? (contact.role ? [contact.role] : []),
    tags: contact.tags ?? [],
    notes: contact.notes ?? null,
    linkedUserId: contact.linkedUserId ?? null,
    source: contact.source,
    sourceSheet: contact.sourceSheet ?? null,
    sourceRecordId: contact.sourceRecordId ?? null,
    sourceCompanyId: contact.sourceCompanyId ?? null,
    visibility: contact.visibility ?? "private",
  }
}

export function normalizeCompanyContext(ctx: AppContext): DirectoryCompany {
  return {
    type: "company",
    sourceCollection: "contexts",
    sourceId: ctx.id,
    name: ctx.name,
    description: ctx.description ?? null,
    phone: getFieldValue(ctx.fields, "Phone"),
    address: getFieldValue(ctx.fields, "Address"),
    timezone: getFieldValue(ctx.fields, "Timezone"),
    website: getFieldValue(ctx.fields, "Website"),
    sourceSheet: ctx.sourceSheet ?? null,
    sourceRecordId: ctx.sourceRecordId ?? null,
    fields: ctx.fields,
  }
}

export function normalizeJobContext(ctx: AppContext): DirectoryJob {
  return {
    type: "job",
    sourceCollection: "contexts",
    sourceId: ctx.id,
    name: ctx.name,
    description: ctx.description ?? null,
    address: getFieldValue(ctx.fields, "Address"),
    // The Jobs "Company" column holds a location string, not a company name.
    location: getFieldValue(ctx.fields, "Company"),
    companyEntityId: null,
    projectManager: getFieldValue(ctx.fields, "Project Manager"),
    projectLead: getFieldValue(ctx.fields, "Project Lead"),
    status: getFieldValue(ctx.fields, "Status"),
    estimatedStartDate: getFieldValue(ctx.fields, "Estimated Start Date"),
    confirmedStartDate: getFieldValue(ctx.fields, "Confirmed Start Date"),
    durationWeeks: getFieldValue(ctx.fields, "Duration in Weeks"),
    relatedContacts: getFieldValue(ctx.fields, "Related Contacts"),
    sourceSheet: ctx.sourceSheet ?? null,
    sourceRecordId: ctx.sourceRecordId ?? null,
    fields: ctx.fields,
  }
}

export function normalizeOtherContext(ctx: AppContext): DirectoryOther {
  return {
    type: "other",
    sourceCollection: "contexts",
    sourceId: ctx.id,
    name: ctx.name,
    description: ctx.description ?? null,
    fields: ctx.fields,
    sourceSheet: ctx.sourceSheet ?? null,
    sourceRecordId: ctx.sourceRecordId ?? null,
  }
}

export function normalizeContext(ctx: AppContext): DirectoryEntry {
  switch (classifyContext(ctx)) {
    case "company": return normalizeCompanyContext(ctx)
    case "job": return normalizeJobContext(ctx)
    default: return normalizeOtherContext(ctx)
  }
}

// ── Index builders ──────────────────────────────────────────────────────

export interface DirectoryBuildContext {
  now?: Date
  /** Resolve a company display name to a composite company id, or null. */
  resolveCompanyId?: (companyName: string) => string | null
}

export function buildPersonIndex(person: DirectoryPerson, ctx: DirectoryBuildContext = {}): DirectoryIndexEntry {
  const now = ctx.now ?? new Date()
  const primaryEmail = person.emails.find(e => e.isPrimary)?.value ?? person.emails[0]?.value ?? null
  const primaryPhone = person.phones.find(p => p.isPrimary)?.value ?? person.phones[0]?.value ?? null
  const location = person.addresses[0]?.locality ?? extractLocality(person.addresses[0]?.formatted) ?? null
  const subtitle = [person.role, person.company].filter(Boolean).join(" @ ") || null
  const companyEntityId = person.company ? (ctx.resolveCompanyId?.(person.company) ?? null) : null

  const emailLocalParts = person.emails
    .map(e => (e.normalized ?? e.value)?.split("@")[0])
    .filter(Boolean) as string[]

  const aliases = uniqueStrings([
    ...emailLocalParts,
    ...person.companies,
  ])

  const keywords = extractKeywords([
    person.name,
    person.role,
    ...person.roles,
    person.company,
    ...person.companies,
    ...person.tags,
    location,
  ])

  const searchText = lowerJoin([
    person.name,
    ...person.emails.flatMap(e => [e.value, e.normalized]),
    ...person.phones.flatMap(p => [p.value, p.normalized]),
    person.company, ...person.companies,
    person.role, ...person.roles,
    person.notes,
    ...person.tags,
    ...person.addresses.map(a => a.formatted),
  ])

  const quality = personQuality(person, companyEntityId)

  return {
    id: directoryId("person", person.sourceId),
    type: "person",
    sourceCollection: "contacts",
    sourceId: person.sourceId,
    name: person.name,
    normalizedName: normalizeName(person.name),
    aliases,
    keywords,
    searchText,
    subtitle,
    email: primaryEmail,
    phone: primaryPhone,
    role: person.role,
    location,
    companyName: person.company,
    companyEntityId,
    linkedUserId: person.linkedUserId,
    sourceSheet: person.sourceSheet,
    sourceRecordId: person.sourceRecordId,
    quality,
    updatedAt: now,
  }
}

export function buildCompanyIndex(company: DirectoryCompany, ctx: DirectoryBuildContext = {}): DirectoryIndexEntry {
  const now = ctx.now ?? new Date()
  const location = extractLocality(company.address) ?? null
  const subtitle = [company.address, company.phone].filter(Boolean).join(" | ") || company.description || null

  const aliases = uniqueStrings([extractDomain(company.website)])
  // Include the full address so city/street tokens are searchable in the
  // compact index (the raw address is not shipped to MiniSearch otherwise).
  const keywords = extractKeywords([company.name, company.description, company.address, location])
  const searchText = lowerJoin([
    company.name, company.description, company.phone,
    company.address, company.timezone, company.website,
    ...company.fields.map(f => f.value),
  ])
  const quality = companyQuality(company)

  return {
    id: directoryId("company", company.sourceId),
    type: "company",
    sourceCollection: "contexts",
    sourceId: company.sourceId,
    name: company.name,
    normalizedName: normalizeName(company.name),
    aliases,
    keywords,
    searchText,
    subtitle,
    email: null,
    phone: company.phone,
    role: null,
    location,
    companyName: null,
    companyEntityId: null,
    linkedUserId: null,
    sourceSheet: company.sourceSheet,
    sourceRecordId: company.sourceRecordId,
    quality,
    updatedAt: now,
  }
}

export function buildJobIndex(job: DirectoryJob, ctx: DirectoryBuildContext = {}): DirectoryIndexEntry {
  const now = ctx.now ?? new Date()
  const location = job.location ?? extractLocality(job.address) ?? null
  const subtitle = [job.status, job.location, job.address].filter(Boolean).join(" | ") || job.description || null

  const aliases: string[] = []
  // PM/Lead fields are "Name / email / phone" — keep only the name segment so
  // keywords aren't polluted with email/phone fragments. Add the address for
  // searchable city tokens.
  const keywords = extractKeywords([job.name, job.status, location, job.address, nameSegment(job.projectManager), nameSegment(job.projectLead)])
  const searchText = lowerJoin([
    job.name, job.description, job.address, job.location,
    job.projectManager, job.projectLead, job.status, job.relatedContacts,
    ...job.fields.map(f => f.value),
  ])
  const quality = jobQuality(job)

  return {
    id: directoryId("job", job.sourceId),
    type: "job",
    sourceCollection: "contexts",
    sourceId: job.sourceId,
    name: job.name,
    normalizedName: normalizeName(job.name),
    aliases,
    keywords,
    searchText,
    subtitle,
    email: null,
    phone: null,
    role: null,
    location,
    companyName: null,
    companyEntityId: job.companyEntityId, // always null for now
    linkedUserId: null,
    sourceSheet: job.sourceSheet,
    sourceRecordId: job.sourceRecordId,
    quality,
    updatedAt: now,
  }
}

export function buildOtherIndex(other: DirectoryOther, ctx: DirectoryBuildContext = {}): DirectoryIndexEntry {
  const now = ctx.now ?? new Date()
  const keywords = extractKeywords([other.name, other.description])
  const searchText = lowerJoin([other.name, other.description, ...other.fields.map(f => f.value)])

  return {
    id: directoryId("other", other.sourceId),
    type: "other",
    sourceCollection: other.sourceCollection,
    sourceId: other.sourceId,
    name: other.name,
    normalizedName: normalizeName(other.name),
    aliases: [],
    keywords,
    searchText,
    subtitle: other.description,
    email: null,
    phone: null,
    role: null,
    location: null,
    companyName: null,
    companyEntityId: null,
    linkedUserId: null,
    sourceSheet: other.sourceSheet,
    sourceRecordId: other.sourceRecordId,
    quality: {
      hasEmail: false, hasPhone: false, hasCompany: false, hasRole: false,
      hasLocation: false, isLinkedUser: false,
      isComplete: !!other.name.trim(),
      issues: other.name.trim() ? [] : ["Missing name"],
    },
    updatedAt: now,
  }
}

export function buildDirectoryIndex(entry: DirectoryEntry, ctx: DirectoryBuildContext = {}): DirectoryIndexEntry {
  switch (entry.type) {
    case "person": return buildPersonIndex(entry, ctx)
    case "company": return buildCompanyIndex(entry, ctx)
    case "job": return buildJobIndex(entry, ctx)
    case "other": return buildOtherIndex(entry, ctx)
  }
}

// ── Quality scoring ─────────────────────────────────────────────────────

function personQuality(person: DirectoryPerson, companyEntityId: string | null): DirectoryQualityFlags {
  const hasEmail = person.emails.length > 0
  const hasPhone = person.phones.length > 0
  const hasCompany = !!person.company
  const hasRole = !!person.role
  const hasLocation = person.addresses.length > 0
  const isLinkedUser = !!person.linkedUserId
  const issues: string[] = []
  if (!person.name.trim()) issues.push("Missing name")
  if (!hasEmail && !hasPhone) issues.push("No email or phone")
  if (!hasCompany) issues.push("No company")
  else if (!companyEntityId) issues.push("Company not resolved to an entity")
  if (!hasRole) issues.push("No role")
  return {
    hasEmail, hasPhone, hasCompany, hasRole, hasLocation, isLinkedUser,
    isComplete: !!person.name.trim() && (hasEmail || hasPhone),
    issues,
  }
}

function companyQuality(company: DirectoryCompany): DirectoryQualityFlags {
  const hasPhone = !!company.phone
  const hasLocation = !!company.address
  const hasWebsite = !!company.website
  const issues: string[] = []
  if (!company.name.trim()) issues.push("Missing name")
  if (!hasPhone && !hasLocation && !hasWebsite) issues.push("No phone, address, or website")
  return {
    hasEmail: false, hasPhone, hasCompany: false, hasRole: false,
    hasLocation, isLinkedUser: false,
    isComplete: !!company.name.trim() && (hasPhone || hasLocation || hasWebsite),
    issues,
  }
}

function jobQuality(job: DirectoryJob): DirectoryQualityFlags {
  const hasLocation = !!(job.location || job.address)
  const issues: string[] = []
  if (!job.name.trim()) issues.push("Missing name")
  if (!job.status) issues.push("No status")
  if (!hasLocation) issues.push("No location or address")
  return {
    hasEmail: false, hasPhone: false, hasCompany: false, hasRole: false,
    hasLocation, isLinkedUser: false,
    isComplete: !!job.name.trim(),
    issues,
  }
}

// ── Company resolver builder ────────────────────────────────────────────

/**
 * Builds a name→composite-company-id resolver from the classified company set.
 * Used to fill DirectoryPerson.companyEntityId when a matching company exists.
 */
export function buildCompanyResolver(companies: DirectoryCompany[]): (name: string) => string | null {
  const byName = new Map<string, string>()
  for (const c of companies) {
    byName.set(normalizeName(c.name), directoryId("company", c.sourceId))
  }
  return (name: string) => byName.get(normalizeName(name)) ?? null
}

// ── Relationship detection ──────────────────────────────────────────────

export interface DirectoryRelationship {
  fromType: DirectoryType
  fromId: string
  fromName: string
  toType: DirectoryType
  toId: string
  toName: string
  relation: string
}

export function detectPersonCompanyRelations(
  people: DirectoryPerson[],
  companies: DirectoryCompany[]
): DirectoryRelationship[] {
  const resolve = buildCompanyResolver(companies)
  const companyById = new Map(companies.map(c => [directoryId("company", c.sourceId), c]))
  const relations: DirectoryRelationship[] = []
  for (const person of people) {
    if (!person.company) continue
    const compositeId = resolve(person.company)
    if (!compositeId) continue
    const company = companyById.get(compositeId)!
    relations.push({
      fromType: "person",
      fromId: directoryId("person", person.sourceId),
      fromName: person.name,
      toType: "company",
      toId: compositeId,
      toName: company.name,
      relation: person.role ?? "employee",
    })
  }
  return relations
}

// ── FUTURE (not applied) — message projection ───────────────────────────

/**
 * Messages could later gain a derived `relatedEntityIds: string[]` of composite
 * Directory IDs, computed from their existing recipientIds / peopleIds /
 * contactIds / contextIds:
 *
 *   contactIds  → person__{contactId}
 *   contextIds  → {company|job|other}__{contextId}   (via classifyContext)
 *   peopleIds / recipientIds → person__{uid} if the uid maps to a linked contact
 *
 * This would be a read-only projection layered on top for "mentioned in N
 * messages" style lookups. It must never become a source-of-truth field and
 * must not change how messages are written today.
 */
export type MessageRelatedEntityIds = string[]

export function projectMessageRelatedEntityIds(message: {
  contactIds?: string[]
  contextIds?: string[]
}, classifyContextId: (contextId: string) => DirectoryType): MessageRelatedEntityIds {
  const ids = new Set<string>()
  for (const cid of message.contactIds ?? []) ids.add(directoryId("person", cid))
  for (const ctxId of message.contextIds ?? []) ids.add(directoryId(classifyContextId(ctxId), ctxId))
  return [...ids]
}

// ── Text helpers ─────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  "the", "and", "for", "inc", "llc", "co", "ltd", "of", "a", "an", "to", "in",
  "on", "at", "by", "with", "de", "la", "el", "los", "las",
])

export function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
}

export function normalizeName(value: string): string {
  return stripAccents(String(value ?? "")).toLowerCase().replace(/\s+/g, " ").trim()
}

function tokenize(value: string): string[] {
  return stripAccents(String(value ?? ""))
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(t => t.length >= 2 && !STOPWORDS.has(t))
}

function extractKeywords(values: Array<string | null | undefined>): string[] {
  const set = new Set<string>()
  for (const v of values) {
    if (!v) continue
    for (const t of tokenize(v)) set.add(t)
  }
  return [...set]
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const set = new Set<string>()
  for (const v of values) {
    const cleaned = (v ?? "").trim()
    if (cleaned) set.add(cleaned)
  }
  return [...set]
}

function lowerJoin(values: Array<string | null | undefined>): string {
  return values.filter(Boolean).join(" ").toLowerCase()
}

/** Best-effort locality from a formatted address ("123 Main St, Trenton, NJ"). */
function extractLocality(formatted?: string | null): string | null {
  if (!formatted) return null
  const parts = formatted.split(",").map(p => p.trim()).filter(Boolean)
  if (parts.length >= 2) return parts.slice(-2).join(", ")
  return parts[0] ?? null
}

function extractDomain(website?: string | null): string | null {
  if (!website) return null
  const m = website.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0]
  return m || null
}

/** First segment of a "Name / email / phone" reference — the person's name. */
function nameSegment(value?: string | null): string | null {
  if (!value) return null
  return value.split("/")[0].trim() || null
}

function getFieldValue(fields: ContextField[], label: string): string | null {
  const field = fields.find(f => f.label.toLowerCase() === label.toLowerCase())
  return field?.value?.trim() || null
}

function hasAnyField(fields: ContextField[], labels: string[]): boolean {
  const normalized = new Set(labels.map(l => l.toLowerCase()))
  return fields.some(f => normalized.has(f.label.toLowerCase()) && f.value?.trim())
}
