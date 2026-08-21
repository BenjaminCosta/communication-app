import { z } from "zod"
import { DIRECTORY_TOOLS, runDirectoryTool } from "@/features/directory/ai/server/tools/definitions"
import { createServerDirectoryProvider } from "@/features/directory/ai/server/tools/provider"
import type { DirectoryDataProvider, DirectoryTool } from "@/features/directory/ai/server/tools/types"
import type { DirectoryAskRecord } from "@/features/directory/ai/directory-ask-contract"
import { mapIndexDoc, type DirectoryIndexRecord } from "@/lib/ai/server/directory-data"
import { getFirebaseAdminApp } from "@/lib/ai/server/firebase-admin"
import { tokenize } from "@/lib/directory-core"
import type { DirectoryType } from "@/lib/directory"
import { deriveNameFromEmail } from "@/lib/store"
import type { SecretaryTool, SecretaryToolBudget, SecretaryToolResult } from "@/lib/whatsapp-secretary/tool-registry"
import {
  describeUnresolved,
  entityArgSchema,
  toModelEntity,
  type EntityResolver,
} from "@/lib/whatsapp-secretary/entity-resolver"

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
/** A profile should be rich enough to answer "who is X?" without consuming
 * the whole cross-module record budget on one large team. */
const SMART_PROFILE_RELATION_LIMIT = 8

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

/** Exported so the "My SVC context" snapshot (`lib/whatsapp-secretary/self-context.ts`)
 * reads the sender's own phone/email through the exact same bounded `/contacts`
 * projection, instead of re-deriving the masterData-first precedence. */
export function createServerContactDetailsProvider(): DirectoryContactDetailsProvider {
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

/** Missing fields are facts, not invitations for the model to fill gaps from a
 * similarly named record or a relationship label. Keep this deliberately small
 * and stable so WhatsApp answers remain useful rather than diagnostic dumps. */
function smartProfileGaps(record: DirectoryAskRecord): string[] {
  const gaps: string[] = []
  if (record.type === "person" && !record.role) gaps.push("no role on file")
  if ((record.type === "person" || record.type === "job") && !record.companyName) gaps.push("no company on file")
  if (!record.location) gaps.push("no location on file")
  if (!record.description) gaps.push("no description or operational context on file")
  return gaps
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

/**
 * Presence and roster used to be two tools whose descriptions were mostly
 * spent explaining that they were not each other — the clearest possible
 * signal that the distinction is a parameter, not a tool boundary. One tool,
 * one `presence` argument, and the description can now spend its length on
 * what the data actually means instead of on disambiguation.
 */
function createUsersTool(
  fetchActive: () => Promise<ActiveUserSummary[]>,
  fetchAllRegistered: () => Promise<ActiveUserSummary[]>,
): SecretaryTool<{ presence?: "active" | "all" }> {
  return {
    name: "directory_listUsers",
    module: "directory",
    description: `List SVC app user accounts. \`presence: "active"\` (default) is who has the app open right now — a ${ACTIVE_USER_WINDOW_SECONDS}-second window, the same live signal the app's own UI shows, with no history. \`presence: "all"\` is every registered account regardless of whether they're online. Neither is clock-in status (use a clocking tool for who's on a job), and neither is the broader Directory contact list, which also holds external non-user contacts.`,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: [],
      properties: {
        presence: { type: "string", enum: ["active", "all"], description: "Defaults to active (online right now)." },
      },
    },
    schema: z.object({ presence: z.enum(["active", "all"]).optional() }),
    async run(args, budget): Promise<SecretaryToolResult> {
      if (budget.remainingRecords <= 0) return { summary: "The retrieval budget for this question is used up.", empty: true }
      const presence = args.presence ?? "active"
      const users = presence === "all" ? await fetchAllRegistered() : await fetchActive()
      const limited = users.slice(0, Math.max(0, Math.min(users.length, budget.remainingRecords)))
      budget.remainingRecords -= limited.length
      if (limited.length === 0) {
        return {
          summary: presence === "all" ? "No registered SVC users were retrieved." : "No SVC users are currently active in the app right now.",
          empty: true,
        }
      }
      return {
        summary:
          presence === "all"
            ? `${limited.length} registered SVC user account(s).`
            : `${limited.length} SVC user(s) currently active in the app right now.`,
        data: { presence, users: limited },
        ...(users.length > limited.length ? { truncated: true, totalMatched: users.length } : {}),
      }
    },
  }
}

/**
 * Every registered SVC app user (`/users`), not filtered by presence at all
 * — answers "what users are registered/exist in the app" as its own
 * question, distinct from `directory_getActiveUsers`'s live 90-second
 * signal. Deliberately does NOT `orderBy("name")`: `app/page.tsx`'s own
 * client-side mapping falls back to `deriveNameFromEmail()` for a user with
 * no stored `name` field (`data.name || deriveNameFromEmail(...)`), which
 * means some `/users` docs may genuinely have no `name` field at all — an
 * `orderBy` on a field some documents don't have would silently drop them
 * from the results. Reuses that exact same fallback here instead, so every
 * registered user is included and named the same way the app itself shows.
 */
const MAX_REGISTERED_USERS_RETURNED = 60

async function fetchAllRegisteredUsers(): Promise<ActiveUserSummary[]> {
  const { getFirestore } = await import("firebase-admin/firestore")
  const db = getFirestore(await getFirebaseAdminApp())
  const snapshot = await db.collection("users").limit(MAX_REGISTERED_USERS_RETURNED).get()
  return snapshot.docs.map((doc) => {
    const data = doc.data() as Record<string, unknown>
    const email = typeof data.email === "string" ? data.email.trim() : ""
    const storedName = typeof data.name === "string" ? data.name.trim() : ""
    const name = storedName || (email ? deriveNameFromEmail(email) : "")
    const role = typeof data.role === "string" ? data.role.trim() : ""
    return { name: name || "Unnamed user", role: role || null }
  })
}

/**
 * Directory's own tool stack is 11 tools, but several of them are the same
 * function with a different constant baked in — `searchPeople`/`searchCompanies`/
 * `searchJobs` are one `searchTool()` called three times, `findSharedContacts`/
 * `findSharedJobs` are one `intersectionTool()` called twice, and the three
 * relationship tools are one `relationshipTool()` called three times.
 *
 * That shape is right for Directory's own single-domain Ask endpoint, where
 * the tool list is the whole menu. It is wrong for a cross-module orchestrator
 * whose menu also has to hold eight other modules: each extra entry costs
 * selection accuracy, and accuracy failures here are silent (a wrong tool
 * returns a plausible answer, not an error).
 *
 * So this adapter presents **five** WhatsApp-facing tools over the same
 * eleven implementations, with the constant that used to pick a tool becoming
 * an ordinary parameter. Nothing is lost — every underlying capability is
 * still reachable, and the merged tools gained optional filters the split ones
 * never had.
 *
 * One real bug is fixed by the merge rather than papered over: the three
 * relationship tools all take a composite `directoryId` (`person__abc`) which
 * *already encodes the entity type*, so the model was being asked to pick a
 * tool from information its own argument carried — and picking wrong returned
 * whatever the mismatched `pick` pulled off the relation object, with no
 * error. `directory_getEntity` now chooses the underlying relationship tool
 * from the **resolved entity's real type**, so a mismatch is impossible.
 */

const DIRECTORY_TOOL = new Map(DIRECTORY_TOOLS.map((tool) => [tool.name, tool as DirectoryTool<never>]))

const RELATIONSHIP_TOOL_FOR: Record<"person" | "company" | "job", string> = {
  person: "getPersonRelationships",
  company: "getCompanyRelationships",
  job: "getJobRelationships",
}

type DirectorySearchType = "person" | "company" | "job"
const SEARCH_TOOL_FOR: Record<DirectorySearchType, string> = {
  person: "searchPeople",
  company: "searchCompanies",
  job: "searchJobs",
}

export function createDirectoryTools(
  deps: {
    resolver?: EntityResolver
    provider?: DirectoryDataProvider
    contactDetailsProvider?: DirectoryContactDetailsProvider
    keywordSearchProvider?: DirectoryKeywordSearchProvider
    activeUsersProvider?: () => Promise<ActiveUserSummary[]>
    registeredUsersProvider?: () => Promise<ActiveUserSummary[]>
  } = {},
): SecretaryTool[] {
  const baseProvider = deps.provider ?? createServerDirectoryProvider()
  const keywordSearch = deps.keywordSearchProvider ?? createServerKeywordSearchProvider()
  const provider = createHybridDirectoryProvider(baseProvider, keywordSearch)
  const getContactDetails = deps.contactDetailsProvider ?? createServerContactDetailsProvider()
  const fetchActive = deps.activeUsersProvider ?? fetchActiveUsers
  const fetchAllRegistered = deps.registeredUsersProvider ?? fetchAllRegisteredUsers
  const resolver = deps.resolver

  /** Runs one underlying Directory tool and enriches person records, as before. */
  async function runUnderlying(name: string, args: unknown, budget: SecretaryToolBudget) {
    const tool = DIRECTORY_TOOL.get(name)
    if (!tool) return null
    const result = await runDirectoryTool(name, args as never, provider, budget)
    const records = result.records ? await enrichPersonRecords(result.records, provider, getContactDetails) : undefined
    return { ...result, records }
  }

  const search: SecretaryTool<{ query: string; type?: DirectorySearchType; limit?: number }> = {
    name: "directory_search",
    module: "directory",
    description:
      "Search the SVC Directory for people, companies or jobs by name, alias, role, company or location. Omit `type` to search all three at once when you don't know which kind of record the name refers to. Returns compact records including a person's phone/email when on file, plus a `ref` for each result you can pass to directory_getEntity or any other tool instead of re-typing the name.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: {
        query: { type: "string", description: "Name or keywords to find." },
        type: { type: "string", enum: ["person", "company", "job"], description: "Optional. Omit to search people, companies and jobs together." },
        limit: { type: "number", description: "Max records to return (1-15)." },
      },
    },
    schema: z.object({
      query: z.string().min(1).max(200),
      type: z.enum(["person", "company", "job"]).optional(),
      limit: z.number().int().min(1).max(15).optional(),
    }),
    async run(args, budget): Promise<SecretaryToolResult> {
      const types: DirectorySearchType[] = args.type ? [args.type] : ["person", "company", "job"]
      const results = await Promise.all(
        types.map((type) => runUnderlying(SEARCH_TOOL_FOR[type], { query: args.query, limit: args.limit }, budget)),
      )

      const records = results.flatMap((result) => result?.records ?? [])
      const totalMatched = results.reduce((total, result) => total + (result?.counts?.matches ?? 0), 0)
      if (records.length === 0) {
        return { summary: `No Directory ${args.type ?? "record"}s matched that search.`, empty: true }
      }

      // Mint refs so the model can drill down without re-resolving by name.
      const refs = resolver
        ? await Promise.all(records.slice(0, 8).map(async (record) => {
            const resolution = await resolver.resolve(record.name, record.type === "company" ? "company" : record.type === "job" ? "job" : "person")
            return resolution.status === "found" ? { ref: resolution.entity.ref, name: record.name } : null
          }))
        : []

      return {
        summary: `${totalMatched || records.length} Directory record(s) matched.`,
        data: {
          records,
          ...(refs.filter(Boolean).length > 0 ? { refs: refs.filter(Boolean) } : {}),
        },
        ...(totalMatched > records.length ? { truncated: true, totalMatched } : {}),
      }
    },
  }

  const getEntity: SecretaryTool<{
    ref?: string
    name?: string
    type?: DirectorySearchType
    include?: Array<"relationships" | "notes">
    relationshipCursor?: string
    relationshipLimit?: number
  }> = {
    name: "directory_getEntity",
    module: "directory",
    description:
      "Get a Smart Directory Profile for one person, company or job: the full record (including phone/email for a person), data gaps, and a first page of its key related records. This is the required follow-up for questions such as \"who is X?\", \"tell me more\", \"what jobs is X on?\" or \"who works with X?\". Pass `ref` from an earlier result when you have one, otherwise `name`. If `nextCursor` is returned and the user wants more relationships, pass it back as `relationshipCursor`. Notes remain opt-in with `include: [\"notes\"]`.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: [],
      properties: {
        ...entityArgSchema("person", "The person, company or job name."),
        type: { type: "string", enum: ["person", "company", "job"], description: "Which kind of record the name refers to. Helps disambiguate; optional when passing a ref." },
        include: {
          type: "array",
          items: { type: "string", enum: ["relationships", "notes"] },
          description: "`relationships` is accepted for backward compatibility (the Smart Profile always includes them); use `notes` to opt into free-text notes.",
        },
        relationshipCursor: { type: "string", description: "Opaque cursor from this tool's earlier relationship page. Omit for the first profile page." },
        relationshipLimit: { type: "number", description: "Related records to show in this profile (1-15; defaults to 8)." },
      },
    },
    schema: z.object({
      ref: z.string().max(20).optional(),
      name: z.string().min(1).max(200).optional(),
      type: z.enum(["person", "company", "job"]).optional(),
      include: z.array(z.enum(["relationships", "notes"])).max(2).optional(),
      relationshipCursor: z.string().min(1).max(300).optional(),
      relationshipLimit: z.number().int().min(1).max(15).optional(),
    }),
    async run(args, budget): Promise<SecretaryToolResult> {
      if (!resolver) return { summary: "Entity resolution is unavailable.", empty: true }
      if (!args.ref && !args.name) return { summary: "Provide a ref or a name.", empty: true }

      const kind = args.type ?? "person"
      let resolution = await resolver.resolveArg({ ref: args.ref, name: args.name }, kind)
      // Without an explicit type, a name that isn't a person is still probably
      // a real record — try the other two kinds before giving up.
      if (resolution.status === "not-found" && !args.type && args.name) {
        for (const fallback of ["company", "job"] as const) {
          const attempt = await resolver.resolve(args.name, fallback)
          if (attempt.status !== "not-found") {
            resolution = attempt
            break
          }
        }
      }
      if (resolution.status !== "found") {
        return describeUnresolved(resolution, kind, args.name ?? args.ref ?? "")
      }

      const entity = resolution.entity
      const directoryId = entity.sourceIds.directoryId
      if (!directoryId) {
        return { summary: `"${entity.name}" has no SVC Directory record.`, empty: true }
      }

      const include = new Set(args.include ?? [])
      const entityType = (entity.kind === "company" || entity.kind === "job" ? entity.kind : "person") as DirectorySearchType
      const relationshipLimit = args.relationshipLimit ?? SMART_PROFILE_RELATION_LIMIT
      const [details, relationships, notes] = await Promise.all([
        runUnderlying("getEntityDetails", { directoryId, relationLimit: relationshipLimit }, budget),
        runUnderlying(RELATIONSHIP_TOOL_FOR[entityType], { directoryId, cursor: args.relationshipCursor, limit: relationshipLimit }, budget),
        include.has("notes") ? runUnderlying("searchRelevantNotes", { query: entity.name, entityIds: [directoryId] }, budget) : Promise.resolve(null),
      ])

      const primary = details?.records?.[0]
      const related = relationships?.records ?? []
      const relatedTotal = relationships?.counts?.linkedRecords ?? details?.counts?.linkedRecords
      const hasMoreRelationships = Boolean(relationships?.nextCursor)

      return {
        summary: details?.summary ?? `Details for ${entity.name}.`,
        empty: !details || details.empty,
        ...(relationships?.truncated || details?.truncated ? { truncated: true } : {}),
        ...(relationships?.nextCursor ? { nextCursor: relationships.nextCursor } : {}),
        data: {
          entity: toModelEntity(entity),
          ...(details?.records ? { records: details.records } : {}),
          ...(details?.counts ? { counts: details.counts } : {}),
          ...(related.length > 0 ? { related } : {}),
          ...(relationships?.counts ? { relatedCounts: relationships.counts } : {}),
          ...(notes?.notes ? { notes: notes.notes } : {}),
          ...(primary
            ? {
                profile: {
                  record: primary,
                  relationships: {
                    showing: related.length,
                    ...(typeof relatedTotal === "number" ? { total: relatedTotal } : {}),
                    hasMore: hasMoreRelationships,
                  },
                  dataGaps: smartProfileGaps(primary),
                },
              }
            : {}),
        },
      }
    },
  }

  const findConnection: SecretaryTool<{ fromRef?: string; fromName?: string; toRef?: string; toName?: string; mode?: "path" | "sharedPeople" | "sharedJobs" }> = {
    name: "directory_findConnection",
    module: "directory",
    description:
      "Find how two Directory records relate. `mode: \"path\"` (default) walks the relationship graph and returns the actual chain (company → job → person → company) so the answer can cite it. `mode: \"sharedPeople\"` / `\"sharedJobs\"` returns what both records have in common. Accepts refs from earlier results or plain names.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: [],
      properties: {
        fromRef: { type: "string", description: "Ref of the first record from an earlier result." },
        fromName: { type: "string", description: "Name of the first record." },
        toRef: { type: "string", description: "Ref of the second record." },
        toName: { type: "string", description: "Name of the second record." },
        mode: { type: "string", enum: ["path", "sharedPeople", "sharedJobs"], description: "Defaults to path." },
      },
    },
    schema: z.object({
      fromRef: z.string().max(20).optional(),
      fromName: z.string().min(1).max(200).optional(),
      toRef: z.string().max(20).optional(),
      toName: z.string().min(1).max(200).optional(),
      mode: z.enum(["path", "sharedPeople", "sharedJobs"]).optional(),
    }),
    async run(args, budget): Promise<SecretaryToolResult> {
      if (!resolver) return { summary: "Entity resolution is unavailable.", empty: true }

      /** Either endpoint may be any kind, so try each until one resolves. */
      async function resolveEither(ref?: string, name?: string) {
        for (const kind of ["person", "company", "job"] as const) {
          const resolution = await resolver!.resolveArg({ ref, name }, kind)
          if (resolution.status === "found" && resolution.entity.sourceIds.directoryId) return resolution.entity
        }
        return null
      }

      const [from, to] = await Promise.all([resolveEither(args.fromRef, args.fromName), resolveEither(args.toRef, args.toName)])
      if (!from) return { summary: `No Directory record matches "${args.fromName ?? args.fromRef ?? ""}".`, empty: true }
      if (!to) return { summary: `No Directory record matches "${args.toName ?? args.toRef ?? ""}".`, empty: true }

      const mode = args.mode ?? "path"
      const result =
        mode === "path"
          ? await runUnderlying("findConnectingPaths", { fromId: from.sourceIds.directoryId, toId: to.sourceIds.directoryId }, budget)
          : await runUnderlying(mode === "sharedPeople" ? "findSharedContacts" : "findSharedJobs", {
              entityIdA: from.sourceIds.directoryId,
              entityIdB: to.sourceIds.directoryId,
            }, budget)

      if (!result) return { summary: "That connection lookup is unavailable.", empty: true }
      return {
        summary: result.summary,
        empty: result.empty,
        data: {
          ...(result.records ? { records: result.records } : {}),
          ...(result.paths ? { paths: result.paths } : {}),
          ...(result.counts ? { counts: result.counts } : {}),
        },
      }
    },
  }

  const searchNotes: SecretaryTool<{ query: string; limit?: number }> = {
    name: "directory_searchNotes",
    module: "directory",
    description:
      "Search free-text Directory notes — the written context people record about a person, company or job that isn't a structured field. Use this when a question needs background or history rather than a record's fields.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: {
        query: { type: "string", description: "What to look for in the notes." },
        limit: { type: "number", description: "Max notes to return (1-5)." },
      },
    },
    schema: z.object({ query: z.string().min(1).max(200), limit: z.number().int().min(1).max(5).optional() }),
    async run(args, budget): Promise<SecretaryToolResult> {
      const result = await runUnderlying("searchRelevantNotes", { query: args.query, limit: args.limit }, budget)
      if (!result) return { summary: "Note search is unavailable.", empty: true }
      return { summary: result.summary, empty: result.empty, data: { ...(result.notes ? { notes: result.notes } : {}) } }
    },
  }

  return [search, getEntity, findConnection, searchNotes, createUsersTool(fetchActive, fetchAllRegistered)]
}
