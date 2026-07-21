import { collection, doc, getDoc, getDocs } from "firebase/firestore/lite"
import { directoryDb } from "@/lib/firebase"
import {
  DIRECTORY_SCHEMA_VERSION,
  DIRECTORY_SEARCH_SHARD_COUNT,
  type DirectorySearchDoc,
} from "@/lib/directory"
import { isDirectoryEntityType } from "@/lib/directory-config"
import {
  directorySearchDocFromData,
  groupByType,
  miniSearchOptions,
  normalizeCachedDocument,
  type DirectorySearchIndex,
} from "@/lib/directory-search-core"

/**
 * SVC Directory — browser search loader.
 *
 * Owns everything runtime-specific: the IndexedDB revision cache, the worker
 * that builds the MiniSearch index off the main thread, and reading the sharded
 * catalog from Firestore Lite. All normalization/projection/ranking lives in
 * `directory-search-core.ts` and is re-exported here so existing imports (and
 * the server-side AI tools) share exactly one implementation.
 */

export {
  buildDirectorySearchIndex,
  directoryItemsForIds,
  directoryListItemFromDoc,
  directorySearchDocFromData,
  getDirectoryTitleSuggestions,
  normalizeSearchText,
  paginateDirectoryItems,
  searchDirectory,
  type DirectorySearchIndex,
} from "@/lib/directory-search-core"

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

/** Browser index build: prefers the worker so the main thread stays responsive. */
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
