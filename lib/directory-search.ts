import type MiniSearch from "minisearch"
import { collection, doc, getDoc, getDocs, type DocumentData } from "firebase/firestore/lite"
import { directoryDb } from "@/lib/firebase"
import {
  DIRECTORY_MINISEARCH_CONFIG,
  DIRECTORY_SCHEMA_VERSION,
  DIRECTORY_SEARCH_SHARD_COUNT,
  type DirectorySearchDoc,
  type DirectoryType,
} from "@/lib/directory"
import {
  isDirectoryEntityType,
  type DirectoryListItem,
  type DirectoryScope,
} from "@/lib/directory-config"

const CACHE_DB = "svc-directory-search"
const CACHE_STORE = "search-indexes"
const CACHE_VERSION = 3
const SEARCH_CACHE_VERSION = 4
const entityCatalogLoads = new Map<string, Promise<DirectorySearchIndex>>()
const serializedSearchIndexes = new WeakMap<object, string>()

interface DirectoryCacheRecord {
  /** IndexedDB primary key for one schema/revision payload. */
  key: string
  cacheKey: string
  userId: string
  searchCacheVersion: number
  schemaVersion: number
  searchRevision: string
  documents: DirectorySearchDoc[]
  indexJson?: string
  indexGzip?: ArrayBuffer
  savedAt: number
}

interface DirectoryCachePointer {
  key: string
  recordKey: string
}

export interface DirectorySearchIndex {
  documents: DirectorySearchDoc[]
  byId: Map<string, DirectorySearchDoc>
  byType: Record<DirectoryType, DirectorySearchDoc[]>
  miniSearch: MiniSearch<DirectorySearchDoc>
  stale: boolean
}

export interface LoadEntityCatalogOptions {
  /** Delivers saved data immediately while metadata/shards revalidate. */
  onCache?: (index: DirectorySearchIndex) => void
}

export function makeDirectoryCacheKey(userId: string, schemaVersion: number, searchRevision: string): string {
  return `${userId}:${SEARCH_CACHE_VERSION}:${schemaVersion}:${searchRevision || "unknown"}`
}

function latestRecordKey(userId: string): string {
  return `latest:${userId}`
}

function revisionRecordKey(cacheKey: string): string {
  return `revision:${cacheKey}`
}

function isCacheRecord(value: unknown): value is DirectoryCacheRecord {
  return Boolean(value && typeof value === "object" && Array.isArray((value as DirectoryCacheRecord).documents))
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

export function directorySearchDocFromData(id: string, data: DocumentData): DirectorySearchDoc | null {
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

function groupByType(documents: DirectorySearchDoc[]): Record<DirectoryType, DirectorySearchDoc[]> {
  const grouped: Record<DirectoryType, DirectorySearchDoc[]> = { person: [], company: [], job: [], other: [] }
  for (const document of documents) grouped[document.type].push(document)
  for (const type of Object.keys(grouped) as DirectoryType[]) {
    grouped[type].sort((a, b) => a.name.localeCompare(b.name))
  }
  return grouped
}

async function buildIndexJsonInWorker(documents: DirectorySearchDoc[]): Promise<string | null> {
  if (typeof window === "undefined" || typeof Worker === "undefined") return null
  return new Promise((resolve) => {
    const worker = new Worker(new URL("./directory-search.worker.ts", import.meta.url), { type: "module" })
    const timeout = window.setTimeout(() => { worker.terminate(); resolve(null) }, 15_000)
    worker.onmessage = (event: MessageEvent<{ indexJson?: string }>) => {
      window.clearTimeout(timeout)
      worker.terminate()
      resolve(typeof event.data?.indexJson === "string" ? event.data.indexJson : null)
    }
    worker.onerror = () => {
      window.clearTimeout(timeout)
      worker.terminate()
      resolve(null)
    }
    worker.postMessage({ documents })
  })
}

export async function createDirectorySearchIndex(documents: DirectorySearchDoc[]): Promise<DirectorySearchIndex> {
  const { default: MiniSearchClass } = await import("minisearch")
  const supported = documents.filter((document) => isDirectoryEntityType(document.type)).map(normalizeCachedDocument)
  const workerJson = await buildIndexJsonInWorker(supported)
  const miniSearch = workerJson
    ? await MiniSearchClass.loadJSONAsync<DirectorySearchDoc>(workerJson, miniSearchOptions())
    : new MiniSearchClass<DirectorySearchDoc>(miniSearchOptions())
  if (!workerJson) await miniSearch.addAllAsync(supported, { chunkSize: 200 })
  if (workerJson) serializedSearchIndexes.set(miniSearch, workerJson)
  return {
    documents: supported,
    byId: new Map(supported.map((document) => [document.id, document])),
    byType: groupByType(supported),
    miniSearch,
    stale: false,
  }
}

export function searchDirectory(
  index: DirectorySearchIndex,
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

function timestampKey(value: unknown): string {
  if (value && typeof value === "object" && "toMillis" in value && typeof value.toMillis === "function") return String(value.toMillis())
  if (value instanceof Date) return String(value.getTime())
  if (typeof value === "number" || typeof value === "string") return String(value)
  return "unknown"
}

function openCacheDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("IndexedDB is unavailable")); return }
    const request = indexedDB.open(CACHE_DB, CACHE_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(CACHE_STORE)) database.createObjectStore(CACHE_STORE, { keyPath: "key" })
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
    const request = store.get(latestRecordKey(userId))
    request.onsuccess = () => {
      if (isCacheRecord(request.result)) {
        resolve(request.result) // v2 compatibility: payload lived at `latest`.
        return
      }
      const recordKey = (request.result as DirectoryCachePointer | undefined)?.recordKey
      if (!recordKey) { resolve(null); return }
      const recordRequest = store.get(recordKey)
      recordRequest.onsuccess = () => resolve(isCacheRecord(recordRequest.result) ? recordRequest.result : null)
      recordRequest.onerror = () => reject(recordRequest.error ?? new Error("Unable to read Directory revision cache"))
    }
    request.onerror = () => reject(request.error ?? new Error("Unable to read Directory cache"))
    transaction.oncomplete = () => database.close()
  })
}

async function writeCache(record: DirectoryCacheRecord, previousRecordKey?: string): Promise<void> {
  const database = await openCacheDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(CACHE_STORE, "readwrite")
    const store = transaction.objectStore(CACHE_STORE)
    store.put(record)
    store.put({ key: latestRecordKey(record.userId), recordKey: record.key } satisfies DirectoryCachePointer)
    if (previousRecordKey && previousRecordKey !== record.key && previousRecordKey !== latestRecordKey(record.userId)) {
      store.delete(previousRecordKey)
    }
    transaction.oncomplete = () => { database.close(); resolve() }
    transaction.onerror = () => { database.close(); reject(transaction.error ?? new Error("Unable to write Directory cache")) }
  })
}

async function compressIndexJson(indexJson: string): Promise<Pick<DirectoryCacheRecord, "indexJson" | "indexGzip">> {
  if (typeof CompressionStream === "undefined") return { indexJson }
  try {
    const compressed = new Blob([indexJson]).stream().pipeThrough(new CompressionStream("gzip"))
    return { indexGzip: await new Response(compressed).arrayBuffer() }
  } catch {
    return { indexJson }
  }
}

async function readIndexJson(record: DirectoryCacheRecord): Promise<string> {
  if (record.indexJson) return record.indexJson
  if (!record.indexGzip || typeof DecompressionStream === "undefined") throw new Error("Cached Directory index cannot be restored")
  const decompressed = new Blob([record.indexGzip]).stream().pipeThrough(new DecompressionStream("gzip"))
  return new Response(decompressed).text()
}

async function restoreIndex(record: DirectoryCacheRecord, stale = false): Promise<DirectorySearchIndex> {
  const documents = record.documents.map(normalizeCachedDocument)
  if (record.searchCacheVersion !== SEARCH_CACHE_VERSION) {
    const rebuilt = await createDirectorySearchIndex(documents)
    return { ...rebuilt, stale }
  }
  try {
    const { default: MiniSearchClass } = await import("minisearch")
    const indexJson = await readIndexJson(record)
    const miniSearch = await MiniSearchClass.loadJSONAsync<DirectorySearchDoc>(indexJson, miniSearchOptions())
    return { documents, byId: new Map(documents.map((entry) => [entry.id, entry])), byType: groupByType(documents), miniSearch, stale }
  } catch {
    const rebuilt = await createDirectorySearchIndex(documents)
    return { ...rebuilt, stale }
  }
}

async function readSearchShards(expectedCount: number, expectedEntries: number): Promise<DirectorySearchDoc[]> {
  const snapshot = await getDocs(collection(directoryDb, "directorySearchShards"))
  if (snapshot.size !== expectedCount) throw new Error(`Expected ${expectedCount} search shards, received ${snapshot.size}`)
  const documents = snapshot.docs.flatMap((entry) => {
    const data = entry.data()
    if (data.schemaVersion !== DIRECTORY_SCHEMA_VERSION || !Array.isArray(data.entries)) return []
    return data.entries.map((document) => normalizeCachedDocument(document as DirectorySearchDoc))
  })
  if (documents.length !== expectedEntries) throw new Error(`Expected ${expectedEntries} catalog entries, received ${documents.length}`)
  if (new Set(documents.map((entry) => entry.id)).size !== documents.length) throw new Error("Duplicate catalog entries")
  return documents
}

async function readLegacyIndex(): Promise<DirectorySearchDoc[]> {
  const snapshot = await getDocs(collection(directoryDb, "directoryIndex"))
  return snapshot.docs.flatMap((entry) => {
    const document = directorySearchDocFromData(entry.id, entry.data())
    return document ? [document] : []
  })
}

async function loadDirectorySearchOnce(
  userId: string,
  options: LoadEntityCatalogOptions = {},
): Promise<DirectorySearchIndex> {
  let cache: DirectoryCacheRecord | null = null
  let cachedIndex: DirectorySearchIndex | null = null
  try {
    cache = await readUserCache(userId)
    if (cache) {
      cachedIndex = await restoreIndex(cache, true)
      options.onCache?.(cachedIndex)
    }
  } catch {
    cache = null
  }

  let schemaVersion = DIRECTORY_SCHEMA_VERSION
  let searchRevision = "unknown"
  let shardCount = 0
  let entryCount = 0
  let metaAvailable = false
  try {
    const metaSnapshot = await getDoc(doc(directoryDb, "directoryMeta", "status"))
    if (metaSnapshot.exists()) {
      const data = metaSnapshot.data()
      schemaVersion = typeof data.searchSchemaVersion === "number"
        ? data.searchSchemaVersion
        : (typeof data.schemaVersion === "number" ? data.schemaVersion : DIRECTORY_SCHEMA_VERSION)
      searchRevision = timestampKey(data.searchRevision ?? data.lastChangeAt ?? data.lastRebuildAt)
      shardCount = typeof data.searchShardCount === "number" ? data.searchShardCount : 0
      entryCount = typeof data.searchEntryCount === "number" ? data.searchEntryCount : 0
      metaAvailable = true
    }
  } catch {
    if (cachedIndex) return cachedIndex
  }

  const cacheKey = makeDirectoryCacheKey(userId, schemaVersion, searchRevision)
  if (cache && cachedIndex && cache.cacheKey === cacheKey) return { ...cachedIndex, stale: false }
  if (!metaAvailable && cachedIndex) return cachedIndex

  try {
    const canUseShards = schemaVersion === DIRECTORY_SCHEMA_VERSION && shardCount === DIRECTORY_SEARCH_SHARD_COUNT && entryCount > 0
    let documents: DirectorySearchDoc[]
    if (canUseShards) {
      try {
        documents = await readSearchShards(shardCount, entryCount)
      } catch {
        documents = await readLegacyIndex()
      }
    } else {
      documents = await readLegacyIndex()
    }
    const index = await createDirectorySearchIndex(documents)
    const serializedIndex = serializedSearchIndexes.get(index.miniSearch) ?? JSON.stringify(index.miniSearch)
    serializedSearchIndexes.delete(index.miniSearch)
    const compressedIndex = await compressIndexJson(serializedIndex)
    const record: DirectoryCacheRecord = {
      key: revisionRecordKey(cacheKey),
      cacheKey,
      userId,
      searchCacheVersion: SEARCH_CACHE_VERSION,
      schemaVersion,
      searchRevision,
      documents,
      ...compressedIndex,
      savedAt: Date.now(),
    }
    writeCache(record, cache?.key).catch(() => {})
    return index
  } catch (error) {
    if (cachedIndex) return cachedIndex
    throw error
  }
}

export function loadDirectorySearch(
  userId: string,
  options: LoadEntityCatalogOptions = {},
): Promise<DirectorySearchIndex> {
  const existing = entityCatalogLoads.get(userId)
  if (existing) return existing
  const request = loadDirectorySearchOnce(userId, options)
    .finally(() => entityCatalogLoads.delete(userId))
  entityCatalogLoads.set(userId, request)
  return request
}

export const loadEntityCatalog = loadDirectorySearch

export async function clearDirectorySearchCache(userId?: string): Promise<void> {
  let database: IDBDatabase
  try { database = await openCacheDatabase() } catch { return }
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(CACHE_STORE, "readwrite")
    const store = transaction.objectStore(CACHE_STORE)
    if (userId) {
      const latestKey = latestRecordKey(userId)
      const request = store.get(latestKey)
      request.onsuccess = () => {
        const value = request.result
        const recordKey = isCacheRecord(value) ? value.key : (value as DirectoryCachePointer | undefined)?.recordKey
        if (recordKey && recordKey !== latestKey) store.delete(recordKey)
        store.delete(latestKey)
      }
    } else store.clear()
    transaction.oncomplete = () => { database.close(); resolve() }
    transaction.onerror = () => { database.close(); reject(transaction.error ?? new Error("Unable to clear Directory cache")) }
  })
}
