import type MiniSearch from "minisearch"
import {
  DIRECTORY_MINISEARCH_CONFIG,
  type DirectorySearchDoc,
  type DirectoryType,
} from "@/lib/directory"
import {
  isDirectoryEntityType,
  type DirectoryListItem,
  type DirectoryScope,
} from "@/lib/directory-config"

/**
 * SVC Directory — framework-free search primitives.
 *
 * Normalization, the MiniSearch configuration, document projection and the
 * ranking logic, with no Firebase or browser dependency. Shared by the browser
 * loader (`lib/directory-search.ts`, IndexedDB + worker) and the server-side AI
 * tools (`lib/ai/server/directory-data.ts`, Admin SDK) so relevance is identical
 * in both runtimes and can be unit-tested directly.
 */

export interface DirectorySearchIndex {
  documents: DirectorySearchDoc[]
  byId: Map<string, DirectorySearchDoc>
  byType: Record<DirectoryType, DirectorySearchDoc[]>
  miniSearch: MiniSearch<DirectorySearchDoc>
  stale: boolean
}

export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

export function normalizePhone(value: string): string {
  return value.replace(/\D/g, "")
}

export function miniSearchOptions() {
  return {
    idField: DIRECTORY_MINISEARCH_CONFIG.idField,
    fields: [...DIRECTORY_MINISEARCH_CONFIG.fields],
    storeFields: [...DIRECTORY_MINISEARCH_CONFIG.storeFields],
    processTerm: normalizeSearchText,
  }
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function asTextArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

export function normalizeCachedDocument(document: DirectorySearchDoc): DirectorySearchDoc {
  const parsedSourceId = document.id.includes("__") ? document.id.slice(document.id.indexOf("__") + 2) : document.id
  return {
    ...document,
    sourceCollection: document.sourceCollection === "contacts" ? "contacts" : "contexts",
    sourceId: asText(document.sourceId) || parsedSourceId,
    ownerUserId: asText(document.ownerUserId),
    aliases: asText(document.aliases),
    email: asText(document.email),
    phone: asText(document.phone),
    phoneDisplay: asText(document.phoneDisplay) || asText(document.phone).split(" ")[0],
    keywords: asText(document.keywords),
    companyName: asText(document.companyName),
    location: asText(document.location),
    role: asText(document.role),
    searchText: asText(document.searchText),
    subtitle: asText(document.subtitle),
    linkedUserId: asText(document.linkedUserId),
    status: document.status === "registered" || document.status === "not_registered" ? document.status : "",
    tags: asTextArray(document.tags),
    description: asText(document.description),
    fieldCount: typeof document.fieldCount === "number" ? document.fieldCount : 0,
  }
}

export function directorySearchDocFromData(id: string, data: Record<string, unknown>): DirectorySearchDoc | null {
  if (!isDirectoryEntityType(data.type)) return null
  const name = asText(data.name).trim()
  if (!name) return null
  const sourceId = asText(data.sourceId) || id.slice(id.indexOf("__") + 2)
  return normalizeCachedDocument({
    id,
    type: data.type,
    sourceCollection: data.sourceCollection === "contacts" ? "contacts" : "contexts",
    sourceId,
    ownerUserId: asText(data.ownerUserId),
    name,
    aliases: asTextArray(data.aliases).join(" "),
    email: asText(data.email),
    phone: [asText(data.phone), normalizePhone(asText(data.phone))].filter(Boolean).join(" "),
    phoneDisplay: asText(data.phone),
    keywords: asTextArray(data.keywords).join(" "),
    companyName: asText(data.companyName),
    location: asText(data.location),
    role: asText(data.role),
    searchText: asText(data.searchText),
    subtitle: asText(data.subtitle),
    linkedUserId: asText(data.linkedUserId),
    status: data.status === "registered" || data.status === "not_registered" ? data.status : "",
    tags: asTextArray(data.tags),
    description: asText(data.description),
    fieldCount: typeof data.fieldCount === "number" ? data.fieldCount : 0,
  })
}

export function directoryListItemFromDoc(document: DirectorySearchDoc, score?: number): DirectoryListItem {
  if (!isDirectoryEntityType(document.type)) throw new Error(`Unsupported Directory type: ${document.type}`)
  return {
    id: document.id,
    type: document.type,
    name: document.name,
    subtitle: document.subtitle,
    companyName: document.companyName,
    location: document.location,
    role: document.role,
    description: document.description,
    score,
  }
}

export function groupByType(documents: DirectorySearchDoc[]): Record<DirectoryType, DirectorySearchDoc[]> {
  const grouped: Record<DirectoryType, DirectorySearchDoc[]> = { person: [], company: [], job: [], other: [] }
  for (const document of documents) grouped[document.type].push(document)
  for (const type of Object.keys(grouped) as DirectoryType[]) {
    grouped[type].sort((a, b) => a.name.localeCompare(b.name))
  }
  return grouped
}

/** Build a MiniSearch index without the browser worker (server / test path). */
export async function buildDirectorySearchIndex(documents: DirectorySearchDoc[]): Promise<DirectorySearchIndex> {
  const { default: MiniSearchClass } = await import("minisearch")
  const supported = documents.filter((document) => isDirectoryEntityType(document.type)).map(normalizeCachedDocument)
  const miniSearch = new MiniSearchClass<DirectorySearchDoc>(miniSearchOptions())
  await miniSearch.addAllAsync(supported, { chunkSize: 500 })
  return {
    documents: supported,
    byId: new Map(supported.map((document) => [document.id, document])),
    byType: groupByType(supported),
    miniSearch,
    stale: false,
  }
}

/**
 * Rank Directory matches. MiniSearch supplies fuzzy/prefix recall; the exact
 * match boosts below make an exact email/phone/name win decisively.
 */
export function searchDirectory(
  index: Pick<DirectorySearchIndex, "miniSearch" | "byId">,
  queryText: string,
  scope: DirectoryScope = "all",
): DirectoryListItem[] {
  const queryTextTrimmed = queryText.trim()
  if (!queryTextTrimmed) return []
  const results = index.miniSearch.search(queryTextTrimmed, {
    ...DIRECTORY_MINISEARCH_CONFIG.searchOptions,
    filter: scope === "all" ? undefined : (result) => result.type === scope,
  })
  const normalizedQuery = normalizeSearchText(queryTextTrimmed)
  const phoneQuery = normalizePhone(queryTextTrimmed)
  return results.flatMap((result) => {
    const document = index.byId.get(String(result.id))
    if (!document) return []
    const normalizedName = normalizeSearchText(document.name)
    const normalizedEmail = normalizeSearchText(document.email)
    const normalizedAliases = normalizeSearchText(document.aliases)
    const normalizedCompany = normalizeSearchText(document.companyName)
    const normalizedPhone = normalizePhone(document.phone)
    let exactMatchBoost = 0
    if (normalizedEmail === normalizedQuery) exactMatchBoost += 12_000
    if (phoneQuery.length >= 6 && normalizedPhone.includes(phoneQuery)) exactMatchBoost += 11_000
    if (normalizedName === normalizedQuery) exactMatchBoost += 10_000
    else if (normalizedName.startsWith(normalizedQuery)) exactMatchBoost += 5_000
    if (normalizedAliases === normalizedQuery) exactMatchBoost += 4_000
    else if (normalizedAliases.includes(normalizedQuery)) exactMatchBoost += 900
    if (normalizedCompany === normalizedQuery) exactMatchBoost += 2_500
    else if (normalizedCompany.startsWith(normalizedQuery)) exactMatchBoost += 700
    const score = result.score + exactMatchBoost
    return [{ item: directoryListItemFromDoc(document, score), score }]
  }).sort((a, b) => b.score - a.score).map(({ item }) => item)
}

export function getDirectoryTitleSuggestions(
  index: DirectorySearchIndex | null,
  queryText: string,
  scope: DirectoryScope = "all",
  limit = 5,
): DirectoryListItem[] {
  const normalizedQuery = normalizeSearchText(queryText)
  if (!index || normalizedQuery.length < 2 || limit <= 0) return []
  const usedTitles = new Set<string>()
  const suggestions: DirectoryListItem[] = []
  for (const item of searchDirectory(index, queryText, scope)) {
    const titleKey = normalizeSearchText(item.name)
    if (!titleKey.includes(normalizedQuery) || usedTitles.has(titleKey)) continue
    usedTitles.add(titleKey)
    suggestions.push(item)
    if (suggestions.length >= limit) break
  }
  return suggestions
}

export function directoryItemsForIds(index: DirectorySearchIndex | null, ids: string[]): DirectoryListItem[] {
  if (!index) return []
  return ids.flatMap((id) => {
    const document = index.byId.get(id)
    return document ? [directoryListItemFromDoc(document)] : []
  })
}

export function paginateDirectoryItems(items: DirectoryListItem[], visibleCount: number): DirectoryListItem[] {
  return items.slice(0, Math.max(0, visibleCount))
}
