import {
  DIRECTORY_SCHEMA_VERSION,
  DIRECTORY_SEARCH_SHARD_COUNT,
  directorySearchShardId,
} from "@/lib/directory-core"

export interface DirectoryConsistencyIndexEntry {
  id: string
  companyEntityId?: string | null
}

export interface DirectoryConsistencyShard {
  id: string
  schemaVersion?: number
  shardId?: string
  revision?: string | number
  entryCount?: number
  entries?: Array<{ id?: unknown }>
}

export interface DirectoryConsistencyReference {
  collection: string
  id: string
  entityIds: string[]
}

export interface DirectoryConsistencyMeta {
  schemaVersion?: number
  searchSchemaVersion?: number
  searchRevision?: string | number
  searchShardCount?: number
  searchEntryCount?: number
}

export interface DirectoryConsistencyInput {
  indexEntries: DirectoryConsistencyIndexEntry[]
  shards: DirectoryConsistencyShard[]
  meta: DirectoryConsistencyMeta | null
  references?: DirectoryConsistencyReference[]
}

export interface DirectoryConsistencyIssue {
  code: string
  id?: string
  detail: string
}

export interface DirectoryConsistencyReport {
  ok: boolean
  issues: DirectoryConsistencyIssue[]
  stats: {
    indexEntries: number
    shardDocuments: number
    shardedEntries: number
    references: number
    maxShardBytes: number
  }
}

function issue(code: string, detail: string, id?: string): DirectoryConsistencyIssue {
  return { code, detail, ...(id ? { id } : {}) }
}

function bytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

/** Pure consistency inspection used by tests and the read-only admin script. */
export function inspectDirectoryConsistency(input: DirectoryConsistencyInput): DirectoryConsistencyReport {
  const issues: DirectoryConsistencyIssue[] = []
  const indexIds = new Set(input.indexEntries.map((entry) => entry.id))
  const expectedShardIds = new Set(
    Array.from({ length: DIRECTORY_SEARCH_SHARD_COUNT }, (_, index) => String(index).padStart(2, "0")),
  )
  const actualShardIds = new Set(input.shards.map((shard) => shard.id))
  const shardedIds = new Set<string>()
  let shardedEntries = 0
  let maxShardBytes = 0

  if (!input.meta) {
    issues.push(issue("meta_missing", "directoryMeta/status does not exist"))
  } else {
    if (input.meta.schemaVersion !== DIRECTORY_SCHEMA_VERSION) {
      issues.push(issue("meta_schema", `expected schema ${DIRECTORY_SCHEMA_VERSION}, got ${input.meta.schemaVersion ?? "missing"}`))
    }
    if (input.meta.searchSchemaVersion !== DIRECTORY_SCHEMA_VERSION) {
      issues.push(issue("meta_search_schema", `expected search schema ${DIRECTORY_SCHEMA_VERSION}, got ${input.meta.searchSchemaVersion ?? "missing"}`))
    }
    if (input.meta.searchShardCount !== DIRECTORY_SEARCH_SHARD_COUNT) {
      issues.push(issue("meta_shard_count", `expected ${DIRECTORY_SEARCH_SHARD_COUNT}, got ${input.meta.searchShardCount ?? "missing"}`))
    }
    if (
      input.meta.searchRevision === undefined ||
      input.meta.searchRevision === null ||
      String(input.meta.searchRevision).trim() === ""
    ) {
      issues.push(issue("meta_revision", "searchRevision is missing"))
    }
  }

  for (const expectedId of expectedShardIds) {
    if (!actualShardIds.has(expectedId)) issues.push(issue("shard_missing", "expected shard document is missing", expectedId))
  }
  for (const actualId of actualShardIds) {
    if (!expectedShardIds.has(actualId)) issues.push(issue("shard_unexpected", "unexpected shard document", actualId))
  }

  for (const shard of input.shards) {
    const entries = Array.isArray(shard.entries) ? shard.entries : []
    const shardBytes = bytes(entries)
    maxShardBytes = Math.max(maxShardBytes, shardBytes)
    shardedEntries += entries.length

    if (shard.schemaVersion !== DIRECTORY_SCHEMA_VERSION) {
      issues.push(issue("shard_schema", `expected schema ${DIRECTORY_SCHEMA_VERSION}, got ${shard.schemaVersion ?? "missing"}`, shard.id))
    }
    if (shard.shardId !== shard.id) {
      issues.push(issue("shard_id", `stored shardId ${shard.shardId ?? "missing"} does not match document ID`, shard.id))
    }
    if (shard.entryCount !== entries.length) {
      issues.push(issue("shard_entry_count", `stored ${shard.entryCount ?? "missing"}, actual ${entries.length}`, shard.id))
    }
    if (
      input.meta?.searchRevision !== undefined &&
      input.meta.searchRevision !== null &&
      String(input.meta.searchRevision).trim() !== "" &&
      String(shard.revision ?? "") !== String(input.meta.searchRevision)
    ) {
      issues.push(issue("shard_revision", "shard revision differs from manifest", shard.id))
    }
    if (shardBytes > 800_000) {
      issues.push(issue("shard_size", `${shardBytes} bytes exceeds the 800 KB safety ceiling`, shard.id))
    }

    for (const entry of entries) {
      if (typeof entry.id !== "string" || !entry.id) {
        issues.push(issue("shard_entry_id", "entry is missing a string ID", shard.id))
        continue
      }
      if (directorySearchShardId(entry.id) !== shard.id) {
        issues.push(issue("shard_assignment", "entry hashes to a different shard", entry.id))
      }
      if (shardedIds.has(entry.id)) issues.push(issue("shard_duplicate", "entry appears more than once", entry.id))
      shardedIds.add(entry.id)
    }
  }

  for (const id of indexIds) {
    if (!shardedIds.has(id)) issues.push(issue("index_missing_from_shards", "index entry is absent from the catalog", id))
  }
  for (const id of shardedIds) {
    if (!indexIds.has(id)) issues.push(issue("shard_missing_from_index", "catalog entry has no directoryIndex document", id))
  }

  if (input.meta?.searchEntryCount !== undefined && input.meta.searchEntryCount !== shardedIds.size) {
    issues.push(issue("meta_entry_count", `stored ${input.meta.searchEntryCount}, unique shard entries ${shardedIds.size}`))
  }

  for (const entry of input.indexEntries) {
    if (entry.companyEntityId && !indexIds.has(entry.companyEntityId)) {
      issues.push(issue("company_reference_missing", `companyEntityId ${entry.companyEntityId} does not exist`, entry.id))
    }
  }

  for (const reference of input.references ?? []) {
    for (const entityId of new Set(reference.entityIds)) {
      if (!indexIds.has(entityId)) {
        issues.push(issue(
          "entity_reference_missing",
          `${reference.collection}/${reference.id} points to missing ${entityId}`,
          entityId,
        ))
      }
    }
  }

  return {
    ok: issues.length === 0,
    issues,
    stats: {
      indexEntries: input.indexEntries.length,
      shardDocuments: input.shards.length,
      shardedEntries,
      references: input.references?.length ?? 0,
      maxShardBytes,
    },
  }
}
