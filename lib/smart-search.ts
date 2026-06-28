import type { AppContext, Contact, ImportedContact, Message } from "@/lib/store"

export interface ActivityStat {
  count: number
  lastUsedAt: Date | null
}

type WeightedField = {
  value?: string | null
  weight: number
}

export function normalizeSearchText(value?: string | null): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9@.+#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export function normalizePhoneSearch(value?: string | null): string {
  return (value ?? "").replace(/\D/g, "")
}

export function tokenizeSearch(query: string): string[] {
  return normalizeSearchText(query).split(" ").filter(Boolean)
}

export function buildPeopleActivityStats(messages: Message[]): Map<string, ActivityStat> {
  const stats = new Map<string, ActivityStat>()
  messages.forEach((message) => {
    const when = message.updatedAt ?? message.createdAt ?? message.timestamp
    const ids = [
      message.senderId,
      message.authorId,
      ...(message.recipientIds ?? []),
      ...(message.peopleIds ?? []),
      ...(message.contactIds ?? []),
    ].filter((id): id is string => !!id)
    ids.forEach((id) => addActivity(stats, id, when))
  })
  return stats
}

export function buildContextActivityStats(messages: Message[]): Map<string, ActivityStat> {
  const stats = new Map<string, ActivityStat>()
  messages.forEach((message) => {
    const when = message.updatedAt ?? message.createdAt ?? message.timestamp
    ;(message.contextIds ?? []).filter(Boolean).forEach((id) => addActivity(stats, id, when))
  })
  return stats
}

export function scoreRegisteredPersonSearch(person: Contact, query: string, activity?: ActivityStat): number {
  return scoreFields(query, [
    { value: person.name, weight: 110 },
    { value: person.email, weight: 95 },
    { value: person.emailNormalized, weight: 95 },
  ]) + activityBoost(activity)
}

export function scoreImportedContactSearch(contact: ImportedContact, query: string, activity?: ActivityStat): number {
  const emailValues = [
    contact.email,
    contact.emailNormalized,
    ...(contact.emailNormalizedCandidates ?? []),
    ...(contact.emails ?? []).flatMap((email) => [email.value, email.normalized]),
  ]
  const phoneValues = [
    contact.phone,
    contact.phoneNormalized,
    ...(contact.phones ?? []).flatMap((phone) => [phone.value, phone.normalized]),
  ]
  const fields: WeightedField[] = [
    { value: contact.name, weight: 120 },
    ...emailValues.map((value) => ({ value, weight: 105 })),
    ...phoneValues.map((value) => ({ value, weight: 105 })),
    { value: contact.company, weight: 82 },
    ...(contact.companies ?? []).map((value) => ({ value, weight: 78 })),
    { value: contact.role, weight: 64 },
    ...(contact.roles ?? []).map((value) => ({ value, weight: 58 })),
    { value: contact.notes, weight: 32 },
    ...(contact.addresses ?? []).map((address) => ({ value: address.formatted, weight: 32 })),
    ...(contact.urls ?? []).map((url) => ({ value: url.value, weight: 28 })),
    ...(contact.tags ?? []).map((tag) => ({ value: tag, weight: 38 })),
  ]
  return scoreFields(query, fields) + activityBoost(activity)
}

export function scoreContextSearch(context: AppContext, query: string, activity?: ActivityStat): number {
  const kindField = context.fields.find((field) => normalizeSearchText(field.label) === "kind")?.value
  const fields: WeightedField[] = [
    { value: context.name, weight: 125 },
    { value: context.description, weight: 60 },
    { value: kindField, weight: 80 },
    { value: context.sourceSheet, weight: 45 },
    ...(context.fields ?? []).flatMap((field) => [
      { value: field.label, weight: 32 },
      { value: field.value, weight: contextFieldWeight(field.label) },
    ]),
  ]
  return scoreFields(query, fields) + activityBoost(activity)
}

export function compareBySearchScore(
  a: { item: unknown; score: number; label: string; activity?: ActivityStat },
  b: { item: unknown; score: number; label: string; activity?: ActivityStat }
): number {
  if (b.score !== a.score) return b.score - a.score
  const countDiff = (b.activity?.count ?? 0) - (a.activity?.count ?? 0)
  if (countDiff !== 0) return countDiff
  const timeDiff = (b.activity?.lastUsedAt?.getTime() ?? 0) - (a.activity?.lastUsedAt?.getTime() ?? 0)
  if (timeDiff !== 0) return timeDiff
  return a.label.localeCompare(b.label)
}

function addActivity(stats: Map<string, ActivityStat>, id: string, when: Date) {
  const prev = stats.get(id) ?? { count: 0, lastUsedAt: null }
  stats.set(id, {
    count: prev.count + 1,
    lastUsedAt: !prev.lastUsedAt || when.getTime() > prev.lastUsedAt.getTime() ? when : prev.lastUsedAt,
  })
}

function activityBoost(activity?: ActivityStat): number {
  if (!activity) return 0
  const recency = activity.lastUsedAt ? Math.max(0, 30 - (Date.now() - activity.lastUsedAt.getTime()) / 86_400_000) : 0
  return Math.min(activity.count * 12, 180) + recency
}

function scoreFields(query: string, fields: WeightedField[]): number {
  const normalizedQuery = normalizeSearchText(query)
  const phoneQuery = normalizePhoneSearch(query)
  if (!normalizedQuery && !phoneQuery) return 0

  let best = 0
  for (const field of fields) {
    const value = field.value ?? ""
    const normalizedValue = normalizeSearchText(value)
    const phoneValue = normalizePhoneSearch(value)
    let score = 0

    if (normalizedQuery && normalizedValue) {
      score = Math.max(score, scoreText(normalizedQuery, normalizedValue, field.weight))
    }
    if (phoneQuery.length >= 3 && phoneValue) {
      score = Math.max(score, scorePhone(phoneQuery, phoneValue, field.weight))
    }
    best = Math.max(best, score)
  }
  return best
}

function scoreText(query: string, value: string, weight: number): number {
  if (value === query) return weight * 1.5
  if (value.startsWith(query)) return weight * 1.25
  if (value.includes(query)) return weight

  const tokens = query.split(" ").filter(Boolean)
  if (tokens.length === 0) return 0
  const allTokensMatch = tokens.every((token) =>
    value.split(" ").some((valueToken) => valueToken.startsWith(token) || valueToken.includes(token))
  )
  if (!allTokensMatch) return 0
  const prefixMatches = tokens.filter((token) => value.split(" ").some((valueToken) => valueToken.startsWith(token))).length
  return weight * (0.55 + Math.min(prefixMatches / tokens.length, 1) * 0.25)
}

function scorePhone(query: string, value: string, weight: number): number {
  if (value === query) return weight * 1.45
  if (value.startsWith(query)) return weight * 1.2
  if (value.includes(query)) return weight
  return 0
}

function contextFieldWeight(label: string): number {
  const normalized = normalizeSearchText(label)
  if (["kind", "status", "company", "project manager", "project lead"].includes(normalized)) return 72
  if (["address", "phone", "website", "related contacts"].includes(normalized)) return 58
  return 44
}
