import type { Firestore } from "firebase-admin/firestore"
import { createServerDirectoryProvider } from "@/features/directory/ai/server/tools/provider"
import type { DirectoryDataProvider } from "@/features/directory/ai/server/tools/types"
import { getFirebaseAdminApp } from "@/lib/ai/server/firebase-admin"
import { directoryId, parseDirectoryId } from "@/lib/directory-core"
import type { WhatsAppSenderIdentity } from "@/lib/whatsapp-svc-identity"
import { createServerContactDetailsProvider, type DirectoryContactDetailsProvider } from "@/lib/whatsapp-secretary/tools/directory"

/**
 * "My SVC context" — one bounded, read-only snapshot of everything SVC
 * genuinely knows about the *resolved sender themselves*, assembled from the
 * live data that already exists.
 *
 * This is personalization, not a new permissions model. Every read below is
 * either (a) about the sender's own record, (b) already open to any
 * identified internal sender through an existing tool (Directory, Quest
 * Coral, Reports, Clocking, Outlooks), or (c) — for Communications — scoped
 * server-side to the exact `visibleToUserIds array-contains <own uid>` ACL the
 * Communications app itself enforces, identical to
 * `messages_searchMyCommunications`. Nothing here widens what a sender may
 * see; it only narrows existing access down to "about me".
 *
 * Two hard design rules, because the whole point is a Secretary that knows who
 * it's talking to *without making things up*:
 *
 * 1. **Every section is independently optional and independently failing.**
 *    Each source is fetched in its own try/catch and degrades to
 *    empty/`null` — a missing Directory profile, an unlinked app account, or
 *    a module the person simply has no records in never blanks out the rest
 *    of the snapshot, and never turns into an invented value.
 * 2. **Absence is reported explicitly, as `gaps`.** "No role on file" is a
 *    fact the model is told, so it can say that instead of guessing a role
 *    from a job name or a company.
 *
 * Firestore query shapes are all deliberately index-free or on already-
 * deployed indexes — this feature adds no new composite index:
 * - Directory profile/relations: a `/directoryIndex` doc read plus
 *   `getRelations()` (already-deployed `directoryRelations(entityIds
 *   CONTAINS, active ASC)`).
 * - Reports: `reports(authorId ASC, status ASC, createdAt DESC)` — already
 *   deployed, already used by `reports_getDailyReportsByAuthor`.
 * - Clocking: `userId == uid AND status == "active"` — equality-only, which
 *   Firestore serves without a composite index (the exact query shape
 *   `getActiveClock()` in `lib/bye-bye-dpr-server.ts` already uses in
 *   production). A *history* query would need `(userId, clockInAt DESC)`,
 *   which does not exist — so this deliberately reports only the currently
 *   open clock rather than adding an index or, worse, returning an
 *   arbitrary unordered slice and calling it "recent".
 * - Quest Coral: one bounded `orderBy(updatedAt desc).limit(N)` page filtered
 *   in memory, because project membership lives in a `people[]` array of
 *   objects that Firestore cannot query. Same bounded-scan tradeoff
 *   `tools/quest-coral.ts` already makes for its keyword fallback, on the
 *   same confirmed-small collection.
 * - Communications: already-deployed `messages(visibleToUserIds CONTAINS,
 *   timestamp DESC)`.
 * - Applications: single-field equality on `general.email` / `general.phone`,
 *   automatically indexed.
 */

const MAX_JOBS = 6
const MAX_COMPANIES = 4
const MAX_PROJECTS = 5
const MAX_REPORTS = 4
const MAX_OUTLOOK_JOBS = 4
const MAX_RECENT_MESSAGES = 8
/** Bounded "scan every project" cap — mirrors `tools/quest-coral.ts`. */
const MAX_PROJECT_SCAN = 200
const SNAPSHOT_CACHE_TTL_MS = 60_000
const SNAPSHOT_CACHE_MAX = 50

type RecordValue = Record<string, unknown>

/** Server-side actor. `personId`/`userId` are authorization context and are never sent to a model. */
export interface SelfContextActor {
  /** `/contacts` document id, or `user:<uid>` when the sender matched only a `/users` record. */
  personId: string
  /** Linked Firebase uid, when the sender has an SVC app account. */
  userId: string | null
  name: string
  role: string | null
}

export interface SelfJobRef {
  name: string
  /** Relationship label straight from Directory (e.g. "Project Manager") — never inferred. */
  relationship: string | null
  /** `/contexts` document id, kept server-side for Outlook lookups. */
  contextId: string | null
}

export interface SelfCompanyRef {
  name: string
  relationship: string | null
}

export interface SelfProfile {
  phone: string | null
  email: string | null
  companyName: string | null
  location: string | null
  /** Directory's own role text for this person, which can differ from the identity's. */
  directoryRole: string | null
}

export interface SelfProject {
  name: string
  status: string
  /** "owner" when they own it, "involved" when they're listed under People involved. */
  involvement: "owner" | "involved"
  nextStep: string | null
  updatedAt: string | null
}

export interface SelfReport {
  jobName: string
  status: "draft" | "submitted"
  createdAt: string | null
}

export interface SelfClock {
  jobName: string
  clockInAt: string | null
}

export interface SelfOutlook {
  jobName: string
  windowStart: string
  windowEnd: string
  taskCount: number
  /** True when today falls inside the window. */
  activeToday: boolean
}

export interface SelfMessageActivity {
  visibleRecentCount: number
  latestAt: string | null
}

export interface SelfApplication {
  candidateName: string
  jobName: string
  status: string
  updatedAt: string | null
}

export interface SelfContextSnapshot {
  identity: {
    name: string
    role: string | null
    hasLinkedAccount: boolean
    /** How the sender was recognized, for an honest "I know you as…" line. */
    recognizedVia: "directory-contact" | "app-account"
  }
  profile: SelfProfile | null
  jobs: SelfJobRef[]
  companies: SelfCompanyRef[]
  projects: SelfProject[]
  reports: SelfReport[]
  clock: SelfClock | null
  outlooks: SelfOutlook[]
  messages: SelfMessageActivity | null
  application: SelfApplication | null
  /** Plain-English statements of what is genuinely NOT on file, so the model states them instead of guessing. */
  gaps: string[]
}

/** Test seam: every live read the snapshot needs, so offline tests use fixtures instead of Firestore. */
export interface SelfContextProvider {
  getDirectoryProfile(contactId: string): Promise<{ profile: SelfProfile; jobs: SelfJobRef[]; companies: SelfCompanyRef[] } | null>
  getQuestCoralInvolvement(userId: string): Promise<SelfProject[]>
  getRecentReports(userId: string): Promise<SelfReport[]>
  getActiveClock(userId: string): Promise<SelfClock | null>
  getOutlooksForJobs(jobs: SelfJobRef[], onDate: string): Promise<SelfOutlook[]>
  getVisibleMessageActivity(userId: string): Promise<SelfMessageActivity | null>
  findOwnApplication(input: { email: string | null; phone: string | null }): Promise<SelfApplication | null>
}

function asRecord(value: unknown): RecordValue | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as RecordValue) : null
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function toIso(value: unknown): string | null {
  if (value && typeof value === "object" && "toDate" in value && typeof (value as { toDate?: unknown }).toDate === "function") {
    const date = (value as { toDate: () => Date }).toDate()
    if (date instanceof Date && !Number.isNaN(date.getTime())) return date.toISOString()
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString()
  return typeof value === "string" && value ? value : null
}

async function getAdminDb(): Promise<Firestore> {
  const { getFirestore } = await import("firebase-admin/firestore")
  return getFirestore(await getFirebaseAdminApp())
}

/** Contact-only identities carry `user:<uid>` as their personId and have no `/contacts` record to read. */
export function contactIdFromPersonId(personId: string): string | null {
  return personId.startsWith("user:") ? null : personId
}

export function createServerSelfContextProvider(
  deps: { directoryProvider?: DirectoryDataProvider; contactDetailsProvider?: DirectoryContactDetailsProvider } = {},
): SelfContextProvider {
  const directoryProvider = deps.directoryProvider ?? createServerDirectoryProvider()
  const getContactDetails = deps.contactDetailsProvider ?? createServerContactDetailsProvider()

  return {
    async getDirectoryProfile(contactId) {
      const entityId = directoryId("person", contactId)
      const [entity, relationResult, detailsById] = await Promise.all([
        directoryProvider.getEntity(entityId),
        directoryProvider.getRelations(entityId),
        getContactDetails([contactId]),
      ])
      const details = detailsById.get(contactId) ?? null
      if (!entity && !details) return null

      const jobs = relationResult.relations.jobs.slice(0, MAX_JOBS).map((ref) => ({
        name: ref.name,
        relationship: ref.role ?? null,
        contextId: parseDirectoryId(ref.id)?.sourceId ?? null,
      }))
      const companies = relationResult.relations.companies.slice(0, MAX_COMPANIES).map((ref) => ({
        name: ref.name,
        relationship: ref.role ?? null,
      }))
      return {
        profile: {
          phone: details?.phone ?? null,
          email: details?.email ?? null,
          companyName: entity?.companyName || null,
          location: entity?.location || null,
          directoryRole: entity?.role || null,
        },
        jobs,
        companies,
      }
    },

    async getQuestCoralInvolvement(userId) {
      const db = await getAdminDb()
      const snapshot = await db.collection("questCoralProjects").orderBy("updatedAt", "desc").limit(MAX_PROJECT_SCAN).get()
      const mine: SelfProject[] = []
      for (const doc of snapshot.docs) {
        const data = doc.data() as RecordValue
        const isOwner = asString(data.ownerUserId) === userId
        const people = Array.isArray(data.people) ? data.people.map(asRecord) : []
        const isInvolved = people.some((person) => person && asString(person.id) === userId)
        if (!isOwner && !isInvolved) continue
        mine.push({
          name: asString(data.name) || "Unnamed project",
          status: asString(data.status) || "planning",
          involvement: isOwner ? "owner" : "involved",
          nextStep: asString(data.nextStep) || null,
          updatedAt: toIso(data.updatedAt),
        })
        if (mine.length >= MAX_PROJECTS) break
      }
      return mine
    },

    async getRecentReports(userId) {
      const db = await getAdminDb()
      const [submitted, drafts] = await Promise.all(
        (["submitted", "draft"] as const).map((status) =>
          db
            .collection("reports")
            .where("authorId", "==", userId)
            .where("status", "==", status)
            .orderBy("createdAt", "desc")
            .select("jobId", "status", "createdAt")
            .limit(MAX_REPORTS)
            .get(),
        ),
      )
      const docs = [...submitted.docs, ...drafts.docs]
      if (docs.length === 0) return []

      const jobIds = [...new Set(docs.map((doc) => asString((doc.data() as RecordValue).jobId)).filter(Boolean))].slice(0, MAX_REPORTS * 2)
      const jobSnapshots = jobIds.length > 0 ? await db.getAll(...jobIds.map((id) => db.collection("jobs").doc(id))) : []
      const jobNames = new Map(jobSnapshots.filter((snap) => snap.exists).map((snap) => [snap.id, asString((snap.data() as RecordValue | undefined)?.name)]))

      return docs
        .map((doc) => {
          const data = doc.data() as RecordValue
          return {
            jobName: jobNames.get(asString(data.jobId)) || "Unnamed job",
            status: data.status === "submitted" ? ("submitted" as const) : ("draft" as const),
            createdAt: toIso(data.createdAt),
          }
        })
        .sort((first, second) => (second.createdAt ?? "").localeCompare(first.createdAt ?? ""))
        .slice(0, MAX_REPORTS)
    },

    async getActiveClock(userId) {
      const db = await getAdminDb()
      const snapshot = await db.collection("clockRecords").where("userId", "==", userId).where("status", "==", "active").limit(1).get()
      const doc = snapshot.docs[0]
      if (!doc) return null
      const data = doc.data() as RecordValue
      const jobId = asString(data.jobId)
      const jobSnapshot = jobId ? await db.collection("jobs").doc(jobId).get() : null
      return {
        jobName: asString((jobSnapshot?.data() as RecordValue | undefined)?.name) || "Unnamed job",
        clockInAt: toIso(data.clockInAt),
      }
    },

    async getOutlooksForJobs(jobs, onDate) {
      const db = await getAdminDb()
      const withContext = jobs.filter((job) => job.contextId).slice(0, MAX_OUTLOOK_JOBS)
      const windows = await Promise.all(
        withContext.map(async (job) => {
          const snapshot = await db
            .collection("contexts")
            .doc(job.contextId as string)
            .collection("outlooks")
            .orderBy("windowStart", "desc")
            .limit(1)
            .get()
          const doc = snapshot.docs[0]
          if (!doc) return null
          const data = doc.data() as RecordValue
          const windowStart = asString(data.windowStart) || doc.id
          const windowEnd = asString(data.windowEnd)
          const taskCount = Array.isArray(data.tasks) ? data.tasks.filter((task) => asString(asRecord(task)?.title)).length : 0
          return {
            jobName: job.name,
            windowStart,
            windowEnd,
            taskCount,
            activeToday: Boolean(windowStart) && Boolean(windowEnd) && onDate >= windowStart && onDate <= windowEnd,
          }
        }),
      )
      return windows.filter((entry): entry is SelfOutlook => entry !== null)
    },

    async getVisibleMessageActivity(userId) {
      const db = await getAdminDb()
      const snapshot = await db
        .collection("messages")
        .where("visibleToUserIds", "array-contains", userId)
        .orderBy("timestamp", "desc")
        .select("timestamp", "sourceModule")
        .limit(MAX_RECENT_MESSAGES)
        .get()
      if (snapshot.empty) return null
      // Counting human-written messages separately would need the full docs;
      // this only reports how much of the sender's own visible feed is recent
      // activity, which is all the snapshot claims.
      const latestAt = toIso((snapshot.docs[0].data() as RecordValue).timestamp)
      return { visibleRecentCount: snapshot.size, latestAt }
    },

    async findOwnApplication({ email, phone }) {
      const db = await getAdminDb()
      const queries = [
        ...(email ? [db.collection("applications").where("general.email", "==", email).limit(1)] : []),
        ...(phone ? [db.collection("applications").where("general.phone", "==", phone).limit(1)] : []),
      ]
      for (const query of queries) {
        const snapshot = await query.get()
        const doc = snapshot.docs[0]
        if (!doc) continue
        const data = doc.data() as RecordValue
        return {
          candidateName: asString(data.candidateName) || "Unnamed candidate",
          jobName: asString(data.jobName) || "Unnamed job",
          status: asString(data.status) || "draft",
          updatedAt: toIso(data.updatedAt),
        }
      }
      return null
    },
  }
}

/** Runs one source, swallowing its failure so a single broken read never blanks the whole snapshot. */
async function safely<T>(run: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await run()
  } catch {
    return fallback
  }
}

function buildGaps(snapshot: Omit<SelfContextSnapshot, "gaps">): string[] {
  const gaps: string[] = []
  if (!snapshot.identity.role) gaps.push("No role/title is on file for them in SVC.")
  if (!snapshot.identity.hasLinkedAccount) {
    gaps.push(
      "They are recognized as an SVC contact but have no linked SVC app account, so nothing that is keyed to a user account (their own Daily Reports, clock records, Quest Coral projects, or their own Communications messages) can be looked up for them.",
    )
  }
  if (!snapshot.profile) gaps.push("They have no SVC Directory profile record on file.")
  if (snapshot.jobs.length === 0) gaps.push("No jobs are linked to them in the SVC Directory.")
  if (snapshot.companies.length === 0) gaps.push("No companies are linked to them in the SVC Directory.")
  if (snapshot.identity.hasLinkedAccount && snapshot.projects.length === 0) gaps.push("They own or appear on no Quest Coral projects.")
  if (snapshot.identity.hasLinkedAccount && snapshot.reports.length === 0) gaps.push("No ByeByeDPR Daily Reports were found authored by them.")
  return gaps
}

/**
 * Assembles the snapshot. Never throws: a total failure degrades to the bare
 * identity the webhook already resolved, which is still true information.
 */
export async function buildSelfContextSnapshot(
  actor: SelfContextActor,
  deps: { provider?: SelfContextProvider; today?: string } = {},
): Promise<SelfContextSnapshot> {
  const provider = deps.provider ?? createServerSelfContextProvider()
  const today = deps.today ?? new Date().toISOString().slice(0, 10)
  const contactId = contactIdFromPersonId(actor.personId)
  const userId = actor.userId

  const directory = contactId ? await safely(() => provider.getDirectoryProfile(contactId), null) : null

  const [projects, reports, clock, messages] = await Promise.all([
    userId ? safely(() => provider.getQuestCoralInvolvement(userId), [] as SelfProject[]) : Promise.resolve([]),
    userId ? safely(() => provider.getRecentReports(userId), [] as SelfReport[]) : Promise.resolve([]),
    userId ? safely(() => provider.getActiveClock(userId), null) : Promise.resolve(null),
    userId ? safely(() => provider.getVisibleMessageActivity(userId), null) : Promise.resolve(null),
  ])

  const jobs = directory?.jobs ?? []
  const [outlooks, application] = await Promise.all([
    jobs.length > 0 ? safely(() => provider.getOutlooksForJobs(jobs, today), [] as SelfOutlook[]) : Promise.resolve([]),
    directory?.profile.email || directory?.profile.phone
      ? safely(() => provider.findOwnApplication({ email: directory.profile.email, phone: directory.profile.phone }), null)
      : Promise.resolve(null),
  ])

  const base: Omit<SelfContextSnapshot, "gaps"> = {
    identity: {
      name: actor.name,
      role: actor.role ?? directory?.profile.directoryRole ?? null,
      hasLinkedAccount: Boolean(userId),
      recognizedVia: contactId ? "directory-contact" : "app-account",
    },
    profile: directory?.profile ?? null,
    jobs,
    companies: directory?.companies ?? [],
    projects,
    reports,
    clock,
    outlooks,
    messages,
    application,
  }
  return { ...base, gaps: buildGaps(base) }
}

const snapshotCache = new Map<string, { atMs: number; snapshot: Promise<SelfContextSnapshot> }>()

/**
 * Per-instance, short-TTL memo. One WhatsApp turn can hit the snapshot several
 * times — the onboarding decision in the webhook, `me_getMyProfile`, and
 * `me_getSecretaryGuide` all want the same data — and this keeps that one
 * bounded fan-out instead of three.
 */
export function getSelfContextSnapshot(
  actor: SelfContextActor,
  deps: { provider?: SelfContextProvider; today?: string; nowMs?: number } = {},
): Promise<SelfContextSnapshot> {
  const nowMs = deps.nowMs ?? Date.now()
  const key = `${actor.personId}|${actor.userId ?? ""}`
  const cached = snapshotCache.get(key)
  if (cached && nowMs - cached.atMs < SNAPSHOT_CACHE_TTL_MS) return cached.snapshot

  const snapshot = buildSelfContextSnapshot(actor, deps)
  snapshotCache.set(key, { atMs: nowMs, snapshot })
  if (snapshotCache.size > SNAPSHOT_CACHE_MAX) {
    const oldest = snapshotCache.keys().next().value
    if (oldest) snapshotCache.delete(oldest)
  }
  return snapshot
}

/** Test helper — the cache is process-wide, so tests must be able to reset it. */
export function clearSelfContextSnapshotCache(): void {
  snapshotCache.clear()
}

export function selfContextActorFromIdentity(identity: WhatsAppSenderIdentity): SelfContextActor {
  return {
    personId: identity.personId,
    userId: identity.userId ?? null,
    name: identity.name,
    role: identity.role ?? null,
  }
}

/** Kept here so both the tools and the onboarding intro classify "has real data" identically. */
export function snapshotHasLiveData(snapshot: SelfContextSnapshot): boolean {
  return (
    snapshot.jobs.length > 0 ||
    snapshot.companies.length > 0 ||
    snapshot.projects.length > 0 ||
    snapshot.reports.length > 0 ||
    snapshot.outlooks.length > 0 ||
    snapshot.clock !== null ||
    snapshot.application !== null
  )
}
