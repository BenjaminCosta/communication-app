"use client"

import { auth } from "@/lib/firebase"
import type { CourtneyRobertsCenterConversationSummary, CourtneyRobertsCenterMessage } from "./types"

/**
 * Browser-side callers for the Courtney Roberts Center read API. Same shape
 * as `features/bye-bye-dpr/client/byebye-dpr-client.ts` — every request
 * carries the current Firebase ID token, and this file owns only auth +
 * error shaping. Response types are `import type`-only from `./types` (no
 * runtime code, no Admin SDK), so nothing server-only ever reaches the
 * client bundle.
 */

export class CourtneyRobertsCenterClientError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = "CourtneyRobertsCenterClientError"
    this.status = status
  }
}

async function authHeader(): Promise<string> {
  const user = auth.currentUser
  if (!user) throw new CourtneyRobertsCenterClientError("Please sign in again.", 401)
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
  throw new CourtneyRobertsCenterClientError(message, response.status)
}

async function getJson<T>(path: string, fallback: string): Promise<T> {
  const response = await fetch(path, { headers: { Authorization: await authHeader() } })
  if (!response.ok) await readError(response, fallback)
  return (await response.json()) as T
}

function toQuery(input?: { limit?: number; cursor?: string }): string {
  const params = new URLSearchParams()
  if (input?.limit) params.set("limit", String(input.limit))
  if (input?.cursor) params.set("cursor", input.cursor)
  const query = params.toString()
  return query ? `?${query}` : ""
}

export type CourtneyRobertsCenterConversationsPage = {
  conversations: CourtneyRobertsCenterConversationSummary[]
  nextCursor?: string
}

export async function fetchCourtneyRobertsCenterConversations(
  input?: { limit?: number; cursor?: string },
): Promise<CourtneyRobertsCenterConversationsPage> {
  return getJson(`/api/courtney-roberts-center/conversations${toQuery(input)}`, "Unable to load conversations.")
}

export type CourtneyRobertsCenterThreadPage = {
  conversation: CourtneyRobertsCenterConversationSummary
  messages: CourtneyRobertsCenterMessage[]
  nextCursor?: string
}

export async function fetchCourtneyRobertsCenterThread(
  conversationId: string,
  input?: { limit?: number; cursor?: string },
): Promise<CourtneyRobertsCenterThreadPage> {
  return getJson(
    `/api/courtney-roberts-center/conversations/${encodeURIComponent(conversationId)}${toQuery(input)}`,
    "Unable to load this conversation.",
  )
}

export type CourtneyRobertsCenterLinkResult = {
  identityStatus: CourtneyRobertsCenterConversationSummary["identityStatus"]
  displayName: string
  resolvedUserId?: string
  resolvedPersonId?: string
  /** Whether the person was actually told they are now recognized. */
  recognitionNotice: "sent" | "deferred" | "skipped"
}

/** Manually links this conversation's WhatsApp number to an SVC account. */
export async function linkCourtneyRobertsCenterConversation(
  conversationId: string,
  email: string,
): Promise<CourtneyRobertsCenterLinkResult> {
  const response = await fetch(`/api/courtney-roberts-center/conversations/${encodeURIComponent(conversationId)}/link`, {
    method: "POST",
    headers: { Authorization: await authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  })
  if (!response.ok) await readError(response, "Unable to link this conversation.")
  return (await response.json()) as CourtneyRobertsCenterLinkResult
}

export type CourtneyRobertsCenterAccessUser = {
  uid: string
  name: string
  email: string
  hasAccess: boolean
}

/** Every registered app user and whether they currently have access — for the manage-access screen. */
export async function fetchCourtneyRobertsCenterAccessUsers(): Promise<CourtneyRobertsCenterAccessUser[]> {
  const { users } = await getJson<{ users: CourtneyRobertsCenterAccessUser[] }>(
    "/api/courtney-roberts-center/admins",
    "Unable to load users.",
  )
  return users
}

export async function setCourtneyRobertsCenterAccessUser(uid: string, hasAccess: boolean): Promise<CourtneyRobertsCenterAccessUser> {
  const response = await fetch(`/api/courtney-roberts-center/admins/${encodeURIComponent(uid)}`, {
    method: "PATCH",
    headers: { Authorization: await authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify({ hasAccess }),
  })
  if (!response.ok) await readError(response, "Unable to update access.")
  const { user } = (await response.json()) as { user: CourtneyRobertsCenterAccessUser }
  return user
}
