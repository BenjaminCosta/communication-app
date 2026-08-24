/**
 * SVC Directory — Profile View Models.
 *
 * The presentation layer NEVER consumes raw Firestore documents directly.
 * These builders take the derived /directoryIndex entry plus the raw source
 * doc (/contacts or /contexts, which carries the enriched `masterData` map)
 * and produce a clean, display-ready view model:
 *
 *   - canonical `masterData` values win over legacy top-level scalars;
 *   - emails / phones / urls / dates are validated, invalid values dropped;
 *   - available quick actions are derived from what data is actually present;
 *   - "main" data (Overview) is separated from technical/legacy/provenance
 *     data (Admin / Data Details), which stays collapsed by default;
 *   - everything tolerates missing fields and never throws on partial data.
 *
 * All validation/normalization reuses lib/directory-core (no duplicated logic).
 */

import {
  cleanValue,
  isLikelyEmail,
  isLikelyPhone,
  isLikelyUrl,
  type DirectoryType,
} from "@/lib/directory"

// ── Shared shapes ─────────────────────────────────────────────────────────

export type ProfileActionKind =
  | "call"
  | "email"
  | "directions"
  | "website"
  | "drive"
  | "edit"
  | "flag"
  | "merge"
  | "delete"

export interface ProfileAction {
  kind: ProfileActionKind
  label: string
  /** Native href for tel:/mailto:/maps/website/drive actions. Absent for in-app actions. */
  href?: string
  /** Raw value behind the action (phone number, email, address) for copy/analytics. */
  value?: string
  /** In-app actions are handled by the screen; native ones open `href`. */
  inApp?: boolean
  primary?: boolean
}

export type ProfileFieldKind = "text" | "email" | "phone" | "url" | "address" | "date" | "multiline"

export interface ProfileField {
  label: string
  value: string
  kind: ProfileFieldKind
  /** Native href when the field itself is actionable (email/phone/url/address). */
  href?: string
}

export interface AdminDataItem {
  label: string
  value: string
}

export interface ProfileQuality {
  isComplete: boolean
  issues: string[]
}

export interface BaseProfileViewModel {
  id: string
  type: DirectoryType
  sourceCollection: "contacts" | "contexts"
  sourceId: string
  name: string
  /** Small kicker under/above the name (role @ company, status, etc.). */
  headline: string | null
  location: string | null
  companyName: string | null
  companyEntityId: string | null
  actions: ProfileAction[]
  overview: ProfileField[]
  adminDetails: AdminDataItem[]
  quality: ProfileQuality
  /** Free-form counts other layers (summaries) can enrich. */
  needsReview: boolean
  /** Set alongside needsReview — preset reason (+ optional note) from whoever flagged it, or import provenance. Null for "other" (no masterData). */
  reviewReason: string | null
}

export interface PersonProfileViewModel extends BaseProfileViewModel {
  type: "person"
  role: string | null
  isInternalUser: boolean
  isActive: boolean | null
  linkedUserId: string | null
  primaryEmail: string | null
  primaryPhone: string | null
  emails: string[]
  phones: string[]
  addresses: string[]
  currentJobName: string | null
  currentJobEntityId: string | null
  photoUrl: string | null
  notes: string | null
}

export interface CompanyProfileViewModel extends BaseProfileViewModel {
  type: "company"
  phone: string | null
  address: string | null
  website: string | null
  description: string | null
  aliases: string[]
}

export interface JobProfileViewModel extends BaseProfileViewModel {
  type: "job"
  status: string | null
  address: string | null
  estimatedStartDate: string | null
  confirmedStartDate: string | null
  /** Pre-formatting raw value — what edits should round-trip through, not the humanized display string. */
  estimatedStartDateRaw: string | null
  confirmedStartDateRaw: string | null
  durationWeeks: string | null
  projectType: string | null
  operatingZone: string | null
  reportCadence: string | null
  driveFolderUrl: string | null
  operationalNotes: string | null
  projectManagerName: string | null
  projectLeadName: string | null
  isLegacyOrArchived: boolean
  /** Rendered only when the viewer is authorized (see `canViewSensitive`). */
  jobRate: string | null
  jobRateAmount: string | null
  jobRateCurrency: string | null
  jobRateUnit: string | null
}

export interface OtherProfileViewModel extends BaseProfileViewModel {
  type: "other"
  description: string | null
  fields: ProfileField[]
}

export type DirectoryProfileViewModel =
  | PersonProfileViewModel
  | CompanyProfileViewModel
  | JobProfileViewModel
  | OtherProfileViewModel

// ── Loose Firestore accessors (raw docs are untyped DocumentData) ──────────

type Loose = Record<string, unknown>

function asRecord(value: unknown): Loose {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Loose) : {}
}

function str(value: unknown): string {
  return cleanValue(typeof value === "string" ? value : value == null ? "" : String(value)) ?? ""
}

/** First non-empty cleaned string from candidates, or null. */
function firstStr(...candidates: unknown[]): string | null {
  for (const candidate of candidates) {
    const cleaned = str(candidate)
    if (cleaned) return cleaned
  }
  return null
}

function strArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => str(item)).filter(Boolean)
}

/** Contact-point / address arrays: pull `.value` | `.formatted` strings. */
function pointValues(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    const record = asRecord(entry)
    const candidate = str(record.value) || str(record.formatted)
    return candidate ? [candidate] : []
  })
}

function uniqueBy(values: string[], normalize: (v: string) => string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const key = normalize(value)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(value)
  }
  return out
}

/** Accepts ISO YYYY-MM-DD (produced by excelDate) or any already-clean string. */
function cleanDate(value: unknown): string | null {
  const raw = str(value)
  if (!raw) return null
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) {
    const date = new Date(`${iso[1]}-${iso[2]}-${iso[3]}T00:00:00Z`)
    if (Number.isNaN(date.getTime())) return raw
    return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" })
  }
  return raw
}

function bool(value: unknown): boolean | null {
  if (value === true || value === "1" || value === "true") return true
  if (value === false || value === "0" || value === "false") return false
  return null
}

/** Look up a legacy fields[] entry by label (case-insensitive). */
function fieldValue(fields: unknown, label: string): string | null {
  if (!Array.isArray(fields)) return null
  const match = fields.find((entry) => {
    const record = asRecord(entry)
    return str(record.label).toLowerCase() === label.toLowerCase()
  })
  return match ? firstStr(asRecord(match).value) : null
}

function mapsHref(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
}

function normalizedUrl(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`
}

// ── masterData confidence gate (mirrors directory-core's 0.75 rule) ────────

const SAFE_COMPANY_CONFIDENCE = 0.75

function companyIsSafe(master: Loose): boolean {
  const confidence = Number(master.companyMatchConfidence)
  return Number.isFinite(confidence) && confidence >= SAFE_COMPANY_CONFIDENCE
}

// ── Index-entry shape we consume (subset of DirectoryIndexEntry) ───────────

export interface ProfileIndexInput {
  id: string
  type: DirectoryType
  sourceCollection: "contacts" | "contexts"
  sourceId: string
  name?: string
  subtitle?: string | null
  role?: string | null
  location?: string | null
  companyName?: string | null
  companyEntityId?: string | null
  linkedUserId?: string | null
  quality?: { isComplete?: boolean; issues?: string[] } | null
}

export interface BuildProfileOptions {
  /** When true, sensitive fields (Job Rate) render in Overview; otherwise Admin-only. */
  canViewSensitive?: boolean
  /** When true (admins only), Merge duplicate / Delete actions are included. */
  canModerate?: boolean
}

// ── Person ─────────────────────────────────────────────────────────────────

export function buildPersonProfileViewModel(
  index: ProfileIndexInput,
  source: Loose,
  options: BuildProfileOptions = {},
): PersonProfileViewModel {
  const master = asRecord(source.masterData)
  const safeCompany = companyIsSafe(master)

  const name =
    firstStr(master.displayName, master.canonicalName, source.name, index.name) ?? "Unknown"
  const role = firstStr(master.roleName, source.role, index.role)
  const company = safeCompany
    ? firstStr(master.companyName, source.company, index.companyName)
    : firstStr(source.company, index.companyName)

  const emails = uniqueBy(
    [
      ...strArray(master.emails),
      str(master.primaryEmail),
      str(source.email),
      str(source.emailNormalized),
      ...pointValues(source.emails),
    ].filter((value) => isLikelyEmail(value)),
    (v) => v.toLowerCase(),
  )
  const phones = uniqueBy(
    [
      ...strArray(master.phones),
      str(master.primaryPhone),
      str(source.phone),
      ...pointValues(source.phones),
    ].filter((value) => isLikelyPhone(value)),
    (v) => v.replace(/\D/g, ""),
  )
  const addresses = uniqueBy(
    [str(master.address), ...pointValues(source.addresses)].filter(Boolean),
    (v) => v.toLowerCase().replace(/\s+/g, " "),
  )
  const urls = uniqueBy(
    [str(master.photoUrl), ...pointValues(source.urls)].filter((value) => isLikelyUrl(value)),
    (v) => v.toLowerCase(),
  )

  const primaryEmail = emails[0] ?? null
  const primaryPhone = phones[0] ?? null
  const isInternalUser = bool(master.isInternalUser) === true
  const isActive = bool(master.active)
  const linkedUserId = firstStr(source.linkedUserId, index.linkedUserId)
  const notes = firstStr(master.notes, source.notes)
  const location = firstStr(index.location, addresses[0])
  const currentJobName = firstStr(master.currentJobName)
  const currentJobContextId = safeCompany ? firstStr(master.currentJobContextId) : null
  const photoUrl = urls.find((url) => isLikelyUrl(url)) ?? null

  const overview: ProfileField[] = []
  if (primaryPhone) overview.push({ label: "Phone", value: primaryPhone, kind: "phone", href: `tel:${primaryPhone.replace(/[^\d+]/g, "")}` })
  if (primaryEmail) overview.push({ label: "Email", value: primaryEmail, kind: "email", href: `mailto:${primaryEmail}` })
  for (const email of emails.slice(1)) overview.push({ label: "Other email", value: email, kind: "email", href: `mailto:${email}` })
  for (const phone of phones.slice(1)) overview.push({ label: "Other phone", value: phone, kind: "phone", href: `tel:${phone.replace(/[^\d+]/g, "")}` })
  if (role) overview.push({ label: "Role", value: role, kind: "text" })
  if (company) overview.push({ label: "Company", value: company, kind: "text" })
  if (currentJobName) overview.push({ label: "Current job", value: currentJobName, kind: "text" })
  for (const address of addresses) overview.push({ label: "Address", value: address, kind: "address", href: mapsHref(address) })
  if (isActive != null) overview.push({ label: "Status", value: isActive ? "Active" : "Inactive", kind: "text" })
  if (notes) overview.push({ label: "Notes", value: notes, kind: "multiline" })

  const actions: ProfileAction[] = []
  if (primaryPhone) actions.push({ kind: "call", label: "Call", href: `tel:${primaryPhone.replace(/[^\d+]/g, "")}`, value: primaryPhone })
  if (primaryEmail) actions.push({ kind: "email", label: "Email", href: `mailto:${primaryEmail}`, value: primaryEmail })
  actions.push({ kind: "edit", label: "Edit Contact", inApp: true })
  actions.push({ kind: "flag", label: "Flag for review", inApp: true })
  if (options.canModerate) {
    actions.push({ kind: "merge", label: "Merge Duplicate", inApp: true })
    actions.push({ kind: "delete", label: "Delete Contact", inApp: true })
  }

  return {
    id: index.id,
    type: "person",
    sourceCollection: "contacts",
    sourceId: index.sourceId,
    name,
    headline: [role, company].filter(Boolean).join(" · ") || firstStr(index.subtitle),
    location,
    companyName: company,
    companyEntityId: safeCompany ? firstStr(index.companyEntityId) : null,
    role,
    isInternalUser,
    isActive,
    linkedUserId,
    primaryEmail,
    primaryPhone,
    emails,
    phones,
    addresses,
    currentJobName,
    currentJobEntityId: currentJobContextId ? `job__${currentJobContextId}` : null,
    photoUrl,
    notes,
    actions,
    overview,
    adminDetails: personAdminDetails(index, source, master),
    quality: buildQuality(index),
    needsReview: bool(master.needsReview) === true,
    reviewReason: firstStr(master.reviewReason),
  }
}

function personAdminDetails(index: ProfileIndexInput, source: Loose, master: Loose): AdminDataItem[] {
  const items: AdminDataItem[] = []
  const push = (label: string, value: string | null) => { if (value) items.push({ label, value }) }
  push("Canonical ID", firstStr(master.canonicalId))
  push("Directory ID", index.id)
  push("Source ID", firstStr(source.sourceRecordId, index.sourceId))
  push("Legacy contact IDs", strArray(master.legacyContactIds).join(", ") || null)
  push("Legacy user IDs", strArray(master.legacyUserIdentifiers).join(", ") || null)
  push("Source sheets", strArray(master.sourceSheets).join(", ") || null)
  push("Company match method", firstStr(master.companyMatchMethod))
  push("Company match confidence", master.companyMatchConfidence != null ? String(master.companyMatchConfidence) : null)
  push("Raw role values", strArray(master.roleRaw).join(", ") || null)
  push("Raw company values", strArray(master.sourceCompanyRaw).join(", ") || null)
  push("Linked user", firstStr(source.linkedUserId, index.linkedUserId))
  push("Needs review", bool(master.needsReview) === true ? "Yes" : null)
  push("Review reason", firstStr(master.reviewReason))
  return items
}

// ── Company ──────────────────────────────────────────────────────────────

export function buildCompanyProfileViewModel(
  index: ProfileIndexInput,
  source: Loose,
  options: BuildProfileOptions = {},
): CompanyProfileViewModel {
  const master = asRecord(source.masterData)
  const fields = source.fields

  const name = firstStr(master.displayName, master.canonicalName, source.name, index.name) ?? "Unknown"
  const phone = firstStr(master.phone, fieldValue(fields, "Phone"))
  const validPhone = phone && isLikelyPhone(phone) ? phone : null
  const address = firstStr(master.address, fieldValue(fields, "Address"))
  const websiteRaw = firstStr(master.website, fieldValue(fields, "Website"))
  const website = websiteRaw && isLikelyUrl(websiteRaw) ? websiteRaw : null
  const description = firstStr(master.description, source.description, fieldValue(fields, "Description"))
  const peopleInvolved = firstStr(fieldValue(fields, "People involved"), fieldValue(fields, "Related Contacts"))
  const aliases = uniqueBy(strArray(master.aliases), (v) => v.toLowerCase())
  const location = firstStr(index.location, address)

  const overview: ProfileField[] = []
  if (validPhone) overview.push({ label: "Phone", value: validPhone, kind: "phone", href: `tel:${validPhone.replace(/[^\d+]/g, "")}` })
  if (address) overview.push({ label: "Address", value: address, kind: "address", href: mapsHref(address) })
  if (website) overview.push({ label: "Website", value: website, kind: "url", href: normalizedUrl(website) })
  if (peopleInvolved) overview.push({ label: "People involved", value: peopleInvolved, kind: "text" })
  if (description) overview.push({ label: "Description", value: description, kind: "multiline" })

  const actions: ProfileAction[] = []
  if (validPhone) actions.push({ kind: "call", label: "Call", href: `tel:${validPhone.replace(/[^\d+]/g, "")}`, value: validPhone })
  if (website) actions.push({ kind: "website", label: "Website", href: normalizedUrl(website), value: website })
  if (address) actions.push({ kind: "directions", label: "Directions", href: mapsHref(address), value: address })
  actions.push({ kind: "edit", label: "Edit Company", inApp: true })
  actions.push({ kind: "flag", label: "Flag for review", inApp: true })
  if (options.canModerate) {
    actions.push({ kind: "merge", label: "Merge Duplicate", inApp: true })
    actions.push({ kind: "delete", label: "Delete Company", inApp: true })
  }

  return {
    id: index.id,
    type: "company",
    sourceCollection: "contexts",
    sourceId: index.sourceId,
    name,
    headline: location,
    location,
    companyName: null,
    companyEntityId: null,
    phone: validPhone,
    address,
    website,
    description,
    aliases,
    actions,
    overview,
    adminDetails: companyAdminDetails(index, source, master),
    quality: buildQuality(index),
    needsReview: bool(master.needsReview) === true,
    reviewReason: firstStr(master.reviewReason),
  }
}

function companyAdminDetails(index: ProfileIndexInput, source: Loose, master: Loose): AdminDataItem[] {
  const items: AdminDataItem[] = []
  const push = (label: string, value: string | null) => { if (value) items.push({ label, value }) }
  push("Canonical ID", firstStr(master.canonicalId))
  push("Directory ID", index.id)
  push("Source ID", firstStr(source.sourceRecordId, index.sourceId))
  push("Legacy company IDs", strArray(master.legacyCompanyIds).join(", ") || null)
  push("Merged record count", master.mergedRecordCount != null ? String(master.mergedRecordCount) : null)
  push("Aliases", strArray(master.aliases).join(", ") || null)
  push("Raw phone values", strArray(master.phoneRaw).join(", ") || null)
  push("Source rows", strArray(master.sourceRowIds).join(", ") || null)
  push("Needs review", bool(master.needsReview) === true ? "Yes" : null)
  push("Review reason", firstStr(master.reviewReason))
  return items
}

// ── Job ────────────────────────────────────────────────────────────────────

export function buildJobProfileViewModel(
  index: ProfileIndexInput,
  source: Loose,
  options: BuildProfileOptions = {},
): JobProfileViewModel {
  const master = asRecord(source.masterData)
  const fields = source.fields
  const safeCompany = companyIsSafe(master)

  const name = firstStr(master.canonicalName, source.name, index.name) ?? "Unknown"
  const status = firstStr(master.status, fieldValue(fields, "Status"))
  const address = firstStr(master.address, fieldValue(fields, "Address"))
  // The Jobs "Company" column is actually a location string (see docs).
  const location = firstStr(master.location, index.location, fieldValue(fields, "Location"), fieldValue(fields, "Company"))
  const company = safeCompany
    ? firstStr(master.companyName, index.companyName, fieldValue(fields, "Parent Company"))
    : firstStr(index.companyName)
  const companyEntityId = safeCompany ? firstStr(index.companyEntityId) : null

  const estimatedStartDateRaw = firstStr(master.estimatedStartDate, fieldValue(fields, "Estimated Start Date"))
  const confirmedStartDateRaw = firstStr(master.confirmedStartDate, fieldValue(fields, "Confirmed Start Date"))
  const estimatedStartDate = cleanDate(estimatedStartDateRaw)
  const confirmedStartDate = cleanDate(confirmedStartDateRaw)
  const durationWeeks = firstStr(
    master.durationWeeks != null ? String(master.durationWeeks) : null,
    fieldValue(fields, "Duration in Weeks"),
  )
  const projectType = firstStr(master.projectType, fieldValue(fields, "Project Type"))
  const operatingZone = firstStr(master.operatingZone, fieldValue(fields, "Operating Zone"))
  const reportCadence = firstStr(master.reportCadence, fieldValue(fields, "Report Cadence"))
  const driveRaw = firstStr(master.imageFolderUrl, fieldValue(fields, "Image Folder Url"))
  const driveFolderUrl = driveRaw && isLikelyUrl(driveRaw) ? normalizedUrl(driveRaw) : null
  const operationalNotes = firstStr(master.operationalNotes, fieldValue(fields, "Operational Notes"))
  const projectManagerName = firstStr(master.projectManagerName, fieldValue(fields, "Project Manager"))
  const projectLeadName = firstStr(master.projectLeadName, fieldValue(fields, "Project Lead"))
  const peopleInvolved = firstStr(fieldValue(fields, "People involved"), fieldValue(fields, "Related Contacts"))
  const isLegacyOrArchived = bool(master.isLegacyOrArchived) === true

  const jobRate = buildJobRate(master, fields)
  const jobRateAmount = firstStr(master.jobRateAmount != null ? String(master.jobRateAmount) : null, fieldValue(fields, "Job Rate Amount"))
  const jobRateCurrency = firstStr(master.jobRateCurrency, fieldValue(fields, "Job Rate Currency"))
  const jobRateUnit = firstStr(master.jobRateUnit, fieldValue(fields, "Job Rate Unit"))

  const overview: ProfileField[] = []
  if (company) overview.push({ label: "Company", value: company, kind: "text" })
  if (location) overview.push({ label: "Location", value: location, kind: "text" })
  if (address) overview.push({ label: "Address", value: address, kind: "address", href: mapsHref(address) })
  if (status) overview.push({ label: "Status", value: status, kind: "text" })
  if (projectType) overview.push({ label: "Project type", value: projectType, kind: "text" })
  if (operatingZone) overview.push({ label: "Operating zone", value: operatingZone, kind: "text" })
  if (estimatedStartDate) overview.push({ label: "Estimated start", value: estimatedStartDate, kind: "date" })
  if (confirmedStartDate) overview.push({ label: "Confirmed start", value: confirmedStartDate, kind: "date" })
  if (durationWeeks) overview.push({ label: "Duration", value: `${durationWeeks} weeks`, kind: "text" })
  if (reportCadence) overview.push({ label: "Report cadence", value: reportCadence, kind: "text" })
  if (projectManagerName) overview.push({ label: "Project manager", value: projectManagerName, kind: "text" })
  if (projectLeadName) overview.push({ label: "Project lead", value: projectLeadName, kind: "text" })
  if (peopleInvolved) overview.push({ label: "People involved", value: peopleInvolved, kind: "text" })
  if (driveFolderUrl) overview.push({ label: "Drive folder", value: "Open folder", kind: "url", href: driveFolderUrl })
  if (options.canViewSensitive && jobRate) overview.push({ label: "Job rate", value: jobRate, kind: "text" })
  if (operationalNotes) overview.push({ label: "Operational notes", value: operationalNotes, kind: "multiline" })

  const actions: ProfileAction[] = []
  if (address || location) {
    const target = address ?? location!
    actions.push({ kind: "directions", label: "Directions", href: mapsHref(target), value: target })
  }
  if (driveFolderUrl) actions.push({ kind: "drive", label: "Open Drive", href: driveFolderUrl, value: driveFolderUrl })
  actions.push({ kind: "edit", label: "Edit Job", inApp: true })
  actions.push({ kind: "flag", label: "Flag for review", inApp: true })
  if (options.canModerate) {
    actions.push({ kind: "merge", label: "Merge Duplicate", inApp: true })
    actions.push({ kind: "delete", label: "Delete Job", inApp: true })
  }

  return {
    id: index.id,
    type: "job",
    sourceCollection: "contexts",
    sourceId: index.sourceId,
    name,
    headline: [status, company].filter(Boolean).join(" · ") || location,
    location,
    companyName: company,
    companyEntityId,
    status,
    address,
    estimatedStartDate,
    confirmedStartDate,
    estimatedStartDateRaw,
    confirmedStartDateRaw,
    durationWeeks,
    projectType,
    operatingZone,
    reportCadence,
    driveFolderUrl,
    operationalNotes,
    projectManagerName,
    projectLeadName,
    isLegacyOrArchived,
    jobRate: options.canViewSensitive ? jobRate : null,
    jobRateAmount: options.canViewSensitive ? jobRateAmount : null,
    jobRateCurrency: options.canViewSensitive ? jobRateCurrency : null,
    jobRateUnit: options.canViewSensitive ? jobRateUnit : null,
    actions,
    overview,
    adminDetails: jobAdminDetails(index, source, master, jobRate),
    quality: buildQuality(index),
    needsReview: bool(master.needsReview) === true,
    reviewReason: firstStr(master.reviewReason),
  }
}

function buildJobRate(master: Loose, fields: unknown): string | null {
  const amount = firstStr(
    master.jobRateAmount != null ? String(master.jobRateAmount) : null,
    fieldValue(fields, "Job Rate Amount"),
  )
  if (!amount) return null
  const currency = firstStr(master.jobRateCurrency, fieldValue(fields, "Job Rate Currency")) ?? ""
  const unit = firstStr(master.jobRateUnit, fieldValue(fields, "Job Rate Unit"))
  return [`${currency}${amount}`.trim(), unit ? `/ ${unit}` : ""].filter(Boolean).join(" ")
}

function jobAdminDetails(index: ProfileIndexInput, source: Loose, master: Loose, jobRate: string | null): AdminDataItem[] {
  const items: AdminDataItem[] = []
  const push = (label: string, value: string | null) => { if (value) items.push({ label, value }) }
  push("Canonical ID", firstStr(master.canonicalId))
  push("Directory ID", index.id)
  push("Source ID", firstStr(source.sourceRecordId, index.sourceId))
  push("Company match method", firstStr(master.companyMatchMethod))
  push("Company match confidence", master.companyMatchConfidence != null ? String(master.companyMatchConfidence) : null)
  push("Job rate", jobRate) // sensitive — Admin-only unless surfaced to Overview above
  push("Raw project manager", firstStr(master.projectManagerRaw))
  push("Raw project lead", firstStr(master.projectLeadRaw))
  push("Legacy NET", firstStr(master.legacyNetRaw))
  push("Legacy RIZZ", firstStr(master.legacyRizzRaw))
  push("Legacy / archived", bool(master.isLegacyOrArchived) === true ? "Yes" : null)
  push("Source sheets", strArray(master.sourceSheets).join(", ") || null)
  push("Needs review", bool(master.needsReview) === true ? "Yes" : null)
  push("Review reason", firstStr(master.reviewReason))
  return items
}

// ── Other ──────────────────────────────────────────────────────────────────

export function buildOtherProfileViewModel(
  index: ProfileIndexInput,
  source: Loose,
  _options: BuildProfileOptions = {},
): OtherProfileViewModel {
  const name = firstStr(source.name, index.name) ?? "Unknown"
  const description = firstStr(source.description, index.subtitle)
  const fields: ProfileField[] = Array.isArray(source.fields)
    ? source.fields.flatMap((entry) => {
        const record = asRecord(entry)
        const label = str(record.label)
        const value = str(record.value)
        return label && value ? [{ label, value, kind: "text" as const }] : []
      })
    : []

  const overview: ProfileField[] = []
  if (description) overview.push({ label: "Description", value: description, kind: "multiline" })
  overview.push(...fields)

  return {
    id: index.id,
    type: "other",
    sourceCollection: index.sourceCollection,
    sourceId: index.sourceId,
    name,
    headline: firstStr(index.subtitle),
    location: firstStr(index.location),
    companyName: null,
    companyEntityId: null,
    description,
    fields,
    actions: [{ kind: "edit", label: "Edit", inApp: true }],
    overview,
    adminDetails: [
      { label: "Directory ID", value: index.id },
      ...(firstStr(source.sourceRecordId) ? [{ label: "Source ID", value: str(source.sourceRecordId) }] : []),
    ],
    quality: buildQuality(index),
    needsReview: false,
    reviewReason: null,
  }
}

// ── Dispatcher ──────────────────────────────────────────────────────────────

export function buildProfileViewModel(
  index: ProfileIndexInput,
  source: Loose,
  options: BuildProfileOptions = {},
): DirectoryProfileViewModel {
  switch (index.type) {
    case "person": return buildPersonProfileViewModel(index, source, options)
    case "company": return buildCompanyProfileViewModel(index, source, options)
    case "job": return buildJobProfileViewModel(index, source, options)
    default: return buildOtherProfileViewModel(index, source, options)
  }
}

function buildQuality(index: ProfileIndexInput): ProfileQuality {
  return {
    isComplete: index.quality?.isComplete ?? true,
    issues: Array.isArray(index.quality?.issues) ? index.quality!.issues!.filter((i): i is string => typeof i === "string") : [],
  }
}

// ── Editable public Overview fields ─────────────────────────────────────────
// The subset of Overview fields a user may edit. Keys are stable identifiers
// consumed by applyDirectoryEdits() in lib/directory-writes.ts, which writes
// them back to the source doc (masterData first, so the edit is authoritative).

export interface EditableField {
  key: string
  label: string
  value: string
  multiline?: boolean
  inputType?: "text" | "tel" | "email" | "url"
}

export function getEditableFields(vm: DirectoryProfileViewModel): EditableField[] {
  switch (vm.type) {
    case "person":
      // Emails/phones are edited as full ordered lists (first = primary) via
      // a dedicated chip editor in the sheet, not as single text fields here —
      // see EmailsEditor/PhonesEditor in directory-edit-sheet.tsx.
      return [
        { key: "name", label: "Name", value: vm.name },
        { key: "role", label: "Role", value: vm.role ?? "" },
        { key: "company", label: "Company", value: vm.companyName ?? "" },
        { key: "address", label: "Address", value: vm.addresses[0] ?? "" },
        { key: "active", label: "Status", value: vm.isActive == null ? "" : vm.isActive ? "Active" : "Inactive" },
        { key: "notes", label: "Notes", value: vm.notes ?? "", multiline: true },
      ]
    case "company":
      return [
        { key: "name", label: "Name", value: vm.name },
        { key: "phone", label: "Phone", value: vm.phone ?? "", inputType: "tel" },
        { key: "address", label: "Address", value: vm.address ?? "" },
        { key: "website", label: "Website", value: vm.website ?? "", inputType: "url" },
        { key: "description", label: "Description", value: vm.description ?? "", multiline: true },
      ]
    case "job": {
      const fields: EditableField[] = [
        { key: "name", label: "Name", value: vm.name },
        { key: "status", label: "Status", value: vm.status ?? "" },
        { key: "address", label: "Address", value: vm.address ?? "" },
        { key: "location", label: "Location", value: vm.location ?? "" },
        { key: "operatingZone", label: "Operating zone", value: vm.operatingZone ?? "" },
        { key: "estimatedStartDate", label: "Estimated start", value: vm.estimatedStartDateRaw ?? "" },
        { key: "confirmedStartDate", label: "Confirmed start", value: vm.confirmedStartDateRaw ?? "" },
        { key: "durationWeeks", label: "Duration (weeks)", value: vm.durationWeeks ?? "" },
        { key: "projectType", label: "Project type", value: vm.projectType ?? "" },
        { key: "reportCadence", label: "Report cadence", value: vm.reportCadence ?? "" },
        { key: "projectManagerName", label: "Project manager", value: vm.projectManagerName ?? "" },
        { key: "projectLeadName", label: "Project lead", value: vm.projectLeadName ?? "" },
        { key: "imageFolderUrl", label: "Drive folder URL", value: vm.driveFolderUrl ?? "", inputType: "url" },
      ]
      // Job rate is sensitive — the view model already nulls these out for an
      // unauthorized viewer, so gating the editable field on their presence
      // reuses that same check instead of a second permission lookup here.
      if (vm.jobRate !== null || vm.jobRateAmount !== null) {
        fields.push(
          { key: "jobRateAmount", label: "Job rate amount", value: vm.jobRateAmount ?? "" },
          { key: "jobRateCurrency", label: "Job rate currency", value: vm.jobRateCurrency ?? "" },
          { key: "jobRateUnit", label: "Job rate unit", value: vm.jobRateUnit ?? "" },
        )
      }
      fields.push({ key: "operationalNotes", label: "Operational notes", value: vm.operationalNotes ?? "", multiline: true })
      return fields
    }
    default:
      return [
        { key: "name", label: "Name", value: vm.name },
        { key: "description", label: "Description", value: vm.description ?? "", multiline: true },
      ]
  }
}
