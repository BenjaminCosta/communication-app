"use client"

import { auth } from "@/lib/firebase"

/**
 * Browser-side callers for the admin-gated Directory cleanup routes
 * (merge duplicate / delete). Every request carries the current Firebase ID
 * token; the server re-verifies it and checks /users/{uid}.isAdmin itself —
 * this client never decides who's allowed, it just surfaces what the server
 * says. Mirrors features/directory/ai/client/directory-ai-client.ts.
 */

export class DirectoryCleanupClientError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "DirectoryCleanupClientError"
  }
}

async function authHeader(): Promise<string> {
  const user = auth.currentUser
  if (!user) throw new DirectoryCleanupClientError("Please sign in again.")
  const token = await user.getIdToken()
  return `Bearer ${token}`
}

async function readError(response: Response, fallback: string): Promise<never> {
  let message = fallback
  try {
    const body = (await response.json()) as { error?: unknown }
    if (typeof body.error === "string" && body.error) message = body.error
  } catch {
    /* keep fallback */
  }
  throw new DirectoryCleanupClientError(message)
}

export interface DirectoryDeleteImpact {
  contexts: number
  notes: number
  files: number
  messages: number
  messagesCapped: boolean
  relations: number
}

async function callDelete(directoryId: string, dryRun: boolean): Promise<DirectoryDeleteImpact> {
  const response = await fetch("/api/directory/delete", {
    method: "POST",
    headers: { Authorization: await authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify({ directoryId, dryRun }),
  })
  if (!response.ok) await readError(response, "Could not complete this delete. Try again.")
  const body = (await response.json()) as { impact: DirectoryDeleteImpact }
  return body.impact
}

/** Preview what deleting this entity would touch, without deleting anything. */
export function requestDirectoryDeleteImpact(directoryId: string): Promise<DirectoryDeleteImpact> {
  return callDelete(directoryId, true)
}

/** Delete the entity after the impact preview has been confirmed. */
export function requestDirectoryDelete(directoryId: string): Promise<DirectoryDeleteImpact> {
  return callDelete(directoryId, false)
}

export interface DirectoryMergeResult {
  survivorDirectoryId: string
}

export async function requestDirectoryMerge(survivorContactId: string, duplicateContactId: string): Promise<DirectoryMergeResult> {
  const response = await fetch("/api/directory/merge", {
    method: "POST",
    headers: { Authorization: await authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify({ survivorContactId, duplicateContactId }),
  })
  if (!response.ok) await readError(response, "Could not merge these contacts. Try again.")
  return (await response.json()) as DirectoryMergeResult
}
