"use client"

import { auth } from "@/lib/firebase"

/**
 * Browser-side callers for Directory's admin-gated routes: access delegation
 * (list/grant/revoke `directoryAdminAccess`) and the flagged-for-review
 * moderation queue — both consumed by the same access-management screen, so
 * they share this one client file rather than being split further. Every
 * request carries the current Firebase ID token; the server re-verifies it
 * and checks `/users/{uid}.directoryAdminAccess`/`isAdmin` itself. Mirrors
 * the relevant subset of `lib/courtney-roberts-center/client.ts`.
 *
 * `fetchDirectoryAccessData()` fetches both lists the access screen needs in
 * one request (GET /api/directory/access) rather than two separate ones —
 * see that route's comment — and caches the result briefly so reopening the
 * screen doesn't redo the whole round trip; `invalidateDirectoryAccessCache()`
 * drops that cache after a mutation.
 */

export class DirectoryAdminClientError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = "DirectoryAdminClientError"
    this.status = status
  }
}

async function authHeader(): Promise<string> {
  const user = auth.currentUser
  if (!user) throw new DirectoryAdminClientError("Please sign in again.", 401)
  return `Bearer ${await user.getIdToken()}`
}

async function readError(response: Response, fallback: string): Promise<never> {
  let message = fallback
  try {
    const body = (await response.json()) as { error?: unknown }
    if (typeof body.error === "string" && body.error) message = body.error
  } catch {
    /* keep fallback */
  }
  throw new DirectoryAdminClientError(message, response.status)
}

export type DirectoryAdminAccessUser = {
  uid: string
  name: string
  email: string
  hasAccess: boolean
  isLegacyAdmin: boolean
}

export type DirectoryFlaggedEntity = {
  directoryId: string
  sourceId: string
  sourceCollection: "contacts" | "contexts"
  type: "person" | "company" | "job" | "other"
  name: string
  reviewReason: string | null
  flaggedByName: string | null
  flaggedAt: number | null
}

export type DirectoryAccessData = {
  users: DirectoryAdminAccessUser[]
  flagged: DirectoryFlaggedEntity[]
}

// The access screen's two lists, cached briefly so closing and reopening it
// (the common case for the topbar icon) doesn't re-verify the token and
// re-run both queries every time. Short enough that another admin's grant/
// clear from a different session still shows up within a few seconds;
// invalidated immediately on any mutation this tab itself makes, so a
// reopen right after toggling access or clearing a flag never shows
// pre-mutation data.
const ACCESS_CACHE_TTL_MS = 30_000
let accessCache: { data: DirectoryAccessData; expiresAt: number } | null = null

/** Drop the cached { users, flagged } snapshot — call after any mutation so the next fetch is fresh. */
export function invalidateDirectoryAccessCache(): void {
  accessCache = null
}

/**
 * { users, flagged } together in one request — the admin roster and the
 * flagged-for-review queue, both fetched via GET /api/directory/access
 * (one requireDirectoryAdmin check) rather than two separate routes each
 * re-verifying the same token. Pass `force: true` to bypass the cache (not
 * currently needed anywhere — mutations invalidate it instead).
 */
export async function fetchDirectoryAccessData(options?: { force?: boolean }): Promise<DirectoryAccessData> {
  if (!options?.force && accessCache && accessCache.expiresAt > Date.now()) {
    return accessCache.data
  }
  const response = await fetch("/api/directory/access", { headers: { Authorization: await authHeader() } })
  if (!response.ok) await readError(response, "Unable to load Directory access data.")
  const data = (await response.json()) as DirectoryAccessData
  accessCache = { data, expiresAt: Date.now() + ACCESS_CACHE_TTL_MS }
  return data
}

export async function setDirectoryAdminAccessUser(uid: string, hasAccess: boolean): Promise<DirectoryAdminAccessUser> {
  const response = await fetch(`/api/directory/admins/${encodeURIComponent(uid)}`, {
    method: "PATCH",
    headers: { Authorization: await authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify({ hasAccess }),
  })
  if (!response.ok) await readError(response, "Unable to update access.")
  const { user } = (await response.json()) as { user: DirectoryAdminAccessUser }
  return user
}

/** Every person/company/job currently flagged for review — used standalone by directory-screen.tsx's topbar badge count, which doesn't need the admin roster. */
export async function fetchDirectoryFlaggedEntities(): Promise<DirectoryFlaggedEntity[]> {
  const response = await fetch("/api/directory/flagged", { headers: { Authorization: await authHeader() } })
  if (!response.ok) await readError(response, "Unable to load flagged records.")
  const { entities } = (await response.json()) as { entities: DirectoryFlaggedEntity[] }
  return entities
}
