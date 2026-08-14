"use client"

import { auth } from "@/lib/firebase"

export class OutlookCommsClientError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = "OutlookCommsClientError"
    this.code = code
  }
}

export async function publishOutlookVersionToComms(input: {
  jobContextId: string
  windowStart: string
  versionId: string
}): Promise<{ messageId: string }> {
  const user = auth.currentUser
  if (!user) throw new OutlookCommsClientError("unauthenticated", "Please sign in again to publish the Outlook.")

  const response = await fetch("/api/outlooks/publish-comms", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await user.getIdToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: unknown; code?: unknown } | null
    throw new OutlookCommsClientError(
      typeof body?.code === "string" ? body.code : "publish-failed",
      typeof body?.error === "string" ? body.error : "Could not publish the Outlook to Communications.",
    )
  }
  return await response.json() as { messageId: string }
}
