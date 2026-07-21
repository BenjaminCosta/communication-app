import {
  findByAskContextRelation,
  findByName,
  getEntityById,
  getNotesForEntities,
  getRelations,
} from "@/lib/ai/server/directory-data"
import type { DirectoryDataProvider } from "@/features/directory/ai/server/tools/types"

/**
 * Production {@link DirectoryDataProvider} — bounded, read-only Admin SDK reads.
 *
 * Every method maps to a single limited Firestore query; nothing scans a
 * collection or loads the shard catalog. The eval harness substitutes an
 * in-memory fixture implementing the same interface.
 */
export function createServerDirectoryProvider(): DirectoryDataProvider {
  return {
    findByName: (name, options) => findByName(name, options),
    getEntity: (directoryId) => getEntityById(directoryId),
    getRelations: (directoryId) => getRelations(directoryId),
    getNotes: (entityIds, limit) => getNotesForEntities(entityIds, limit),
    findByRelationField: (field, entityId, options) => findByAskContextRelation(field, entityId, options),
    // Semantic note retrieval is intentionally absent until the askContext
    // backfill + embeddings land; the notes tool falls back to lexical scoring.
  }
}
