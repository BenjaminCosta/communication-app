import { createServerDirectoryProvider } from "@/features/directory/ai/server/tools/provider"
import { getFirebaseAdminApp } from "@/lib/ai/server/firebase-admin"
import type { DossierSources } from "@/lib/whatsapp-secretary/tools/svc"

/**
 * Production wiring for the cross-module dossier.
 *
 * Kept out of `svc.ts` for the same reason `entity-lookups.ts` is kept out of
 * `entity-resolver.ts`: the tool file stays free of Firebase imports so its
 * logic (section selection, empty-vs-unavailable reporting, budget accounting)
 * is unit-testable under plain `tsx` with fixtures.
 *
 * Every query here is deliberately the *narrowest* form of a read an existing
 * module tool already performs — newest-N for one id — rather than a new
 * access path. No new Firestore index is required: each one runs on an index
 * that is already deployed and already exercised by the per-module tools.
 */

type RecordValue = Record<string, unknown>

async function getAdminDb() {
  const { getFirestore } = await import("firebase-admin/firestore")
  return getFirestore(await getFirebaseAdminApp())
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

function truncate(value: unknown, max: number): string | null {
  const text = asString(value)
  return text ? text.slice(0, max) : null
}

export function createServerDossierSources(): DossierSources {
  const directory = createServerDirectoryProvider()

  return {
    async getOutlook(contextId, onDate) {
      const db = await getAdminDb()
      const snapshot = await db.collection("contexts").doc(contextId).collection("outlooks").orderBy("windowStart", "desc").limit(1).get()
      const doc = snapshot.docs[0]
      if (!doc) return null
      const data = doc.data() as RecordValue
      const windowStart = asString(data.windowStart) || doc.id
      const windowEnd = asString(data.windowEnd)
      const taskCount = Array.isArray(data.tasks) ? data.tasks.filter((task) => asString(asRecord(task)?.title)).length : 0
      return {
        windowStart,
        windowEnd,
        taskCount,
        activeToday: Boolean(windowStart) && Boolean(windowEnd) && onDate >= windowStart && onDate <= windowEnd,
      }
    },

    async getReports(byeByeDprJobId, limit) {
      const db = await getAdminDb()
      const snapshot = await db
        .collection("reports")
        .where("jobId", "==", byeByeDprJobId)
        .where("type", "==", "daily_report")
        .orderBy("createdAt", "desc")
        .select("status", "createdAt", "structuredData.workCompleted")
        .limit(limit)
        .get()
      return snapshot.docs.map((doc) => {
        const data = doc.data() as RecordValue
        return {
          status: data.status === "submitted" ? ("submitted" as const) : ("draft" as const),
          createdAt: toIso(data.createdAt),
          workCompleted: truncate(asRecord(data.structuredData)?.workCompleted, 240),
        }
      })
    },

    async getReportsByAuthor(userId, limit) {
      const db = await getAdminDb()
      const snapshot = await db
        .collection("reports")
        .where("authorId", "==", userId)
        .where("status", "==", "submitted")
        .orderBy("createdAt", "desc")
        .select("status", "createdAt", "structuredData.workCompleted")
        .limit(limit)
        .get()
      return snapshot.docs.map((doc) => {
        const data = doc.data() as RecordValue
        return {
          status: "submitted" as const,
          createdAt: toIso(data.createdAt),
          workCompleted: truncate(asRecord(data.structuredData)?.workCompleted, 240),
        }
      })
    },

    async getClockActivity(byeByeDprJobId) {
      const db = await getAdminDb()
      const [activeSnap, recentSnap] = await Promise.all([
        db.collection("clockRecords").where("jobId", "==", byeByeDprJobId).where("status", "==", "active").count().get(),
        db.collection("clockRecords").where("jobId", "==", byeByeDprJobId).orderBy("clockInAt", "desc").limit(1).get(),
      ])
      const activeWorkerCount = activeSnap.data().count
      const recentDoc = recentSnap.docs[0]
      if (activeWorkerCount === 0 && !recentDoc) return null
      return {
        activeWorkerCount,
        mostRecentClockInAt: recentDoc ? toIso((recentDoc.data() as RecordValue).clockInAt) : null,
      }
    },

    async getOperationalMessages(contextId, limit) {
      const { AUTOMATIC_MESSAGE_SOURCE_MODULES } = await import("@/lib/store")
      const db = await getAdminDb()
      const snapshot = await db
        .collection("messages")
        .where("contextIds", "array-contains", contextId)
        .where("sourceModule", "in", AUTOMATIC_MESSAGE_SOURCE_MODULES)
        .orderBy("timestamp", "desc")
        .limit(limit)
        .get()
      return snapshot.docs.map((doc) => {
        const data = doc.data() as RecordValue
        return {
          category: asString(data.sourceModule) === "three-week-outlook" ? "outlook" : asString(data.sourceModule) === "applications" ? "application" : "bye-bye-dpr",
          authorName: asString(data.authorName) || "SVC",
          text: truncate(data.text ?? data.content, 200) ?? "",
          createdAt: toIso(data.timestamp ?? data.createdAt),
        }
      })
    },

    async getApplications(directoryJobId, limit) {
      const db = await getAdminDb()
      const snapshot = await db
        .collection("applications")
        .where("entityIds", "array-contains", directoryJobId)
        .orderBy("updatedAt", "desc")
        .select("candidateName", "status", "updatedAt")
        .limit(limit)
        .get()
      return snapshot.docs.map((doc) => {
        const data = doc.data() as RecordValue
        return {
          candidateName: asString(data.candidateName) || "Unnamed candidate",
          status: asString(data.status) || "draft",
          updatedAt: toIso(data.updatedAt),
        }
      })
    },

    async getRelated(directoryId, limit) {
      const { relations } = await directory.getRelations(directoryId)
      return [...relations.people, ...relations.companies, ...relations.jobs]
        .slice(0, limit)
        .map((ref) => ({ name: ref.name, type: ref.type, ...(ref.role ? { relation: ref.role } : {}) }))
    },

    async getProject(projectId) {
      const db = await getAdminDb()
      const [projectSnap, updatesSnap] = await Promise.all([
        db.collection("questCoralProjects").doc(projectId).get(),
        db.collection("questCoralUpdates").where("projectId", "==", projectId).orderBy("createdAt", "desc").limit(1).get(),
      ])
      if (!projectSnap.exists) return null
      const data = projectSnap.data() as RecordValue
      return {
        status: asString(data.status) || "planning",
        progress: typeof data.progress === "number" ? data.progress : 0,
        ownerName: asString(data.ownerName) || "Unassigned",
        nextStep: truncate(data.nextStep, 200),
        recentUpdate: truncate((updatesSnap.docs[0]?.data() as RecordValue | undefined)?.body, 240),
      }
    },
  }
}
