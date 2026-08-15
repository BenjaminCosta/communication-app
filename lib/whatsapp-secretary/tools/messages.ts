import { z } from "zod"
import type { Firestore } from "firebase-admin/firestore"
import { createServerDirectoryProvider } from "@/features/directory/ai/server/tools/provider"
import type { DirectoryDataProvider } from "@/features/directory/ai/server/tools/types"
import { getFirebaseAdminApp } from "@/lib/ai/server/firebase-admin"
import { BYE_BYE_DPR_TIME_TRACKING_PROJECT_ID } from "@/lib/bye-bye-dpr-tags"
import { AUTOMATIC_MESSAGE_SOURCE_MODULES, isAutomaticMessageSourceModule, projectTagId, type MessageType } from "@/lib/store"
import type { SecretaryTool, SecretaryToolResult } from "@/lib/whatsapp-secretary/tool-registry"
import { describeUnresolved, type EntityResolver } from "@/lib/whatsapp-secretary/entity-resolver"

/**
 * Communications (Messages) read layer for the WhatsApp Secretary.
 *
 * Two tools, deliberately kept separate rather than one flag on a shared
 * query, because they enforce two different privacy models:
 *
 * - `messages_searchOperationalHistory` reads automatic, system-generated
 *   Communications posts (3-Week Outlook publishes, ByeByeDPR clock-in/out,
 *   Daily Report submissions, and completed Applications — see `isAutomaticMessageSourceModule` in
 *   `lib/store.ts` for exactly which `sourceModule` values qualify and why
 *   Quest Coral's mirrored human feedback is deliberately excluded). This
 *   content is factual/templated by construction, so it's open to any
 *   internal sender, matching how every other live-data tool here works.
 * - `messages_searchMyCommunications` reads human-written Communications
 *   messages, and is hard-scoped server-side to `visibleToUserIds
 *   array-contains <the requesting sender's own Firebase uid>` — the exact
 *   same ACL the Communications app itself enforces
 *   (`mergeMessageFeed`/firestore.rules). It never takes a "whose messages"
 *   argument from the model; the actor id comes from the access policy the
 *   orchestrator already resolved server-side, not model input. A sender
 *   with no linked Firebase user id (identified by contact match only) gets
 *   an empty, explained result rather than a query — there is no uid to
 *   scope by. It also excludes automatic messages even though a broadcast
 *   automatic post's current (separately tracked, over-broad)
 *   `visibleToUserIds` may technically include the sender — that content
 *   belongs to the other tool, not "my communications."
 *
 * Job/context resolution reuses Directory's own `findByName(..., {type:
 * "job"})`, matching `outlooks.ts`/`reports.ts` — `Message.contextIds`
 * stores the same `/contexts` document id Directory jobs resolve to (see
 * `lib/outlook-comms-server.ts` and `lib/bye-bye-dpr-server.ts`, both of
 * which write a job's `directoryContextId` straight into `contextIds`).
 *
 * Firestore query shapes (two new composite indexes required — see
 * `firestore.indexes.json`, not yet deployed):
 * - `contextIds ARRAY_CONTAINS + sourceModule IN + timestamp DESC` (per-job
 *   operational history).
 * - `sourceModule IN + timestamp DESC` (company-wide operational history,
 *   no job filter).
 * The human-message tool reuses the already-deployed
 * `visibleToUserIds ARRAY_CONTAINS + timestamp DESC` index — no new index
 * needed there. Job/type/category filtering for that tool happens in-memory
 * over a bounded overfetch, the same "bounded slice, refine in memory"
 * pattern `reports.ts`'s `getJobsWithoutRecentReports` and `outlooks.ts`'s
 * `listActiveOutlooks` already use for combos with no dedicated index.
 */

const MESSAGES_COLLECTION = "messages"
const CONTEXTS_COLLECTION = "contexts"
const USERS_COLLECTION = "users"
const PROJECTS_COLLECTION = "projects"
const MAX_RESULTS = 12
const MAX_HUMAN_OVERFETCH = 150
const MAX_TEXT_CHARACTERS = 400

type RecordValue = Record<string, unknown>
export type OperationalMessageCategory = "outlook" | "clocking" | "daily-report" | "application"

export interface OperationalMessageSummary {
  category: OperationalMessageCategory
  authorName: string
  jobName: string | null
  text: string
  createdAt: string | null
  /** Only used server-side to build a WhatsApp attachment (e.g. an Outlook PDF) — stripped before the model sees it. */
  imageUrl: string | null
  fileUrl: string | null
  fileName: string | null
}

export interface HumanMessageSummary {
  authorName: string
  jobName: string | null
  type: MessageType
  text: string
  createdAt: string | null
  /** Only used server-side to build a WhatsApp attachment — stripped before the model sees it. */
  imageUrl: string | null
  fileUrl: string | null
  fileName: string | null
}

export interface MessagesToolsProvider {
  searchOperationalHistory(options: {
    contextId?: string
    since?: string
    until?: string
    category?: OperationalMessageCategory
    tagId?: string
    limit: number
  }): Promise<OperationalMessageSummary[]>
  /** `actorUserId` is always required — this method must never be called without one. */
  searchMyCommunications(options: {
    actorUserId: string
    contextId?: string
    since?: string
    until?: string
    type?: MessageType
    tagId?: string
    limit: number
  }): Promise<HumanMessageSummary[]>
}

function asRecord(value: unknown): RecordValue | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as RecordValue) : null
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0) : []
}

function toIso(value: unknown): string | null {
  if (value && typeof value === "object" && "toDate" in value && typeof (value as { toDate?: unknown }).toDate === "function") {
    const date = (value as { toDate: () => Date }).toDate()
    if (date instanceof Date && !Number.isNaN(date.getTime())) return date.toISOString()
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString()
  return typeof value === "string" && value ? value : null
}

function messageText(data: RecordValue): string {
  const text = asString(data.text) || asString(data.content)
  return text.slice(0, MAX_TEXT_CHARACTERS)
}

function operationalCategory(data: RecordValue): OperationalMessageCategory | null {
  const sourceModule = asString(data.sourceModule)
  if (sourceModule === "three-week-outlook") return "outlook"
  if (sourceModule === "bye-bye-dpr") {
    return asString(data.projectId) === BYE_BYE_DPR_TIME_TRACKING_PROJECT_ID ? "clocking" : "daily-report"
  }
  if (sourceModule === "applications") return "application"
  return null
}

async function getAdminDb(): Promise<Firestore> {
  const { getFirestore } = await import("firebase-admin/firestore")
  return getFirestore(await getFirebaseAdminApp())
}

function messageAttachmentFields(data: RecordValue): { imageUrl: string | null; fileUrl: string | null; fileName: string | null } {
  return {
    imageUrl: asString(data.imageUrl) || null,
    fileUrl: asString(data.fileUrl) || null,
    fileName: asString(data.fileName) || null,
  }
}

/**
 * Strips the internal-only attachment URLs/filename before a message reaches
 * the model, replacing them with a plain `hasAttachment` boolean. The model
 * never gets the URL (it can't leak, invent, or mis-type what it never saw),
 * but it still needs to know a file/photo exists so it can say "I'm sending
 * the photo" instead of "I can't share photos" — the deterministic
 * response-ux layer decides whether to actually attach it (see
 * `buildMessageAttachments` below and `attachmentsFromExecutions` in
 * `lib/whatsapp-response-ux.ts`).
 */
function toModelOperationalMessage({ imageUrl, fileUrl, fileName: _fileName, ...post }: OperationalMessageSummary): RecordValue {
  return { ...post, hasAttachment: Boolean(imageUrl || fileUrl) }
}

function toModelHumanMessage({ imageUrl, fileUrl, fileName: _fileName, ...message }: HumanMessageSummary): RecordValue {
  return { ...message, hasAttachment: Boolean(imageUrl || fileUrl) }
}

type MessagesAttachment = { kind: "image" | "document"; url: string; filename?: string; caption: string }

/**
 * Builds ready-to-send WhatsApp attachments straight from `imageUrl`/
 * `fileUrl`, which are already real, directly-fetchable Firebase download
 * URLs stored on the message doc — no signing needed (unlike report PDFs,
 * which need a fresh signed URL minted from a bare storage path). The model
 * never sees these; only the deterministic response-ux layer does, and only
 * when the user's question actually asked for the file (see
 * `attachmentsFromExecutions` in `lib/whatsapp-response-ux.ts`).
 */
function buildMessageAttachments(messages: Array<{ imageUrl: string | null; fileUrl: string | null; fileName: string | null; authorName: string; jobName: string | null }>): MessagesAttachment[] {
  const attachments: MessagesAttachment[] = []
  for (const message of messages) {
    const caption = `${message.authorName}${message.jobName ? ` — ${message.jobName}` : ""}`
    if (message.imageUrl) attachments.push({ kind: "image", url: message.imageUrl, caption })
    if (message.fileUrl) attachments.push({ kind: "document", url: message.fileUrl, filename: message.fileName ?? undefined, caption })
  }
  return attachments
}

/** Best-effort, batched, capped — mirrors `reports.ts`'s `attachJobNames`. */
async function resolveJobNames(db: Firestore, contextIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(contextIds)].slice(0, 20)
  if (ids.length === 0) return new Map()
  const snapshots = await db.getAll(...ids.map((id) => db.collection(CONTEXTS_COLLECTION).doc(id)))
  const names = new Map<string, string>()
  for (const snapshot of snapshots) {
    if (!snapshot.exists) continue
    const data = snapshot.data() as RecordValue
    const masterData = asRecord(data.masterData)
    const name = asString(masterData?.canonicalName) || asString(data.name)
    if (name) names.set(snapshot.id, name)
  }
  return names
}

async function resolveAuthorNames(db: Firestore, authorIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(authorIds)].slice(0, 20)
  if (ids.length === 0) return new Map()
  const snapshots = await db.getAll(...ids.map((id) => db.collection(USERS_COLLECTION).doc(id)))
  const names = new Map<string, string>()
  for (const snapshot of snapshots) {
    if (!snapshot.exists) continue
    const name = asString((snapshot.data() as RecordValue | undefined)?.name)
    if (name) names.set(snapshot.id, name)
  }
  return names
}

function firstJobName(contextIds: string[], jobNames: Map<string, string>): string | null {
  for (const id of contextIds) {
    const name = jobNames.get(id)
    if (name) return name
  }
  return null
}

function createServerMessagesToolsProvider(): MessagesToolsProvider {
  return {
    async searchOperationalHistory(options) {
      const db = await getAdminDb()
      let query = db
        .collection(MESSAGES_COLLECTION)
        .where("sourceModule", "in", AUTOMATIC_MESSAGE_SOURCE_MODULES)
        .orderBy("timestamp", "desc")
      if (options.contextId) query = db.collection(MESSAGES_COLLECTION).where("contextIds", "array-contains", options.contextId).where("sourceModule", "in", AUTOMATIC_MESSAGE_SOURCE_MODULES).orderBy("timestamp", "desc")
      if (options.until) query = query.where("timestamp", "<=", new Date(options.until))
      if (options.since) query = query.where("timestamp", ">=", new Date(options.since))

      // Over-fetch a bounded amount so an in-memory `category` filter still
      // has enough to choose from without adding a 4th composite index.
      const snapshot = await query.limit(Math.max(options.limit, MAX_RESULTS) * 3).get()
      const docs = snapshot.docs.map((doc) => doc.data() as RecordValue)
      const jobNames = await resolveJobNames(db, docs.flatMap((doc) => asStringArray(doc.contextIds)))
      const authorNames = await resolveAuthorNames(db, docs.map((doc) => asString(doc.authorId) || asString(doc.senderId)))

      const mapped: OperationalMessageSummary[] = []
      for (const doc of docs) {
        const category = operationalCategory(doc)
        if (!category) continue
        if (options.category && category !== options.category) continue
        if (options.tagId && !messageHasTag(doc, options.tagId)) continue
        const contextIds = asStringArray(doc.contextIds)
        mapped.push({
          category,
          authorName: authorNames.get(asString(doc.authorId) || asString(doc.senderId)) || "Someone",
          jobName: firstJobName(contextIds, jobNames),
          text: messageText(doc),
          createdAt: toIso(doc.timestamp ?? doc.createdAt),
          ...messageAttachmentFields(doc),
        })
        if (mapped.length >= options.limit) break
      }
      return mapped
    },
    async searchMyCommunications(options) {
      const db = await getAdminDb()
      let query = db.collection(MESSAGES_COLLECTION).where("visibleToUserIds", "array-contains", options.actorUserId).orderBy("timestamp", "desc")
      if (options.until) query = query.where("timestamp", "<=", new Date(options.until))
      if (options.since) query = query.where("timestamp", ">=", new Date(options.since))

      const snapshot = await query.limit(MAX_HUMAN_OVERFETCH).get()
      const docs = snapshot.docs.map((doc) => doc.data() as RecordValue)
      const jobNames = await resolveJobNames(db, docs.flatMap((doc) => asStringArray(doc.contextIds)))
      const authorNames = await resolveAuthorNames(db, docs.map((doc) => asString(doc.authorId) || asString(doc.senderId)))

      const mapped: HumanMessageSummary[] = []
      for (const doc of docs) {
        if (isAutomaticMessageSourceModule(asString(doc.sourceModule))) continue
        const contextIds = asStringArray(doc.contextIds)
        if (options.contextId && !contextIds.includes(options.contextId)) continue
        const type = (asString(doc.type) || "none") as MessageType
        if (options.type && type !== options.type) continue
        if (options.tagId && !messageHasTag(doc, options.tagId)) continue
        mapped.push({
          authorName: authorNames.get(asString(doc.authorId) || asString(doc.senderId)) || "Someone",
          jobName: firstJobName(contextIds, jobNames),
          type,
          text: messageText(doc),
          createdAt: toIso(doc.timestamp ?? doc.createdAt),
          ...messageAttachmentFields(doc),
        })
        if (mapped.length >= options.limit) break
      }
      return mapped
    },
  }
}

/** Resolves a job name argument to a `/contexts` id, exactly like `outlooks.ts`'s `getOutlookForJob`. */
async function resolveJobContextId(
  directoryProvider: DirectoryDataProvider,
  jobName: string,
): Promise<{ contextId: string; jobName: string } | { ambiguous: true; candidates: Array<{ name: string; location: string }> } | null> {
  const matches = await directoryProvider.findByName(jobName, { type: "job", limit: 5 })
  if (matches.length === 0) return null
  if (matches.length > 1) return { ambiguous: true, candidates: matches.map((job) => ({ name: job.name, location: job.location })) }
  return { contextId: matches[0].sourceId, jobName: matches[0].name }
}

export type TagResolution = { tagId: string; tagName: string } | { ambiguous: true; candidates: Array<{ name: string }> } | null
/** Test seam: swap for a fixture in offline tests instead of hitting Firestore, matching `directoryProvider`'s role for job names. */
export type TagResolver = (tagName: string) => Promise<TagResolution>

/**
 * Resolves a tag name argument to a `/projects` doc id — Communications tags
 * are backed by `/projects` (see `projectToTag()`/`getMessageTagIds()` in
 * `lib/store.ts`), the same collection ByeByeDPR's/Outlook's/Applications'
 * own fixed automatic tags live in. Exact name match only, mirroring how
 * those fixed tags are themselves looked up by name server-side (e.g.
 * `existingDailyReportProjectId` in `lib/bye-bye-dpr-tags.ts`) — tag names
 * are curated, not a large free-text space like job/person names.
 */
async function resolveTagIdFromFirestore(tagName: string): Promise<TagResolution> {
  const db = await getAdminDb()
  const snapshot = await db.collection(PROJECTS_COLLECTION).where("name", "==", tagName).limit(5).get()
  if (snapshot.empty) return null
  if (snapshot.size > 1) {
    return { ambiguous: true, candidates: snapshot.docs.map((doc) => ({ name: asString((doc.data() as RecordValue).name) })) }
  }
  const doc = snapshot.docs[0]!
  return { tagId: doc.id, tagName: asString((doc.data() as RecordValue).name) }
}

/** True when a message carries the given `/projects` tag, across every field that can express it. */
function messageHasTag(data: RecordValue, tagId: string): boolean {
  if (asString(data.projectId) === tagId) return true
  if (asStringArray(data.projectIds).includes(tagId)) return true
  if (asStringArray(data.tagIds).includes(projectTagId(tagId))) return true
  return false
}

export function createMessagesTools(
  deps: {
    resolver?: EntityResolver
    provider?: MessagesToolsProvider
    directoryProvider?: DirectoryDataProvider
    resolveTag?: TagResolver
    /** The requesting WhatsApp sender's linked Firebase uid, if any — resolved
     * server-side by the orchestrator from the access policy, never supplied
     * by the model. Required for `messages_searchMyCommunications`. */
    actorUserId?: string
  } = {},
): SecretaryTool[] {
  const provider = deps.provider ?? createServerMessagesToolsProvider()
  const directoryProvider = deps.directoryProvider ?? createServerDirectoryProvider()
  const resolveTag = deps.resolveTag ?? resolveTagIdFromFirestore
  const actorUserId = deps.actorUserId
  const resolver = deps.resolver

  /** One job-resolution path for both tools: the shared resolver when present, the legacy Directory lookup otherwise. */
  async function resolveJob(
    ref: string | undefined,
    name: string | undefined,
  ): Promise<{ contextId: string; jobName: string } | { failed: SecretaryToolResult }> {
    if (resolver) {
      const resolution = await resolver.resolveArg({ ref, name }, "job")
      if (resolution.status !== "found") return { failed: describeUnresolved(resolution, "job", name ?? ref ?? "") }
      const contextId = resolution.entity.sourceIds.contextId
      if (!contextId) return { failed: { summary: `"${resolution.entity.name}" isn't linked to a Directory job context.`, empty: true } }
      return { contextId, jobName: resolution.entity.name }
    }
    const legacy = await resolveJobContextId(directoryProvider, name as string)
    if (!legacy) return { failed: { summary: `No job matches "${name}".`, empty: true } }
    if ("ambiguous" in legacy) {
      return { failed: { summary: `More than one job matches "${name}". Ask which one.`, data: { candidates: legacy.candidates } } }
    }
    return { contextId: legacy.contextId, jobName: legacy.jobName }
  }

  const searchOperationalHistory: SecretaryTool<{ jobRef?: string; jobName?: string; since?: string; until?: string; category?: OperationalMessageCategory; tag?: string; limit?: number }> = {
    name: "messages_searchOperationalHistory",
    module: "messages",
    description:
      "Search SVC's automatic Communications operational history: system-generated event posts — 3-Week Outlook publishes, ByeByeDPR clock-in/out events, and Daily Report submissions. Open to any internal sender, not limited to what they personally can see in the app, because this content is factual/templated, never human-written. Does NOT include human-written Communications messages — use messages_searchMyCommunications for those.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: [],
      properties: {
        jobRef: { type: "string", description: "Opaque job ref from an earlier result. Preferred over jobName." },
        jobName: { type: "string", description: "Optional job name to scope the history to." },
        since: { type: "string", description: "Only posts on/after this ISO date." },
        until: { type: "string", description: "Only posts on/before this ISO date." },
        category: { type: "string", enum: ["outlook", "clocking", "daily-report"], description: "Optional: only this kind of automatic event." },
        tag: { type: "string", description: "Optional Communications tag name to filter by (e.g. 'Time Tracking', 'Daily Report')." },
        limit: { type: "number", description: "Max posts to return (1-12)." },
      },
    },
    schema: z.object({
      jobRef: z.string().max(20).optional(),
      jobName: z.string().min(1).max(160).optional(),
      since: z.string().max(40).optional(),
      until: z.string().max(40).optional(),
      category: z.enum(["outlook", "clocking", "daily-report"]).optional(),
      tag: z.string().min(1).max(160).optional(),
      limit: z.number().int().min(1).max(MAX_RESULTS).optional(),
    }),
    async run(args, budget): Promise<SecretaryToolResult> {
      let contextId: string | undefined
      let resolvedJobName: string | undefined
      if (args.jobRef || args.jobName) {
        const resolved = await resolveJob(args.jobRef, args.jobName)
        if ("failed" in resolved) return resolved.failed
        contextId = resolved.contextId
        resolvedJobName = resolved.jobName
      }

      let tagId: string | undefined
      if (args.tag) {
        const resolvedTag = await resolveTag(args.tag)
        if (!resolvedTag) return { summary: `No Communications tag matches "${args.tag}".`, empty: true }
        if ("ambiguous" in resolvedTag) {
          return { summary: `More than one tag matches "${args.tag}". Ask which one.`, data: { candidates: resolvedTag.candidates } }
        }
        tagId = resolvedTag.tagId
      }

      if (budget.remainingRecords <= 0) return { summary: "The retrieval budget for this question is used up.", empty: true }
      const limit = Math.max(1, Math.min(args.limit ?? MAX_RESULTS, MAX_RESULTS, budget.remainingRecords))

      const posts = await provider.searchOperationalHistory({ contextId, since: args.since, until: args.until, category: args.category, tagId, limit })
      budget.remainingRecords -= posts.length
      if (posts.length === 0) {
        return { summary: `No automatic Communications history was retrieved${resolvedJobName ? ` for "${resolvedJobName}"` : ""}.`, empty: true }
      }
      const attachments = buildMessageAttachments(posts)
      return {
        summary: `${posts.length} automatic Communications post(s)${resolvedJobName ? ` for "${resolvedJobName}"` : ""}, newest first.`,
        data: { posts: posts.map(toModelOperationalMessage) },
        ...(attachments.length > 0 ? { presentation: { attachments } } : {}),
      }
    },
  }

  const searchMyCommunications: SecretaryTool<{ jobRef?: string; jobName?: string; since?: string; until?: string; type?: MessageType; tag?: string; limit?: number }> = {
    name: "messages_searchMyCommunications",
    module: "messages",
    description:
      "Search the requesting sender's own human-written Communications messages — only messages they are already allowed to see in the SVC app, exactly as the app itself enforces (their own visibility, never another person's private messages). Does NOT include automatic operational posts — use messages_searchOperationalHistory for those.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: [],
      properties: {
        jobRef: { type: "string", description: "Opaque job ref from an earlier result. Preferred over jobName." },
        jobName: { type: "string", description: "Optional job/context name to scope the search to." },
        since: { type: "string", description: "Only messages on/after this ISO date." },
        until: { type: "string", description: "Only messages on/before this ISO date." },
        type: { type: "string", enum: ["progress", "problem", "feedback", "decision", "none"], description: "Optional message type filter." },
        tag: { type: "string", description: "Optional Communications tag name to filter by." },
        limit: { type: "number", description: "Max messages to return (1-12)." },
      },
    },
    schema: z.object({
      jobRef: z.string().max(20).optional(),
      jobName: z.string().min(1).max(160).optional(),
      since: z.string().max(40).optional(),
      until: z.string().max(40).optional(),
      type: z.enum(["progress", "problem", "feedback", "decision", "none"]).optional(),
      tag: z.string().min(1).max(160).optional(),
      limit: z.number().int().min(1).max(MAX_RESULTS).optional(),
    }),
    async run(args, budget): Promise<SecretaryToolResult> {
      if (!actorUserId) {
        return {
          summary: "This sender isn't linked to an SVC app account, so their personal Communications messages can't be checked here.",
          empty: true,
        }
      }

      let contextId: string | undefined
      let resolvedJobName: string | undefined
      if (args.jobRef || args.jobName) {
        const resolved = await resolveJob(args.jobRef, args.jobName)
        if ("failed" in resolved) return resolved.failed
        contextId = resolved.contextId
        resolvedJobName = resolved.jobName
      }

      let tagId: string | undefined
      if (args.tag) {
        const resolvedTag = await resolveTag(args.tag)
        if (!resolvedTag) return { summary: `No Communications tag matches "${args.tag}".`, empty: true }
        if ("ambiguous" in resolvedTag) {
          return { summary: `More than one tag matches "${args.tag}". Ask which one.`, data: { candidates: resolvedTag.candidates } }
        }
        tagId = resolvedTag.tagId
      }

      if (budget.remainingRecords <= 0) return { summary: "The retrieval budget for this question is used up.", empty: true }
      const limit = Math.max(1, Math.min(args.limit ?? MAX_RESULTS, MAX_RESULTS, budget.remainingRecords))

      const messages = await provider.searchMyCommunications({ actorUserId, contextId, since: args.since, until: args.until, type: args.type, tagId, limit })
      budget.remainingRecords -= messages.length
      if (messages.length === 0) {
        return { summary: `No visible Communications messages were retrieved${resolvedJobName ? ` for "${resolvedJobName}"` : ""}.`, empty: true }
      }
      const attachments = buildMessageAttachments(messages)
      return {
        summary: `${messages.length} Communications message(s) visible to this sender${resolvedJobName ? ` for "${resolvedJobName}"` : ""}, newest first.`,
        data: { messages: messages.map(toModelHumanMessage) },
        ...(attachments.length > 0 ? { presentation: { attachments } } : {}),
      }
    },
  }

  return [searchOperationalHistory, searchMyCommunications]
}
