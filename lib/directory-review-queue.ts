import { getFirestore } from "firebase-admin/firestore"
import { getFirebaseAdminApp } from "@/lib/ai/server/firebase-admin"
import { classifyContext, directoryId, type CoreContext, type DirectoryType } from "@/lib/directory-core"

/**
 * Directory's moderation queue: every person/company/job currently flagged
 * for review (`masterData.needsReview === true`, set by
 * flagDirectoryEntityForReview() in lib/directory-writes.ts — see that
 * file's comment for why it lives in masterData). Flagging itself is open to
 * any signed-in user, but there was previously nowhere that listed flagged
 * records in aggregate — only the individual profile
 * (directory-flag-sheet.tsx) showed it. This is a small, ad hoc pair of
 * queries against the source collections; it does not touch the
 * directoryIndex/search-shard projection pipeline (that stays a
 * name/contact-fields projection, not a moderation index).
 */

export interface DirectoryFlaggedEntity {
  directoryId: string
  sourceId: string
  type: DirectoryType
  name: string
  reviewReason: string | null
}

function cleanStr(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function nameOf(data: Record<string, unknown>): string {
  const master = (data.masterData ?? {}) as Record<string, unknown>
  return cleanStr(master.displayName) ?? cleanStr(master.canonicalName) ?? cleanStr(data.name) ?? "Unknown"
}

function reviewReasonOf(data: Record<string, unknown>): string | null {
  const master = (data.masterData ?? {}) as Record<string, unknown>
  return cleanStr(master.reviewReason)
}

/** Every flagged person, company and job, sorted by name. */
export async function listFlaggedDirectoryEntities(): Promise<DirectoryFlaggedEntity[]> {
  const db = getFirestore(await getFirebaseAdminApp())
  const [contactsSnap, contextsSnap] = await Promise.all([
    db.collection("contacts").where("masterData.needsReview", "==", true).get(),
    db.collection("contexts").where("masterData.needsReview", "==", true).get(),
  ])

  const people: DirectoryFlaggedEntity[] = contactsSnap.docs.map((doc) => {
    const data = doc.data()
    return {
      directoryId: directoryId("person", doc.id),
      sourceId: doc.id,
      type: "person",
      name: nameOf(data),
      reviewReason: reviewReasonOf(data),
    }
  })

  const others: DirectoryFlaggedEntity[] = contextsSnap.docs.map((doc) => {
    const data = doc.data()
    const type = classifyContext({ id: doc.id, ...data } as CoreContext)
    return {
      directoryId: directoryId(type, doc.id),
      sourceId: doc.id,
      type,
      name: nameOf(data),
      reviewReason: reviewReasonOf(data),
    }
  })

  return [...people, ...others].sort((a, b) => a.name.localeCompare(b.name))
}
