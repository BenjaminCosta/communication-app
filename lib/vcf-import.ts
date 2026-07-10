import type { Contact, ImportedContact, ImportedContactAddress, ImportedContactPoint } from "./store"

export interface VcfSkippedContact {
  name: string
  reason: "duplicate" | "no_contact_signal" | "invalid"
  detail: string
}

export interface VcfImportStats {
  totalCards: number
  importable: number
  skipped: number
  duplicateEmails: number
  duplicatePhones: number
}

export interface VcfImportResult {
  contacts: Omit<ImportedContact, "id">[]
  skipped: VcfSkippedContact[]
  stats: VcfImportStats
}

interface VcfProperty {
  name: string
  params: string[]
  value: string
  decodedValue: string
  labels: string[]
  preferred: boolean
}

const TEXT_DECODER = typeof TextDecoder !== "undefined" ? new TextDecoder("utf-8") : null

export function normalizeVcfEmail(email?: string | null): string {
  return (email ?? "").trim().toLowerCase()
}

export function normalizeVcfPhone(phone?: string | null): string {
  const raw = (phone ?? "").trim()
  if (!raw) return ""
  const extensionMatch = raw.match(/(?:ext\.?|x)\s*\d+$/i)
  const withoutExtension = extensionMatch ? raw.slice(0, extensionMatch.index).trim() : raw
  const digits = withoutExtension.replace(/\D/g, "")
  if (!digits) return ""
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1)
  return digits
}

export function parseVcfImportedContacts(
  text: string,
  options: {
    ownerUserId: string
    registeredUsers: Contact[]
    existingImported: ImportedContact[]
    importBatchId?: string
  }
): VcfImportResult {
  const cards = splitVcards(unfoldVcardLines(text))
  const skipped: VcfSkippedContact[] = []
  const contacts: Omit<ImportedContact, "id">[] = []
  const seenEmails = new Set<string>()
  const seenPhones = new Set<string>()
  const existingEmails = collectExistingEmails(options.existingImported)
  const existingPhones = collectExistingPhones(options.existingImported)
  let duplicateEmails = 0
  let duplicatePhones = 0

  cards.forEach((card, index) => {
    const mapped = mapVcard(card, index)
    if (!mapped) {
      skipped.push({ name: `Card ${index + 1}`, reason: "invalid", detail: "Could not parse vCard." })
      return
    }

    if (!mapped.hasContactSignal) {
      skipped.push({
        name: mapped.name || `Card ${index + 1}`,
        reason: "no_contact_signal",
        detail: "No usable email or phone number.",
      })
      return
    }

    const duplicateEmail = mapped.emailCandidates.find((email) => seenEmails.has(email) || existingEmails.has(email))
    if (duplicateEmail) {
      duplicateEmails += 1
      skipped.push({
        name: mapped.name,
        reason: "duplicate",
        detail: `Email already exists: ${duplicateEmail}`,
      })
      return
    }

    const duplicatePhone = mapped.phoneCandidates.find((phone) => seenPhones.has(phone) || existingPhones.has(phone))
    if (duplicatePhone) {
      duplicatePhones += 1
      skipped.push({
        name: mapped.name,
        reason: "duplicate",
        detail: `Phone already exists: ${duplicatePhone}`,
      })
      return
    }

    mapped.emailCandidates.forEach((email) => seenEmails.add(email))
    mapped.phoneCandidates.forEach((phone) => seenPhones.add(phone))

    const linkedUser = mapped.emailCandidates.length > 0
      ? options.registeredUsers.find((user) => {
          const userEmail = normalizeVcfEmail(user.emailNormalized ?? user.email)
          return !!userEmail && mapped.emailCandidates.includes(userEmail)
        })
      : undefined

    contacts.push({
      ownerUserId: options.ownerUserId,
      name: mapped.name,
      source: "vcf",
      tags: [],
      visibility: "global",
      linkedUserId: linkedUser?.id ?? null,
      status: linkedUser ? "registered" : "not_registered",
      createdAt: new Date(),
      updatedAt: new Date(),
      ...(options.importBatchId ? { importBatchId: options.importBatchId } : {}),
      ...(mapped.primaryEmail ? { email: mapped.primaryEmail.normalized, emailNormalized: mapped.primaryEmail.normalized } : {}),
      ...(mapped.primaryPhone ? { phone: mapped.primaryPhone.value, phoneNormalized: mapped.primaryPhone.normalized } : {}),
      ...(mapped.emails.length > 0 ? { emails: mapped.emails, emailNormalizedCandidates: mapped.emailCandidates } : {}),
      ...(mapped.phones.length > 0 ? { phones: mapped.phones } : {}),
      ...(mapped.companies.length > 0 ? { company: mapped.companies[0], companies: mapped.companies } : {}),
      ...(mapped.roles.length > 0 ? { role: mapped.roles[0], roles: mapped.roles } : {}),
      ...(mapped.notes ? { notes: mapped.notes } : {}),
      ...(mapped.addresses.length > 0 ? { addresses: mapped.addresses } : {}),
      ...(mapped.urls.length > 0 ? { urls: mapped.urls } : {}),
    })
  })

  return {
    contacts,
    skipped,
    stats: {
      totalCards: cards.length,
      importable: contacts.length,
      skipped: skipped.length,
      duplicateEmails,
      duplicatePhones,
    },
  }
}

function unfoldVcardLines(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
  const lines: string[] = []
  normalized.split("\n").forEach((line) => {
    if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1)
    } else {
      lines.push(line)
    }
  })
  return lines.filter((line) => line.trim().length > 0)
}

function splitVcards(lines: string[]): string[][] {
  const cards: string[][] = []
  let current: string[] | null = null
  lines.forEach((line) => {
    if (line.toUpperCase() === "BEGIN:VCARD") current = []
    if (current) current.push(line)
    if (line.toUpperCase() === "END:VCARD" && current) {
      cards.push(current)
      current = null
    }
  })
  return cards
}

function parseProperty(line: string): VcfProperty | null {
  const colon = line.indexOf(":")
  if (colon < 0) return null
  const head = line.slice(0, colon)
  const value = line.slice(colon + 1)
  const parts = head.split(";")
  const name = parts[0].toUpperCase()
  const params = parts.slice(1)
  const encoding = params.find((param) => param.toUpperCase().startsWith("ENCODING="))?.split("=")[1]?.toUpperCase()
  const decodedValue = encoding === "QUOTED-PRINTABLE" ? decodeQuotedPrintable(value) : unescapeVcardText(value)
  return {
    name,
    params,
    value,
    decodedValue: decodedValue.trim(),
    labels: extractLabels(params),
    preferred: params.some((param) => param.toUpperCase() === "PREF" || param.toUpperCase().includes("PREF")),
  }
}

function mapVcard(lines: string[], index: number) {
  const props = lines.map(parseProperty).filter((prop): prop is VcfProperty => prop !== null)
  const byName = (name: string) => props.filter((prop) => prop.name === name)
  const emails = makePoints(byName("EMAIL"), normalizeVcfEmail, "email")
  const phones = makePoints(byName("TEL"), normalizeVcfPhone, "phone")
  const companies = uniqueClean(byName("ORG").flatMap((prop) => splitStructuredValue(prop.decodedValue)))
  const roles = uniqueClean([...byName("TITLE"), ...byName("ROLE")].map((prop) => prop.decodedValue))
  const notes = uniqueClean(byName("NOTE").map((prop) => prop.decodedValue)).join("\n")
  const addresses = makeAddresses(byName("ADR"))
  const hasContactSignal = emails.length > 0 || phones.length > 0
  const name = (
    firstValue(byName("FN")) ||
    composeName(firstValue(byName("N"))) ||
    (hasContactSignal ? companies[0] : "") ||
    `Imported Contact ${index + 1}`
  ).trim()
  const urls = hasContactSignal ? makePoints(byName("URL"), (value) => value.trim(), "url") : []
  const emailCandidates = uniqueClean(emails.map((point) => point.normalized ?? normalizeVcfEmail(point.value)))
  const phoneCandidates = uniqueClean(phones.map((point) => point.normalized ?? normalizeVcfPhone(point.value)))
  const primaryEmail = choosePrimary(emails)
  const primaryPhone = choosePrimary(phones, (point) => point.label.toLowerCase().includes("cell"))

  return {
    name,
    emails,
    phones,
    primaryEmail,
    primaryPhone,
    emailCandidates,
    phoneCandidates,
    companies,
    roles,
    notes,
    addresses,
    urls,
    hasContactSignal,
  }
}

function makePoints(
  props: VcfProperty[],
  normalize: (value: string) => string,
  fallbackLabel: string
): ImportedContactPoint[] {
  const seen = new Set<string>()
  const raw: ImportedContactPoint[] = []
  props.forEach((prop) => {
    const value = prop.decodedValue.trim()
    const normalized = normalize(value)
    if (!value || !normalized) return
    const key = normalized || value.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    raw.push({
      label: prop.labels[0] || fallbackLabel,
      value,
      normalized,
      isPreferred: prop.preferred,
    })
  })

  const primary = choosePrimary(raw, fallbackLabel === "phone" ? (point) => point.label.toLowerCase().includes("cell") : undefined)
  return raw.map((point) => ({ ...point, isPrimary: point === primary }))
}

function choosePrimary<T extends { isPreferred?: boolean }>(points: T[], tieBreaker?: (point: T) => boolean): T | undefined {
  return points.find((point) => point.isPreferred) ?? (tieBreaker ? points.find(tieBreaker) : undefined) ?? points[0]
}

function makeAddresses(props: VcfProperty[]): ImportedContactAddress[] {
  const seen = new Set<string>()
  const addresses: ImportedContactAddress[] = []
  props.forEach((prop) => {
    const parts = splitStructuredValuePreservingPositions(prop.decodedValue)
    const [poBox, extended, street, locality, region, postalCode, country] = parts
    const formatted = uniqueClean([street, extended, locality, region, postalCode, country]).join(", ")
    if (!formatted) return
    const key = formatted.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    addresses.push(cleanObject({
      label: prop.labels[0] || "address",
      formatted,
      poBox,
      extended,
      street,
      locality,
      region,
      postalCode,
      country,
    }))
  })
  return addresses
}

function firstValue(props: VcfProperty[]): string {
  return props[0]?.decodedValue?.trim() ?? ""
}

function composeName(value: string): string {
  if (!value) return ""
  const [family, given, additional, prefix, suffix] = splitStructuredValue(value)
  return uniqueClean([prefix, given, additional, family, suffix]).join(" ")
}

function splitStructuredValue(value: string): string[] {
  return value.split(";").map((part) => unescapeVcardText(part).trim()).filter(Boolean)
}

function splitStructuredValuePreservingPositions(value: string): string[] {
  return value.split(";").map((part) => unescapeVcardText(part).trim())
}

function uniqueClean(values: Array<string | undefined | null>): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  values.forEach((value) => {
    const cleaned = (value ?? "").trim()
    if (!cleaned) return
    const key = cleaned.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    result.push(cleaned)
  })
  return result
}

function extractLabels(params: string[]): string[] {
  const labels = params.flatMap((param) => {
    const upper = param.toUpperCase()
    if (upper === "PREF" || upper.startsWith("CHARSET=") || upper.startsWith("ENCODING=")) return []
    if (upper.startsWith("X-CUSTOM")) return [decodeCustomLabel(param)]
    if (upper.startsWith("TYPE=")) return param.slice(5).split(",")
    if (param.includes("=")) return []
    return [param]
  })
  return uniqueClean(labels.map(formatLabel))
}

function decodeCustomLabel(param: string): string {
  const match = param.match(/\((.*)\)/)
  const content = match?.[1] ?? param
  const encoded = content.split(",").pop() ?? content
  return decodeQuotedPrintable(encoded)
}

function formatLabel(value: string): string {
  const decoded = decodeQuotedPrintable(value).replace(/^X-/, "").trim()
  if (!decoded) return ""
  return decoded.toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase())
}

function decodeQuotedPrintable(value: string): string {
  const compact = value.replace(/=\n/g, "")
  const bytes: number[] = []
  let output = ""
  for (let i = 0; i < compact.length; i += 1) {
    const char = compact[i]
    if (char === "=" && /^[0-9A-Fa-f]{2}$/.test(compact.slice(i + 1, i + 3))) {
      bytes.push(parseInt(compact.slice(i + 1, i + 3), 16))
      i += 2
    } else {
      if (bytes.length > 0) {
        output += decodeBytes(bytes)
        bytes.length = 0
      }
      output += char
    }
  }
  if (bytes.length > 0) output += decodeBytes(bytes)
  return unescapeVcardText(output)
}

function decodeBytes(bytes: number[]): string {
  return TEXT_DECODER ? TEXT_DECODER.decode(new Uint8Array(bytes)) : String.fromCharCode(...bytes)
}

function unescapeVcardText(value: string): string {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
}

function collectExistingEmails(contacts: ImportedContact[]): Set<string> {
  const values = contacts.flatMap((contact) => [
    contact.email,
    contact.emailNormalized,
    ...(contact.emailNormalizedCandidates ?? []),
    ...(contact.emails ?? []).flatMap((point) => [point.normalized, point.value]),
  ])
  return new Set(values.map(normalizeVcfEmail).filter(Boolean))
}

function collectExistingPhones(contacts: ImportedContact[]): Set<string> {
  const values = contacts.flatMap((contact) => [
    contact.phone,
    contact.phoneNormalized,
    ...(contact.phones ?? []).flatMap((point) => [point.normalized, point.value]),
  ])
  return new Set(values.map(normalizeVcfPhone).filter(Boolean))
}

function cleanObject<T extends Record<string, string | undefined>>(value: T): T {
  Object.keys(value).forEach((key) => {
    if (value[key] === undefined || value[key] === "") delete value[key]
  })
  return value
}
