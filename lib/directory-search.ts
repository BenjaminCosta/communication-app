import type MiniSearch from "minisearch"
import { collection, doc, getDoc, getDocs, type DocumentData } from "firebase/firestore/lite"
import { directoryDb } from "@/lib/firebase"
import {
  DIRECTORY_MINISEARCH_CONFIG,
  DIRECTORY_SCHEMA_VERSION,
  type DirectorySearchDoc,
} from "@/lib/directory"
import {
  isDirectoryEntityType,
  type DirectoryListItem,
  type DirectoryScope,
} from "@/lib/directory-config"

const CACHE_DB = "svc-directory-search"
const CACHE_STORE = "search-indexes"
const CACHE_VERSION = 2
const SEARCH_CACHE_VERSION = 2

interface DirectoryCacheRecord {
  key: string
  userId: string
  searchCacheVersion: number
  schemaVersion: number
  lastChangeAt: string
  documents: DirectorySearchDoc[]
  indexJson: string
  savedAt: number
}

export interface DirectorySearchIndex {
  documents: DirectorySearchDoc[]
  byId: Map<string, DirectorySearchDoc>
  miniSearch: MiniSearch<DirectorySearchDoc>
  stale: boolean
}

export function makeDirectoryCacheKey(userId: string, schemaVersion: number, lastChangeAt: string): string {
  return `${userId}:${SEARCH_CACHE_VERSION}:${schemaVersion}:${lastChangeAt || "unknown"}`
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

function normalizePhone(value: string): string {
  return value.replace(/\D/g, "")
}

function miniSearchOptions() {
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

function normalizeCachedDocument(document: DirectorySearchDoc): DirectorySearchDoc {
  return {
    ...document,
    aliases: asText(document.aliases),
    email: asText(document.email),
    phone: asText(document.phone),
    keywords: asText(document.keywords),
    companyName: asText(document.companyName),
    location: asText(document.location),
    role: asText(document.role),
    searchText: asText(document.searchText),
    subtitle: asText(document.subtitle),
  }
}

export function directorySearchDocFromData(id: string, data: DocumentData): DirectorySearchDoc | null {
  if (!isDirectoryEntityType(data.type)) return null
  const name = asText(data.name).trim()
  if (!name) return null
  return {
    id,
    type: data.type,
    name,
    aliases: asTextArray(data.aliases).join(" "),
    email: asText(data.email),
    phone: [asText(data.phone), normalizePhone(asText(data.phone))].filter(Boolean).join(" "),
    keywords: asTextArray(data.keywords).join(" "),
    companyName: asText(data.companyName),
    location: asText(data.location),
    role: asText(data.role),
    searchText: asText(data.searchText),
    subtitle: asText(data.subtitle),
  }
}

export function directoryListItemFromDoc(document: DirectorySearchDoc, score?: number): DirectoryListItem {
  if (!isDirectoryEntityType(document.type)) {
    throw new Error(`Unsupported Directory type: ${document.type}`)
  }
  return {
    id: document.id,
    type: document.type,
    name: document.name,
    subtitle: document.subtitle,
    companyName: document.companyName,
    location: document.location,
    role: document.role,
    score,
  }
}

export async function createDirectorySearchIndex(documents: DirectorySearchDoc[]): Promise<DirectorySearchIndex> {
  const { default: MiniSearchClass } = await import("minisearch")
  const supported = documents.filter((document) => isDirectoryEntityType(document.type))
  const miniSearch = new MiniSearchClass<DirectorySearchDoc>(miniSearchOptions())
  miniSearch.addAll(supported)
  return {
    documents: supported,
    byId: new Map(supported.map((document) => [document.id, document])),
    miniSearch,
    stale: false,
  }
}

export function searchDirectory(
  index: DirectorySearchIndex,
  queryText: string,
  scope: DirectoryScope = "all",
): DirectoryListItem[] {
  const query = queryText.trim()
  if (!query) return []
  const results = index.miniSearch.search(query, {
    ...DIRECTORY_MINISEARCH_CONFIG.searchOptions,
    filter: scope === "all" ? undefined : (result) => result.type === scope,
  })
  const normalizedQuery = normalizeSearchText(query)
  const phoneQuery = normalizePhone(query)
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

    return [{ item: directoryListItemFromDoc(document, result.score + exactMatchBoost), score: result.score + exactMatchBoost }]
  }).sort((a, b) => b.score - a.score).map(({ item }) => item)
}

/**
 * Google-style suggestions are deliberately restricted to entity titles. The
 * selected title is submitted as a normal search rather than opening detail.
 */
export function getDirectoryTitleSuggestions(
  index: DirectorySearchIndex | null,
  queryText: string,
  scope: DirectoryScope = "all",
  limit = 5,
): DirectoryListItem[] {
  const normalizedQuery = normalizeSearchText(queryText)
  if (!index || normalizedQuery.length < 2 || limit <= 0) return []
  const usedTitles = new Set<string>()
  return searchDirectory(index, queryText, scope).flatMap((item) => {
    const titleKey = normalizeSearchText(item.name)
    if (!titleKey.includes(normalizedQuery) || usedTitles.has(titleKey) || usedTitles.size >= limit) return []
    usedTitles.add(titleKey)
    return [item]
  })
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

function timestampKey(value: unknown): string {
  if (value && typeof value === "object" && "toMillis" in value && typeof value.toMillis === "function") {
    return String(value.toMillis())
  }
  if (value instanceof Date) return String(value.getTime())
  if (typeof value === "number" || typeof value === "string") return String(value)
  return "unknown"
}

function openCacheDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is unavailable"))
      return
    }
    const request = indexedDB.open(CACHE_DB, CACHE_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(CACHE_STORE)) {
        database.createObjectStore(CACHE_STORE, { keyPath: "key" })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error("Unable to open Directory cache"))
  })
}

async function readUserCache(userId: string): Promise<DirectoryCacheRecord | null> {
  const database = await openCacheDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(CACHE_STORE, "readonly")
    const store = transaction.objectStore(CACHE_STORE)
    const request = store.getAll()
    request.onsuccess = () => {
      const records = (request.result as DirectoryCacheRecord[])
        .filter((record) => record.userId === userId)
        .sort((a, b) => b.savedAt - a.savedAt)
      resolve(records[0] ?? null)
    }
    request.onerror = () => reject(request.error ?? new Error("Unable to read Directory cache"))
    transaction.oncomplete = () => database.close()
  })
}

async function writeCache(record: DirectoryCacheRecord): Promise<void> {
  const database = await openCacheDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(CACHE_STORE, "readwrite")
    const store = transaction.objectStore(CACHE_STORE)
    store.put(record)
    const all = store.getAll()
    all.onsuccess = () => {
      ;(all.result as DirectoryCacheRecord[])
        .filter((item) => item.userId === record.userId && item.key !== record.key)
        .forEach((item) => store.delete(item.key))
    }
    transaction.oncomplete = () => { database.close(); resolve() }
    transaction.onerror = () => { database.close(); reject(transaction.error ?? new Error("Unable to write Directory cache")) }
  })
}

async function restoreIndex(record: DirectoryCacheRecord, stale = false): Promise<DirectorySearchIndex> {
  const documents = record.documents.map(normalizeCachedDocument)
  if (record.searchCacheVersion !== SEARCH_CACHE_VERSION) {
    const rebuilt = await createDirectorySearchIndex(documents)
    return { ...rebuilt, stale }
  }
  try {
    const { default: MiniSearchClass } = await import("minisearch")
    const miniSearch = MiniSearchClass.loadJSON<DirectorySearchDoc>(record.indexJson, miniSearchOptions())
    return {
      documents,
      byId: new Map(documents.map((document) => [document.id, document])),
      miniSearch,
      stale,
    }
  } catch {
    const rebuilt = await createDirectorySearchIndex(documents)
    return { ...rebuilt, stale }
  }
}

export async function loadDirectorySearch(userId: string): Promise<DirectorySearchIndex> {
  let cache: DirectoryCacheRecord | null = null
  try {
    cache = await readUserCache(userId)
  } catch {
    cache = null
  }

  let schemaVersion = DIRECTORY_SCHEMA_VERSION
  let lastChangeAt = "unknown"
  let metaAvailable = false
  try {
    const metaSnapshot = await getDoc(doc(directoryDb, "directoryMeta", "status"))
    if (metaSnapshot.exists()) {
      const data = metaSnapshot.data()
      schemaVersion = typeof data.schemaVersion === "number" ? data.schemaVersion : DIRECTORY_SCHEMA_VERSION
      lastChangeAt = timestampKey(data.lastChangeAt ?? data.lastRebuildAt)
      metaAvailable = true
    }
  } catch {
    if (cache) return restoreIndex(cache, true)
  }

  const key = makeDirectoryCacheKey(userId, schemaVersion, lastChangeAt)
  if (cache && cache.key === key) return restoreIndex(cache)
  if (!metaAvailable && cache) return restoreIndex(cache, true)

  try {
    const snapshot = await getDocs(collection(directoryDb, "directoryIndex"))
    const documents = snapshot.docs.flatMap((entry) => {
      const document = directorySearchDocFromData(entry.id, entry.data())
      return document ? [document] : []
    })
    const index = await createDirectorySearchIndex(documents)
    const record: DirectoryCacheRecord = {
      key,
      userId,
      searchCacheVersion: SEARCH_CACHE_VERSION,
      schemaVersion,
      lastChangeAt,
      documents,
      indexJson: JSON.stringify(index.miniSearch),
      savedAt: Date.now(),
    }
    writeCache(record).catch(() => {})
    return index
  } catch (error) {
    if (cache) return restoreIndex(cache, true)
    throw error
  }
}

export async function clearDirectorySearchCache(userId?: string): Promise<void> {
  let database: IDBDatabase
  try {
    database = await openCacheDatabase()
  } catch {
    return
  }
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(CACHE_STORE, "readwrite")
    const store = transaction.objectStore(CACHE_STORE)
    if (!userId) {
      store.clear()
    } else {
      const request = store.getAll()
      request.onsuccess = () => {
        ;(request.result as DirectoryCacheRecord[])
          .filter((record) => record.userId === userId)
          .forEach((record) => store.delete(record.key))
      }
    }
    transaction.oncomplete = () => { database.close(); resolve() }
    transaction.onerror = () => { database.close(); reject(transaction.error ?? new Error("Unable to clear Directory cache")) }
  })
}
