import type { Firestore } from "firebase-admin/firestore"
import { getFirebaseAdminApp } from "@/lib/ai/server/firebase-admin"
import { COURTNEY_ROBERTS_CENTER_ACCESS_FIELD } from "./access"

/**
 * Self-service admin management for Courtney Roberts Center — any user who
 * currently has access can grant or revoke it for anyone else from inside
 * the module. Replaces the earlier `COURTNEY_ROBERTS_CENTER_ADMIN_EMAILS`
 * Vercel env var, which required a redeploy to change and had drifted out
 * of sync with the module switcher's own (separate) visibility check —
 * the actual cause of a real access bug (an approved admin, `isAdmin:
 * false` on their /users doc, couldn't even see the entry point). Moving
 * the source of truth to Firestore, readable and writable from this
 * screen, removes that whole class of drift.
 */

type RecordValue = Record<string, unknown>

export type CourtneyRobertsCenterAccessUser = {
  uid: string
  name: string
  email: string
  hasAccess: boolean
}

export class CourtneyRobertsCenterAdminManagementError extends Error {
  readonly status: 400 | 404
  constructor(status: 400 | 404, message: string) {
    super(message)
    this.name = "CourtneyRobertsCenterAdminManagementError"
    this.status = status
  }
}

async function getAdminDb(): Promise<Firestore> {
  const { getFirestore } = await import("firebase-admin/firestore")
  return getFirestore(await getFirebaseAdminApp())
}

function toAccessUser(uid: string, data: RecordValue): CourtneyRobertsCenterAccessUser {
  const email = typeof data.email === "string" ? data.email : ""
  const name = typeof data.name === "string" && data.name ? data.name : email || "Unknown"
  return { uid, name, email, hasAccess: data[COURTNEY_ROBERTS_CENTER_ACCESS_FIELD] === true }
}

/** Test seam: the doc-shape mapping is where a schema drift would silently mislabel a user. */
export const toCourtneyRobertsCenterAccessUserForTests = toAccessUser

/** Every registered app user, sorted by name — this app has ~10 users, so one unbounded read is fine. */
export async function listCourtneyRobertsCenterAccessUsers(): Promise<CourtneyRobertsCenterAccessUser[]> {
  const db = await getAdminDb()
  const snapshot = await db.collection("users").get()
  return snapshot.docs
    .map((doc) => toAccessUser(doc.id, doc.data()))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function setCourtneyRobertsCenterAccess(uid: string, hasAccess: boolean): Promise<CourtneyRobertsCenterAccessUser> {
  if (!uid.trim()) throw new CourtneyRobertsCenterAdminManagementError(400, "Missing user id.")

  const db = await getAdminDb()
  const ref = db.collection("users").doc(uid)
  const snapshot = await ref.get()
  if (!snapshot.exists) throw new CourtneyRobertsCenterAdminManagementError(404, "User not found.")

  await ref.set({ [COURTNEY_ROBERTS_CENTER_ACCESS_FIELD]: hasAccess }, { merge: true })
  return toAccessUser(uid, { ...snapshot.data(), [COURTNEY_ROBERTS_CENTER_ACCESS_FIELD]: hasAccess })
}
