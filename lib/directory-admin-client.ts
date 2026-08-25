"use client"

import { auth } from "@/lib/firebase"

/**
 * Browser-side callers for Directory's admin-access delegation routes
 * (list/grant/revoke `directoryAdminAccess`). Every request carries the
 * current Firebase ID token; the server re-verifies it and checks
 * `/users/{uid}.directoryAdminAccess`/`isAdmin` itself. Mirrors the relevant
 * subset of `lib/courtney-roberts-center/client.ts`.
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

/** Every registered app user and whether they currently have Directory admin access — for the manage-access screen. */
export async function fetchDirectoryAdminAccessUsers(): Promise<DirectoryAdminAccessUser[]> {
  const response = await fetch("/api/directory/admins", { headers: { Authorization: await authHeader() } })
  if (!response.ok) await readError(response, "Unable to load users.")
  const { users } = (await response.json()) as { users: DirectoryAdminAccessUser[] }
  return users
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
