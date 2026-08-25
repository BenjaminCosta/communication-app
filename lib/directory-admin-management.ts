import type { Firestore } from "firebase-admin/firestore"
import { getFirebaseAdminApp } from "@/lib/ai/server/firebase-admin"
import { DIRECTORY_ADMIN_ACCESS_FIELD } from "./directory-admin-guard"

/**
 * Self-service admin-access management for Directory — any user who
 * currently has Directory admin access (`directoryAdminAccess` or the
 * legacy `isAdmin`, see directory-admin-guard.ts) can grant or revoke
 * `directoryAdminAccess` for anyone else from inside the module. Mirrors
 * Courtney Roberts Center's `admin-management.ts` exactly: same self-service
 * shape, same reasoning for staying a single flag rather than a tiered
 * permission model, same "any admin can manage any user, including
 * themselves" posture (this screen just disables the self-toggle in the UI
 * so nobody accidentally locks themselves out — the API itself doesn't
 * forbid it, matching CRC).
 */

type RecordValue = Record<string, unknown>

export type DirectoryAdminAccessUser = {
  uid: string
  name: string
  email: string
  hasAccess: boolean
  /** True when this user has Directory admin access via the legacy global `isAdmin` flag, independent of `hasAccess`.
   * Revoking `hasAccess` for them here does NOT remove their access — `isAdmin` still grants it — so the UI surfaces
   * this rather than let the toggle silently appear to do nothing. */
  isLegacyAdmin: boolean
}

export class DirectoryAdminManagementError extends Error {
  readonly status: 400 | 404
  constructor(status: 400 | 404, message: string) {
    super(message)
    this.name = "DirectoryAdminManagementError"
    this.status = status
  }
}

async function getAdminDb(): Promise<Firestore> {
  const { getFirestore } = await import("firebase-admin/firestore")
  return getFirestore(await getFirebaseAdminApp())
}

function toAccessUser(uid: string, data: RecordValue): DirectoryAdminAccessUser {
  const email = typeof data.email === "string" ? data.email : ""
  const name = typeof data.name === "string" && data.name ? data.name : email || "Unknown"
  return {
    uid,
    name,
    email,
    hasAccess: data[DIRECTORY_ADMIN_ACCESS_FIELD] === true,
    isLegacyAdmin: data.isAdmin === true,
  }
}

/** Test seam: the doc-shape mapping is where a schema drift would silently mislabel a user. */
export const toDirectoryAdminAccessUserForTests = toAccessUser

/** Every registered app user, sorted by name — this app has ~10 users, so one unbounded read is fine. */
export async function listDirectoryAdminAccessUsers(): Promise<DirectoryAdminAccessUser[]> {
  const db = await getAdminDb()
  const snapshot = await db.collection("users").get()
  return snapshot.docs
    .map((doc) => toAccessUser(doc.id, doc.data()))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function setDirectoryAdminAccess(uid: string, hasAccess: boolean): Promise<DirectoryAdminAccessUser> {
  if (!uid.trim()) throw new DirectoryAdminManagementError(400, "Missing user id.")

  const db = await getAdminDb()
  const ref = db.collection("users").doc(uid)
  const snapshot = await ref.get()
  if (!snapshot.exists) throw new DirectoryAdminManagementError(404, "User not found.")

  await ref.set({ [DIRECTORY_ADMIN_ACCESS_FIELD]: hasAccess }, { merge: true })
  return toAccessUser(uid, { ...snapshot.data(), [DIRECTORY_ADMIN_ACCESS_FIELD]: hasAccess })
}
