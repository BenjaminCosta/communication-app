import { z } from "zod"
import { DIRECTORY_TOOLS, runDirectoryTool } from "@/features/directory/ai/server/tools/definitions"
import { createServerDirectoryProvider } from "@/features/directory/ai/server/tools/provider"
import type { DirectoryDataProvider, DirectoryTool } from "@/features/directory/ai/server/tools/types"
import type { DirectoryAskRecord } from "@/features/directory/ai/directory-ask-contract"
import { mapIndexDoc, type DirectoryIndexRecord } from "@/lib/ai/server/directory-data"
import { getFirebaseAdminApp } from "@/lib/ai/server/firebase-admin"
import { tokenize } from "@/lib/directory-core"
import type { DirectoryType } from "@/lib/directory"
import type { SecretaryTool, SecretaryToolResult } from "@/lib/whatsapp-secretary/tool-registry"

/**
 * Directory adapter — the full "Ask SVC Directory" tool stack (nothing
 * excluded; every WhatsApp sender who reaches these tools is already a
 * uniquely identified internal SVC user, so there is no narrower internal
 * audience to protect Directory data from), plus two WhatsApp-only upgrades:
 * contact-detail enrichment and a keyword-search fallback for better recall.
 *
 * Directory's own `extractEntities`/`buildQueryPlan` deterministic prefetch
 * optimizer is deliberately NOT reused here — that machinery exists to save
 * a model round-trip for Directory's single-domain ask endpoint; in the
 * cross-module orchestrator the model itself extracts names/ids as tool
 * arguments when it chooses to call `directory_searchPeople` etc., exactly as
 * it already does today for every other Directory tool call.
 *
 * Phone/email enrichment: the shared `DirectoryAskRecord` shape used by the
 * web app's "Ask SVC Directory" assistant deliberately has no phone/email
 * field. That's the right default for a broadly-shared component, but every
 * sender who can reach ANY tool in this file is, by construction, already a
 * uniquely identified internal SVC user (`buildToolRegistry` only registers
 * Directory tools when `canReadDirectory` is true, which requires an
 * identified sender) — a verified colleague coordinating with another SVC
 * person, not an outside party. So for person records, this adapter does one
 * extra bounded `/contacts` read per result and attaches `phone`/`email` when
 * the contact has them on file, and the system prompt explicitly allows
 * relaying them.
 *
 * Keyword-search fallback: the shared `findByName()` in
 * `lib/ai/server/directory-data.ts` only does exact-match-then-first-word-
 * prefix matching on `normalizedName` — a search for "Beach" alone never
 * finds a job actually named "Miami Beach Project", because the prefix
 * anchor is the query's own first token, not every word in the stored name.
 * That's an acceptable tradeoff for Directory's own low-latency ask endpoint,
 * but the WhatsApp Secretary should find real records from a natural,
 * partial phrase. `createHybridDirectoryProvider()` wraps the real provider:
 * it tries the exact/prefix path first (unchanged, zero extra cost for the
 * common case), and only when that finds nothing, falls back to
 * `directoryIndex.where("keywords","array-contains-any",tokens)` — the same
 * derived, pre-tokenized field and query shape ByeByeDPR's own
 * `searchDirectoryJobsByKeyword()` already uses successfully
 * (`lib/bye-bye-dpr-directory-link.ts`), covered by the already-deployed
 * `directoryIndex(keywords CONTAINS, type ASC)` composite index (and by
 * Firestore's automatic single-field index on `keywords` when no `type`
 * filter is given) — no new index needed. Results are reranked by how many
 * query tokens each candidate's own `keywords` actually contains, since
 * `array-contains-any` is an OR over tokens with no relevance ordering of
 * its own.
 */

const MAX_KEYWORD_TOKENS = 30
const KEYWORD_OVERFETCH_LIMIT = 30

type RecordValue = Record<string, unknown>

export interface DirectoryContactDetails {
  phone: string | null
  email: string | null
}

/** Test seam: swap for a fixture in offline tests instead of hitting Firestore. */
export type DirectoryContactDetailsProvider = (sourceIds: string[]) => Promise<Map<string, DirectoryContactDetails>>

/** Test seam: swap for a fixture in offline tests instead of hitting Firestore. */
export type DirectoryKeywordSearchProvider = (
  tokens: string[],
  options: { type?: DirectoryType; limit: number },
) => Promise<DirectoryIndexRecord[]>

function asRecord(value: unknown): RecordValue | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as RecordValue) : null
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0) : []
}

/** First non-empty `.value` from an `ImportedContactPoint[]`-shaped array. */
function firstPointValue(value: unknown): string {
  if (!Array.isArray(value)) return ""
  for (const entry of value) {
    const point = asRecord(entry)
    const pointValue = asString(point?.value)
    if (pointValue) return pointValue
  }
  return ""
}

/** Mirrors the precedence `buildPersonProfileViewModel()` uses for display: human-edited masterData first, then the imported doc's own fields. */
function extractContactDetails(data: RecordValue): DirectoryContactDetails {
  const masterData = asRecord(data.masterData)
  const phone = asString(masterData?.primaryPhone) || asStringArray(masterData?.phones)[0] || asString(data.phone) || firstPointValue(data.phones)
  const email = asString(masterData?.primaryEmail) || asStringArray(masterData?.emails)[0] || asString(data.email) || firstPointValue(data.emails)
  return { phone: phone || null, email: email || null }
}

function createServerContactDetailsProvider(): DirectoryContactDetailsProvider {
  return async (sourceIds) => {
    const result = new Map<string, DirectoryContactDetails>()
    if (sourceIds.length === 0) return result
    const { getFirestore } = await import("firebase-admin/firestore")
    const db = getFirestore(await getFirebaseAdminApp())
    const snapshots = await db.getAll(...sourceIds.map((id) => db.collection("contacts").doc(id)))
    for (const snapshot of snapshots) {
      if (!snapshot.exists) continue
      result.set(snapshot.id, extractContactDetails(snapshot.data() as RecordValue))
    }
    return result
  }
}

/** Attaches `phone`/`email` to person records that have them on file. Non-person records pass through unchanged. */
async function enrichPersonRecords(
  records: DirectoryAskRecord[],
  provider: DirectoryDataProvider,
  getContactDetails: DirectoryContactDetailsProvider,
): Promise<Array<DirectoryAskRecord & { phone?: string; email?: string }>> {
  const personRecords = records.filter((record) => record.type === "person")
  if (personRecords.length === 0) return records

  const indexRecords = await Promise.all(personRecords.map((record) => provider.getEntity(record.id)))
  const sourceIdByDirectoryId = new Map<string, string>()
  indexRecords.forEach((indexRecord, i) => {
    if (indexRecord && indexRecord.sourceCollection === "contacts") {
      sourceIdByDirectoryId.set(personRecords[i]!.id, indexRecord.sourceId)
    }
  })
  if (sourceIdByDirectoryId.size === 0) return records

  const detailsBySourceId = await getContactDetails([...new Set(sourceIdByDirectoryId.values())])
  return records.map((record) => {
    const sourceId = sourceIdByDirectoryId.get(record.id)
    const details = sourceId ? detailsBySourceId.get(sourceId) : undefined
    if (!details) return record
    return {
      ...record,
      ...(details.phone ? { phone: details.phone } : {}),
      ...(details.email ? { email: details.email } : {}),
    }
  })
}

interface ScoredKeywordMatch {
  record: DirectoryIndexRecord
  score: number
}

/**
 * Pure reranking step, split out from the Firestore query so it's directly
 * unit-testable. `array-contains-any` is an OR over tokens, so a two-word
 * query like "courtney roberts" also pulls in every OTHER "Roberts" and
 * every other "Courtney" on a single-token match — real noise once there are
 * a dozen "Roberts"-someone records in Directory. When at least one
 * candidate matches every query token (the far stronger signal — e.g. the
 * one person who is both "courtney" AND "roberts"), keep only those; fall
 * back to the best partial matches only when nothing matched fully.
 */
export function rerankKeywordMatches(scored: ScoredKeywordMatch[], tokenCount: number, limit: number): DirectoryIndexRecord[] {
  const maxScore = scored.reduce((max, entry) => Math.max(max, entry.score), 0)
  const threshold = maxScore >= tokenCount ? tokenCount : maxScore
  return scored
    .filter((entry) => entry.score >= threshold && entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.record)
}

function createServerKeywordSearchProvider(): DirectoryKeywordSearchProvider {
  return async (tokens, options) => {
    if (tokens.length === 0) return []
    const { getFirestore } = await import("firebase-admin/firestore")
    const db = getFirestore(await getFirebaseAdminApp())
    let query = db.collection("directoryIndex").where("keywords", "array-contains-any", tokens.slice(0, MAX_KEYWORD_TOKENS))
    if (options.type) query = query.where("type", "==", options.type)
    const snapshot = await query.limit(Math.min(KEYWORD_OVERFETCH_LIMIT, Math.max(options.limit * 3, options.limit))).get()

    const scored: ScoredKeywordMatch[] = snapshot.docs.map((doc) => {
      const data = doc.data() as RecordValue
      const keywords = new Set(asStringArray(data.keywords))
      const score = tokens.reduce((total, token) => total + (keywords.has(token) ? 1 : 0), 0)
      return { record: mapIndexDoc(doc.id, data), score }
    })
    return rerankKeywordMatches(scored, tokens.length, options.limit)
  }
}

/**
 * Wraps a real `DirectoryDataProvider` so `findByName` gets a second, bounded
 * chance via keyword search whenever the exact/prefix path finds nothing —
 * every other method passes through unchanged.
 */
export function createHybridDirectoryProvider(
  base: DirectoryDataProvider,
  keywordSearch: DirectoryKeywordSearchProvider,
): DirectoryDataProvider {
  return {
    ...base,
    async findByName(name, options = {}) {
      const primary = await base.findByName(name, options)
      if (primary.length > 0) return primary
      const tokens = tokenize(name)
      if (tokens.length === 0) return primary
      return keywordSearch(tokens, { type: options.type, limit: options.limit ?? 8 })
    },
  }
}

/**
 * The real, keyword-fallback-wrapped Directory provider, for every other
 * module's own job/person resolution (Reports/Clocking via
 * `job-fanout.ts`'s `resolveJobByNameViaDirectory`, Applications'
 * `getApplicationsForJob`, Reports' `resolveAuthorIdByName`) — so a partial
 * or single-word name resolves as well from those call sites as it already
 * does from Directory's own `directory_searchPeople`/`searchCompanies`
 * tools, without each call site re-deriving the same hybrid wiring.
 */
export function createServerDirectoryProviderWithKeywordFallback(): DirectoryDataProvider {
  return createHybridDirectoryProvider(createServerDirectoryProvider(), createServerKeywordSearchProvider())
}

/**
 * "Active now" presence — reuses the exact same signal the web app itself
 * shows: `app/page.tsx` writes `lastSeen: serverTimestamp()` to `/users/{uid}`
 * every 60s while a tab is open/visible, and its own `activeUsers` memo
 * defines "active" as `lastSeen` within the last 90 seconds. This tool asks
 * the identical question over WhatsApp rather than inventing a different
 * "active" definition (there is no login-history or last-30-days concept
 * anywhere in this app to fall back to). Single-field range query on
 * `lastSeen`, automatically indexed by Firestore — no composite index needed.
 */
const ACTIVE_USER_WINDOW_SECONDS = 90
const MAX_ACTIVE_USERS_RETURNED = 30

export interface ActiveUserSummary {
  name: string
  role: string | null
}

async function fetchActiveUsers(): Promise<ActiveUserSummary[]> {
  const { getFirestore, Timestamp } = await import("firebase-admin/firestore")
  const db = getFirestore(await getFirebaseAdminApp())
  const cutoff = Timestamp.fromMillis(Date.now() - ACTIVE_USER_WINDOW_SECONDS * 1000)
  const snapshot = await db
    .collection("users")
    .where("lastSeen", ">=", cutoff)
    .orderBy("lastSeen", "desc")
    .limit(MAX_ACTIVE_USERS_RETURNED)
    .get()
  return snapshot.docs.map((doc) => {
    const data = doc.data() as Record<string, unknown>
    const name = typeof data.name === "string" ? data.name.trim() : ""
    const role = typeof data.role === "string" ? data.role.trim() : ""
    return { name: name || "Unnamed user", role: role || null }
  })
}

function createActiveUsersTool(fetchActive: () => Promise<ActiveUserSummary[]>): SecretaryTool<Record<string, never>> {
  return {
    name: "directory_getActiveUsers",
    module: "directory",
    description: `Lists SVC users currently active in the app right now — had the app open in the last ${ACTIVE_USER_WINDOW_SECONDS} seconds, the same "active now" presence signal the app itself shows. Use this for "who's active/online right now" questions. This is NOT a login/registration list and NOT clock-in status (use a clocking tool for who's clocked in) — it only reflects this exact moment, with no history.`,
    parameters: { type: "object", additionalProperties: false, required: [], properties: {} },
    schema: z.object({}),
    async run(_args, budget): Promise<SecretaryToolResult> {
      if (budget.remainingRecords <= 0) return { summary: "The retrieval budget for this question is used up.", empty: true }
      const users = await fetchActive()
      const limited = users.slice(0, Math.max(0, Math.min(users.length, budget.remainingRecords)))
      budget.remainingRecords -= limited.length
      if (limited.length === 0) return { summary: "No SVC users are currently active in the app right now.", empty: true }
      return { summary: `${limited.length} SVC user(s) currently active in the app right now.`, data: { users: limited } }
    },
  }
}

export function createDirectoryTools(
  deps: {
    provider?: DirectoryDataProvider
    contactDetailsProvider?: DirectoryContactDetailsProvider
    keywordSearchProvider?: DirectoryKeywordSearchProvider
    activeUsersProvider?: () => Promise<ActiveUserSummary[]>
  } = {},
): SecretaryTool[] {
  const baseProvider = deps.provider ?? createServerDirectoryProvider()
  const keywordSearch = deps.keywordSearchProvider ?? createServerKeywordSearchProvider()
  const provider = createHybridDirectoryProvider(baseProvider, keywordSearch)
  const getContactDetails = deps.contactDetailsProvider ?? createServerContactDetailsProvider()
  const fetchActive = deps.activeUsersProvider ?? fetchActiveUsers

  const directoryTools = DIRECTORY_TOOLS.map(
    (tool: DirectoryTool<never>): SecretaryTool => ({
      name: `directory_${tool.name}`,
      module: "directory",
      description: tool.description,
      parameters: tool.parameters,
      schema: tool.schema,
      async run(args, budget): Promise<SecretaryToolResult> {
        const result = await runDirectoryTool(tool.name, args, provider, budget)
        const records = result.records ? await enrichPersonRecords(result.records, provider, getContactDetails) : undefined
        return {
          summary: result.summary,
          empty: result.empty,
          data: {
            ...(records ? { records } : {}),
            ...(result.notes ? { notes: result.notes } : {}),
            ...(result.paths ? { paths: result.paths } : {}),
            ...(result.counts ? { counts: result.counts } : {}),
          },
        }
      },
    }),
  )

  return [...directoryTools, createActiveUsersTool(fetchActive)]
}
