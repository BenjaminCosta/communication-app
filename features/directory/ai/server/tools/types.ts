import type { z } from "zod"
import type { DirectoryType } from "@/lib/directory"
import type { DirectoryRelations, RelationEntityRef } from "@/lib/directory-relations-core"
import type { AskContextRelationField, DirectoryIndexRecord } from "@/lib/ai/server/directory-data"
import type { DirectoryAskRecord } from "@/features/directory/ai/directory-ask-contract"

/**
 * Contracts for the Ask SVC Directory tool layer.
 *
 * Tools are the model's only route to Directory data. Every tool is READ-ONLY,
 * validates its own arguments server-side (never trusting model output), and
 * returns a compact, bounded projection — never raw documents and never the
 * whole database.
 *
 * Data access goes through {@link DirectoryDataProvider} so the real Admin-SDK
 * provider can be swapped for an in-memory fixture in the eval harness.
 */

export interface DirectoryNoteRecord {
  id: string
  entityIds: string[]
  text: string
  noteType: string
  createdAtMs: number | null
}

/** A bounded, stable page of an entity's validated Directory relationships. */
export interface DirectoryRelationsPage {
  relations: DirectoryRelations
  edges: RelationEntityRef[]
  /** True when more relationships exist after this page. */
  hasMore: boolean
  /** Opaque relation-document cursor for the next page, when one exists. */
  nextCursor: string | null
  /** Exact number of active relationships when available cheaply; otherwise null. */
  total: number | null
}

export interface DirectoryRelationsOptions {
  cursor?: string | null
  limit?: number
}

/**
 * Bounded, read-only data access. Per the Firestore audit there is deliberately
 * NO "search everything" method: names resolve through bounded `normalizedName`
 * queries and relationships through `/directoryRelations` or the derived
 * `askContext` arrays. Nothing here may scan a collection or load shards.
 */
export interface DirectoryDataProvider {
  findByName(name: string, options: { type?: DirectoryType; limit?: number }): Promise<DirectoryIndexRecord[]>
  getEntity(directoryId: string): Promise<DirectoryIndexRecord | null>
  getRelations(directoryId: string, options?: DirectoryRelationsOptions): Promise<DirectoryRelationsPage>
  getNotes(entityIds: string[], limit: number): Promise<DirectoryNoteRecord[]>
  /** Derived `askContext` relation arrays; one array filter per query. */
  findByRelationField?(
    field: AskContextRelationField,
    entityId: string,
    options: { type?: DirectoryType; limit?: number },
  ): Promise<DirectoryIndexRecord[]>
  /** Optional semantic path; returns null when embeddings are unavailable. */
  searchNotesSemantic?(query: string, limit: number): Promise<DirectoryNoteRecord[] | null>
}

/** A single hop in a relationship path (company → job → person → company). */
export interface PathHop {
  id: string
  name: string
  type: string
  /** How this hop connects to the previous one. */
  role?: string
}

export interface CompactNote {
  id: string
  text: string
  noteType: string
  entityIds: string[]
}

/**
 * Bounded tool output. Everything the model sees is one of these compact
 * shapes; long text is truncated before it leaves the server.
 */
export interface DirectoryToolResult {
  /** Short natural-language framing of what the tool found. */
  summary: string
  records?: DirectoryAskRecord[]
  notes?: CompactNote[]
  paths?: PathHop[][]
  counts?: Record<string, number>
  /** True when this is only a page or the record budget clipped it. */
  truncated?: boolean
  /** Cursor for the next relationship page, when the tool supports it. */
  nextCursor?: string
  /** Set when the tool genuinely found nothing, so the model can say so. */
  empty?: boolean
}

/** Per-question budget shared across every tool call in one conversation. */
export interface ToolBudget {
  maxRecordsPerTool: number
  maxNotesPerTool: number
  maxNoteChars: number
  /** Total records handed to the model across all tool calls. */
  remainingRecords: number
}

export interface DirectoryTool<Args = unknown> {
  name: string
  description: string
  /** JSON Schema advertised to OpenAI. */
  parameters: Record<string, unknown>
  /** Server-side validation — the model's arguments are never trusted. */
  schema: z.ZodType<Args>
  run(args: Args, provider: DirectoryDataProvider, budget: ToolBudget): Promise<DirectoryToolResult>
}
